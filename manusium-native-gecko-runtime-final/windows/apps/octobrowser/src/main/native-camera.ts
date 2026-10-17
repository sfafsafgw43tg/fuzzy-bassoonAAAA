import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CONTROL = 'octo-cameractl.exe';
const SOURCE = 'octo-camera-source.dll';
const MISSING_COMPONENT = 'The native camera component is not included in this build. Close Octo.su, rerun setup on Windows, and ensure Visual Studio C++ desktop tools, Windows SDK 10.0.22621+, and CMake are installed.';

export interface NativeCameraStatus {
  supported: boolean;
  available: boolean;
  installed: boolean;
  controlPath: string;
  sourcePath: string;
  message: string;
}

function roots(): string[] {
  const candidates = [
    process.env.OCTO_NATIVE_CAMERA_DIR,
    path.join(process.resourcesPath, 'native-camera'),
    path.join(process.cwd(), 'resources', 'native-camera'),
    path.resolve(__dirname, '../../../../../../native/octo-camera/build/Release'),
  ];
  return candidates.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function binaries(): { controlPath: string; sourcePath: string } {
  for (const root of roots()) {
    const controlPath = path.join(root, CONTROL);
    const sourcePath = path.join(root, SOURCE);
    if (fs.existsSync(controlPath) || fs.existsSync(sourcePath)) return { controlPath, sourcePath };
  }
  return { controlPath: '', sourcePath: '' };
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
    throw new Error(`Octo Camera control failed${exitCode}${details ? `: ${details}` : '.'}`);
  }
}

export async function nativeCameraStatus(): Promise<NativeCameraStatus> {
  if (process.platform !== 'win32') {
    return { supported: false, available: false, installed: false, controlPath: '', sourcePath: '', message: 'The Windows virtual camera is only available on Windows.' };
  }
  const { controlPath, sourcePath } = binaries();
  if (!controlPath || !sourcePath) {
    return { supported: true, available: false, installed: false, controlPath, sourcePath, message: MISSING_COMPONENT };
  }
  try {
    await runControl(['status']);
    return { supported: true, available: true, installed: true, controlPath, sourcePath, message: 'Octo Camera is registered for this Windows user.' };
  } catch {
    return { supported: true, available: true, installed: false, controlPath, sourcePath, message: 'Octo Camera is available but not registered for this Windows user.' };
  }
}

export async function installNativeCamera(): Promise<NativeCameraStatus> {
  if (process.platform !== 'win32') throw new Error('The Windows virtual camera is only available on Windows.');
  const { sourcePath } = binaries();
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error(`${MISSING_COMPONENT} Expected ${SOURCE} under the packaged resources/native-camera directory.`);
  await runControl(['install', '--source', sourcePath]);
  return nativeCameraStatus();
}

export async function uninstallNativeCamera(): Promise<NativeCameraStatus> {
  if (process.platform !== 'win32') throw new Error('The Windows virtual camera is only available on Windows.');
  await runControl(['uninstall']);
  return nativeCameraStatus();
}
