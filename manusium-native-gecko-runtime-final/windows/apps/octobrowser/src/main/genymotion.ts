import { execFile as execFileCallback, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export interface GenymotionDevice {
  id: string;
  name: string;
  status: 'running' | 'off' | 'unknown';
  ip: string;
  adbSerial: string;
  androidVersion: string;
  model: string;
}

export interface GenymotionStatus {
  available: boolean;
  executable: string;
  gmtoolExecutable: string;
  shellExecutable: string;
  authenticated: 'unknown';
  camera: { hostUvc: boolean; mediaInjection: 'edition-dependent'; virtualCamera: 'experimental-3.10+'; fixedResolution: '1280x720' };
  message: string;
}

export interface GenymotionCameraInfo {
  available: boolean;
  version: string;
  obsVirtualCamera: 'supported-experimentally' | 'upgrade-required' | 'unknown';
  fixedResolution: '1280x720';
  mediaFolder: string;
  message: string;
}

export interface GenymotionCreateInput {
  hardwareProfile: string;
  osImage: string;
  name: string;
  width?: number;
  height?: number;
  density?: number;
  ramMb?: number;
  cores?: number;
  rootAccess?: boolean;
}

function roots(): string[] {
  return [process.env.PROGRAMFILES, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA, process.env.APPDATA]
    .filter((item): item is string => Boolean(item));
}

function locate(file: 'genymotion.exe' | 'genymotion-shell.exe' | 'gmtool.exe'): string {
  const found = roots().flatMap((root) => [
    path.join(root, 'Genymobile', 'Genymotion', file),
    path.join(root, 'Genymobile', 'Genymotion', 'tools', file),
  ]).find((item) => fs.existsSync(item));
  return found ?? '';
}

function toolPath(): string { return locate('gmtool.exe'); }

async function command(args: string[], timeout = 15_000): Promise<{ stdout: string; stderr: string; code: number }> {
  const tool = toolPath();
  if (!tool) return { stdout: '', stderr: 'gmtool.exe is not installed', code: 127 };
  try {
    const result = await execFile(tool, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 });
    return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    return { stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? ''), code: Number(failure.code ?? 1) };
  }
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

function parseStatus(value: unknown): GenymotionDevice['status'] {
  const status = text(value).toLowerCase();
  if (status.includes('run') || status === 'on' || status === 'started') return 'running';
  if (status.includes('off') || status === 'stopped') return 'off';
  return 'unknown';
}

function deviceFrom(value: unknown): GenymotionDevice | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const name = text(item.name ?? item.device_name ?? item.label);
  if (!name) return undefined;
  const id = text(item.id ?? item.uuid ?? item.device_id) || name;
  const ip = text(item.ip ?? item.ip_address ?? item.address);
  const adbSerial = text(item.adb_serial ?? item.adbSerial ?? item.serial) || (ip && !ip.includes(':') ? `${ip}:5555` : ip);
  return {
    id,
    name,
    status: parseStatus(item.status ?? item.state),
    ip,
    adbSerial,
    androidVersion: text(item.android_version ?? item.androidVersion ?? item.os),
    model: text(item.model ?? item.hardware_profile ?? item.hardwareProfile),
  };
}

function parseJsonDevices(raw: string): GenymotionDevice[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    const candidates = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object'
      ? ((parsed as Record<string, unknown>).devices ?? (parsed as Record<string, unknown>).virtual_devices ?? []) : []);
    return Array.isArray(candidates) ? candidates.map(deviceFrom).filter((item): item is GenymotionDevice => Boolean(item)) : [];
  } catch { return []; }
}

function parseTextDevices(raw: string): GenymotionDevice[] {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    if (/^(id|name|available|virtual devices|[-=])\b/i.test(line)) return [];
    const columns = line.split(/\s{2,}|\s*\|\s*/).map((item) => item.trim()).filter(Boolean);
    if (!columns.length || /no .*virtual device/i.test(line)) return [];
    const name = columns.at(-1) ?? '';
    if (!name || name.length > 160) return [];
    return [{ id: columns[0] || name, name, status: parseStatus(columns[1] ?? line), ip: '', adbSerial: '', androidVersion: '', model: '' }];
  });
}

export function genymotionStatus(): GenymotionStatus {
  if (process.platform !== 'win32') {
    return { available: false, executable: '', gmtoolExecutable: '', shellExecutable: '', authenticated: 'unknown', camera: { hostUvc: true, mediaInjection: 'edition-dependent', virtualCamera: 'experimental-3.10+', fixedResolution: '1280x720' }, message: 'Genymotion Desktop integration is currently supported on Windows only.' };
  }
  const executable = locate('genymotion.exe');
  const gmtoolExecutable = locate('gmtool.exe');
  const shellExecutable = locate('genymotion-shell.exe');
  if (!executable && !gmtoolExecutable) {
    return { available: false, executable: '', gmtoolExecutable: '', shellExecutable: '', authenticated: 'unknown', camera: { hostUvc: true, mediaInjection: 'edition-dependent', virtualCamera: 'experimental-3.10+', fixedResolution: '1280x720' }, message: 'Genymotion Desktop is not installed.' };
  }
  return {
    available: Boolean(executable && gmtoolExecutable), executable, gmtoolExecutable, shellExecutable,
    authenticated: 'unknown', camera: { hostUvc: true, mediaInjection: 'edition-dependent', virtualCamera: 'experimental-3.10+', fixedResolution: '1280x720' },
    message: 'Genymotion handles its own account activation and licensing. Octo never stores or bypasses credentials. Windows virtual cameras are not guaranteed; use a physical UVC webcam or Genymotion media injection.',
  };
}

function versionNumber(value: string): number {
  const match = value.match(/(?:version\s*[: ]\s*)?(\d+)(?:\.(\d+))?/i);
  return match ? Number(`${match[1]}.${match[2] ?? '0'}`) : 0;
}

export async function genymotionCameraInfo(): Promise<GenymotionCameraInfo> {
  const status = genymotionStatus();
  const mediaFolder = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'Genymobile', 'Genymotion', 'media')
    : '';
  if (!status.available) return { available: false, version: '', obsVirtualCamera: 'unknown', fixedResolution: '1280x720', mediaFolder, message: status.message };
  const result = await command(['version']);
  const version = result.stdout.trim() || result.stderr.trim();
  const obsVirtualCamera = versionNumber(version) >= 3.10 ? 'supported-experimentally' : version ? 'upgrade-required' : 'unknown';
  return {
    available: true, version, obsVirtualCamera, fixedResolution: '1280x720', mediaFolder,
    message: obsVirtualCamera === 'supported-experimentally'
      ? 'OBS Virtual Camera is experimental in Genymotion Desktop 3.10+. Configure OBS output to 1280×720, start OBS Virtual Camera, then map it to Front or Back in Genymotion Media Injection.'
      : 'Genymotion camera input is controlled by the Media Injection widget. The camera API is fixed at 1280×720; update Genymotion to 3.10+ for experimental OBS Virtual Camera support.',
  };
}

export function openGenymotionMediaFolder(): { opened: boolean; message: string } {
  const folder = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'Genymobile', 'Genymotion', 'media')
    : '';
  if (!folder) return { opened: false, message: 'The Genymotion media folder is only available on Windows.' };
  fs.mkdirSync(folder, { recursive: true });
  const child = spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return { opened: true, message: 'Opened the Genymotion media folder.' };
}

export async function listGenymotionDevices(): Promise<GenymotionDevice[]> {
  const result = await command(['admin', 'list', '--json']);
  const json = parseJsonDevices(result.stdout).concat(parseJsonDevices(result.stderr));
  if (json.length) return [...new Map(json.map((item) => [item.id || item.name, item])).values()];
  const fallback = await command(['admin', 'list']);
  return parseTextDevices(fallback.stdout || result.stdout);
}

export async function genymotionProfiles(): Promise<{ hardwareProfiles: string[]; osImages: string[] }> {
  const [hardware, images] = await Promise.all([command(['admin', 'hwprofiles']), command(['admin', 'osimages'])]);
  const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^[-=]|^(name|id)\b/i.test(line));
  return { hardwareProfiles: lines(hardware.stdout), osImages: lines(images.stdout) };
}

export async function createGenymotionDevice(input: GenymotionCreateInput): Promise<{ ok: boolean; message: string }> {
  const name = input.name.trim();
  if (!name || name.length > 80) return { ok: false, message: 'Enter a device name between 1 and 80 characters.' };
  if (!input.hardwareProfile.trim() || !input.osImage.trim()) return { ok: false, message: 'Select a hardware profile and Android image.' };
  const args = ['admin', 'create', input.hardwareProfile.trim(), input.osImage.trim(), name];
  const number = (value: number | undefined, min: number, max: number, flag: string) => {
    if (value === undefined) return;
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${flag} is outside the supported range`);
    args.push(flag, String(Math.round(value)));
  };
  try {
    number(input.width, 240, 4096, '--width'); number(input.height, 240, 8192, '--height');
    number(input.density, 120, 640, '--density'); number(input.ramMb, 512, 65536, '--ram');
    number(input.cores, 1, 16, '--nbcpu');
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Invalid device settings.' }; }
  if (typeof input.rootAccess === 'boolean') args.push('--root-access', input.rootAccess ? 'on' : 'off');
  const result = await command(args, 120_000);
  return result.code === 0 ? { ok: true, message: result.stdout.trim() || 'Genymotion device created.' } : { ok: false, message: result.stderr.trim() || result.stdout.trim() || 'Genymotion could not create the device.' };
}

async function mutate(action: 'start' | 'stop' | 'delete' | 'factoryreset', name: string, extra: string[] = []): Promise<{ ok: boolean; message: string }> {
  const clean = name.trim();
  if (!clean || clean.length > 160) return { ok: false, message: 'Invalid Genymotion device name.' };
  const result = await command(['admin', action, clean, ...extra], 120_000);
  return result.code === 0 ? { ok: true, message: result.stdout.trim() || `${action} completed.` } : { ok: false, message: result.stderr.trim() || result.stdout.trim() || `Genymotion ${action} failed.` };
}

export const startGenymotionDevice = (name: string, coldBoot = false) => mutate('start', name, coldBoot ? ['--coldboot'] : []);
export const stopGenymotionDevice = (name: string) => mutate('stop', name);
export const deleteGenymotionDevice = (name: string) => mutate('delete', name);
export const resetGenymotionDevice = (name: string) => mutate('factoryreset', name);

export function openGenymotion(): { opened: boolean; message: string } {
  const status = genymotionStatus();
  if (!status.executable) return { opened: false, message: status.message };
  const child = spawn(status.executable, [], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return { opened: true, message: 'Genymotion Desktop launched. Complete activation in Genymotion if requested.' };
}
