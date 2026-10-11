#!/usr/bin/env node
/**
 * Apply the supplied native Chromium patch series to the pinned source tree.
 *
 * This is a developer/CI-only step. The normal InkBrowser installer never
 * downloads Chromium source, depot_tools, or Visual Studio.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const patchRoot = path.join(root, 'tools', 'inkbrowser', 'source', 'patches');
export const seriesFile = path.join(patchRoot, 'series');

export function readPatchSeries(file = seriesFile) {
  if (!fs.existsSync(file)) throw new Error(`Chromium patch series is missing: ${file}`);
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').replace(/\s+$/, '').replace(/!$/, '').trim())
    .filter(Boolean);
}

export function patchFiles(file = seriesFile) {
  return readPatchSeries(file).map((name) => path.join(path.dirname(file), name));
}

export function seriesDigest(file = seriesFile) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  for (const patch of patchFiles(file)) {
    if (!fs.existsSync(patch)) throw new Error(`Patch listed in series is missing: ${patch}`);
    hash.update(path.basename(patch));
    hash.update(fs.readFileSync(patch));
  }
  return hash.digest('hex');
}

export function validatePatchBundle(file = seriesFile) {
  const names = readPatchSeries(file);
  const files = patchFiles(file);
  const missing = files.filter((entry) => !fs.existsSync(entry));
  if (missing.length) throw new Error(`Chromium patch series has missing files: ${missing.join(', ')}`);
  return { names, files, digest: seriesDigest(file) };
}

export function gitApplyArgs(patches, check = false) {
  const files = Array.isArray(patches) ? patches : [patches];
  return ['apply', '--whitespace=nowarn', ...(check ? ['--check'] : []), ...files];
}

function runGit(source, args) {
  const result = spawnSync('git', ['-C', source, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (output) process.stdout.write(`${output}\n`);
  if (result.error) throw new Error(`git ${args.join(' ')} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed with exit code ${result.status}`);
  return output;
}

function markerPath(source) {
  return path.join(source, 'inkbrowser-patch-series.json');
}

export function applyPatchSeries({ source, checkOnly = false } = {}) {
  if (!source) throw new Error('Chromium source directory is required');
  if (!fs.existsSync(path.join(source, '.git'))) throw new Error(`Chromium source is not a Git checkout: ${source}`);

  const bundle = validatePatchBundle();
  const { names, files, digest } = bundle;
  const marker = markerPath(source);
  if (!checkOnly && fs.existsSync(marker)) {
    try {
      const existing = JSON.parse(fs.readFileSync(marker, 'utf8'));
      if (existing.seriesSha256 === digest && existing.count === names.length) {
        return { applied: false, skipped: true, count: names.length, digest };
      }
    } catch {
      // A malformed marker is not proof that the source is patched; verify it.
    }
    throw new Error(`Chromium source has a patch marker with a different series: ${marker}; rebase or repair the checkout before retrying`);
  }

  // Check the complete ordered series in one Git transaction. Checking each
  // patch independently would incorrectly test later patches against the
  // unmodified tree even though they intentionally depend on earlier patches.
  runGit(source, gitApplyArgs(files, true));
  if (checkOnly) return { applied: false, skipped: false, checked: true, count: names.length, digest };
  runGit(source, gitApplyArgs(files, false));
  fs.writeFileSync(marker, `${JSON.stringify({
    schema: 'inkbrowser.chromium.patch-series.v1',
    product: 'InkBrowser',
    chromiumVersion: '155.0.8059.39',
    count: names.length,
    seriesSha256: digest,
    source: 'InkBrowser-source-handoff.zip',
  }, null, 2)}\n`);
  return { applied: true, skipped: false, count: names.length, digest };
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const checkOnly = process.argv.includes('--check');
  const sourceArg = process.argv.find((value, index) => index > 1 && !value.startsWith('--'));
  const source = sourceArg ? path.resolve(sourceArg) : process.env.OCTO_CHROMIUM_SOURCE;
  if (!source && !checkOnly) throw new Error('Usage: node apply-chromium-patches.mjs <chromium-src>');
  if (!source) {
    const bundle = validatePatchBundle();
    console.log(`[apply-chromium-patches] patch bundle validated (${bundle.names.length} patches, ${bundle.digest})`);
  } else {
    const result = applyPatchSeries({ source, checkOnly });
    console.log(`[apply-chromium-patches] ${result.count} patches ${checkOnly ? 'validated' : 'applied or already present'}`);
  }
}
