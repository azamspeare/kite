function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return (Math.floor(seed * 2654435761) ^ 0x9e3779b9) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random number in [0, 1) for a seed. Same seed → same value, every frame. */
export function random(seed: number | string): number {
  let a = hashSeed(seed);
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Deterministic random number in [min, max). */
export function randomRange(seed: number | string, min: number, max: number): number {
  return min + random(seed) * (max - min);
}

/** Smooth 1D value noise in [-1, 1]; use for gentle drift: noise(t * 0.8, 'card') * 6 */
export function noise(x: number, seed: number | string = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = random(`${seed}:${i}`) * 2 - 1;
  const b = random(`${seed}:${i + 1}`) * 2 - 1;
  return a + (b - a) * u;
}
