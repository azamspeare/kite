/** fnmatch-style patterns, as huggingface_hub's allow_patterns use them (`*` also matches `/`). */
function matches(file: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regex}$`).test(file);
}

/** Total size of a Hugging Face model repo's files (only those matching `patterns`, if given); null when it can't be listed. */
export async function hfRepoSize(repo: string, patterns?: string[]): Promise<number | null> {
  try {
    const res = await fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const entries = (await res.json()) as { type: string; path: string; size?: number }[];
    const files = entries.filter((e) => e.type === 'file' && (!patterns || patterns.some((p) => matches(e.path, p))));
    const total = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}
