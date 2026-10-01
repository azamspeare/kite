import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { readTheme } from './theme';

const saved = new Map<string, string>([['sb:theme', 'dark']]);
const storage = {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => saved.set(key, value),
};
const root = { dataset: { theme: 'dark' } };
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root } });
const { setTheme, useEditor } = await import('./store');

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)![1];

function boot() {
  const document = { documentElement: { dataset: {} as Record<string, string> } };
  runInNewContext(bootstrap, { localStorage: storage, document });
  return document.documentElement.dataset.theme;
}

test('the editor initializes with the saved theme', () => {
  assert.equal(useEditor.getState().theme, 'dark');
});

test('the pre-paint bootstrap and editor agree on saved, missing and invalid preferences', () => {
  assert.ok(html.indexOf('<script>') < html.indexOf('<link rel="stylesheet"'));
  for (const value of [null, '', 'system', 'light', 'dark', 'invalid', 'DARK']) {
    if (value === null) saved.delete('sb:theme');
    else saved.set('sb:theme', value);
    const expected = value === 'light' || value === 'dark' ? value : 'system';
    assert.equal(readTheme(), expected);
    assert.equal(boot(), expected);
  }
});

test('theme changes apply immediately and persist through reloads, including returning to System', () => {
  for (const theme of ['light', 'dark', 'system'] as const) {
    setTheme(theme);
    assert.equal(root.dataset.theme, theme);
    assert.equal(useEditor.getState().theme, theme);
    assert.equal(saved.get('sb:theme'), theme);
    assert.equal(readTheme(), theme);
    assert.equal(boot(), theme);
  }
});

test('unavailable storage falls back to the system theme without breaking the bootstrap', (t) => {
  t.mock.method(storage, 'getItem', () => {
    throw new Error('Storage unavailable');
  });
  assert.equal(readTheme(), 'system');
  assert.equal(boot(), undefined);
});

test('a theme can still be changed when persistence is unavailable', (t) => {
  t.mock.method(storage, 'setItem', () => {
    throw new Error('Storage unavailable');
  });
  setTheme('dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(useEditor.getState().theme, 'dark');
});
