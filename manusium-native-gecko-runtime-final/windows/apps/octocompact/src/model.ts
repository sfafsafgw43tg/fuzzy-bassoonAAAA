export interface Bookmark { title: string; url: string }
export interface TabState { id: number; title: string; url: string; loading: boolean; error: string }
export interface CompactState {
  tabs: TabState[]; active: number; private: boolean; bookmarks: Bookmark[];
  back: boolean; forward: boolean; panel: boolean; message: string;
}
export const RELEASES = 'https://github.com/sfafsafgw43tg/fuzzy-bassoonAAAA/releases';
export const MAX_BOOKMARKS = 500;
export function webURL(value: string): boolean {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}
export function destination(input: string): string {
  const value = input.trim().slice(0, 4096);
  if (!value || value === 'about:blank') return 'about:blank';
  if (webURL(value)) return new URL(value).href;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^(localhost|[\w.-]+\.\w+):\d+(\/|$)/i.test(value)) throw new Error('Only HTTP and HTTPS pages can be opened.');
  if (!/\s/.test(value) && /^(localhost(?::\d+)?|[\w.-]+\.[a-z\d-]+(?::\d+)?)(\/|$)/i.test(value)) return new URL(`https://${value}`).href;
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}
export function cleanBookmarks(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((b): b is Bookmark => !!b && typeof b.url === 'string' && b.url.length <= 4096 && webURL(b.url) && typeof b.title === 'string')
    .filter(b => !seen.has(b.url) && !!seen.add(b.url)).slice(0, MAX_BOOKMARKS)
    .map(b => ({ title: b.title.slice(0, 160), url: b.url }));
}
export function sessionPartition(privateWindow: boolean, id: string): string {
  return privateWindow ? `compact-private-${id}` : 'persist:compact';
}

/** Strict asset allowlist for the trusted chrome's local scheme. */
export function chromeAsset(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'octo-compact:' || url.host !== 'app' || url.username || url.password) return null;
    return ({ '/index.html': 'index.html', '/style.css': 'style.css', '/renderer.js': 'renderer.js' } as Record<string, string>)[url.pathname] ?? null;
  } catch { return null; }
}
