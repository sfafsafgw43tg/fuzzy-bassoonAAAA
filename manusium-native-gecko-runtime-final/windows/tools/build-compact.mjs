import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'apps/octocompact');
const output = path.join(dir, 'dist');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
pkg.version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
for (const entry of ['main', 'preload', 'renderer']) {
  await esbuild.build({ entryPoints: [path.join(dir, 'src', `${entry}.ts`)], outfile: path.join(output, `${entry}.js`), bundle: true,
    platform: entry === 'main' ? 'node' : 'browser', format: entry === 'renderer' ? 'iife' : 'cjs', target: entry === 'main' ? 'node22' : 'chrome140',
    external: ['electron'], minify: true, legalComments: 'external', sourcemap: false, tsconfig: path.join(root, 'tsconfig.json') });
}
for (const file of ['index.html', 'style.css']) fs.copyFileSync(path.join(dir, 'src', file), path.join(output, file));
fs.copyFileSync(path.join(root, 'branding/octobrowser/icon.ico'), path.join(output, 'icon.ico'));
console.log('Built Octo Compact UI and main process. No native browser source or extra runtime was downloaded.');
