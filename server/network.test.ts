import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { allowedHost, isCrossSite, networkConfig, networkExposed } from './network';
import { readSettings, writeSettings } from './settings';
import { BASE_URL, HOST, ROOT } from './config';
import { appNeedsRestart } from './cli/services';

describe('network configuration', () => {
  it('keeps existing installs local and gives environment variables precedence', () => {
    assert.deepEqual(networkConfig(null, {}), { host: '127.0.0.1', port: 5199, baseUrl: 'http://127.0.0.1:5199' });
    assert.deepEqual(networkConfig({ host: '0.0.0.0', port: 5299 }, {}), {
      host: '0.0.0.0',
      port: 5299,
      baseUrl: 'http://127.0.0.1:5299',
    });
    assert.deepEqual(networkConfig({ host: '0.0.0.0', port: 5299 }, { HOST: '192.168.1.20', PORT: '6000' }), {
      host: '192.168.1.20',
      port: 6000,
      baseUrl: 'http://192.168.1.20:6000',
    });
    assert.equal(networkConfig({ host: '::', port: 5299 }, {}).baseUrl, 'http://[::1]:5299');
    assert.equal(networkConfig({ host: '2001:db8::1' }, {}).baseUrl, 'http://[2001:db8::1]:5199');
    for (const PORT of ['', '0', '65536', '1.5', '1e3', ' 80', 'NaN']) assert.throws(() => networkConfig(null, { PORT }), /PORT/);
    assert.throws(() => networkConfig(null, { HOST: 'bad.example' }), /HOST/);
  });

  it('identifies network-exposed binds', () => {
    for (const host of ['127.0.0.1', '127.0.0.2', 'localhost', '::1', '0:0:0:0:0:0:0:1'])
      assert.equal(networkExposed(host), false, host);
    for (const host of ['0.0.0.0', '::', '192.168.1.20', '2001:db8::1']) assert.equal(networkExposed(host), true, host);
  });

  it('preserves settings and accepts older settings files', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-settings-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'settings.json');
    assert.equal(readSettings(file), null);
    const old = { music: true, sfx: false, provider: 'codex' as const };
    writeSettings(old, file);
    assert.deepEqual(readSettings(file), old);
    const next = { ...readSettings(file)!, host: '0.0.0.0', port: 5299 };
    writeSettings(next, file);
    assert.deepEqual(readSettings(file), next);
    assert.throws(() => writeSettings({ ...next, port: 0 }, file), /Invalid port/);
    assert.deepEqual(readSettings(file), next);
    fs.writeFileSync(file, JSON.stringify({ ...old, host: 'bad.example', port: -1 }));
    assert.deepEqual(readSettings(file), old);
  });

  it('loads saved choices on startup and refreshes live URLs after setup saves', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-config-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'server'));
    for (const name of ['config.ts', 'settings.ts', 'paths.ts', 'network.ts'])
      fs.copyFileSync(path.join(ROOT, 'server', name), path.join(dir, 'server', name));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    writeSettings({ music: false, sfx: true, host: '0.0.0.0', port: 5299 }, path.join(dir, '.storyboard/settings.json'));
    const { HOST: _host, PORT: _port, ...env } = process.env;
    const result = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import * as config from './server/config.ts';
      import { readSettings, writeSettings } from './server/settings.ts';
      assert.equal(config.HOST, '0.0.0.0');
      assert.equal(config.PORT, 5299);
      assert.equal(config.BASE_URL, 'http://127.0.0.1:5299');
      writeSettings({ ...readSettings(), host: '::', port: 5399 });
      config.reloadNetworkConfig();
      assert.equal(config.HOST, '::');
      assert.equal(config.MCP_URL, 'http://[::1]:5399/mcp');
      assert.equal(readSettings().sfx, true);
      console.log('ok');
    `,
      ],
      { cwd: dir, env, encoding: 'utf8' },
    );
    assert.equal(result.trim(), 'ok');
  });

  it('requires a managed app restart when its saved address or port changes', () => {
    const info = { pid: 1, startedAt: 0, url: BASE_URL, host: HOST };
    assert.equal(appNeedsRestart(info), false);
    assert.equal(appNeedsRestart({ ...info, url: 'http://127.0.0.1:1' }), true);
    assert.equal(appNeedsRestart({ ...info, host: HOST === '0.0.0.0' ? '127.0.0.1' : '0.0.0.0' }), true);
  });
});

describe('network request guards', () => {
  it('accepts loopback and the bound LAN address but rejects DNS rebinding hosts', () => {
    for (const host of ['localhost:5299', '127.0.0.1:5299', '[::1]:5299']) assert.equal(allowedHost(host, '127.0.0.1'), true);
    assert.equal(allowedHost('192.168.1.20:5299', '192.168.1.20'), true);
    assert.equal(allowedHost('192.168.1.20:5299', '0.0.0.0', '192.168.1.20'), true);
    assert.equal(allowedHost('192.168.1.20:5299', '::', '::ffff:192.168.1.20'), true);
    assert.equal(allowedHost('[2001:db8::1]:5299', '::', '2001:db8::1'), true);
    assert.equal(allowedHost('192.168.1.20:5299', '127.0.0.1'), false);
    assert.equal(allowedHost('192.168.1.21:5299', '0.0.0.0', '192.168.1.20'), false);
    for (const host of [
      undefined,
      '',
      'evil.example:5299',
      'localhost.evil.example',
      'localhost@evil.example',
      'localhost/path',
      'localhost:99999',
    ])
      assert.equal(allowedHost(host, '0.0.0.0', '192.168.1.20'), false, String(host));
  });

  it('accepts the literal wildcard bind address without weakening origin checks', () => {
    assert.equal(allowedHost('0.0.0.0:5299', '0.0.0.0', '127.0.0.1'), true);
    assert.equal(allowedHost('[::]:5299', '::', '::1'), true);
    assert.equal(allowedHost('0.0.0.0:5299', '127.0.0.1', '127.0.0.1'), false);
    assert.equal(allowedHost('[::]:5299', '::1', '::1'), false);
    const host = '0.0.0.0:5299';
    assert.equal(isCrossSite({ headers: { host, origin: `http://${host}` } }), false);
    assert.equal(isCrossSite({ headers: { host, origin: 'http://evil.example' } }), true);
    assert.equal(isCrossSite({ headers: { host, origin: `http://${host}`, 'sec-fetch-site': 'cross-site' } }), true);
  });

  it('allows same-origin LAN requests and non-browser clients, not cross-site calls', () => {
    const host = '192.168.1.20:5299';
    assert.equal(isCrossSite({ headers: { host } }), false);
    assert.equal(isCrossSite({ headers: { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' } }), false);
    for (const origin of ['http://evil.example', 'http://192.168.1.20:5399', `https://${host}`, 'null', 'not a url'])
      assert.equal(isCrossSite({ headers: { host, origin } }), true);
    for (const site of ['cross-site', 'same-site'])
      assert.equal(isCrossSite({ headers: { host, 'sec-fetch-site': site } }), true);
  });
});
