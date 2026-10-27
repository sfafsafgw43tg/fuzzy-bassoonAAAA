import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { serviceWorkerFingerprintPreload } from '../src/preload/service-worker';

describe('service-worker fingerprint observation surface', () => {
  const originalWorkerNavigator = (globalThis as Record<string, unknown>).WorkerNavigator;

  beforeEach(() => {
    class MockWorkerNavigator {}
    Object.defineProperties(MockWorkerNavigator.prototype, {
      userAgent: { configurable: true, enumerable: true, get: () => 'native' },
      platform: { configurable: true, enumerable: true, get: () => 'native' },
      languages: { configurable: true, enumerable: true, get: () => ['en-US'] },
      language: { configurable: true, enumerable: true, get: () => 'en-US' },
      hardwareConcurrency: { configurable: true, enumerable: true, get: () => 4 },
      deviceMemory: { configurable: true, enumerable: true, get: () => 4 },
      userAgentData: { configurable: true, enumerable: true, get: () => undefined },
    });
    (globalThis as Record<string, unknown>).WorkerNavigator = MockWorkerNavigator;
  });

  afterEach(() => {
    if (originalWorkerNavigator === undefined) delete (globalThis as Record<string, unknown>).WorkerNavigator;
    else (globalThis as Record<string, unknown>).WorkerNavigator = originalWorkerNavigator;
  });

  it('exposes matching low- and high-entropy UA-CH values', async () => {
    serviceWorkerFingerprintPreload({
      userAgent: 'Mozilla/5.0 Chrome/150.0.0.0',
      platform: 'Win32',
      languages: ['pl-PL', 'pl'],
      uaPlatform: 'Windows',
      uaPlatformVersion: '15.0.0',
      uaArchitecture: 'x86',
      uaBitness: '64',
      uaModel: '',
      uaBrands: [{ brand: 'Chromium', version: '150' }],
      uaFullVersionList: [{ brand: 'Chromium', version: '150.0.0.0' }],
      cores: 8,
      memory: 8,
      webgl: 'real',
      vendor: 'Google Inc. (NVIDIA)',
      renderer: 'ANGLE (NVIDIA)',
      seed: 7,
    });

    const proto = (globalThis as Record<string, unknown>).WorkerNavigator as { prototype: Record<string, unknown> };
    const data = (Object.getOwnPropertyDescriptor(proto.prototype, 'userAgentData')?.get as () => Record<string, unknown>)();
    expect(data.platform).toBe('Windows');
    expect(data.mobile).toBe(false);
    expect(data.brands).toEqual([{ brand: 'Chromium', version: '150' }]);
    await expect((data.getHighEntropyValues as (hints: string[]) => Promise<Record<string, unknown>>)(['architecture', 'bitness', 'platformVersion', 'fullVersionList']))
      .resolves.toMatchObject({ architecture: 'x86', bitness: '64', platformVersion: '15.0.0', fullVersionList: [{ brand: 'Chromium', version: '150.0.0.0' }] });
  });
});
