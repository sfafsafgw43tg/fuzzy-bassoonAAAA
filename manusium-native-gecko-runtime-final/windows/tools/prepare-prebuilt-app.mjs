#!/usr/bin/env node
/**
 * Create the runnable, prebuilt Windows layout used by the source installer.
 *
 * This is intentionally not electron-builder: normal users must not need a
 * packaging toolchain. Electron's documented manual layout is:
 *   <app>/electron.exe
 *   <app>/resources/app/package.json + application files
 * Native engines, when supplied by a release, live in resources/engines.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetPlatform = process.env.OCTO_PREBUILT_PLATFORM ?? process.platform;
const targetArch = process.env.OCTO_PREBUILT_ARCH ?? process.arch;
if (targetPlatform !== 'win32' || targetArch !== 'x64') {
  throw new Error(`Windows x64 prebuilt preparation required; received ${targetPlatform}-${targetArch}.`);
}

const electronDir = path.join(root, 'node_modules', 'electron');
const electronDist = path.join(electronDir, 'dist');
const electronExe = path.join(electronDist, 'electron.exe');
if (!fs.existsSync(electronExe)) {
  throw new Error(`Prebuilt Electron/Chromium binary is missing: ${electronExe}. Run the dependency repair step first.`);
}

const apps = [
  { id: 'octobrowser', folder: 'OctoBrowser', exe: 'Octo.su.exe' },
  { id: 'octodetect', folder: 'OctoDetect', exe: 'OctoDetect.su.exe' },
];

function copyTree(source, destination) {
  fs.cpSync(source, destination, { recursive: true, force: true });
}
function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

for (const app of apps) {
  const sourceApp = path.join(root, 'apps', app.id);
  const sourceDist = path.join(sourceApp, 'dist');
  const sourcePackage = path.join(sourceApp, 'package.json');
  if (!fs.existsSync(path.join(sourceDist, 'main.js'))) throw new Error(`Built ${app.id} app is missing dist/main.js.`);
  if (!fs.existsSync(sourcePackage)) throw new Error(`Built ${app.id} app is missing package.json.`);

  const output = path.join(root, 'release', app.id, 'win-unpacked');
  const outputResources = path.join(output, 'resources');
  resetDir(output);
  copyTree(electronDist, output);
  const outputExe = path.join(output, app.exe);
  copyFile(electronExe, outputExe);
  fs.rmSync(path.join(output, 'electron.exe'), { force: true });
  const rcedit = path.join(root, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  const icon = path.join(root, 'branding', app.id, 'icon.ico');
  if (fs.existsSync(rcedit) && fs.existsSync(icon)) {
    const result = spawnSync(rcedit, [outputExe, '--set-icon', icon,
      '--set-version-string', 'ProductName', app.id === 'octobrowser' ? 'Octo.su' : 'OctoDetect.su',
      '--set-version-string', 'FileDescription', app.id === 'octobrowser' ? 'Octo.su' : 'OctoDetect.su',
      '--set-version-string', 'OriginalFilename', app.exe], { stdio: 'inherit', windowsHide: true, shell: false });
    if (result.error || result.status !== 0) throw new Error(`Branding ${app.id} failed with exit code ${result.status ?? 'unknown'}.`);
  }

  const appResources = path.join(outputResources, 'app');
  fs.mkdirSync(appResources, { recursive: true });
  copyFile(sourcePackage, path.join(appResources, 'package.json'));
  copyTree(sourceDist, path.join(appResources, 'dist'));

  // Keep resource paths compatible with process.resourcesPath in the app.
  for (const name of ['engines', 'addons', 'filters', 'licenses']) {
    const source = path.join(root, 'resources', name);
    if (fs.existsSync(source)) copyTree(source, path.join(outputResources, name));
  }
  console.log(`[prepare-prebuilt-app] ${app.id}: ${path.relative(root, output)}`);
}
console.log('[prepare-prebuilt-app] complete: self-contained Electron/Chromium app bundles are ready.');
