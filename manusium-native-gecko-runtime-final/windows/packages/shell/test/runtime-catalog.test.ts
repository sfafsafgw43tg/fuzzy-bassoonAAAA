import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CHROMIUM_CATALOG, DEFAULT_CHROMIUM_VERSION, catalogForPlatform, catalogEntry, validateCatalog, listInstalled, installChromium } from '../src/runtime-catalog';
import { FIREFOX_CATALOG, geckoCatalogEntry, listInstalledGecko } from '../src/gecko-runtime';

describe('Chromium runtime catalog', () => {
  it('has one supported default per platform and a current Stable choice', () => {
    validateCatalog();
    expect(DEFAULT_CHROMIUM_VERSION).toBe('155.0.8059.39');
    expect(catalogForPlatform('linux', 'x64').find((e) => e.default)?.channel).toBe('stable');
    expect(catalogForPlatform('win32', 'x64').find((e) => e.default)?.channel).toBe('stable');
    expect(CHROMIUM_CATALOG.some((e) => e.channel === 'beta' && e.support === 'supported')).toBe(true);
  });
  it('does not allow installing the retired compatibility entry', () => {
    const retired = catalogEntry('140.0.7339.207', 'linux', 'x64');
    expect(retired.support).toBe('retired');
  });
  it('rejects a catalog entry with an unpinned source or invalid checksum', () => {
    expect(() => validateCatalog([{ ...CHROMIUM_CATALOG[0], source: 'https://example.invalid/latest', archiveSha256: 'bad' }])).toThrow(/invalid catalog entry/i);
  });
  it('does not treat a repackaged Windows archive as an installed source build', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'octo-chromium-catalog-'));
    try {
      const runtime = path.join(root, '155.0.8059.39');
      fs.mkdirSync(runtime, { recursive: true });
      const executable = path.join(runtime, 'inkbrowser-chrome.exe');
      fs.writeFileSync(executable, 'not-a-vendor-runtime');
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
      fs.writeFileSync(path.join(runtime, 'runtime.json'), JSON.stringify({ version: '155.0.8059.39', sha256, distribution: 'cft' }));
      expect(listInstalled(root, 'win32', 'x64').find((e) => e.entry.version === '155.0.8059.39')?.installed).toBe(false);
      expect(() => installChromium(catalogEntry('155.0.8059.39', 'win32', 'x64'), root)).toThrow(/built from the pinned source checkout/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it('extracts a verified ungoogled-Chromium archive without renaming chrome.exe', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'octo-ungoogled-catalog-'));
    const root = path.join(work, 'installed');
    const archiveRoot = 'ungoogled-test_windows_x64';
    const source = path.join(work, archiveRoot);
    const archive = path.join(work, 'runtime.zip');
    try {
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, 'chrome.exe'), 'verified browser payload');
      for (const name of ['chrome.dll', 'chrome_elf.dll', 'chrome_wer.dll', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'resources.pak', 'icudtl.dat', 'v8_context_snapshot.bin', 'libEGL.dll', 'libGLESv2.dll', 'LICENSE.chromium', 'LICENSE.ungoogled-chromium', 'THIRD-PARTY-NOTICES.txt']) {
        const file = path.join(source, ...name.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'runtime fixture');
      }
      fs.mkdirSync(path.join(source, 'locales'), { recursive: true });
      fs.writeFileSync(path.join(source, 'locales', 'en-US.pak'), 'locale');
      execFileSync('zip', ['-q', '-r', archive, archiveRoot], { cwd: work });
      const archiveSha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
      const entry = { ...CHROMIUM_CATALOG.find((candidate) => candidate.distribution === 'ungoogled-chromium')!, version: '155.0.8059.39-test', archiveRoot, archiveSha256 };
      const previous = process.env.OCTO_CHROMIUM_ARCHIVE;
      process.env.OCTO_CHROMIUM_ARCHIVE = archive;
      try {
        const installed = installChromium(entry, root, false);
        expect(installed.executablePath.endsWith(`${path.sep}chrome.exe`)).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(path.join(installed.rootDir, 'runtime.json'), 'utf8')) as Record<string, unknown>;
        expect(manifest.distribution).toBe('ungoogled-chromium');
        expect(manifest.modified).toBe(false);
        expect(fs.existsSync(path.join(installed.rootDir, 'LICENSE.chromium'))).toBe(true);
      } finally {
        if (previous === undefined) delete process.env.OCTO_CHROMIUM_ARCHIVE;
        else process.env.OCTO_CHROMIUM_ARCHIVE = previous;
      }
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
  it('pins official Mozilla Gecko archives for Linux and Windows', () => {
    expect(FIREFOX_CATALOG[0].source).toContain('ftp.mozilla.org/pub/firefox/releases/140.0');
    expect(FIREFOX_CATALOG[0].archiveSha512).toMatch(/^[a-f0-9]{128}$/);
    expect(geckoCatalogEntry('140.0', 'linux', 'x64').executable).toBe('inkbrowser-firefox');
    expect(geckoCatalogEntry('140.0', 'win32', 'x64').executable).toBe('inkbrowser-firefox.exe');
    expect(geckoCatalogEntry('140.0', 'win32', 'x64').format).toBe('msi');
  });
  it('recognizes a verified staged Gecko runtime from its platforms manifest field', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'octo-gecko-catalog-'));
    try {
      const runtime = path.join(root, '140.0');
      fs.mkdirSync(runtime, { recursive: true });
      const executable = path.join(runtime, 'inkbrowser-firefox');
      fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
      fs.writeFileSync(path.join(runtime, 'runtime.json'), JSON.stringify({ version: '140.0', platforms: ['linux-x64'], executableSha256: sha256 }));
      expect(listInstalledGecko(root, 'linux', 'x64')[0]?.installed).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
