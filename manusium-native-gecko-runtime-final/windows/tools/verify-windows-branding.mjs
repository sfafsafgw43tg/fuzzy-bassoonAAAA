import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32') throw new Error('Windows executable resource checks require Windows.');
for (const [app, name] of [['octobrowser', 'Octo.su'], ['octodetect', 'OctoDetect.su']]) {
  const exe = path.join(root, 'release', app, 'win-unpacked', `${name}.exe`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference = "Stop"; $v = (Get-Item -LiteralPath $env:OCTO_VERIFY_EXE).VersionInfo; if ($v.ProductName -ne $env:OCTO_VERIFY_PRODUCT -or $v.FileDescription -ne $env:OCTO_VERIFY_PRODUCT) { throw "Executable still has incorrect Windows product metadata" }',
  ], { env: { ...process.env, OCTO_VERIFY_EXE: exe, OCTO_VERIFY_PRODUCT: name }, stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error(`Windows branding verification failed for ${exe}`);
}
