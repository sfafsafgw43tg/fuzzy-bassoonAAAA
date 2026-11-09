import { describe, expect, it } from 'vitest';
import { BROWSER_INTEGRATIONS, browserIntegration, isBrowserIntegrationId } from '../src/browser-integrations';

describe('browser integration catalog', () => {
  it('classifies browsers separately from extensions, audit tools, and libraries', () => {
    expect(browserIntegration('brave-browser')?.classification).toBe('browser');
    expect(browserIntegration('chameleon-extension')?.classification).toBe('extension');
    expect(browserIntegration('creepjs')?.classification).toBe('audit-tool');
    expect(browserIntegration('browserforge')?.classification).toBe('automation-library');
  });

  it('does not advertise launch for non-browser entries or unverified Camoufox', () => {
    for (const entry of BROWSER_INTEGRATIONS.filter((item) => item.classification !== 'browser' || item.id === 'camoufox')) {
      expect(entry.capabilities.launch).toBe(false);
    }
  });

  it('narrows only known catalog identifiers', () => {
    expect(isBrowserIntegrationId('librewolf')).toBe(true);
    expect(isBrowserIntegrationId('electron')).toBe(false);
    expect(isBrowserIntegrationId('../brave.exe')).toBe(false);
    expect(browserIntegration(undefined)).toBeUndefined();
  });
});
