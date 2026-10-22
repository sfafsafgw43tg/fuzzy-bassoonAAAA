import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(__dirname, '../../..');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
it('brands Windows resources and relaunch names without changing legal attribution', async () => {
  const { applyChromiumBranding } = await import(pathToFileURL(path.join(root, 'tools/lib/chromium-branding.mjs')).href);
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'inkbrowser-branding-')); dirs.push(source);
  const files = {
    'chrome/app/theme/chromium/win/chromium.ico': 'old-icon',
    'chrome/common/chrome_constants.cc': '// Copyright The Chromium Authors\nFPL("chrome.exe");',
    'chrome/install_static/chromium_install_modes.h': 'L"Chromium"; L"ChromiumHTM";',
    'chrome/app/chromium_strings.grd': '<message name="IDS_PRODUCT_NAME">Chromium</message><message name="IDS_COPYRIGHT">The Chromium Authors</message>',
  };
  for (const [name, value] of Object.entries(files)) { const p = path.join(source, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); }
  const branding = path.join(root, 'branding/inkbrowser-chrome');
  applyChromiumBranding(source, branding);
  const read = (name: string) => fs.readFileSync(path.join(source, name), 'utf8');
  expect(read('chrome/common/chrome_constants.cc')).toContain('FPL("inkbrowser-chrome.exe")');
  expect(read('chrome/common/chrome_constants.cc')).toContain('Copyright The Chromium Authors');
  expect(read('chrome/install_static/chromium_install_modes.h')).toContain('L"InkBrowserHTM"');
  expect(read('chrome/app/chromium_strings.grd')).toContain('>InkBrowser</message>');
  expect(read('chrome/app/chromium_strings.grd')).toContain('>The Chromium Authors</message>');
  expect(fs.readFileSync(path.join(source, 'chrome/app/theme/chromium/win/chromium.ico'))).toEqual(fs.readFileSync(path.join(branding, 'icon.ico')));
  expect(() => applyChromiumBranding(source, branding)).not.toThrow();
});
it('keeps the release version pins aligned with the Windows selection catalog', async () => {
  const { catalogForPlatform } = await import('../../shell/src/runtime-catalog');
  const versions = JSON.parse(fs.readFileSync(path.join(root, 'tools/chromium-versions.json'), 'utf8'));
  expect(versions).toEqual(catalogForPlatform('win32', 'x64').filter(entry => entry.support === 'supported' && !entry.distribution).map(entry => entry.version));
});
it('sets Octo taskbar identity, icon and relaunch metadata before creating windows', () => {
  const prepare = fs.readFileSync(path.join(root, 'packages/shell/src/prepare.ts'), 'utf8');
  expect(prepare).toContain("app.on('browser-window-created'");
  expect(prepare).toContain('window.setAppDetails');
  expect(prepare).toContain('relaunchDisplayName: info.productName');
  expect(prepare).toContain("appIconPath: path.join(distDir, 'assets', 'icon.ico')");
});
it('stages runtime resources without shipping compiler object trees', async () => {
  const { copyChromiumPayload } = await import(pathToFileURL(path.join(root, 'tools/lib/chromium-payload.mjs')).href);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'inkbrowser-payload-')); dirs.push(work);
  const build = path.join(work, 'build'); const output = path.join(work, 'payload');
  const files = ['chrome.exe', 'chrome.dll', 'locales/en-US.pak', 'resources.pak', 'obj/chrome.obj', 'gen/generated.cc', 'chrome.pdb', 'build.ninja'];
  for (const name of files) { const file = path.join(build, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, name); }
  copyChromiumPayload(build, output);
  for (const name of files.slice(0, 4)) expect(fs.existsSync(path.join(output, name))).toBe(true);
  for (const name of files.slice(4)) expect(fs.existsSync(path.join(output, name))).toBe(false);
});
