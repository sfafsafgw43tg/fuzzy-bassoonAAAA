import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] || (process.platform === 'win32' ? 'win32-x64' : 'linux-x64');
const out = path.join(root, '.runtime-test');
const version = process.env.INKBROWSER_CHROMIUM_VERSION ?? '155.0.8059.39';
const versionDir = path.join(out, version);
const suppliedRoot = process.argv.find(arg => arg.startsWith('--root='))?.slice('--root='.length);
let runtimeRoot = out;
let stagedTemporaryRuntime = false;
try {
  if (target === 'win32-x64') {
    if (process.platform !== 'win32') throw new Error('Windows native runtime tests require Windows; cross-platform execution is not verification.');
    const appRoot = path.resolve(suppliedRoot ?? (process.argv.includes('--packaged') ? path.join(root, 'release', 'octobrowser', 'win-unpacked') : root));
    const verification = spawnSync(process.execPath, [path.join(root, 'tools', 'verify-packaged-chromium.mjs'), `--root=${appRoot}`], { cwd: root, stdio: 'inherit' });
    if (verification.error || verification.status !== 0) throw new Error('Runtime payload verification failed; refusing to launch.');
    runtimeRoot = path.join(appRoot, 'resources', 'engines', 'chromium');
    const packaged = path.join(runtimeRoot, version);
    const manifestPath = path.join(packaged, 'runtime.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`source-built Windows runtime is missing: ${manifestPath}; run npm run build:chromium:windows on Windows first`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.distribution !== 'source-built' || manifest.modified !== true) throw new Error('refusing to test a repackaged Chrome for Testing runtime');
    // Test these exact installed files, not a copied/staged substitute.
  } else {
    stagedTemporaryRuntime = true;
    const stage = spawnSync(process.execPath, [path.join(root, 'tools', 'stage-chromium.mjs'), '--target', target, '--out', versionDir], { cwd: root, stdio: 'inherit' });
    if (stage.status !== 0) process.exit(stage.status ?? 1);
  }
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'packages/shell/test/native-engine.integration.test.ts'], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, OCTO_PACKAGED_CHROMIUM_ROOT: runtimeRoot, INKBROWSER_CHROMIUM_VERSION: version, OCTO_REQUIRE_NATIVE_RUNTIME: '1', OCTO_CHROMIUM_PATH: '' },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (stagedTemporaryRuntime) fs.rmSync(out, { recursive: true, force: true });
}
