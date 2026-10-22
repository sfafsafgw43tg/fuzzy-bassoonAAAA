// Brand the Electron binary used by a source checkout without changing npm's
// electron package name or the package-managed electron.exe. The generated
// copy is disposable and is recreated after npm ci when open.bat needs it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronDir = path.join(root, 'node_modules', 'electron', 'dist');
const source = path.join(electronDir, process.platform === 'win32' ? 'electron.exe' : 'electron');
const branded = path.join(electronDir, process.platform === 'win32' ? 'Octo.su.exe' : 'Octo.su');
const icon = path.join(root, 'branding', 'octobrowser', 'icon.ico');
const rcedit = path.join(root, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

if (process.platform !== 'win32') {
  console.log('[brand-electron-dev] skipped: this step only brands Windows development launches');
  process.exit(0);
}

if (!fs.existsSync(source)) throw new Error(`[brand-electron-dev] Electron binary is missing: ${source}`);
if (!fs.existsSync(icon)) throw new Error(`[brand-electron-dev] Octo icon is missing: ${icon}`);
fs.copyFileSync(source, branded);

if (fs.existsSync(rcedit)) {
  const result = spawnSync(rcedit, [
    branded,
    '--set-icon', icon,
    '--set-version-string', 'ProductName', 'Octo.su',
    '--set-version-string', 'FileDescription', 'Octo.su',
    '--set-version-string', 'InternalName', 'Octo.su',
    '--set-version-string', 'OriginalFilename', 'Octo.su.exe',
    '--set-version-string', 'CompanyName', 'OctoSuite contributors',
  ], { stdio: 'inherit', windowsHide: true, shell: false });
  if (result.error || result.status !== 0) {
    throw new Error(`[brand-electron-dev] rcedit failed with code ${result.status ?? 'unknown'}: ${result.error?.message ?? ''}`);
  }
} else {
  console.warn(`[brand-electron-dev] rcedit is unavailable; copied binary will run but retain Electron's Windows icon/metadata: ${rcedit}`);
}

console.log(`[brand-electron-dev] branded development binary: ${branded}`);
