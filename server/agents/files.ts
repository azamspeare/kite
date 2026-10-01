import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectState } from '../../src/shared/types';
import { KeyedMutex, writeFileAtomic } from '../util';

const MAX_BYTES = 1024 * 1024;
const mutex = new KeyedMutex();

/** File tools for agents without per-file permissions. No traversal, hidden files, or symlink following. */
export class ProjectFiles {
  constructor(
    private project: ProjectState,
    private sceneId?: string,
  ) {}

  private async resolve(file: string, write = false) {
    const parts = file.split('/');
    if (
      !file ||
      path.isAbsolute(file) ||
      file.includes('\\') ||
      file.includes('\0') ||
      parts.some((p) => !p || p.startsWith('.'))
    ) {
      throw new Error('Use a project-relative file path without hidden files or traversal.');
    }
    const readable =
      file === 'project.json' || file === 'art-direction.md' || ['scenes', 'components', 'assets'].includes(parts[0]);
    const sceneFile = this.project.scenes.some((s) => file === `scenes/${s.id}.tsx`);
    const writable = this.sceneId
      ? file === `scenes/${this.sceneId}.tsx`
      : sceneFile || file === 'art-direction.md' || (parts[0] === 'components' && parts.length > 1);
    if (!readable || (write && !writable))
      throw new Error(
        write
          ? 'This chat may not edit that file. Use the Project chat and the structure tools to manage scenes.'
          : 'That file is not part of the project source or assets.',
      );
    let target = this.project.dir;
    for (const part of parts) {
      target = path.join(target, part);
      const stat = await fs.lstat(target).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null;
        throw e;
      });
      if (stat?.isSymbolicLink()) throw new Error('Symlinks are not allowed in project file tools.');
    }
    return target;
  }

  async list(): Promise<string[]> {
    const files: string[] = [];
    const visit = async (dir: string, depth: number) => {
      if (depth > 12 || files.length >= 500) return;
      const entries = await fs.readdir(path.join(this.project.dir, dir), { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink() || files.length >= 500) continue;
        const file = dir ? `${dir}/${entry.name}` : entry.name;
        if (!dir && !['scenes', 'components', 'assets', 'art-direction.md', 'project.json'].includes(entry.name)) continue;
        if (entry.isDirectory()) await visit(file, depth + 1);
        else if (entry.isFile()) files.push(file);
      }
    };
    await visit('', 0);
    return files;
  }

  async read(file: string): Promise<string> {
    const target = await this.resolve(file);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Read a text file smaller than 1 MB.');
    const data = await fs.readFile(target);
    if (data.includes(0)) throw new Error('This is a binary file.');
    return data.toString('utf8');
  }

  async write(file: string, content: string) {
    return mutex.run(path.join(this.project.dir, file), async () => {
      const target = await this.resolve(file, true);
      if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('Project source files must be smaller than 1 MB.');
      await writeFileAtomic(target, content);
    });
  }

  async edit(file: string, oldText: string, newText: string) {
    return mutex.run(path.join(this.project.dir, file), async () => {
      const target = await this.resolve(file, true);
      const content = await this.read(file);
      if (!oldText || content.split(oldText).length !== 2)
        throw new Error('old_text must match exactly once. Read the file again before editing.');
      const next = content.replace(oldText, () => newText);
      if (Buffer.byteLength(next) > MAX_BYTES) throw new Error('Project source files must be smaller than 1 MB.');
      await writeFileAtomic(target, next);
    });
  }
}
