import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

let windowRef: BrowserWindow | undefined;
const sdkRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')].filter(Boolean) as string[];
const sdkRoot = sdkRoots.find((root) => root && root.length > 0) || '';
const adb = process.env.ADB || path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const emulator = path.join(sdkRoot, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
const avdManagerCandidates = [
  path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', process.platform === 'win32' ? 'avdmanager.bat' : 'avdmanager'),
  path.join(sdkRoot, 'cmdline-tools', 'bin', process.platform === 'win32' ? 'avdmanager.bat' : 'avdmanager'),
  path.join(sdkRoot, 'tools', 'bin', process.platform === 'win32' ? 'avdmanager.bat' : 'avdmanager'),
];

function run(file: string, args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const needsWindowsShell = process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(file);
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024, shell: needsWindowsShell }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim()));
      else resolve(stdout.trim());
    });
  });
}
function startProcess(file: string, args: string[]): void {
  spawn(file, args, { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
}
async function avds(): Promise<string[]> {
  const output = await run(emulator, ['-list-avds']);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function avdManager(): string {
  const found = avdManagerCandidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('avdmanager was not found in the Android SDK command-line tools. Install Android SDK Command-line Tools from SDK Manager.');
  return found;
}
function installedImages(): string[] {
  const root = path.join(sdkRoot, 'system-images');
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  for (const android of fs.readdirSync(root, { withFileTypes: true })) {
    if (!android.isDirectory()) continue;
    const androidPath = path.join(root, android.name);
    for (const packageDir of fs.readdirSync(androidPath, { withFileTypes: true })) {
      if (!packageDir.isDirectory()) continue;
      const packagePath = path.join(androidPath, packageDir.name);
      for (const abi of fs.readdirSync(packagePath, { withFileTypes: true })) {
        if (abi.isDirectory()) result.push(`system-images;${android.name};${packageDir.name};${abi.name}`);
      }
    }
  }
  return result.sort((a, b) => a.localeCompare(b));
}
async function devices(): Promise<Array<{ serial: string; state: string; avd: string; model: string }>> {
  const output = await run(adb, ['devices', '-l']);
  const rows: Array<{ serial: string; state: string; avd: string; model: string }> = [];
  for (const line of output.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (!parts[0] || !parts[1]) continue;
    const serial = parts[0];
    let avd = '';
    let model = '';
    try { avd = (await run(adb, ['-s', serial, 'emu', 'avd', 'name'], 8000)).split(/\r?\n/)[0].trim(); } catch { /* physical devices have no emulator console */ }
    const modelPart = parts.find((part) => part.startsWith('model:'));
    if (modelPart) model = modelPart.slice(6);
    rows.push({ serial, state: parts[1], avd, model });
  }
  return rows;
}
async function status() {
  const [available, running] = await Promise.all([avds().catch(() => []), devices().catch(() => [])]);
  return { sdkRoot, adb, emulator, available, running };
}
async function findSerial(name: string): Promise<string> {
  const running = await devices();
  const match = running.find((device) => device.avd === name && device.state === 'device');
  if (!match) throw new Error(`${name} is not running.`);
  return match.serial;
}

ipcMain.handle('avd:status', () => status());
ipcMain.handle('avd:images', () => installedImages());
ipcMain.handle('avd:create', async (_event, input: { name?: string; image?: string; device?: string }) => {
  const name = String(input?.name || '').trim();
  const image = String(input?.image || '').trim();
  const device = String(input?.device || '').trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) throw new Error('Use a machine name with letters, numbers, dots, dashes, or underscores.');
  if (!/^system-images;[A-Za-z0-9._-]+;[A-Za-z0-9._-]+;[A-Za-z0-9._-]+$/.test(image)) throw new Error('Choose an installed Android system image.');
  if ((await avds()).includes(name)) throw new Error(`${name} already exists.`);
  const args = ['create', 'avd', '-n', name, '-k', image, '--force'];
  if (device && /^[A-Za-z0-9._-]{1,64}$/.test(device)) args.push('--device', device);
  await run(avdManager(), args, 120000);
  return { created: true, name };
});
ipcMain.handle('avd:delete', async (_event, name: string) => {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(clean)) throw new Error('Invalid AVD name.');
  const running = (await devices().catch(() => [])).find((device) => device.avd === clean);
  if (running) await run(adb, ['-s', running.serial, 'emu', 'kill'], 20000).catch(() => undefined);
  await run(avdManager(), ['delete', 'avd', '-n', clean], 60000);
  return { deleted: true, name: clean };
});
ipcMain.handle('avd:folder', async (_event, name: string) => {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(clean)) throw new Error('Invalid AVD name.');
  const ini = path.join(process.env.USERPROFILE || '', '.android', 'avd', `${clean}.ini`);
  let folder = path.join(process.env.USERPROFILE || '', '.android', 'avd', `${clean}.avd`);
  if (fs.existsSync(ini)) {
    const match = fs.readFileSync(ini, 'utf8').match(/^path=(.+)$/m);
    if (match?.[1]) folder = match[1].trim();
  }
  const error = await shell.openPath(folder);
  return { opened: !error, folder, message: error || folder };
});
ipcMain.handle('avd:start', async (_event, name: string) => {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(clean)) throw new Error('Invalid AVD name.');
  const running = await devices().catch(() => []);
  const existing = running.find((device) => device.avd === clean);
  if (existing) return { started: false, alreadyRunning: true, serial: existing.serial };
  startProcess(emulator, ['-avd', clean, '-camera-front', 'webcam0', '-camera-back', 'webcam0']);
  return { started: true, alreadyRunning: false };
});
ipcMain.handle('avd:stop', async (_event, name: string) => {
  const serial = await findSerial(String(name || '').trim());
  await run(adb, ['-s', serial, 'emu', 'kill'], 20000);
  return { stopped: true, serial };
});
ipcMain.handle('avd:root-check', async (_event, name: string) => {
  const serial = await findSerial(String(name || '').trim());
  const rootReply = await run(adb, ['-s', serial, 'root'], 20000).catch((error) => String(error));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const identity = await run(adb, ['-s', serial, 'shell', 'id'], 20000).catch((error) => String(error));
  const properties: Record<string, string> = {};
  for (const key of ['ro.build.version.release', 'ro.build.version.sdk', 'ro.build.type', 'ro.debuggable', 'ro.product.name']) properties[key] = await run(adb, ['-s', serial, 'shell', 'getprop', key], 10000).catch(() => '');
  return { serial, verified: /uid=0\(root\)/i.test(identity), rootReply, identity, properties };
});
ipcMain.handle('avd:open-studio', async () => {
  const candidates = [path.join(process.env.ProgramFiles || '', 'Android', 'Android Studio', 'bin', 'studio64.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Android Studio', 'bin', 'studio64.exe')];
  const studio = candidates.find((candidate) => candidate && require('node:fs').existsSync(candidate));
  if (!studio) return { opened: false, message: 'Android Studio was not found in the standard installation paths.' };
  startProcess(studio, []);
  return { opened: true, message: studio };
});

function createWindow(): void {
  windowRef = new BrowserWindow({ width: 1180, height: 760, minWidth: 920, minHeight: 620, title: 'Octo Android Manager', backgroundColor: '#101318', webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') } });
  windowRef.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  windowRef.on('closed', () => { windowRef = undefined; });
}
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (!windowRef) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
void shell;
