import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn, execFile } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as net from 'node:net';

let win: BrowserWindow | undefined;
let activeImageSource: string | undefined;
let activeVideoSource: string | undefined;
let activeSerial: string | undefined;
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const adb = process.env.ADB || path.join(sdk, 'platform-tools', 'adb.exe');
const emulator = path.join(sdk, 'emulator', 'emulator.exe');
const work = path.join(os.tmpdir(), 'octo-camera-controller');
fs.mkdirSync(work, { recursive: true });

function run(file: string, args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim())); else resolve(stdout.trim());
    });
  });
}
function start(file: string, args: string[]): void { spawn(file, args, { detached: true, windowsHide: true, stdio: 'ignore' }).unref(); }
function emulatorConsolePort(serial?: string): number | undefined {
  const match = String(serial ?? '').match(/emulator-(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function consoleCommand(serial: string, command: string, timeout = 8000): Promise<string> {
  const port = emulatorConsolePort(serial);
  if (!port) return Promise.reject(new Error(`Unsupported emulator serial for console control: ${serial}`));
  const tokenPath = path.join(os.homedir(), '.emulator_console_auth_token');
  const token = fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, 'utf8').trim() : '';
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let output = '';
    let stage: 'auth' | 'command' | 'done' = 'auth';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Emulator console timed out while changing the Virtual Scene image.')); }, timeout);
    const finish = (error?: Error) => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(output); };
    socket.setEncoding('utf8');
    socket.on('error', (error) => finish(error));
    socket.on('data', (chunk: string) => {
      output += chunk;
      if (stage === 'auth' && /OK\s*$/m.test(output)) {
        stage = 'command';
        socket.write(`${token ? `auth ${token}\n` : ''}${command}\n`);
      } else if (stage === 'command' && /OK\s*$/m.test(output)) {
        stage = 'done';
        socket.write('quit\n');
        finish();
      }
    });
    socket.on('connect', () => { /* wait for the console banner before authenticating */ });
  });
}

async function findRunningEmulator(): Promise<string> {
  const rows = await devices();
  const emulatorDevice = rows.find((row) => row.serial.startsWith('emulator-') && row.state === 'device');
  if (!emulatorDevice) throw new Error('Start the Android Emulator and wait for ADB before changing the live image.');
  return emulatorDevice.serial;
}

async function applyVirtualSceneImage(source: string, serial?: string): Promise<{ serial: string; message: string }> {
  const target = serial || activeSerial || await findRunningEmulator();
  await consoleCommand(target, `virtualscene-image wall "${source.replace(/"/g, '\\"')}"`);
  activeSerial = target;
  return { serial: target, message: 'Virtual Scene image updated while the Android device stayed running.' };
}

async function devices(): Promise<Array<{ serial: string; state: string }>> {
  const text = await run(adb, ['devices']);
  return text.split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/)).filter(row => row[0] && row[1]).map(row => ({ serial: row[0], state: row[1] }));
}
async function avds(): Promise<string[]> { return (await run(emulator, ['-list-avds'])).split(/\r?\n/).map(s => s.trim()).filter(Boolean); }

ipcMain.handle('camera:avds', () => avds().catch(() => []));
ipcMain.handle('camera:devices', () => devices().catch(() => []));
ipcMain.handle('camera:pick', async (_event, kind: 'image' | 'video') => {
  const result = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: kind === 'image' ? 'Images' : 'Videos', extensions: kind === 'image' ? ['png', 'jpg', 'jpeg', 'webp'] : ['mp4', 'mkv', 'avi', 'mov'] }] });
  return result.canceled ? '' : result.filePaths[0] || '';
});
ipcMain.handle('camera:apply', async (_event, input: { avd: string; source: string; type: 'image' | 'video'; width: number; height: number; fit: 'stretch' | 'fit' | 'crop'; serial?: string; crop?: { x: number; y: number; width: number; height: number }; filter?: 'none' | 'grayscale' | 'sepia' | 'bright' | 'contrast'; videoLoop?: boolean; videoSpeed?: number }) => {
  if (!input.avd || !input.source || !fs.existsSync(input.source)) throw new Error('Select an AVD and a readable media file first.');
  let source = input.source;
  if (input.type === 'image') {
    source = path.join(work, `camera-${Date.now()}-${input.width}x${input.height}-${input.fit}.jpg`);
    const scriptCandidates = [
      path.join(process.resourcesPath, 'android-scripts', 'prepare-octo-camera-image.ps1'),
      path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'android', 'prepare-octo-camera-image.ps1'),
    ];
    const script = scriptCandidates.find(candidate => fs.existsSync(candidate)) || scriptCandidates[0];
    const imageArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputPath', input.source, '-OutputPath', source, '-Width', String(input.width), '-Height', String(input.height), '-Fit', input.fit, '-Filter', input.filter || 'none'];
    if (input.fit === 'crop' && input.crop) imageArgs.push('-SourceX', String(Math.round(input.crop.x)), '-SourceY', String(Math.round(input.crop.y)), '-SourceWidth', String(Math.round(input.crop.width)), '-SourceHeight', String(Math.round(input.crop.height)));
    await run('powershell.exe', imageArgs, 60000);
  }
  if (input.type === 'video' && (input.videoSpeed || 1) !== 1) {
    const ffmpeg = process.env.FFMPEG || 'ffmpeg.exe';
    const processed = path.join(work, `video-${Date.now()}-${input.videoSpeed}x.mp4`);
    await run(ffmpeg, [...(input.videoLoop ? ['-stream_loop', '1'] : []), '-y', '-i', input.source, '-vf', `setpts=${1 / Math.max(0.25, Math.min(4, input.videoSpeed || 1))}*PTS`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', processed], 120000);
    source = processed;
  }
  const camera = input.type === 'video' ? `videofile:${source}` : 'environment';
  const args = ['-avd', input.avd, '-no-snapshot', '-camera-front', 'none', '-camera-back', camera];
  try { await run(adb, ['emu', 'kill'], 10000); } catch { /* no running emulator is fine */ }
  start(emulator, args);
  activeImageSource = input.type === 'image' ? source : undefined;
  activeVideoSource = input.type === 'video' ? source : undefined;
  if (input.type === 'image') {
    void (async () => {
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        try { await applyVirtualSceneImage(source, input.serial); return; } catch { await new Promise((resolve) => setTimeout(resolve, 1500)); }
      }
    })();
  }
  return { ok: true, message: `Started ${input.avd} with Virtual Scene image control at ${input.width}x${input.height}.`, source };
});
ipcMain.handle('camera:apply-live', async (_event, input: { source: string; type: 'image' | 'video'; width: number; height: number; fit: 'stretch' | 'fit' | 'crop'; crop?: { x: number; y: number; width: number; height: number }; filter?: 'none' | 'grayscale' | 'sepia' | 'bright' | 'contrast'; videoLoop?: boolean; videoSpeed?: number }) => {
  const activeSource = input.type === 'image' ? activeImageSource : activeVideoSource;
  if (!activeSource) throw new Error(`Live ${input.type} apply is available after starting a ${input.type} source from this controller.`);
  if (!fs.existsSync(input.source)) throw new Error('Select a readable media file first.');
  if (input.type === 'video') {
    throw new Error('Android Emulator does not expose a runtime videofile reload command. Use the image mode for no-restart changes, or apply the video and restart the emulator.');
  }
  const temp = path.join(work, `live-${Date.now()}-${input.width}x${input.height}.jpg`);
  const scriptCandidates = [
    path.join(process.resourcesPath, 'android-scripts', 'prepare-octo-camera-image.ps1'),
    path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'android', 'prepare-octo-camera-image.ps1'),
  ];
  const script = scriptCandidates.find(candidate => fs.existsSync(candidate)) || scriptCandidates[0];
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputPath', input.source, '-OutputPath', temp, '-Width', String(input.width), '-Height', String(input.height), '-Fit', input.fit, '-Filter', input.filter || 'none'];
  if (input.fit === 'crop' && input.crop) args.push('-SourceX', String(Math.round(input.crop.x)), '-SourceY', String(Math.round(input.crop.y)), '-SourceWidth', String(Math.round(input.crop.width)), '-SourceHeight', String(Math.round(input.crop.height)));
  await run('powershell.exe', args, 60000);
  const applied = await applyVirtualSceneImage(temp);
  activeImageSource = temp;
  return { ok: true, message: `${applied.message} (${input.width}x${input.height}).`, source: temp };
});
ipcMain.handle('camera:install-controller', async (_event, serial?: string) => {
  const candidates = [
    path.join(process.resourcesPath, 'octo-camera', 'OctoCameraController.apk'),
    path.resolve(process.cwd(), 'resources', 'octo-camera', 'OctoCameraController.apk'),
    path.resolve(__dirname, '..', '..', '..', 'resources', 'octo-camera', 'OctoCameraController.apk'),
  ];
  const apk = candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
  if (!fs.existsSync(apk)) throw new Error('Octo Camera Controller APK is missing from this bundle.');
  const args = serial ? ['-s', serial, 'install', '-r', apk] : ['install', '-r', apk];
  return run(adb, args, 120000);
});

function createWindow(): void {
  win = new BrowserWindow({ width: 980, height: 720, minWidth: 760, minHeight: 560, title: 'Octo Camera Controller', webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = undefined; });
}
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (!win) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
