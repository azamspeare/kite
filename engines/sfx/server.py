"""Storyboard's sound-effects engine: Stable Audio Open 1.0 (via diffusers) behind a small local HTTP API.

    python server.py --download                     fetch the model into ./models (needs a Hugging Face token with the license accepted)
    python server.py --host 127.0.0.1 --port 8002   serve; the model loads in the background

    GET  /health    {"status", "ready", "loading", "model", "device", "error"}
    POST /generate  Authorization: Bearer $SFX_API_KEY
                    {"prompt", "negative_prompt"?, "duration", "variations"?, "steps"?, "guidance"?, "seed"?}
                    -> {"sample_rate", "seed", "seconds", "clips": [base64 WAV, ...]}

`./storyboard setup` installs it and downloads the model; `./storyboard start|stop|status|logs` runs it (and sets SFX_API_KEY).
"""

from __future__ import annotations

import argparse
import base64
import hmac
import io
import json
import math
import os
import random
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# The model lives next to this file (engines/sfx/models), inside Storyboard's folder, not in ~/.cache/huggingface.
os.environ["HF_HUB_CACHE"] = str(Path(__file__).resolve().parent / "models")
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

MODEL_ID = "stabilityai/stable-audio-open-1.0"
MODEL_NAME = "stable-audio-open-1.0"
LICENSE_URL = f"https://huggingface.co/{MODEL_ID}"
# Only the diffusers-format files (~5.3 GB); the repo's single-file stable-audio-tools checkpoints are skipped.
ALLOW_PATTERNS = [
    "model_index.json",
    "LICENSE.md",
    "scheduler/*",
    "text_encoder/*",
    "tokenizer/*",
    "transformer/*",
    "vae/*",
    "projection_model/*",
]
REQUIRED_FILES = [
    "model_index.json",
    "scheduler/scheduler_config.json",
    "text_encoder/model.safetensors",
    "tokenizer/tokenizer.json",
    "transformer/diffusion_pytorch_model.safetensors",
    "vae/diffusion_pytorch_model.safetensors",
    "projection_model/diffusion_pytorch_model.safetensors",
]
NOT_DOWNLOADED = "Model not downloaded — run `./storyboard setup`"

MIN_DURATION, MAX_DURATION = 0.2, 20.0
DEFAULT_STEPS = 100
DEFAULT_GUIDANCE = 7.0
# Isolated one-shots, not music or ambience.
DEFAULT_NEGATIVE = "music, melody, singing, speech, voice, background noise, hum, low quality, distorted, muffled"
# Extra latent length beyond the requested duration, so the sound can end naturally before the cut.
LATENT_MARGIN_S = 0.3
MIN_LATENTS = 32
MAX_BODY_BYTES = 64 * 1024


class State:
    def __init__(self) -> None:
        self.pipe = None
        self.ready = False
        self.loading = False
        self.error: str | None = None
        self.device = "cpu"
        self.dtype = None
        self.generate_lock = threading.Lock()


state = State()


def log(message: str) -> None:
    print(f"[sfx {time.strftime('%H:%M:%S')}] {message}", flush=True)


# ---------------------------------------------------------------------------
# Model files


def local_model_path() -> Path | None:
    """The cached snapshot, if every file the pipeline needs is there (never touches the network)."""
    from huggingface_hub import snapshot_download

    try:
        path = Path(snapshot_download(MODEL_ID, allow_patterns=ALLOW_PATTERNS, local_files_only=True))
    except Exception:
        return None
    return path if all((path / f).is_file() for f in REQUIRED_FILES) else None


def license_hint() -> str:
    return (
        f"Stable Audio Open is gated on Hugging Face: accept its license at {LICENSE_URL}\n"
        "(\"Agree and access repository\") and create a Read token. `./storyboard setup` walks you through it."
    )


def download() -> int:
    from huggingface_hub import get_token, snapshot_download
    from huggingface_hub.errors import GatedRepoError, HfHubHTTPError, RepositoryNotFoundError

    existing = local_model_path()
    if existing:
        print(f"Model already downloaded: {existing}")
        return 0
    if not get_token():
        print("Not logged in to Hugging Face.\n")
        print(license_hint())
        return 2
    print(f"Downloading {MODEL_ID} (diffusers weights, about 5.3 GB)…", flush=True)
    try:
        path = snapshot_download(MODEL_ID, allow_patterns=ALLOW_PATTERNS)
    except (GatedRepoError, RepositoryNotFoundError) as e:
        print(f"\nHugging Face refused the download ({type(e).__name__}).\n")
        print(license_hint())
        return 2
    except HfHubHTTPError as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status in (401, 403):
            print(f"\nHugging Face refused the download (HTTP {status}).\n")
            print(license_hint())
            return 2
        raise
    missing = [f for f in REQUIRED_FILES if not (Path(path) / f).is_file()]
    if missing:
        print(f"Download incomplete, missing: {', '.join(missing)}. Run it again.")
        return 1
    print(f"Done: {path}")
    return 0


# ---------------------------------------------------------------------------
# Inference


def pick_device():
    import torch

    wanted = os.environ.get("SFX_DEVICE", "").strip().lower()
    if wanted:
        device = wanted
    elif torch.cuda.is_available():
        device = "cuda"
    elif torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"
    dtype_name = os.environ.get("SFX_DTYPE", "").strip().lower() or ("float16" if device == "cuda" else "float32")
    return device, getattr(torch, dtype_name)


def patch_noise_sampler() -> None:
    """
    Stable Audio's scheduler (CosineDPMSolverMultistepScheduler) asks its Brownian-tree noise sampler for noise
    down to sigma 0 on the last step, below the tree's sigma_min; torchsde then recurses until it crashes
    (RecursionError). That step's noise is multiplied by sigma 0 anyway, so answer it with zeros, and keep every
    other query inside the tree's range.
    """
    import torch
    from diffusers.schedulers import scheduling_cosine_dpmsolver_multistep as cosine
    from diffusers.schedulers.scheduling_dpmsolver_sde import BrownianTreeNoiseSampler

    class InRangeNoiseSampler(BrownianTreeNoiseSampler):
        def __init__(self, x, sigma_min, sigma_max, seed=None, transform=lambda x: x):
            super().__init__(x, sigma_min, sigma_max, seed, transform)
            self.bounds = (float(sigma_min), float(sigma_max))
            self.zeros = torch.zeros_like(x)

        def __call__(self, sigma, sigma_next):
            lo, hi = self.bounds
            a, b = float(sigma), float(sigma_next)
            if min(a, b) < lo * (1 - 1e-4):
                return self.zeros
            return super().__call__(torch.tensor(min(a, hi)), torch.tensor(min(b, hi)))

    cosine.BrownianTreeNoiseSampler = InRangeNoiseSampler


def latent_length(duration: float) -> int:
    pipe = state.pipe
    sample_rate = pipe.vae.config.sampling_rate
    hop = pipe.vae.hop_length
    n = math.ceil((duration + LATENT_MARGIN_S) * sample_rate / hop)
    n = max(MIN_LATENTS, math.ceil(n / 8) * 8)
    return min(n, int(pipe.transformer.config.sample_size))


def run_pipeline(prompt: str, negative: str, duration: float, variations: int, steps: int, guidance: float, seed: int):
    """Returns float32 numpy audio shaped (variations, channels, samples)."""
    import torch

    pipe = state.pipe
    generator = torch.Generator("cpu").manual_seed(seed)
    # The pipeline denoises the model's whole 47.55 s window unless it gets latents; a window just longer
    # than the sound is much faster and the output is still cut to audio_end_in_s.
    shape = (variations, pipe.transformer.config.in_channels, latent_length(duration))
    latents = torch.randn(shape, generator=generator, dtype=torch.float32).to(state.device, state.dtype)
    with torch.inference_mode():
        out = pipe(
            prompt=prompt,
            negative_prompt=negative or None,
            audio_end_in_s=duration,
            num_inference_steps=steps,
            guidance_scale=guidance,
            num_waveforms_per_prompt=variations,
            latents=latents,
            generator=generator,
            output_type="np",
        )
    return out.audios


def load_model() -> None:
    state.loading = True
    try:
        state.device, state.dtype = pick_device()
        path = local_model_path()
        if path is None:
            state.error = NOT_DOWNLOADED
            log(state.error)
            return
        import torch
        from diffusers import StableAudioPipeline

        patch_noise_sampler()
        log(f"Loading {MODEL_NAME} on {state.device} ({str(state.dtype).replace('torch.', '')})…")
        started = time.time()
        pipe = StableAudioPipeline.from_pretrained(str(path), torch_dtype=state.dtype)
        pipe = pipe.to(state.device)
        pipe.set_progress_bar_config(disable=True)
        state.pipe = pipe
        # Warm up (the first call compiles kernels), so "ready" means ready.
        run_pipeline("click", "", 0.5, 1, 2, DEFAULT_GUIDANCE, 0)
        if state.device == "mps":
            torch.mps.empty_cache()
        state.ready = True
        state.error = None
        log(f"Ready in {time.time() - started:.1f}s")
    except Exception as e:
        state.pipe = None
        state.error = f"Could not load the model: {e}"
        log(state.error)
        traceback.print_exc()
    finally:
        state.loading = False


def wav_bytes(audio, sample_rate: int) -> bytes:
    import soundfile as sf

    buffer = io.BytesIO()
    # (channels, samples) -> (samples, channels); float WAV keeps any overs for the caller to handle.
    sf.write(buffer, audio.T, sample_rate, format="WAV", subtype="FLOAT")
    return buffer.getvalue()


class BadRequest(Exception):
    pass


def number(body: dict, key: str, default, lo: float, hi: float, cast=float):
    value = body.get(key, default)
    if value is None:
        return None
    try:
        value = cast(value)
    except (TypeError, ValueError):
        raise BadRequest(f"{key} must be a number")
    if isinstance(value, float) and not math.isfinite(value):
        raise BadRequest(f"{key} must be a finite number")
    if value < lo or value > hi:
        raise BadRequest(f"{key} must be between {lo:g} and {hi:g}")
    return value


def generate(body: dict) -> dict:
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise BadRequest("prompt is required")
    if len(prompt) > 1000:
        raise BadRequest("prompt is too long (1000 characters max)")
    duration = number(body, "duration", None, MIN_DURATION, MAX_DURATION)
    if duration is None:
        raise BadRequest("duration is required")
    variations = number(body, "variations", 1, 1, 4, int)
    steps = number(body, "steps", DEFAULT_STEPS, 4, 250, int)
    guidance = number(body, "guidance", DEFAULT_GUIDANCE, 1, 15)
    seed = number(body, "seed", None, 0, 2**31 - 1, int)
    if seed is None:
        seed = random.randint(0, 2**31 - 1)
    extra = str(body.get("negative_prompt") or "").strip()
    negative = f"{DEFAULT_NEGATIVE}, {extra}" if extra else DEFAULT_NEGATIVE

    with state.generate_lock:
        started = time.time()
        audios = run_pipeline(prompt, negative, duration, variations, steps, guidance, seed)
        if state.device == "mps":
            import torch

            torch.mps.empty_cache()
        seconds = time.time() - started
    sample_rate = int(state.pipe.vae.config.sampling_rate)
    clips = [base64.b64encode(wav_bytes(a, sample_rate)).decode("ascii") for a in audios]
    log(f"{variations}× {duration:g}s in {seconds:.1f}s ({steps} steps, seed {seed}): {prompt[:80]}")
    return {"sample_rate": sample_rate, "seed": seed, "seconds": round(seconds, 2), "clips": clips}


# ---------------------------------------------------------------------------
# HTTP


class Handler(BaseHTTPRequestHandler):
    server_version = "StoryboardSFX/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args) -> None:  # noqa: A002 (stdlib signature)
        if self.path != "/health":
            log(f"{self.address_string()} {format % args}")

    def send_json(self, status: int, payload: dict, close: bool = False) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if close:
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path.split("?")[0] != "/health":
            self.send_json(404, {"error": "Not found"})
            return
        self.send_json(
            200,
            {
                "status": "ok",
                "ready": state.ready,
                "loading": state.loading,
                "model": MODEL_NAME,
                "device": state.device,
                "error": state.error,
            },
        )

    def do_POST(self) -> None:
        if self.path.split("?")[0] != "/generate":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY_BYTES:
            # The body (if any) stays unread, so this connection can't be reused.
            self.send_json(400, {"error": "Send a JSON body (64 KB max)"}, close=True)
            return
        raw = self.rfile.read(length)
        expected = os.environ.get("SFX_API_KEY", "")
        given = self.headers.get("Authorization", "")
        if not hmac.compare_digest(given.encode("utf-8"), f"Bearer {expected}".encode("utf-8")):
            self.send_json(401, {"error": "Missing or wrong API key"})
            return
        try:
            body = json.loads(raw)
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            self.send_json(400, {"error": "The body must be a JSON object"})
            return
        if not state.ready:
            message = "The model is still loading" if state.loading else (state.error or "The model is not loaded")
            self.send_json(503, {"error": message})
            return
        try:
            self.send_json(200, generate(body))
        except BadRequest as e:
            self.send_json(400, {"error": str(e)})
        except Exception as e:
            traceback.print_exc()
            self.send_json(500, {"error": f"Generation failed: {e}"})


def serve(host: str, port: int) -> int:
    if not os.environ.get("SFX_API_KEY"):
        print("Set SFX_API_KEY first (`./storyboard start` does it for you).", file=sys.stderr)
        return 2
    # Serving never downloads anything; `--download` does.
    os.environ["HF_HUB_OFFLINE"] = "1"
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    threading.Thread(target=load_model, name="load-model", daemon=True).start()
    log(f"Listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Storyboard sound-effects engine (Stable Audio Open)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8002)
    parser.add_argument("--download", action="store_true", help="download the model and exit")
    parser.add_argument("--check", action="store_true", help="exit 0 if the model is downloaded, 1 if not")
    args = parser.parse_args()
    if args.download:
        return download()
    if args.check:
        path = local_model_path()
        print(path if path else NOT_DOWNLOADED)
        return 0 if path else 1
    return serve(args.host, args.port)


if __name__ == "__main__":
    sys.exit(main())
