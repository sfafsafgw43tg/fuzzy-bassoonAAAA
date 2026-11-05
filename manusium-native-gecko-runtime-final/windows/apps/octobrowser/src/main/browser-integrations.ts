import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launchDetached } from '@octo/shell/winutil';
import { BROWSER_INTEGRATIONS, browserIntegration, type BrowserIntegrationId, type Profile } from '@octo/core';

const execFileAsync = promisify(execFile);
const WINDOWS_PATH = /^[A-Za-z]:\\/;

export interface BrowserIntegrationStatus {
  id: BrowserIntegrationId;
  name: string;
  classification: string;
  installed: boolean;
  executablePath?: string;
  version?: string;
  officialUrl: string;
  sourceUrl: string;
  license: string;
  maintenance: string;
  limitation: string;
  capabilities: ReturnType<typeof browserIntegration> extends infer T ? T extends { capabilities: infer C } ? C : never : never;
}

function expandCandidate(value: string): string {
  return value.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? `%${name}%`);
}

function safeExecutablePath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length < 4 || value.length > 2048 || !WINDOWS_PATH.test(value) || /(^|[\\/])\.\.([\\/]|$)/.test(value)) return undefined;
  const resolved = path.win32.normalize(value);
  if (resolved.includes('..')) return undefined;
  return resolved;
}

async function versionOf(executablePath: string): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  try {
    const result = await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', '(Get-Item -LiteralPath $args[0]).VersionInfo.ProductVersion', executablePath,
    ], { windowsHide: true, timeout: 5000, maxBuffer: 32 * 1024, encoding: 'utf8' });
    const version = String(result.stdout ?? '').trim().split(/\r?\n/)[0];
    return /^\d+(?:\.\d+){1,4}(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? version : undefined;
  } catch { return undefined; }
}

export async function detectBrowserIntegrations(userPaths: Partial<Record<BrowserIntegrationId, string>> = {}): Promise<BrowserIntegrationStatus[]> {
  const out: BrowserIntegrationStatus[] = [];
  for (const descriptor of BROWSER_INTEGRATIONS) {
    const explicit = safeExecutablePath(userPaths[descriptor.id]);
    const candidates = [explicit, ...descriptor.executableCandidates.map(expandCandidate).map(safeExecutablePath)].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);
    const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
    out.push({
      id: descriptor.id, name: descriptor.name, classification: descriptor.classification,
      installed: !!executablePath, executablePath, version: executablePath ? await versionOf(executablePath) : undefined,
      officialUrl: descriptor.officialUrl, sourceUrl: descriptor.sourceUrl, license: descriptor.license,
      maintenance: descriptor.maintenance, limitation: descriptor.limitation, capabilities: descriptor.capabilities,
    });
  }
  return out;
}

function profileFolder(profile: Profile, root: string): string {
  const folder = path.join(root, 'external', profile.id);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function proxyArgs(profile: Profile): string[] {
  const proxy = profile.network.mode === 'proxy' ? profile.network.proxy : undefined;
  if (!proxy || !proxy.host || !Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) return [];
  const protocol = proxy.type === 'socks5' ? 'socks5' : proxy.type === 'https' ? 'https' : 'http';
  return [`--proxy-server=${protocol}://${proxy.host}:${proxy.port}`];
}

function writeFirefoxAdapter(folder: string, profile: Profile): void {
  const lines = ['// Managed by OctoSuite. Do not edit while this profile is active.'];
  const proxy = profile.network.mode === 'proxy' ? profile.network.proxy : undefined;
  if (proxy && proxy.host && Number.isInteger(proxy.port)) {
    lines.push('user_pref("network.proxy.type", 1);');
    lines.push(`user_pref("network.proxy.http", ${JSON.stringify(proxy.host)});`);
    lines.push(`user_pref("network.proxy.http_port", ${proxy.port});`);
    lines.push(`user_pref("network.proxy.ssl", ${JSON.stringify(proxy.host)});`);
    lines.push(`user_pref("network.proxy.ssl_port", ${proxy.port});`);
  } else {
    lines.push('user_pref("network.proxy.type", 0);');
  }
  fs.writeFileSync(path.join(folder, 'user.js'), `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
}

function urls(profile: Profile): string[] {
  return [...new Set([profile.homePage, ...(profile.startPages ?? [])].filter((url) => /^https?:\/\//i.test(url)))].slice(0, 20);
}

export async function launchBrowserIntegration(profile: Profile, root: string): Promise<{ status: string; detail?: string }> {
  const descriptor = browserIntegration(profile.browserIntegration);
  if (!descriptor) return { status: 'browser-integration-unavailable', detail: 'not-selected' };
  if (!descriptor.capabilities.launch || descriptor.classification !== 'browser') return { status: 'browser-integration-unavailable', detail: descriptor.classification };
  if (profile.fingerprint?.enabled || profile.protection.level !== 'normal' || Object.keys(profile.protection.overrides ?? {}).length) {
    return { status: 'browser-integration-unsupported', detail: 'advanced-settings-not-supported-by-adapter' };
  }
  const statuses = await detectBrowserIntegrations({ [descriptor.id]: profile.browserExecutablePath ?? '' });
  const detected = statuses.find((entry) => entry.id === descriptor.id);
  if (!detected?.installed || !detected.executablePath) return { status: 'browser-integration-missing', detail: descriptor.id };
  const folder = profileFolder(profile, root);
  const args: string[] = [];
  if (descriptor.id === 'librewolf') {
    writeFirefoxAdapter(folder, profile);
    args.push('-no-remote', '-profile', folder);
  } else {
    args.push(`--user-data-dir=${folder}`, '--no-first-run', '--no-default-browser-check', ...proxyArgs(profile));
  }
  args.push(...urls(profile));
  try {
    launchDetached(detected.executablePath, args);
    return { status: 'browser-integration-launched' };
  } catch (error) {
    return { status: 'browser-integration-launch-failed', detail: error instanceof Error ? error.message : String(error) };
  }
}
