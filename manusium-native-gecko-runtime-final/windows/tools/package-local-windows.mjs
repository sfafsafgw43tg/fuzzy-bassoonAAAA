// Source setup creates the same branded executable layout as a release. It never
// compiles/downloads Chromium and never treats stale dist/main.js as installed.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { versions, runNode } from './chromium-versions.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Local Octo packaging requires Windows x64.');
const skipNativeRuntimeVerify = process.env.OCTO_SKIP_NATIVE_RUNTIME_VERIFY === '1';
const receipt = path.join(root, 'release', '.octo-local-ready.json');
fs.rmSync(receipt, { force: true });
if (!skipNativeRuntimeVerify) {
  for (const version of versions) {
    runNode('verify-packaged-chromium.mjs', [`--root=${root}`], { ...process.env, INKBROWSER_CHROMIUM_VERSION: version });
  }
}
runNode('build-icons.mjs');
runNode('build.mjs');
for (const app of ['octobrowser', 'octodetect']) {
  const output = path.join(root, 'release', app);
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'), '--win', '--x64', '--dir', '--config.directories.output=' + output, '--projectDir', path.join(root, 'apps', app)], { cwd: root, stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error(`Packaging ${app} failed: ${result.error?.message ?? result.status}`);
}
if (!skipNativeRuntimeVerify) runNode('chromium-versions.mjs', ['verify-packaged']);
runNode('verify-windows-branding.mjs');
if (!skipNativeRuntimeVerify) runNode('chromium-versions.mjs', ['test']);
fs.writeFileSync(receipt, JSON.stringify({ schema: 'octo.local-ready.v1', versions, nativeRuntimeVerified: !skipNativeRuntimeVerify, checkedAt: new Date().toISOString() }));
console.log(skipNativeRuntimeVerify
  ? 'Branded Octo executables packaged; native InkBrowser runtime verification was skipped for the normal installer path.'
  : 'Branded Octo executables and the native InkBrowser runtime were verified.');
