import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GenymotionStatus {
  available: boolean;
  executable: string;
  shellExecutable: string;
  authenticated: 'unknown';
  message: string;
}

function candidates(): string[] {
  const roots = [
    process.env.PROGRAMFILES,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
  ].filter((item): item is string => Boolean(item));
  const names = [
    ['Genymobile', 'Genymotion', 'genymotion.exe'],
    ['Genymobile', 'Genymotion', 'genymotion-shell.exe'],
  ];
  return roots.flatMap((root) => names.map((parts) => path.join(root, ...parts)));
}

function locate(file: 'genymotion.exe' | 'genymotion-shell.exe'): string {
  const found = candidates().find((item) => path.basename(item).toLowerCase() === file && fs.existsSync(item));
  return found ?? '';
}

export function genymotionStatus(): GenymotionStatus {
  if (process.platform !== 'win32') {
    return { available: false, executable: '', shellExecutable: '', authenticated: 'unknown', message: 'Genymotion Desktop integration is currently supported on Windows only.' };
  }
  const executable = locate('genymotion.exe');
  const shellExecutable = locate('genymotion-shell.exe');
  if (!executable && !shellExecutable) {
    return { available: false, executable: '', shellExecutable: '', authenticated: 'unknown', message: 'Genymotion Desktop is not installed.' };
  }
  return {
    available: Boolean(executable || shellExecutable),
    executable,
    shellExecutable,
    authenticated: 'unknown',
    message: 'Genymotion handles its own account activation and licensing. Octo never stores or bypasses credentials.',
  };
}

export function openGenymotion(): { opened: boolean; message: string } {
  const status = genymotionStatus();
  if (!status.executable) return { opened: false, message: status.message };
  const child = spawn(status.executable, [], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return { opened: true, message: 'Genymotion Desktop launched. Complete activation in Genymotion if requested.' };
}
