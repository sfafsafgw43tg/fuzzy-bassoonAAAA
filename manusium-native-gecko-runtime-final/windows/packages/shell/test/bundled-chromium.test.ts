import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { listInstalled } from '../src/runtime-catalog';
import { discoverEngineRuntime } from '../src/engine-runtime';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inkbrowser-bundled-'));
  roots.push(root);
  const resources = path.join(root, 'resources');
  const user = path.join(root, 'user');
  const make = (version: string, manifestVersion = version) => {
    const dir = path.join(resources, 'engines/chromium', version);
    fs.mkdirSync(dir, { recursive: true });
    const exe = path.join(dir, 'inkbrowser-chrome.exe');
    fs.writeFileSync(exe, `fixture ${version}`);
    fs.writeFileSync(path.join(dir, 'runtime.json'), JSON.stringify({
      schema: 'octo.engine-manifest.v1', kind: 'chromium', version: manifestVersion,
      executable: 'inkbrowser-chrome.exe', protocol: 'cdp', platforms: ['win32-x64'],
      capabilities: ['window', 'tabs'], distribution: 'source-built', modified: true,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),
    }));
    return exe;
  };
  return { resources, user, make };
}
describe('bundled InkBrowser versions', () => {
  it('marks both packaged versions as available and installer-managed', () => {
    const f = fixture();
    f.make('155.0.8059.39'); f.make('156.0.8078.12');
    const entries = listInstalled(f.user, 'win32', 'x64', [f.resources]);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.installed).toBe(true);
      expect(entry.bundled).toBe(true);
      expect(entry.installable).toBe(false);
    }
  });
  it('launch discovery resolves the exact selected version, not the newest', () => {
    const f = fixture();
    for (const version of ['155.0.8059.39', '156.0.8078.12']) f.make(version);
    for (const version of ['155.0.8059.39', '156.0.8078.12']) {
      expect(discoverEngineRuntime('chromium', { resourcesPath: f.resources, platform: 'win32', arch: 'x64', version }).version).toBe(version);
    }
    expect(() => discoverEngineRuntime('chromium', { resourcesPath: f.resources, platform: 'win32', arch: 'x64', version: '1.2.3.4' })).toThrow(/No packaged/);
  });
  it('does not show tampered or mislabeled versions as installed', () => {
    const f = fixture();
    const exe = f.make('155.0.8059.39'); fs.appendFileSync(exe, 'tampered');
    f.make('156.0.8078.12', '155.0.8059.39');
    expect(listInstalled(f.user, 'win32', 'x64', [f.resources]).every(entry => !entry.installed)).toBe(true);
    expect(() => discoverEngineRuntime('chromium', { resourcesPath: f.resources, platform: 'win32', arch: 'x64', version: '156.0.8078.12' })).toThrow(/does not match manifest version/);
  });
});
