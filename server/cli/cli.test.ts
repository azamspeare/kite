import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { parseServices, parseSetup } from './args';
import { checkHfAccess } from './sfx';
import { fit, formatDuration, formatSize, visible, wrap } from './ui';
import { UV_PYTHON_DIR, venvIsOurs } from './uv';

describe('parseServices', () => {
  it('reads service names and skips options', () => {
    assert.deepEqual(parseServices(['music', '-f']), ['music']);
    assert.deepEqual(parseServices([]), []);
    assert.deepEqual(parseServices(['all']), ['app', 'music', 'sfx']);
    assert.deepEqual(parseServices(['kite', 'app']), ['app']);
  });

  it('rejects anything else', () => {
    assert.equal(parseServices(['musik']), null);
    assert.equal(parseServices(['app', 'sounds']), null);
  });
});

describe('parseSetup', () => {
  it('reads --yes and the on/off choices', () => {
    assert.deepEqual(parseSetup([]), { yes: false });
    assert.deepEqual(parseSetup(['--yes', '--music=on', '--sfx=off']), { yes: true, music: true, sfx: false });
    assert.deepEqual(parseSetup(['-y', '--sfx=yes']), { yes: true, sfx: true });
    assert.deepEqual(parseSetup(['--yes', '--provider=codex']), { yes: true, provider: 'codex' });
    assert.deepEqual(parseSetup(['--provider=claude-code']), { yes: false, provider: 'claude-code' });
    assert.equal(parseSetup(['--provider=other']), null);
  });

  it('reads and validates network choices in both flag forms', () => {
    assert.deepEqual(parseSetup(['--yes', '--host=0.0.0.0', '--port=5299']), { yes: true, host: '0.0.0.0', port: 5299 });
    assert.deepEqual(parseSetup(['--ip', '192.168.1.10', '--port', '65535']), { yes: false, host: '192.168.1.10', port: 65535 });
    assert.deepEqual(parseSetup(['--host=::', '--port=1']), { yes: false, host: '::', port: 1 });
    assert.deepEqual(parseSetup(['--host', 'localhost']), { yes: false, host: 'localhost' });
    for (const value of ['', '0', '65536', '-1', '1.5', '1e3', 'abc', ' 80', '0x50'])
      assert.equal(parseSetup([`--port=${value}`]), null, value);
    for (const value of ['', 'example.com', 'http://127.0.0.1', '127.0.0.1:80', '999.1.1.1', '[::1]', 'fe80::1%en0'])
      assert.equal(parseSetup([`--host=${value}`]), null, value);
    assert.equal(parseSetup(['--port']), null);
    assert.equal(parseSetup(['--host', '--yes']), null);
  });

  it('rejects unknown options', () => {
    assert.equal(parseSetup(['--music']), null);
    assert.equal(parseSetup(['--music=maybe']), null);
    assert.equal(parseSetup(['music']), null);
  });
});

describe('venvIsOurs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-venv-'));
  const venv = (home: string) => {
    const dir = fs.mkdtempSync(path.join(tmp, 'venv-'));
    fs.writeFileSync(path.join(dir, 'pyvenv.cfg'), `home = ${home}\nversion_info = 3.12\n`);
    return dir;
  };

  it("accepts only environments made with uv's Python in the app folder", () => {
    assert.equal(venvIsOurs(venv(path.join(UV_PYTHON_DIR, 'cpython-3.12-macos-aarch64-none', 'bin'))), true);
    assert.equal(venvIsOurs(venv('/opt/homebrew/opt/python@3.12/bin')), false);
    assert.equal(venvIsOurs(venv(`${UV_PYTHON_DIR}-elsewhere/bin`)), false);
    assert.equal(venvIsOurs(path.join(tmp, 'missing')), false);
  });
});

describe('checkHfAccess', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  /** Hugging Face answering whoami and the gated model file with these statuses. */
  const huggingFace = (whoami: number, modelFile: number) => {
    globalThis.fetch = (async (url: string | URL | Request) =>
      String(url).includes('/api/whoami-v2')
        ? new Response(JSON.stringify({ name: 'ada' }), { status: whoami })
        : new Response(null, { status: modelFile })) as typeof fetch;
  };

  it('tells a bad token, a missing license and access apart', async () => {
    huggingFace(401, 200);
    assert.deepEqual(await checkHfAccess('hf_x'), { ok: false, problem: 'token' });
    huggingFace(200, 403);
    assert.deepEqual(await checkHfAccess('hf_x'), { ok: false, problem: 'license', user: 'ada' });
    huggingFace(200, 302);
    assert.deepEqual(await checkHfAccess('hf_x'), { ok: true, user: 'ada' });
    huggingFace(200, 200);
    assert.deepEqual(await checkHfAccess('hf_x'), { ok: true, user: 'ada' });
  });

  it('reports network problems', async () => {
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND huggingface.co');
    }) as typeof fetch;
    assert.deepEqual(await checkHfAccess('hf_x'), {
      ok: false,
      problem: 'network',
      detail: 'getaddrinfo ENOTFOUND huggingface.co',
    });
  });
});

describe('ui', () => {
  it('wraps text to the width, breaking words longer than a line', () => {
    const lines = wrap(`short words ${'x'.repeat(250)} end`);
    assert.ok(lines.length >= 3);
    for (const line of lines) assert.ok(line.length <= 106, `${line.length} characters`);
    assert.equal(lines.join('').replace(/ /g, ''), `shortwords${'x'.repeat(250)}end`);
  });

  it('cuts colored lines by what shows, keeping the color codes', () => {
    const line = `\x1b[32m✓\x1b[39m ${'y'.repeat(200)}`;
    const cut = fit(line, 40);
    assert.equal(visible(cut), 40);
    assert.ok(cut.startsWith('\x1b[32m✓'));
    assert.equal(fit('short', 40), 'short');
  });

  it('formats sizes and durations', () => {
    assert.equal(formatSize(762e9), '762 GB');
    assert.equal(formatSize(10.09e9), '10.1 GB');
    assert.equal(formatSize(94e6), '94 MB');
    assert.equal(formatDuration(12.4), '12 s');
    assert.equal(formatDuration(240), '4 min');
    assert.equal(formatDuration(3900), '1 h 5 min');
  });
});
