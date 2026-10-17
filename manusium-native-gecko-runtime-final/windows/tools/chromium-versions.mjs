// Build/test versions are explicit pins, never resolved from "latest".
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const versions = JSON.parse(fs.readFileSync(new URL('./chromium-versions.json', import.meta.url), 'utf8'));
if (!Array.isArray(versions) || versions.length < 1 || new Set(versions).size !== versions.length || versions.some(v => !/^\d+\.\d+\.\d+\.\d+$/.test(v))) throw new Error('Invalid InkBrowser version pins');
export function runNode(script, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${script} failed: ${result.error?.message ?? result.status}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (!['build', 'verify', 'verify-packaged', 'test'].includes(mode)) throw new Error('Expected build, verify, verify-packaged, or test');
  for (const version of versions) {
    console.log(`[InkBrowser] ${mode} ${version}`);
    const env = { ...process.env, INKBROWSER_CHROMIUM_VERSION: version };
    if (mode === 'build') runNode('build-chromium-source.mjs', ['--version', version], env);
    if (mode === 'verify') runNode('verify-prebuilt-chromium.mjs', [], env);
    if (mode === 'verify-packaged') runNode('verify-packaged-chromium.mjs', process.argv.slice(3), env);
    if (mode === 'test') runNode('test-packaged-chromium.mjs', ['win32-x64', '--packaged'], env);
  }
}
