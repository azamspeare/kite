export type Theme = 'system' | 'light' | 'dark';

export function readTheme(): Theme {
  try {
    const theme = localStorage.getItem('sb:theme');
    return theme === 'light' || theme === 'dark' ? theme : 'system';
  } catch {
    return 'system';
  }
}
