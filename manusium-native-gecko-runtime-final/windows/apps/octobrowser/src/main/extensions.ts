/**
 * apps/octobrowser/src/main/extensions.ts
 *
 * Paths and metadata for reviewed WebExtensions bundled with OctoBrowser.
 * A profile process loads an enabled bundle into its own default session, so
 * extension storage and any granted active-tab access remain profile-local.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BundledExtension {
  /** Matching id from packages/core/src/addons.ts. */
  addonId: string;
  /** Folder shipped below resources/addons in packaged builds. */
  folder: string;
  /** Local extension page made available through the OctoBrowser Add-ons panel. */
  entryPage: string;
  /** Native Chromium loads this at process start; Electron does not. */
  nativeOnly?: boolean;
}

const BUNDLED_EXTENSIONS: readonly BundledExtension[] = Object.freeze([
  { addonId: 'proximal-editor', folder: 'proximal-editor', entryPage: 'workspace.html' },
  { addonId: 'dark-pages', folder: 'dark-pages', entryPage: '', nativeOnly: true },
  { addonId: 'clearurls', folder: 'clearurls', entryPage: '', nativeOnly: true },
]);

export function bundledExtension(addonId: string): BundledExtension | undefined {
  return BUNDLED_EXTENSIONS.find((extension) => extension.addonId === addonId);
}

/**
 * Locate the unpacked extension source in both developer and packaged builds.
 * Electron must load extensions from a real directory, never from app.asar.
 */
export function bundledExtensionPath(extension: BundledExtension, distDir: string, packaged: boolean, resourcesDir: string): string {
  return packaged
    ? path.join(resourcesDir, 'addons', extension.folder)
    : path.resolve(distDir, '..', '..', '..', 'resources', 'addons', extension.folder);
}

/** Resolve only reviewed, application-owned bundles for standalone Chromium. */
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
