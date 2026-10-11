import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const root = path.resolve(__dirname, '../../..');
const packaging = fs.readFileSync(path.join(root, 'tools/package-local-windows.mjs'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'scripts/lib/octo.ps1'), 'utf8');
const fn = (name: string) => new RegExp(`function ${name}(?:\\([^\\n]*\\))? \\{([\\s\\S]*?)\\r?\\n\\}`).exec(installer)?.[1] ?? '';
describe('branded local Windows setup', () => {
  it('keeps strict runtime checks available for release mode and supports the normal installer skip mode', () => {
    const stages = ['skipNativeRuntimeVerify', "fs.rmSync(receipt", "runNode('build.mjs'", 'electron-builder/cli.js', "runNode('verify-windows-branding.mjs'", 'fs.writeFileSync(receipt'];
    const offsets = stages.map(stage => packaging.indexOf(stage));
    expect(offsets.every(offset => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(packaging).not.toContain('build-chromium-source');
  });
  it('does not accept old Javascript build output or an interrupted package as ready', () => {
    const ready = fn('Test-Ready');
    expect(ready).toContain('release\\.octo-local-ready.json');
    expect(ready).toContain('VersionInfo.ProductName');
    expect(ready).toContain('resources\\app.asar');
    expect(ready).toContain("OCTO_SKIP_NATIVE_RUNTIME_VERIFY -eq '1'");
    expect(ready).not.toContain('dist\\main.js');
  });
  it('starts the packaged GUI executable in Windows source installs', () => {
    const open = fn('Invoke-Open');
    expect(open).toContain('$packagedExe = Get-LocalPackagedExe $appId');
    expect(open).toContain('Start-Process -FilePath $packagedExe');
    expect(open.indexOf('Start-Process -FilePath $packagedExe')).toBeLessThan(open.indexOf('$electronExe ='));
  });
  it('does not block open.bat on missing generated native runtimes', () => {
    const open = fn('Invoke-Open');
    expect(open).toContain('if (Test-Ready) {');
    expect(open).toContain("Warn (T 'nativeFallback')");
    expect(open).not.toContain("if (-not (Invoke-Setup) -or -not (Test-Ready)) { Fail (T 'wizardNotReady') }");
    expect(open).toContain("Invoke-Npm @('run', 'build')");
    expect(installer).toContain('nativeFallback');
  });
  it('keeps npm ownership of Electron while launching a disposable branded copy', () => {
    const open = fn('Invoke-Open');
    expect(open).toContain("node_modules\\electron\\dist\\electron.exe");
    expect(open).toContain("node_modules\\electron\\dist\\Octo.su.exe");
    expect(open).toContain('brand-electron-dev.mjs');
    expect(open).toContain("$electronExe = $brandedElectronExe");
    expect(open).toContain('npm must continue to own');
  });
});
