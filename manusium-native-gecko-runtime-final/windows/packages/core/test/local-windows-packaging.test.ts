import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const root = path.resolve(__dirname, '../../..');
const packaging = fs.readFileSync(path.join(root, 'tools/package-local-windows.mjs'), 'utf8');
const prebuilt = fs.readFileSync(path.join(root, 'tools/prepare-prebuilt-app.mjs'), 'utf8');
const fetchRuntime = fs.readFileSync(path.join(root, 'tools/fetch-prebuilt-chromium.mjs'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'scripts/lib/octo.ps1'), 'utf8');
const fn = (name: string) => new RegExp(`function ${name}(?:\\([^\\n]*\\))? \\{([\\s\\S]*?)\\r?\\n\\}`).exec(installer)?.[1] ?? '';
describe('branded local Windows setup', () => {
  it('keeps strict packaging separate while setup uses the prebuilt app runtime', () => {
    expect(installer).toContain("package:local:windows");
    expect(installer).toContain("prepare:prebuilt:windows");
    expect(prebuilt).toContain("path.join(outputResources, 'app')");
    expect(prebuilt).toContain('copyTree(electronDist, output)');
    expect(prebuilt).toContain('verifyBundledChromium(sourceEngines)');
    expect(prebuilt).toContain("manifest.distribution !== 'source-built'");
    expect(prebuilt).toContain("manifest.executable !== 'inkbrowser-chrome.exe'");
    expect(prebuilt).toContain("sha256(executable).toLowerCase() !== expected");
    expect(prebuilt).toContain("'native-camera'");
    expect(prebuilt).toContain('maxRetries: 8, retryDelay: 250');
    expect(prebuilt).toContain('Close Octo.su, OctoDetect.su');
    expect(installer).toContain('Invoke-NpmResult @(');
    expect(installer).toContain("HTTP 404|release not found|no release");
    expect(installer).toContain("T 'nativeRuntimeNotPublished'");
    expect(installer).toContain("$env:OCTO_REQUIRE_NATIVE_CHROMIUM = if ($nativeAvailable) { '1' } else { '0' }");
    expect(packaging).toContain("runNode('verify-packaged-chromium.mjs'");
    const buildStep = installer.slice(installer.indexOf("@{ Key = 'stepBuild'"), installer.indexOf("@{ Key = 'stepShortcut'"));
    const stages = ["Invoke-Npm @('run', 'icons')", "Invoke-Npm @('run', 'build')", "Invoke-NpmResult @('run', 'build:native-camera')", "OCTO_REQUIRE_NATIVE_CHROMIUM", "prebuilt-inkbrowser' } else { 'prebuilt-electron"];
    const offsets = stages.map(stage => buildStep.indexOf(stage));
    expect(offsets.every(offset => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(packaging).not.toContain('build-chromium-source');
  });
  it('accepts only complete prebuilt InkBrowser readiness data', () => {
    const ready = fn('Test-Ready');
    expect(ready).toContain('release\\.octo-local-ready.json');
    expect(ready).toContain("receipt.mode -in @('prebuilt-inkbrowser', 'prebuilt-electron')");
    expect(ready).toContain("receipt.mode -eq 'prebuilt-inkbrowser' -and");
    expect(ready).toContain('release\\{0}\\win-unpacked');
    expect(ready).toContain('resources\\app\\package.json');
    expect(ready).toContain('resources\\app\\dist\\main.js');
    expect(ready).toContain("Test-NativeRuntimeReady 'chromium' 'win32-x64'");
  });
  it('detects packaged and development processes before replacing output folders', () => {
    expect(installer).toContain('Get-CimInstance Win32_Process');
    expect(installer).toContain('$app.DevDir');
    expect(installer).toContain('[StringComparison]::OrdinalIgnoreCase');
  });
  it('starts the packaged GUI executable in Windows source installs', () => {
    const open = fn('Invoke-Open');
    expect(open).toContain('$packagedExe = Get-LocalPackagedExe $appId');
    expect(open).toContain('Start-Process -FilePath $packagedExe');
    expect(open.indexOf('Start-Process -FilePath $packagedExe')).toBeLessThan(open.indexOf('$electronExe ='));
  });
  it('does not block open.bat on missing generated native runtimes', () => {
    const open = fn('Invoke-Open');
    expect(open).toContain('(Test-Ready) -and (Test-Path -LiteralPath $packagedExe');
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
    expect(open).toContain('npm must continue to own');
    expect(installer).toContain('function Get-ElectronLauncherExe');
    expect(installer).toContain("return $branded");
    expect(installer).toContain('The launcher is always the branded Electron app shell');
  });
  it('keeps the profile Base choice independent from the Electron launcher', () => {
    const editor = fs.readFileSync(path.join(root, 'apps/octobrowser/src/renderer/launcher-editor.ts'), 'utf8');
    const engine = fs.readFileSync(path.join(root, 'packages/core/src/inkbrowser.ts'), 'utf8');
    const open = fn('Invoke-Open');
    expect(editor).toContain('engine: NEW_PROFILE_ENGINE');
    expect(editor).toContain("d.engine = choice === 'chromium' ? 'inkbrowser' : choice");
    expect(engine).toContain("export const NEW_PROFILE_ENGINE: BrowserEngine = 'electron'");
    expect(open).toContain("$electronExe = Get-ElectronLauncherExe 'octobrowser'");
  });
  it('labels the primary base as Chrome while explaining its InkBrowser Chromium fork', () => {
    const en = fs.readFileSync(path.join(root, 'packages/core/src/i18n/en.ts'), 'utf8');
    expect(en).toContain("'profile.base.chromium': 'Chrome'");
    expect(en).toContain('custom Octo InkBrowser fork based on Chromium');
    expect(en).toContain('source-built Octo InkBrowser Chromium runtime');
  });
  it('bootstraps Chrome Base from a verified source-built release asset before packaging', () => {
    const buildStep = installer.slice(installer.indexOf("@{ Key = 'stepBuild'"), installer.indexOf("@{ Key = 'stepShortcut'"));
    expect(buildStep).toContain("Invoke-NpmResult @('run', 'fetch:chromium:windows')");
    expect(buildStep).toContain("$env:OCTO_REQUIRE_NATIVE_CHROMIUM = if ($nativeAvailable) { '1' } else { '0' }");
    expect(fetchRuntime).toContain('releases/latest/download');
    expect(fetchRuntime).toContain('distribution !== \'source-built\' || manifest.modified !== true');
    expect(fetchRuntime).toContain('runtime archive SHA-256 mismatch');
    expect(fetchRuntime).toContain('runtime executable SHA-256 does not match runtime.json');
  });
});
