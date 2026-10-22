/** Bundled WebExtension metadata and source layout. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundledExtension, bundledExtensionPath, inspectLocalChromeExtension, nativeBundledExtensionPaths } from '../src/main/extensions';
import { ADDONS } from '@octo/core';

const root = process.cwd();
const distDir = path.join(root, 'apps', 'octobrowser', 'dist');

describe('bundled PrOximAl Editor extension', () => {
  it('is catalogued with a clear local-only description and non-default enablement', () => {
    const addon = ADDONS.find((item) => item.id === 'proximal-editor');
    expect(addon).toMatchObject({
      name: 'PrOximAl Editor', kind: 'extension', version: '1.0.0', defaultEnabled: false,
    });
    expect(addon?.description.en).toMatch(/local-only/i);
    expect(addon?.description.en).toMatch(/never submits forms/i);
  });

  it('ships the reviewed source and declares no host permissions or extension-page network access', () => {
    const extension = bundledExtension('proximal-editor');
    expect(extension).toBeDefined();
    const source = bundledExtensionPath(extension!, distDir, false, '/unused-resources-dir');
    expect(source).toBe(path.join(root, 'resources', 'addons', 'proximal-editor'));

    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8')) as {
      manifest_version: number; permissions: string[]; host_permissions?: string[]; content_security_policy?: { extension_pages?: string };
    };
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(expect.arrayContaining(['activeTab', 'contextMenus', 'scripting', 'storage']));
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.content_security_policy?.extension_pages).toContain("connect-src 'none'");
  });
});

describe('native Chromium addon bundles', () => {
  it('resolves only application-owned MV3 bundles', () => {
    const resources = fs.mkdtempSync(path.join('/tmp', 'octo-addons-'));
    const addon = path.join(resources, 'addons', 'dark-pages');
    fs.mkdirSync(addon, { recursive: true });
    fs.writeFileSync(path.join(addon, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'test', version: '1.0.0' }));
    expect(nativeBundledExtensionPaths(['dark-pages', 'not-a-bundle'], '', true, resources)).toEqual([addon]);
  });

  it('fails clearly when a reviewed bundle is absent or malformed', () => {
    const resources = fs.mkdtempSync(path.join('/tmp', 'octo-addons-invalid-'));
    expect(() => nativeBundledExtensionPaths(['dark-pages'], '', true, resources)).toThrow(/missing: dark-pages/);
    const addon = path.join(resources, 'addons', 'clearurls');
    fs.mkdirSync(addon, { recursive: true });
    fs.writeFileSync(path.join(addon, 'manifest.json'), '{not-json');
    expect(() => nativeBundledExtensionPaths(['clearurls'], '', true, resources)).toThrow(/invalid: clearurls/);
    fs.writeFileSync(path.join(addon, 'manifest.json'), JSON.stringify({ manifest_version: 2 }));
    expect(() => nativeBundledExtensionPaths(['clearurls'], '', true, resources)).toThrow(/unsupported: clearurls/);
  });
});

describe('profile-local Chrome extensions', () => {
  it('reads a valid MV3 manifest and exposes declared permissions', () => {
    const root = fs.mkdtempSync(path.join('/tmp', 'octo-local-extension-'));
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'Local QA tool', version: '1.2.3', permissions: ['storage', 'tabs'], host_permissions: ['https://example.test/*'],
    }));
    expect(inspectLocalChromeExtension(root)).toMatchObject({ name: 'Local QA tool', version: '1.2.3', permissions: ['storage', 'tabs'], hostPermissions: ['https://example.test/*'], manifestVersion: 3 });
    expect(inspectLocalChromeExtension(root).id).toMatch(/^chrome-local-[a-f0-9]{16}$/);
  });

  it('rejects malformed and unsupported manifests', () => {
    const root = fs.mkdtempSync(path.join('/tmp', 'octo-local-extension-invalid-'));
    expect(() => inspectLocalChromeExtension(root)).toThrow(/missing or invalid/);
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ manifest_version: 1, name: 'old', version: '1' }));
    expect(() => inspectLocalChromeExtension(root)).toThrow(/Manifest V2 or V3/);
  });
});
