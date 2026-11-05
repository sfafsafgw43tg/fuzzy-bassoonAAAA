import { describe, expect, it } from 'vitest';
import { unzipSingleFile, zipSingleFile } from '../src/portable-zip';

describe('portable profile ZIP', () => {
  it('round-trips the encrypted payload in a standard ZIP container', () => {
    const payload = Buffer.from('encrypted-octo-bundle');
    const zip = zipSingleFile('octo-profile-bundle.octobackup', payload);
    expect(zip.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(unzipSingleFile(zip, 'octo-profile-bundle.octobackup')).toEqual(payload);
  });

  it('rejects the wrong entry name and corrupt payload', () => {
    const zip = zipSingleFile('octo-profile-bundle.octobackup', Buffer.from('payload'));
    expect(() => unzipSingleFile(zip, 'other.octobackup')).toThrow(/entry/i);
    const corrupt = Buffer.from(zip);
    corrupt[corrupt.length - 23] ^= 0xff;
    expect(() => unzipSingleFile(corrupt, 'octo-profile-bundle.octobackup')).toThrow();
  });
});
