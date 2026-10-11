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
import crypto from 'node:crypto';
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

const chromiumVersion = process.env.INKBROWSER_CHROMIUM_VERSION ?? '155.0.8059.39';
const chromiumRequired = process.env.OCTO_REQUIRE_NATIVE_CHROMIUM !== '0';
const chromiumRequiredFiles = [
  'inkbrowser-chrome.exe', 'chrome.dll', 'chrome_elf.dll', 'chrome_child.dll',
  'resources.pak', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
  'icudtl.dat', 'v8_context_snapshot.bin', 'locales/en-US.pak',
];
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function verifyBundledChromium(resourcesRoot) {
  const runtimeRoot = path.join(resourcesRoot, 'engines', 'chromium', chromiumVersion);
  const manifestPath = path.join(runtimeRoot, 'runtime.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Bundled InkBrowser Chromium manifest is missing: ${manifestPath}`);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (error) { throw new Error(`Bundled InkBrowser Chromium manifest is invalid: ${error.message}`); }
  if (manifest.schema !== 'octo.engine-manifest.v1' || manifest.kind !== 'chromium') throw new Error('Bundled InkBrowser Chromium manifest schema/kind is invalid.');
  if (manifest.version !== chromiumVersion || manifest.executable !== 'inkbrowser-chrome.exe') throw new Error(`Bundled InkBrowser Chromium is not pinned to ${chromiumVersion}.`);
  if (manifest.distribution !== 'source-built' || manifest.modified !== true) throw new Error('Bundled Chromium is not marked as a modified source-built InkBrowser runtime.');
  if (!Array.isArray(manifest.platforms) || !manifest.platforms.includes('win32-x64')) throw new Error('Bundled InkBrowser Chromium does not declare win32-x64 support.');
  for (const relative of chromiumRequiredFiles) {
    const file = path.join(runtimeRoot, ...relative.split('/'));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Bundled InkBrowser Chromium file is missing: ${file}`);
  }
  const executable = path.join(runtimeRoot, 'inkbrowser-chrome.exe');
  const expected = String(manifest.sha256 ?? manifest.executableSha256 ?? '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected) || sha256(executable).toLowerCase() !== expected) throw new Error('Bundled InkBrowser Chromium executable SHA-256 does not match runtime.json.');
  return runtimeRoot;
}
const sourceEngines = path.join(root, 'resources', 'engines');
if (chromiumRequired) {
  verifyBundledChromium(sourceEngines);
  console.log(`[prepare-prebuilt-app] verified source-built InkBrowser Chromium ${chromiumVersion}`);
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
  if (chromiumRequired) verifyBundledChromium(outputResources);
  console.log(`[prepare-prebuilt-app] ${app.id}: ${path.relative(root, output)}`);
}
console.log(`[prepare-prebuilt-app] complete: self-contained Electron + InkBrowser Chromium ${chromiumVersion} app bundles are ready.`);
