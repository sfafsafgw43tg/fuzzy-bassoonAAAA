import { describe, expect, it } from 'vitest';
import { launchWindowsSandbox, windowsSandboxAvailable } from '../src/winutil';

describe('Windows Sandbox launch guard', () => {
  it('reports feature availability without starting a VM', () => {
    expect(typeof windowsSandboxAvailable()).toBe('boolean');
  });

  it('fails closed when the generated WSB file is missing', () => {
    // This validates the same guard used immediately before spawn. It must not
    // start Windows Sandbox or touch a user profile during automated tests.
    expect(launchWindowsSandbox('C:\\path-that-does-not-exist\\octo-test.wsb')).toBe(false);
  });
});
