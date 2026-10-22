import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
// @ts-expect-error - plain ESM build tool without a declaration file
import { gitApplyArgs, patchFiles, readPatchSeries, seriesDigest, validatePatchBundle } from '../../../tools/inkbrowser/apply-chromium-patches.mjs';

describe('InkBrowser Chromium patch bundle', () => {
  const workspaces: string[] = [];
  afterEach(() => {
    for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
  });

  it('reads the handoff series in order and strips hot-file markers/comments', () => {
    const names = readPatchSeries();
    expect(names.length).toBe(35);
    expect(names[0]).toBe('0001-fp-config-plumbing.patch');
    expect(names.at(-1)).toBe('0903-mac-quit-with-last-window.patch');
    expect(names.every((name: string) => name.endsWith('.patch'))).toBe(true);
  });

  it('has every listed patch and a stable non-empty bundle digest', () => {
    expect(patchFiles().every((file: string) => existsSync(file))).toBe(true);
    expect(seriesDigest()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('constructs Git arguments without shell interpolation', () => {
    const patch = 'C:\\src\\ink browser\\patches\\0030-canvas-noise.patch';
    expect(gitApplyArgs(patch, true)).toEqual([
      'apply', '--whitespace=nowarn', '--check', patch,
    ]);
    expect(gitApplyArgs(patch, false)).toEqual([
      'apply', '--whitespace=nowarn', patch,
    ]);
    expect(gitApplyArgs(['one.patch', 'two.patch'], true)).toEqual([
      'apply', '--whitespace=nowarn', '--check', 'one.patch', 'two.patch',
    ]);
  });

  it('does not accept a missing series entry', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'inkbrowser-patch-test-'));
    workspaces.push(workspace);
    const series = path.join(workspace, 'series');
    mkdirSync(path.join(workspace, 'patches'));
    writeFileSync(series, 'missing.patch\n');
    expect(() => validatePatchBundle(series)).toThrow(/missing.patch/);
  });
});
