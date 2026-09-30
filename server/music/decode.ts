import { spawn } from 'node:child_process';

export const ANALYSIS_SAMPLE_RATE = 22050;

/** Decode any audio/video file to mono float32 PCM at `sampleRate` using ffmpeg. */
export function decodeAudio(
  filePath: string,
  sampleRate = ANALYSIS_SAMPLE_RATE,
  ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg',
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpegPath,
      ['-v', 'error', '-nostdin', '-i', filePath, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      bytes += chunk.length;
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(new Error(`Could not run ffmpeg (${ffmpegPath}): ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg failed to decode ${filePath} (exit ${code}): ${stderr.trim().slice(0, 500)}`));
        return;
      }
      // Copy into a fresh, 4-byte-aligned buffer before viewing as float32.
      const usable = bytes - (bytes % 4);
      const aligned = new ArrayBuffer(usable);
      const view = new Uint8Array(aligned);
      let offset = 0;
      for (const chunk of chunks) {
        const take = Math.min(chunk.length, usable - offset);
        if (take <= 0) break;
        view.set(take === chunk.length ? chunk : chunk.subarray(0, take), offset);
        offset += take;
      }
      resolve(new Float32Array(aligned));
    });
  });
}
