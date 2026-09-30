import { spawn } from 'node:child_process';
import { FFMPEG } from '../config';

/** Every sound effect, the mix and the render's audio run at this rate. */
export const SOUND_SAMPLE_RATE = 48000;

export interface Stereo {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

export function silence(sampleRate: number, samples: number): Stereo {
  return { sampleRate, left: new Float32Array(samples), right: new Float32Array(samples) };
}

/** 32-bit float stereo WAV (what the library caches, the preview loads and ffmpeg encodes from). */
export function encodeWav(audio: Stereo): Buffer {
  const frames = audio.left.length;
  const dataBytes = frames * 2 * 4;
  const buf = Buffer.alloc(58 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(50 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(18, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(audio.sampleRate, 24);
  buf.writeUInt32LE(audio.sampleRate * 8, 28);
  buf.writeUInt16LE(8, 32);
  buf.writeUInt16LE(32, 34);
  buf.writeUInt16LE(0, 36);
  buf.write('fact', 38);
  buf.writeUInt32LE(4, 42);
  buf.writeUInt32LE(frames, 46);
  buf.write('data', 50);
  buf.writeUInt32LE(dataBytes, 54);
  let o = 58;
  for (let i = 0; i < frames; i++) {
    buf.writeFloatLE(audio.left[i], o);
    buf.writeFloatLE(audio.right[i], o + 4);
    o += 8;
  }
  return buf;
}

/** Read a PCM (16/24/32-bit) or float WAV; mono is duplicated to both channels. Returns null for anything else. */
export function decodeWav(buf: Buffer): Stereo | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
      // WAVE_FORMAT_EXTENSIBLE: the real format tag sits in the sub-format GUID.
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(body + 24);
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size));
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!data || channels < 1 || channels > 2 || !sampleRate) return null;
  const bytes = bits / 8;
  let read: (at: number) => number;
  if (format === 3 && bits === 32) read = (at) => data.readFloatLE(at);
  else if (format === 1 && bits === 16) read = (at) => data.readInt16LE(at) / 32768;
  else if (format === 1 && bits === 24) read = (at) => data.readIntLE(at, 3) / 8388608;
  else if (format === 1 && bits === 32) read = (at) => data.readInt32LE(at) / 2147483648;
  else return null;
  const frames = Math.floor(data.length / (bytes * channels));
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const at = i * bytes * channels;
    left[i] = read(at);
    right[i] = channels === 2 ? read(at + bytes) : left[i];
  }
  return { sampleRate, left, right };
}

/**
 * Decode any audio file ffmpeg reads to stereo float at `sampleRate`. With `start`/`length` (seconds),
 * only that window is decoded, padded with silence when the file ends early.
 */
export function decodeFile(file: string, opts: { sampleRate?: number; start?: number; length?: number } = {}): Promise<Stereo> {
  const sampleRate = opts.sampleRate ?? SOUND_SAMPLE_RATE;
  const args = ['-v', 'error', '-nostdin'];
  if (opts.start) args.push('-ss', opts.start.toFixed(6));
  args.push('-i', file, '-vn');
  if (opts.length !== undefined) args.push('-t', opts.length.toFixed(6));
  args.push('-ac', '2', '-ar', String(sampleRate), '-f', 'f32le', '-');
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on('error', (e) => reject(new Error(`Could not run ffmpeg (${FFMPEG}): ${e.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg could not decode ${file}: ${stderr.trim().split('\n').pop() || `exit ${code}`}`));
        return;
      }
      const raw = Buffer.concat(chunks);
      const decoded = Math.floor(raw.length / 8);
      const frames = opts.length !== undefined ? Math.round(opts.length * sampleRate) : decoded;
      const left = new Float32Array(frames);
      const right = new Float32Array(frames);
      for (let i = 0; i < Math.min(frames, decoded); i++) {
        left[i] = raw.readFloatLE(i * 8);
        right[i] = raw.readFloatLE(i * 8 + 4);
      }
      resolve({ sampleRate, left, right });
    });
  });
}

export const db = (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);
