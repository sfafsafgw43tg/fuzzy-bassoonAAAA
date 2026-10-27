import { describe, expect, it } from 'vitest';
import { auditFingerprintContexts } from '../src/main/context-audit';

describe('cross-context fingerprint audit', () => {
  it('reports matching values without modifying observations', () => {
    const rows = auditFingerprintContexts([
      { context: 'window', userAgent: 'UA', platform: 'Win32', languages: ['pl-PL', 'pl'], hardwareConcurrency: 8 },
      { context: 'dedicated-worker', userAgent: 'UA', platform: 'Win32', languages: ['pl-PL', 'pl'], hardwareConcurrency: 8 },
    ]);
    expect(rows.find((row) => row.field === 'userAgent')).toMatchObject({ status: 'match', reference: 'UA' });
    expect(rows.find((row) => row.field === 'languages')).toMatchObject({ status: 'match', reference: 'pl-PL|pl' });
    expect(rows.find((row) => row.field === 'hardwareConcurrency')).toMatchObject({ status: 'match', reference: '8' });
  });

  it('reports mismatches rather than normalizing them away', () => {
    const rows = auditFingerprintContexts([
      { context: 'window', platform: 'Win32', webglRenderer: 'GPU A' },
      { context: 'service-worker', platform: 'Win32', webglRenderer: 'GPU B' },
    ]);
    expect(rows.find((row) => row.field === 'webglRenderer')).toMatchObject({ status: 'mismatch', reference: 'GPU A' });
  });

  it('distinguishes unavailable context fields from mismatches', () => {
    const rows = auditFingerprintContexts([
      { context: 'window', userAgent: 'UA' },
      { context: 'service-worker' },
    ]);
    expect(rows.find((row) => row.field === 'userAgent')).toMatchObject({ status: 'unavailable', reference: 'UA' });
    expect(rows.find((row) => row.field === 'platform')?.status).toBe('unavailable');
  });
});
