import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';

export type WindowsBuildBackend = 'wsl2' | 'docker' | 'remote';
export interface WindowsHostReport { platform: string; architecture: string; backend: WindowsBuildBackend | 'unavailable'; wsl2: { available: boolean; distribution?: string; detail: string }; docker: { available: boolean; detail: string }; cpuCount: number; memoryBytes: number; freeDiskBytes?: number; missing: string[] }
function run(file: string, args: string[], timeout = 5000): Promise<{ ok: boolean; stdout: string; detail: string }> { return new Promise((resolve) => { execFile(file, args, { windowsHide: true, timeout }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout), detail: String(stderr || error?.message || '') })); }); }
export async function inspectWindowsBuildHost(root = process.cwd()): Promise<WindowsHostReport> {
  const missing: string[] = []; const platform = process.platform; const architecture = process.arch; let freeDiskBytes: number | undefined;
  const wsl = platform === 'win32' ? await run('wsl.exe', ['--list', '--quiet']) : { ok: false, stdout: '', detail: 'WSL2 checks require Windows.' };
  const docker = platform === 'win32' ? await run('docker.exe', ['info', '--format', '{{.ServerVersion}}']) : { ok: false, stdout: '', detail: 'Docker checks require Windows.' };
  let backend: WindowsBuildBackend | 'unavailable' = 'unavailable'; const distro = wsl.stdout.split(/\r?\n/).map((x) => x.replace(/^\uFEFF/, '').trim()).find(Boolean);
  if (wsl.ok && distro) backend = 'wsl2'; else if (docker.ok) backend = 'docker'; else if (platform === 'win32') missing.push('WSL2 Ubuntu or Docker Desktop'); else missing.push('Windows host');
  if (platform !== 'win32') missing.push('Windows client host'); if (architecture !== 'x64') missing.push('64-bit Windows');
  return { platform, architecture, backend, wsl2: { available: wsl.ok && Boolean(distro), distribution: distro, detail: wsl.ok ? `Detected distribution: ${distro || 'none'}` : wsl.detail }, docker: { available: docker.ok, detail: docker.ok ? `Docker server ${docker.stdout.trim()}` : docker.detail }, cpuCount: os.cpus().length, memoryBytes: os.totalmem(), freeDiskBytes, missing };
}
export function controlledWslCommand(distribution: string, workPath: string): { file: string; args: string[] } {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(distribution)) throw new Error('Invalid WSL distribution.');
  if (!path.isAbsolute(workPath) || /[\r\n\0]/.test(workPath)) throw new Error('Invalid controlled WSL work path.');
  return { file: 'wsl.exe', args: ['-d', distribution, '--', '/opt/octosuite/android-build-worker', '--work-root', workPath] };
}
export function controlledDockerCommand(image: string): { file: string; args: string[] } {
  if (!/^[-A-Za-z0-9._/:@]{1,200}$/.test(image)) throw new Error('Invalid worker image.');
  return { file: 'docker.exe', args: ['run', '--rm', '--init', '--read-only', '--network', 'none', image] };
}
