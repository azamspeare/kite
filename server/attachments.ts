import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Attachment } from '../src/shared/types';
import { attachmentKind, maxBytes } from '../src/shared/chatOptions';
import { INTERNAL_DIR } from './config';
import { decodeFile } from './sound/audio';
import { HttpError, KeyedMutex, readJson, writeJson } from './util';

/*
 * Files attached to chat messages. They are kept in the project's assets/ folder, where scenes can show
 * them (`asset('<id>')`) and the agent can open them; the message only points at them by name.
 */

/** An attachment's file name: a random prefix, a dash, a safe stem and a short extension. Nothing else is accepted. */
export const ATTACHMENT_ID = /^[a-z0-9]{6}-[A-Za-z0-9_-]{1,60}\.[a-z0-9]{1,5}$/;

/** What the files don't say about themselves: the name each had on the user's computer, and audio lengths. */
type Index = Record<string, { name: string; duration?: number }>;

const indexLock = new KeyedMutex();
const indexFile = (projectDir: string) => path.join(projectDir, INTERNAL_DIR, 'attachments.json');
const MB = 1024 * 1024;

/**
 * SVG is markup: opened on its own it runs in the editor's origin, next to /api. Anything that could run
 * script (script elements, event attributes, javascript: links, embedded HTML) is refused.
 */
const ACTIVE_SVG = /<script|\son[a-z]+\s*=|javascript:|<foreignObject/i;

/** The attachment's stem, without its random prefix or extension: a good default name for a sound made from it. */
export function attachmentStem(id: string): string {
  return id.replace(/^[a-z0-9]{6}-/, '').replace(/\.[a-z0-9]+$/, '');
}

/** Seconds of audio in a file; throws when ffmpeg can't read it as audio. */
async function measure(file: string): Promise<number> {
  const rate = 8000;
  const decoded = await decodeFile(file, { sampleRate: rate });
  if (decoded.left.length === 0) throw new Error('it holds no audio');
  return Math.round((decoded.left.length / rate) * 1000) / 1000;
}

/** Keep an uploaded file in assets/ and describe it. Images and audio only; audio must decode. */
export async function saveAttachment(projectDir: string, originalName: string, data: Buffer): Promise<Attachment> {
  const name = originalName.trim();
  if (!name || name.length > 200) throw new HttpError(400, 'The file needs a name of at most 200 characters');
  const kind = attachmentKind(name);
  if (!kind) throw new HttpError(415, `Kite can attach images and audio files, not “${name}”`);
  if (data.length === 0) throw new HttpError(400, `“${name}” is empty`);
  const limit = maxBytes(kind);
  if (data.length > limit)
    throw new HttpError(413, `${kind === 'image' ? 'Images' : 'Audio files'} are limited to ${limit / MB} MB`);

  const ext = path.extname(name).slice(1).toLowerCase();
  if (ext === 'svg' && ACTIVE_SVG.test(data.toString('utf8'))) {
    throw new HttpError(415, `“${name}” contains scripts, which Kite doesn't attach. Export it as a PNG instead.`);
  }
  const stem =
    path
      .basename(name, path.extname(name))
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'file';
  const id = `${randomBytes(6)
    .toString('base64url')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '0')
    .slice(0, 6)}-${stem}.${ext}`;
  const dir = path.join(projectDir, 'assets');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, id);
  await fs.writeFile(file, data, { flag: 'wx' });

  let duration: number | undefined;
  if (kind === 'audio') {
    try {
      duration = await measure(file);
    } catch {
      await fs.rm(file, { force: true });
      throw new HttpError(400, `“${name}” can't be read as audio`);
    }
  }
  await indexLock.run(projectDir, async () => {
    const index = await readJson<Index>(indexFile(projectDir), {});
    index[id] = { name, ...(duration !== undefined ? { duration } : {}) };
    await writeJson(indexFile(projectDir), index);
  });
  return { id, name, kind, size: data.length, ...(duration !== undefined ? { duration } : {}) };
}

/** The attachments a message names, read back from the disk. Any id that isn't one of this project's files fails. */
export async function findAttachments(projectDir: string, ids: readonly string[]): Promise<Attachment[]> {
  if (ids.length === 0) return [];
  const index = await readJson<Index>(indexFile(projectDir), {});
  return Promise.all(
    ids.map(async (id) => {
      const kind = ATTACHMENT_ID.test(id) ? attachmentKind(id) : null;
      const stat = kind ? await fs.stat(path.join(projectDir, 'assets', id)).catch(() => null) : null;
      if (!kind || !stat?.isFile()) throw new HttpError(400, 'An attached file is missing. Attach it again.');
      const known = index[id];
      return {
        id,
        name: known?.name ?? id,
        kind,
        size: stat.size,
        ...(kind === 'audio' && known?.duration !== undefined ? { duration: known.duration } : {}),
      };
    }),
  );
}
