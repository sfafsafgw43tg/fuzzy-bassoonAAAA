import { describe, expect, it } from 'vitest';
import { cleanBookmarks, destination, sessionPartition, webURL, chromeAsset } from '../src/model';
import { SAFE_WEB_PREFERENCES } from '@octo/shell/security-policy';
describe('compact browser policy', () => {
  it('searches text and upgrades typed domains to HTTPS', () => {
    expect(destination(' example.org/path ')).toBe('https://example.org/path');
    expect(destination('two words')).toBe('https://duckduckgo.com/?q=two%20words');
    expect(destination('')).toBe('about:blank');
    expect(destination('http://127.0.0.1:1234/')).toBe('http://127.0.0.1:1234/');
  });
  it.each(['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,hello', 'vbscript:msgbox(1)', 'chrome://settings', 'mailto:a@example.org'])('blocks privileged navigation %s', input => {
    expect(() => destination(input)).toThrow(); expect(webURL(input)).toBe(false);
  });
  it('sanitizes and bounds bookmarks without trusting saved objects', () => {
    const bookmarks = cleanBookmarks([{ title: '<img onerror=alert(1)>', url: 'https://example.org/' }, { title: 'Duplicate', url: 'https://example.org/' }, { title: 'Unsafe', url: 'javascript:alert(1)' }, null]);
    expect(bookmarks).toEqual([{ title: '<img onerror=alert(1)>', url: 'https://example.org/' }]);
    expect(cleanBookmarks(Array.from({ length: 800 }, (_, i) => ({ title: 'x', url: `https://example.org/${i}` })))).toHaveLength(500);
  });
  it('never gives private sessions a disk-persistent partition', () => {
    expect(sessionPartition(true, 'one')).toBe('compact-private-one');
    expect(sessionPartition(true, 'two')).not.toBe(sessionPartition(true, 'one'));
    expect(sessionPartition(false, 'anything')).toBe('persist:compact');
    expect(SAFE_WEB_PREFERENCES.sandbox).toBe(true);
    expect(SAFE_WEB_PREFERENCES.nodeIntegration).toBe(false);
    expect(SAFE_WEB_PREFERENCES.contextIsolation).toBe(true);
  });
});


describe('trusted chrome asset boundary', () => {
  it('serves only allowlisted assets on the trusted host and scheme', () => {
    expect(chromeAsset('octo-compact://app/index.html')).toBe('index.html');
    expect(chromeAsset('octo-compact://app/renderer.js')).toBe('renderer.js');
    for (const url of ['https://app/index.html', 'octo-compact://other/index.html', 'octo-compact://app/main.js', 'octo-compact://app/../../secret.json', 'octo-compact://app/%2f..%2fmain.js', 'octo-compact://user@app/index.html']) expect(chromeAsset(url)).toBeNull();
  });
});
