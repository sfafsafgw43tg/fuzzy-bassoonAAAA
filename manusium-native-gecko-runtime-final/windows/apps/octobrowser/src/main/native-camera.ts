import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CONTROL = 'octo-cameractl.exe';
const SOURCE = 'octo-camera-source.dll';
const DIRECTSHOW = 'octo-directshow-camera.dll';
const MISSING_COMPONENT = 'The native camera component is not included in this build. Close Octo.su, rerun setup on Windows, and ensure Visual Studio C++ desktop tools, Windows SDK 10.0.22621+, and CMake are installed.';
const MISSING_WINDOWS_API = 'Windows virtual camera support is unavailable. Install Windows 11 version 22H2 or newer from Settings > Windows Update (build 22000 or newer is required); there is no separate API package to install. Windows 10 needs a separate DirectShow backend.';
const DIRECTSHOW_ELEVATION = 'Windows blocked DirectShow camera registration. Approve the administrator prompt when Octo.su asks, or run Octo.su once as administrator; Windows 10 stores legacy camera filters system-wide.';

export interface NativeCameraStatus {
  supported: boolean;
  available: boolean;
  installed: boolean;
  controlPath: string;
  sourcePath: string;
  directShowPath: string;
  message: string;
}

function roots(): string[] {
  const candidates = [
    process.env.OCTO_NATIVE_CAMERA_DIR,
    path.join(process.resourcesPath, 'native-camera'),
    path.join(process.cwd(), 'resources', 'native-camera'),
    path.resolve(__dirname, '../../../../../../native/octo-camera/build/Release'),
    path.resolve(__dirname, '../../../../../../native/octo-directshow/build/Release'),
  ];
  return candidates.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function binaries(): { controlPath: string; sourcePath: string; directShowPath: string } {
  let controlPath = '';
  let sourcePath = '';
  let directShowPath = '';
  for (const root of roots()) {
    const nextControl = path.join(root, CONTROL);
    const nextSource = path.join(root, SOURCE);
    const nextDirectShow = path.join(root, DIRECTSHOW);
    if (!controlPath && fs.existsSync(nextControl)) controlPath = nextControl;
    if (!sourcePath && fs.existsSync(nextSource)) sourcePath = nextSource;
    if (!directShowPath && fs.existsSync(nextDirectShow)) directShowPath = nextDirectShow;
  }
  return { controlPath, sourcePath, directShowPath };
}

async function runControl(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { controlPath } = binaries();
  if (!controlPath || !fs.existsSync(controlPath)) throw new Error('The Octo Camera control utility is not included in this build.');
  try {
    return await execFileAsync(controlPath, args, { windowsHide: true, timeout: 20_000, windowsVerbatimArguments: false });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string; code?: string | number };
    const details = [failure.stderr?.trim(), failure.stdout?.trim()].filter(Boolean).join(' ');
    const exitCode = failure.code === undefined ? '' : ` (exit ${failure.code})`;
    if (/0x8007007f|MFCreateVirtualCamera|ERROR_PROC_NOT_FOUND/i.test(details)) throw new Error(MISSING_WINDOWS_API);
    if (/0x80070005|0x800704c7|access denied|administrator|cancelled/i.test(details)) throw new Error(DIRECTSHOW_ELEVATION);
    throw new Error(`Octo Camera control failed${exitCode}${details ? `: ${details}` : '.'}`);
  }
}

export async function nativeCameraStatus(): Promise<NativeCameraStatus> {
  if (process.platform !== 'win32') {
    return { supported: false, available: false, installed: false, controlPath: '', sourcePath: '', directShowPath: '', message: 'The Windows virtual camera is only available on Windows.' };
  }
  const { controlPath, sourcePath, directShowPath } = binaries();
  if (!controlPath || !sourcePath) {
    return { supported: true, available: false, installed: false, controlPath, sourcePath, directShowPath, message: MISSING_COMPONENT };
  }
  try {
    await runControl(['status']);
    return { supported: true, available: true, installed: true, controlPath, sourcePath, directShowPath, message: 'Octo Camera is registered for this Windows user.' };
  } catch {
    return { supported: true, available: true, installed: false, controlPath, sourcePath, directShowPath, message: 'Octo Camera is available but not registered for this Windows user.' };
  }
}

export async function installNativeCamera(): Promise<NativeCameraStatus> {
  if (process.platform !== 'win32') throw new Error('The Windows virtual camera is only available on Windows.');
  const { sourcePath, directShowPath } = binaries();
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error(`${MISSING_COMPONENT} Expected ${SOURCE} under the packaged resources/native-camera directory.`);
  const args = ['install', '--source', sourcePath];
  if (directShowPath && fs.existsSync(directShowPath)) args.push('--directshow', directShowPath);
  await runControl(args);
  return nativeCameraStatus();
}

export async function uninstallNativeCamera(): Promise<NativeCameraStatus> {
  if (process.platform !== 'win32') throw new Error('The Windows virtual camera is only available on Windows.');
  const { directShowPath } = binaries();
  const args = ['uninstall'];
  if (directShowPath && fs.existsSync(directShowPath)) args.push('--directshow', directShowPath);
  await runControl(args);
  return nativeCameraStatus();
}
