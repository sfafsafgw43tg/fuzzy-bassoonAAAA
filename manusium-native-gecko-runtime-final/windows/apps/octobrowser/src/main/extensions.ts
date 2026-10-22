/**
 * apps/octobrowser/src/main/extensions.ts
 *
 * Reviewed bundles and explicit user-selected local Chromium extensions.
 * Local extensions are never downloaded or executed through a shell. Their
 * manifest is read before loading and the resulting metadata is persisted per
 * profile so permissions are visible in the launcher.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProfileChromeExtension } from '@octo/core';

export interface BundledExtension {
  addonId: string;
  folder: string;
  entryPage: string;
  nativeOnly?: boolean;
}

export interface LocalChromeExtensionManifest {
  id: string;
  name: string;
  version: string;
  path: string;
  permissions: string[];
  hostPermissions: string[];
  manifestVersion: 2 | 3;
}

const BUNDLED_EXTENSIONS: readonly BundledExtension[] = Object.freeze([
  { addonId: 'proximal-editor', folder: 'proximal-editor', entryPage: 'workspace.html' },
  { addonId: 'dark-pages', folder: 'dark-pages', entryPage: '', nativeOnly: true },
  { addonId: 'clearurls', folder: 'clearurls', entryPage: '', nativeOnly: true },
]);

const cleanStrings = (value: unknown, max = 64): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string').map((item) => item.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 256)).filter(Boolean).slice(0, max)
  : [];

/** Validate an unpacked MV2/MV3 directory and return only safe persisted metadata. */
export function inspectLocalChromeExtension(extensionPath: string): LocalChromeExtensionManifest {
  if (!path.isAbsolute(extensionPath)) throw new Error('Chrome extension path must be absolute');
  const resolved = fs.realpathSync(extensionPath);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Chrome extension path must be a directory');
  const manifestPath = path.join(resolved, 'manifest.json');
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { throw new Error('Chrome extension manifest.json is missing or invalid'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('Chrome extension manifest must be an object');
  const manifest = parsed as Record<string, unknown>;
  const manifestVersion = manifest.manifest_version;
  if (manifestVersion !== 2 && manifestVersion !== 3) throw new Error('Only Chrome Manifest V2 or V3 extensions are supported');
  const name = typeof manifest.name === 'string' ? manifest.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) : '';
  const version = typeof manifest.version === 'string' ? manifest.version.trim().slice(0, 64) : '';
  if (!name || !version) throw new Error('Chrome extension manifest must declare name and version');
  const digest = crypto.createHash('sha256').update(resolved.toLowerCase()).digest('hex').slice(0, 16);
  return { id: `chrome-local-${digest}`, name, version, path: resolved, permissions: cleanStrings(manifest.permissions), hostPermissions: cleanStrings(manifest.host_permissions), manifestVersion };
}

export function toProfileChromeExtension(manifest: LocalChromeExtensionManifest): ProfileChromeExtension {
  return { id: manifest.id, name: manifest.name, version: manifest.version, path: manifest.path, permissions: manifest.permissions, hostPermissions: manifest.hostPermissions, enabled: true };
}

export function bundledExtension(addonId: string): BundledExtension | undefined {
  return BUNDLED_EXTENSIONS.find((extension) => extension.addonId === addonId);
}

export function bundledExtensionPath(extension: BundledExtension, distDir: string, packaged: boolean, resourcesDir: string): string {
  return packaged
    ? path.join(resourcesDir, 'addons', extension.folder)
    : path.resolve(distDir, '..', '..', '..', 'resources', 'addons', extension.folder);
}

export function nativeBundledExtensionPaths(
  addonIds: readonly string[], distDir: string, packaged: boolean, resourcesDir: string,
): string[] {
  const paths: string[] = [];
  for (const addonId of new Set(addonIds)) {
    const extension = bundledExtension(addonId);
    if (!extension) continue;
    const extensionPath = bundledExtensionPath(extension, distDir, packaged, resourcesDir);
    const manifest = path.join(extensionPath, 'manifest.json');
    if (!fs.existsSync(manifest)) throw new Error(`Chromium addon package is missing: ${addonId}`);
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch { throw new Error(`Chromium addon manifest is invalid: ${addonId}`); }
    if (!parsed || typeof parsed !== 'object' || (parsed as { manifest_version?: unknown }).manifest_version !== 3) {
      throw new Error(`Chromium addon manifest is unsupported: ${addonId}`);
    }
    paths.push(extensionPath);
  }
  return paths;
}
