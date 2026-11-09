import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'apps', 'octobrowser');
const brandedExe = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'Octo.su.exe' : 'Octo.su');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

function fail(message) {
  console.error(`[start-browser] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(appDir, 'dist', 'main.js'))) fail('The browser bundle is missing. Run npm run build:browser first.');

if (process.platform === 'win32') {
  if (!fs.existsSync(brandedExe)) {
    const brand = spawnSync(process.execPath, [path.join(root, 'tools', 'brand-electron-dev.mjs')], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (brand.error || brand.status !== 0 || !fs.existsSync(brandedExe)) {
      fail('The branded Octo.su development executable could not be prepared; refusing to start raw electron.exe because Windows would register the taskbar item as Electron.');
    }
  }
  const child = spawn(brandedExe, [appDir, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', windowsHide: true });
  child.on('error', (error) => fail(error.message));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} else {
  const cli = require.resolve('electron/cli.js');
  const child = spawn(process.execPath, [cli, appDir, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
  child.on('error', (error) => fail(error.message));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
