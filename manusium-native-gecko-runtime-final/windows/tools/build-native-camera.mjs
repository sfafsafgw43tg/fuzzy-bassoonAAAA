import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const project = path.join(root, 'native', 'octo-camera');
const build = path.join(project, 'build');
const output = path.join(root, 'resources', 'native-camera');

if (process.platform !== 'win32') {
  console.log('native camera: skipped (Windows-only Media Foundation target)');
  process.exit(0);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

fs.mkdirSync(output, { recursive: true });
run('cmake', ['-S', project, '-B', build, '-A', 'x64']);
run('cmake', ['--build', build, '--config', 'Release', '--parallel']);

for (const name of ['octo-camera-source.dll', 'octo-cameractl.exe']) {
  const candidates = [path.join(build, 'Release', name), path.join(build, name)];
  const source = candidates.find((file) => fs.existsSync(file));
  if (!source) throw new Error(`Native camera build did not produce ${name}`);
  fs.copyFileSync(source, path.join(output, name));
}
fs.writeFileSync(path.join(output, 'BUILD.txt'), `Built by CMake on ${new Date().toISOString()}\n`);
console.log(`native camera: staged to ${path.relative(root, output)}`);
