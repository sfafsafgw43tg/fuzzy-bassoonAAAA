import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverEngineRuntime, ENGINE_MANIFEST_SCHEMA, type EngineCapability, type EngineManifest } from './engine-runtime';

const execFileAsync = promisify(execFile);

export type RuntimeChannel = 'stable' | 'beta';
export type RuntimeSupport = 'supported' | 'retired';
export interface ChromiumCatalogEntry {
  version: string; channel: RuntimeChannel; support: RuntimeSupport; default?: boolean;
  platform: 'linux-x64' | 'win32-x64'; source: string; archiveSha256: string;
  executable: string; distribution?: EngineManifest['distribution']; displayName?: string; archiveRoot?: string;
  manifest: Pick<EngineManifest, 'schema' | 'kind' | 'protocol' | 'capabilities'>;
  retirementReason?: string;
}

export const CHROMIUM_CATALOG: readonly ChromiumCatalogEntry[] = [
  { version: '155.0.8059.39', channel: 'stable', support: 'supported', default: true, platform: 'linux-x64', source: 'https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.39/linux64/chrome-linux64.zip', archiveSha256: '55672d1f392fd3e7b7a08621b6e804e6bcb39d40cf155504abb74b3a021ea8ea', executable: 'inkbrowser-chrome', manifest: { schema: ENGINE_MANIFEST_SCHEMA, kind: 'chromium', protocol: 'cdp', capabilities: ['window', 'tabs', 'navigation', 'crash-recovery'] } },
  { version: '155.0.8059.39', channel: 'stable', support: 'supported', default: true, platform: 'win32-x64', source: 'https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.39/win64/chrome-win64.zip', archiveSha256: '59ab2a6e99bde9c0bc180414988394f9f5355a0d3764c704151ee8ecea235c7e', executable: 'inkbrowser-chrome.exe', manifest: { schema: ENGINE_MANIFEST_SCHEMA, kind: 'chromium', protocol: 'cdp', capabilities: ['window', 'tabs', 'navigation', 'crash-recovery'] } },
  { version: '155.0.8059.39-1.1', channel: 'stable', support: 'supported', platform: 'win32-x64', source: 'https://github.com/ungoogled-software/ungoogled-chromium-windows/releases/download/155.0.8059.39-1.1/ungoogled-chromium_155.0.8059.39-1.1_windows_x64.zip', archiveSha256: '7ab1bac653c531ea06cd4f08a59120e129d53f73f2cf7a00ae52a43276849f11', executable: 'chrome.exe', distribution: 'ungoogled-chromium', displayName: 'Ungoogled Chromium', archiveRoot: 'ungoogled-chromium_155.0.8059.39-1.1_windows_x64', manifest: { schema: ENGINE_MANIFEST_SCHEMA, kind: 'chromium', protocol: 'cdp', capabilities: ['window', 'tabs', 'navigation', 'crash-recovery'] } },
  { version: '156.0.8078.12', channel: 'beta', support: 'supported', platform: 'linux-x64', source: 'https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.12/linux64/chrome-linux64.zip', archiveSha256: 'e83a1cd8ea29a20b43748ee1e7ea414e091429b7d4869ee29aec08c13583111c', executable: 'inkbrowser-chrome', manifest: { schema: ENGINE_MANIFEST_SCHEMA, kind: 'chromium', protocol: 'cdp', capabilities: ['window', 'tabs', 'navigation', 'crash-recovery'] } },
  { version: '156.0.8078.12', channel: 'beta', support: 'retired', platform: 'win32-x64', source: 'https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.12/win64/chrome-win64.zip', archiveSha256: '3afa11a86d390f83dc108c218a8fde04d68f2a9c4fd4cd010db0f2cde4837e5c', executable: 'inkbrowser-chrome.exe', manifest: { schema: ENGINE_MANIFEST_SCHEMA, kind: 'chromium', protocol: 'cdp', capabilities: ['window', 'tabs', 'navigation', 'crash-recovery'] }, retirementReason: 'No native InkBrowser patch-series compatibility claim exists for Chromium 156.' },
  { version: '140.0.7339.207', channel: 'stable', support: 'retired', platform: 'linux-x64', source: 'https://storage.googleapis.com/chrome-for-testing-public/140.0.7339.207/linux64/chrome-linux64.zip', archiveSha256: 'ba5e4c245945118a2b462749bec08ed6797b67559de5f49ab20186177d3b9ec7', executable: 'inkbrowser-chrome', manifest: { schema: ENGINE_MANIFEST_SCHEMA, kind: 'chromium', protocol: 'cdp', capabilities: ['window', 'tabs', 'navigation', 'crash-recovery'] }, retirementReason: 'Security support ended; retained only for compatibility migration.' },
] as const;

export const DEFAULT_CHROMIUM_VERSION = CHROMIUM_CATALOG.find((e) => e.default && e.support === 'supported')!.version;
export function catalogForPlatform(platform = process.platform, arch = process.arch): ChromiumCatalogEntry[] {
  const key = `${platform}-${arch}` as ChromiumCatalogEntry['platform'];
  return CHROMIUM_CATALOG.filter((e) => e.platform === key);
}
export function catalogEntry(version: string, platform = process.platform, arch = process.arch): ChromiumCatalogEntry {
  const entry = catalogForPlatform(platform, arch).find((e) => e.version === version);
  if (!entry) throw new Error(`No catalog entry for Chromium ${version} on ${platform}-${arch}`);
  return entry;
}
export function validateCatalog(entries = CHROMIUM_CATALOG): void {
  const platforms = [...new Set(entries.map((e) => e.platform))];
  for (const platform of platforms) if (entries.filter((e) => e.platform === platform && e.default && e.support === 'supported').length !== 1) throw new Error(`Chromium catalog must have exactly one supported default for ${platform}`);
  for (const e of entries) {
    if (!/^\d+\.\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(e.version) || !/^https:\/\//.test(e.source) || !/^[a-f0-9]{64}$/.test(e.archiveSha256)) throw new Error(`Invalid catalog entry ${e.version}`);
    if (e.manifest.schema !== ENGINE_MANIFEST_SCHEMA || e.manifest.kind !== 'chromium' || e.manifest.protocol !== 'cdp') throw new Error(`Invalid manifest metadata for ${e.version}`);
    if (e.distribution === 'ungoogled-chromium' && (e.platform !== 'win32-x64' || e.executable !== 'chrome.exe' || !e.archiveRoot)) throw new Error(`Invalid ungoogled-Chromium metadata for ${e.version}`);
  }
}

async function digest(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}
async function safeExtract(zip: string, temp: string): Promise<void> {
  const listingResult = process.platform === 'win32'
    ? await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '& { param($archive); Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead($archive); try { $z.Entries | ForEach-Object { $_.FullName } } finally { $z.Dispose() } }', zip], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    : await execFileAsync('unzip', ['-Z1', zip], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  for (const item of String(listingResult.stdout).split(/\r?\n/).filter(Boolean)) {
    const clean = item.replace(/\\/g, '/');
    if (clean.startsWith('/') || clean.split('/').includes('..')) throw new Error(`Unsafe archive path: ${item}`);
  }
  if (process.platform === 'win32') {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '& { param($archive, $target); $ErrorActionPreference = "Stop"; Expand-Archive -LiteralPath $archive -DestinationPath $target -Force }', zip, temp], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  } else {
    await execFileAsync('unzip', ['-q', '-o', zip, '-d', temp], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  }
}
export interface InstalledRuntime { entry: ChromiumCatalogEntry; rootDir: string; executablePath: string; installed: boolean; bundled?: boolean; installable?: boolean; }
export function listInstalled(root: string, platform = process.platform, arch = process.arch, bundledResources: string[] = []): InstalledRuntime[] {
  return catalogForPlatform(platform, arch).map((entry) => {
    const missing = { entry, rootDir: path.join(root, entry.version), executablePath: path.join(root, entry.version, entry.executable), installed: false, bundled: false, installable: (platform !== 'win32' || entry.distribution === 'ungoogled-chromium') && entry.support === 'supported' };
    for (const resourcesPath of bundledResources.length ? bundledResources : ['']) {
      try {
        const runtime = discoverEngineRuntime('chromium', { resourcesPath, env: { OCTO_CHROMIUM_RUNTIME: root }, platform, arch, version: entry.version });
        return { ...missing, rootDir: runtime.rootDir, executablePath: runtime.executablePath, installed: true, bundled: path.resolve(runtime.rootDir) !== path.resolve(root, entry.version) };
      } catch { /* Invalid or incomplete runtimes must not appear ready. */ }
    }
    return missing;
  });
}

const installLocks = new Map<string, Promise<InstalledRuntime>>();
export function installChromium(entry: ChromiumCatalogEntry, root: string, fetch = true): Promise<InstalledRuntime> {
  const key = `${process.platform}-${process.arch}:${path.resolve(root)}:${entry.version}`;
  const existing = installLocks.get(key);
  if (existing) return existing;
  const operation = installChromiumOnce(entry, root, fetch).finally(() => installLocks.delete(key));
  installLocks.set(key, operation);
  return operation;
}
async function installChromiumOnce(entry: ChromiumCatalogEntry, root: string, fetch = true): Promise<InstalledRuntime> {
  if (entry.support === 'retired') throw new Error(`Cannot install retired Chromium ${entry.version}`);
  if (entry.platform === 'win32-x64' && entry.distribution !== 'ungoogled-chromium') throw new Error('This Windows Chromium distribution must be built from the pinned source checkout.');
  await fsp.mkdir(root, { recursive: true });
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'octo-runtime-')); const archive = path.join(temp, 'runtime.zip'); const unpacked = path.join(temp, 'unpacked');
  try {
    const suppliedArchive = process.env.OCTO_CHROMIUM_ARCHIVE;
    if (fetch) {
      const downloader = process.platform === 'win32' ? 'curl.exe' : 'curl';
      const mirrors = [entry.source, entry.source.replace('https://storage.googleapis.com/', 'https://commondatastorage.googleapis.com/')];
      const errors: string[] = [];
      let acquired = false;
      for (const url of mirrors) {
        try {
          await fsp.rm(archive, { force: true });
          await execFileAsync(downloader, ['-fL', '--retry', '3', '--retry-delay', '2', '--connect-timeout', '20', url, '-o', archive], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
          if (await digest(archive) === entry.archiveSha256) { acquired = true; break; }
          errors.push(`${url}: checksum mismatch`);
        } catch (error) { errors.push(`${url}: ${String(error instanceof Error ? error.message : error)}`); }
      }
      if (!acquired) throw new Error(`all Chromium mirrors failed for ${entry.version}: ${errors.join(' | ')}`);
    } else if (suppliedArchive) {
      await fsp.copyFile(path.resolve(suppliedArchive), archive);
    } else {
      throw new Error('A local archive is required when fetch=false; set OCTO_CHROMIUM_ARCHIVE.');
    }
    if (await digest(archive) !== entry.archiveSha256) throw new Error(`Archive checksum mismatch for ${entry.version}`);
    await fsp.mkdir(unpacked, { recursive: true });
    await safeExtract(archive, unpacked);
    const sourceRoot = path.join(unpacked, entry.archiveRoot ?? (entry.platform.startsWith('win') ? 'chrome-win64' : 'chrome-linux64'));
    const exeSource = path.join(sourceRoot, entry.platform.startsWith('win') ? 'chrome.exe' : 'chrome');
    if (!fs.existsSync(exeSource)) throw new Error(`Runtime executable missing for ${entry.version}`);
    if (entry.distribution === 'ungoogled-chromium') {
      const required = ['chrome.dll', 'chrome_elf.dll', 'chrome_wer.dll', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'resources.pak', 'icudtl.dat', 'v8_context_snapshot.bin', 'libEGL.dll', 'libGLESv2.dll', 'locales/en-US.pak'];
      for (const name of required) if (!fs.existsSync(path.join(sourceRoot, ...name.split('/')))) throw new Error(`Ungoogled-Chromium archive is missing required file: ${name}`);
    }
    const finalRoot = path.join(root, entry.version); const staged = `${finalRoot}.partial-${process.pid}`;
    await fsp.rm(staged, { recursive: true, force: true }); await fsp.cp(sourceRoot, staged, { recursive: true });
    const executablePath = path.join(staged, entry.executable);
    if (path.resolve(exeSource) !== path.resolve(executablePath)) await fsp.rename(exeSource.replace(sourceRoot, staged), executablePath);
    if (!entry.platform.startsWith('win')) await fsp.chmod(executablePath, 0o755);
    const manifest = { ...entry.manifest, version: entry.version, executable: entry.executable, platforms: [entry.platform], capabilities: entry.manifest.capabilities as EngineCapability[], distribution: entry.distribution ?? 'catalog-archive', modified: entry.distribution === 'ungoogled-chromium' ? false : undefined, notices: entry.distribution === 'ungoogled-chromium' ? 'incomplete' : undefined, sha256: await digest(executablePath), source: { url: entry.source, archiveSha256: entry.archiveSha256, license: entry.distribution === 'ungoogled-chromium' ? 'Ungoogled-Chromium and Chromium licenses; complete third-party notices require maintainer/legal review.' : 'Chrome for Testing distribution; preserve ABOUT and upstream notices.' } };
    await fsp.writeFile(path.join(staged, 'runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`); await fsp.writeFile(path.join(staged, 'NOTICE.chromium.txt'), `Chromium ${entry.version} (${entry.channel}) from ${entry.displayName ?? 'the pinned catalog archive'}.\nSource: ${entry.source}\nArchive SHA-256: ${entry.archiveSha256}\nThe upstream archive did not include a complete third-party notice inventory. Preserve any upstream notice files present and complete maintainer/legal review before redistribution.\n`);
    await fsp.rm(finalRoot, { recursive: true, force: true }); await fsp.rename(staged, finalRoot);
    return { entry, rootDir: finalRoot, executablePath: path.join(finalRoot, entry.executable), installed: true };
  } finally { await fsp.rm(temp, { recursive: true, force: true }); }
}
export function removeChromium(entry: ChromiumCatalogEntry, root: string, inUse: boolean): void { if (inUse) throw new Error(`Chromium ${entry.version} is in use`); fs.rmSync(path.join(root, entry.version), { recursive: true, force: false }); }
validateCatalog();
