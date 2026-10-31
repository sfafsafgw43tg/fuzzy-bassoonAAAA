import { describe, expect, it } from 'vitest';
import { isSafeNavigationUrl } from '../src/hardening';

describe('Electron navigation hardening', () => {
  it('allows ordinary web navigation only in browser tab contents', () => {
    expect(isSafeNavigationUrl('https://example.test/path', true)).toBe(true);
    expect(isSafeNavigationUrl('http://localhost:3000', true)).toBe(true);
    expect(isSafeNavigationUrl('about:blank', true)).toBe(true);
  });

  it('rejects script, local-file, and non-web schemes in browser tabs', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'file:///C:/Windows/System32/cmd.exe',
      'chrome-devtools://devtools/bundled/inspector.html',
    ]) {
      expect(isSafeNavigationUrl(url, true), url).toBe(false);
    }
  });

  it('keeps UI navigation restricted to local file pages', () => {
    expect(isSafeNavigationUrl('file:///app/launcher.html', false)).toBe(true);
    expect(isSafeNavigationUrl('https://example.test', false)).toBe(false);
    expect(isSafeNavigationUrl('javascript:alert(1)', false)).toBe(false);
    expect(isSafeNavigationUrl('not a url', false)).toBe(false);
  });
});
