import fs from 'node:fs';
import path from 'node:path';
function size(file) {
  if (!fs.existsSync(file)) return 0;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) return 0;
  return stat.isDirectory() ? fs.readdirSync(file).reduce((total, name) => total + size(path.join(file, name)), 0) : stat.size;
}
const report = { schema: 'octo.compact-build-size.v1', note: 'Logical bytes at the end of packaging, not peak allocation. Cache entries and installer staging may coexist during packaging.',
  dependenciesBytes: size('node_modules'), appBundleBytes: size('apps/octocompact/dist'), packageAndInstallerBytes: size('release/compact'),
  electronCacheBytes: size(process.env.ELECTRON_CACHE || ''), builderCacheBytes: size(process.env.ELECTRON_BUILDER_CACHE || '') };
fs.mkdirSync('ci-logs/compact', { recursive: true });
fs.writeFileSync('ci-logs/compact/build-size.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Compact build footprint::${JSON.stringify(report)}`);
