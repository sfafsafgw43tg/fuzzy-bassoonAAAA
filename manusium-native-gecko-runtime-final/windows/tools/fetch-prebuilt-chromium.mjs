#!/usr/bin/env node
/**
 * Acquire the already-built InkBrowser Chromium payload for normal users.
 *
 * This never builds Chromium and never accepts Chrome for Testing. The release
 * asset is accompanied by a SHA-256 file, and the extracted runtime must also
 * pass the same source-built manifest/executable checks used by packaging.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.env.INKBROWSER_CHROMIUM_VERSION ?? '155.0.8059.39';
const owner = process.env.INKBROWSER_RUNTIME_OWNER ?? 'sfafsafgw43tg';
const repo = process.env.INKBROWSER_RUNTIME_REPO ?? 'fuzzy-bassoonAAAA';
const asset = process.env.INKBROWSER_RUNTIME_ASSET ?? `InkBrowser-Chromium-win32-x64-${version}.zip`;
const checksumAsset = process.env.INKBROWSER_RUNTIME_CHECKSUM_ASSET ?? `${asset}.sha256`;
const releaseBase = process.env.INKBROWSER_RUNTIME_RELEASE_BASE ?? `https://github.com/${owner}/${repo}/releases/latest/download`;
const archiveUrl = process.env.INKBROWSER_RUNTIME_URL ?? `${releaseBase}/${asset}`;
const checksumUrl = process.env.INKBROWSER_RUNTIME_SHA256_URL ?? `${releaseBase}/${checksumAsset}`;
const destination = path.join(root, 'resources', 'engines', 'chromium', version);

function fail(message) { throw new Error(`[fetch-prebuilt-chromium] ${message}`); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function command(file, args, cwd = root) {
  const result = spawnSync(file, args, { cwd, stdio: 'inherit', windowsHide: true, shell: false });
  if (result.error || result.status !== 0) fail(`${file} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
}
async function download(url, file) {
  console.log(`[fetch-prebuilt-chromium] downloading ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) fail(`download failed with HTTP ${response.status}: ${url}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}
function verifyArchiveEntries(archive, temp) {
  const listed = spawnSync('tar', ['-tf', archive], { cwd: temp, encoding: 'utf8', windowsHide: true });
  if (listed.error || listed.status !== 0) fail(`cannot inspect runtime archive; install the Windows 10+ tar utility or use a current Windows build environment`);
  const entries = listed.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) fail('runtime archive is empty');
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.includes('../') || normalized === '..') fail(`runtime archive contains an unsafe path: ${entry}`);
  }
}
function verifyExtractedRuntime() {
  const manifestPath = path.join(destination, 'runtime.json');
  const executable = path.join(destination, 'inkbrowser-chrome.exe');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(executable)) fail(`release did not contain ${version}/runtime.json and inkbrowser-chrome.exe`);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (error) { fail(`runtime.json is invalid: ${error.message}`); }
  if (manifest.schema !== 'octo.engine-manifest.v1' || manifest.kind !== 'chromium' || manifest.version !== version || manifest.executable !== 'inkbrowser-chrome.exe') fail('runtime manifest is not the expected Chromium version or executable');
  if (manifest.distribution !== 'source-built' || manifest.modified !== true) fail('release is not marked as a modified source-built InkBrowser runtime; refusing to install it');
  if (!Array.isArray(manifest.platforms) || !manifest.platforms.includes('win32-x64')) fail('runtime manifest does not declare win32-x64 support');
  const expected = String(manifest.sha256 ?? '').toLowerCase();
  const actual = sha256(executable);
  if (!/^[a-f0-9]{64}$/.test(expected) || expected !== actual) fail('runtime executable SHA-256 does not match runtime.json');
  console.log(`[fetch-prebuilt-chromium] verified source-built InkBrowser Chromium ${version} (${actual})`);
}

if (process.platform !== 'win32' || process.arch !== 'x64') fail('normal prebuilt acquisition is only for Windows x64');
if (fs.existsSync(destination)) {
  try { verifyExtractedRuntime(); console.log('[fetch-prebuilt-chromium] existing runtime is valid; nothing to download'); process.exit(0); } catch { /* replace only after a complete verified download */ }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkbrowser-runtime-'));
const archive = path.join(temp, asset);
const checksumFile = path.join(temp, checksumAsset);
const extracted = path.join(temp, 'extracted');
try {
  await download(archiveUrl, archive);
  await download(checksumUrl, checksumFile);
  const checksumText = fs.readFileSync(checksumFile, 'utf8');
  const match = checksumText.match(/\b([a-f0-9]{64})\b/i);
  if (!match) fail(`checksum asset does not contain a SHA-256 value: ${checksumUrl}`);
  const actualArchiveHash = sha256(archive);
  if (actualArchiveHash.toLowerCase() !== match[1].toLowerCase()) fail(`runtime archive SHA-256 mismatch (expected ${match[1]}, got ${actualArchiveHash})`);
  verifyArchiveEntries(archive, temp);
  fs.mkdirSync(extracted, { recursive: true });
  command('tar', ['-xf', archive, '-C', extracted], temp);
  const extractedDestination = path.join(extracted, version);
  if (!fs.existsSync(extractedDestination)) fail(`runtime archive must contain a top-level ${version} directory`);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(extractedDestination, destination);
  try { verifyExtractedRuntime(); } catch (error) { fs.rmSync(destination, { recursive: true, force: true }); throw error; }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
