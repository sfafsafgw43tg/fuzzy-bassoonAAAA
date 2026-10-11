import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '../../..');
const text = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('installed InkBrowser release gate', () => {
  it('fails rather than skips when a required runtime is absent', () => {
    const missing = mkdtempSync(path.join(os.tmpdir(), 'missing-inkbrowser-'));
    try {
      const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'packages/shell/test/native-engine.integration.test.ts'], {
        cwd: root, encoding: 'utf8', timeout: 25000,
        env: { ...process.env, OCTO_REQUIRE_NATIVE_RUNTIME: '1', OCTO_PACKAGED_CHROMIUM_ROOT: missing, OCTO_CHROMIUM_PATH: '', INKBROWSER_CHROMIUM_VERSION: '155.0.8059.39' },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toMatch(/runtime|manifest/i);
    } finally { rmSync(missing, { recursive: true, force: true }); }
  }, 30000);

  it('rejects an empty installed app instead of downloading a substitute', () => {
    const missing = mkdtempSync(path.join(os.tmpdir(), 'empty-inkbrowser-app-'));
    try {
      const result = spawnSync(process.execPath, ['tools/test-packaged-chromium.mjs', 'win32-x64', `--root=${missing}`], { cwd: root, encoding: 'utf8', timeout: 10000 });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toMatch(/require Windows|missing|verification failed/);
    } finally { rmSync(missing, { recursive: true, force: true }); }
  });

  it('tests each selected runtime in place and never copies installed binaries to a test tree', () => {
    const runner = text('tools/test-packaged-chromium.mjs');
    expect(runner).toContain("verify-packaged-chromium.mjs");
    expect(runner).toContain("OCTO_REQUIRE_NATIVE_RUNTIME: '1'");
    expect(runner).not.toContain('fs.cpSync');
    const native = text('packages/shell/test/native-engine.integration.test.ts');
    expect(native).toContain('version: process.env.INKBROWSER_CHROMIUM_VERSION');
    const installer = text('tools/ci/installer-e2e.ps1');
    expect(installer).toContain('No pre-existing OctoSuite installation');
    expect(installer).toContain('foreach ($runtimeVersion in $runtimeVersions)');
    expect(installer).toContain('tools\\test-packaged-chromium.mjs');
    expect(installer).toContain('"--root=$(Join-Path $installDir \'OctoBrowser\')"');
    expect(installer).toContain("$env:OCTO_NATIVE_VISIBLE = '1'");
  });
});
