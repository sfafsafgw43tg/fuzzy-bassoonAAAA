import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import * as path from 'node:path';

let windowRef: BrowserWindow | undefined;
const sdkRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')].filter(Boolean) as string[];
const sdkRoot = sdkRoots.find((root) => root && root.length > 0) || '';
const adb = process.env.ADB || path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const emulator = path.join(sdkRoot, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');

function run(file: string, args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
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
