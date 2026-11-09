import { describe, expect, it } from 'vitest';
import { buildWsbConfig, defaultProfile, describeIsolation, quoteWinArg, SANDBOX_APP_DIR, SANDBOX_DATA_DIR, SANDBOX_DOWNLOADS_DIR } from '../src';

describe('Windows Sandbox configuration', () => {
  it('quotes executable and arguments using Windows command-line rules', () => {
    expect(quoteWinArg('Octo.su.exe')).toBe('Octo.su.exe');
    expect(quoteWinArg('C:\\Program Files\\Octo\\Octo.su.exe')).toBe('"C:\\Program Files\\Octo\\Octo.su.exe"');
    expect(quoteWinArg('a"b')).toBe('"a\\"b"');
  });

  it('generates a disposable, no-vGPU WSB configuration with safe XML escaping', () => {
    const config = buildWsbConfig({
      appHostDir: 'E:\\Octo & QA',
      exeName: 'Octo.su.exe',
      downloadsHostDir: 'E:\\Downloads',
      networking: true,
      clipboard: false,
      audioInput: false,
      videoInput: true,
      args: [`--ephemeral-data-dir=${SANDBOX_DATA_DIR}`, '--profile-name=QA "Sandbox"'],
      memoryMB: 1024,
    });

    expect(config).toContain('<vGPU>Disable</vGPU>');
    expect(config).toContain('<Networking>Enable</Networking>');
    expect(config).toContain('<AudioInput>Disable</AudioInput>');
    expect(config).toContain('<VideoInput>Enable</VideoInput>');
    expect(config).toContain('<ClipboardRedirection>Disable</ClipboardRedirection>');
    expect(config).toContain('<MemoryInMB>2048</MemoryInMB>');
    expect(config).toContain('<HostFolder>E:\\Octo &amp; QA</HostFolder>');
    expect(config).toContain(`<SandboxFolder>${SANDBOX_APP_DIR}</SandboxFolder>`);
    expect(config).toContain(`<SandboxFolder>${SANDBOX_DOWNLOADS_DIR}</SandboxFolder>`);
    expect(config).toContain('--profile-name=QA \\&quot;Sandbox\\&quot;');
    expect(config).toContain('<ReadOnly>false</ReadOnly>');
  });

  it('describes Windows Sandbox as disposable and reports the proxy route', () => {
    const profile = defaultProfile('custom', 'Sandbox QA');
    profile.sandbox.mode = 'windows-sandbox';
    profile.sandbox.shareDownloads = true;
    profile.network.mode = 'proxy';
    profile.network.proxyRules = 'http=127.0.0.1:8080';
    const items = describeIsolation(profile, {
      downloadsDir: 'C:\\Users\\QA\\Downloads',
      windowsSandboxAvailable: true,
      vpnDetected: false,
    });
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ labelKey: 'iso.mode', value: 't:iso.mode.windows-sandbox' }),
      expect.objectContaining({ labelKey: 'iso.folders', value: 'C:\\Users\\QA\\Downloads' }),
      expect.objectContaining({ labelKey: 'iso.route', value: 't:iso.route.proxy' }),
      expect.objectContaining({ labelKey: 'iso.status', value: 't:sandbox.testVersion' }),
    ]));
  });
});
