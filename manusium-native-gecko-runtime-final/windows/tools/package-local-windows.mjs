// Source setup creates the same branded executable layout as a release. It never
// compiles/downloads Chromium and never treats stale dist/main.js as installed.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { versions, runNode } from './chromium-versions.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Local Octo packaging requires Windows x64.');
const receipt = path.join(root, 'release', '.octo-local-ready.json');
fs.rmSync(receipt, { force: true });
for (const version of versions) {
  runNode('verify-packaged-chromium.mjs', [`--root=${root}`], { ...process.env, INKBROWSER_CHROMIUM_VERSION: version });
}
runNode('build-icons.mjs');
runNode('build.mjs');
for (const app of ['octobrowser', 'octodetect']) {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'), '--win', '--x64', '--dir', '--projectDir', path.join(root, 'apps', app)], { cwd: root, stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error(`Packaging ${app} failed: ${result.error?.message ?? result.status}`);
}
runNode('chromium-versions.mjs', ['verify-packaged']);
runNode('verify-windows-branding.mjs');
runNode('chromium-versions.mjs', ['test']);
fs.writeFileSync(receipt, JSON.stringify({ schema: 'octo.local-ready.v1', versions, checkedAt: new Date().toISOString() }));
console.log('Branded Octo executables and both prebuilt InkBrowser runtimes verified.');
