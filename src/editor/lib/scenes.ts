/** The moment a scene's thumbnail shows: most of the way in, when its entrances have usually landed. */
export function posterTime(duration: number): number {
  return Math.max(0, Math.min(duration - 0.02, duration * 0.62));
}
