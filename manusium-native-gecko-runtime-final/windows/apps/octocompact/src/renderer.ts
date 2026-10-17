import type { CompactState } from './model';
declare global { interface Window { compact: { command(action: string, value?: unknown): Promise<void>; onState(listener: (state: CompactState) => void): void } } }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const command = (action: string, value?: unknown) => { void window.compact.command(action, value).catch(() => { $('notice').textContent = 'Browser command failed. Try again.'; }); };
let state: CompactState | undefined;
function button(label: string, click: () => void, className = ''): HTMLButtonElement {
  const el = document.createElement('button'); el.textContent = label; el.className = className; el.onclick = click; return el;
}
function render(s: CompactState): void {
  state = s;
  document.body.classList.toggle('private', s.private);
  const active = s.tabs.find(t => t.id === s.active);
  const tabs = $('tabs'); const scroll = tabs.scrollLeft; tabs.replaceChildren();
  for (const tab of s.tabs) {
    const row = document.createElement('div'); row.className = 'tab'; row.setAttribute('role', 'tab'); row.setAttribute('aria-selected', String(tab.id === s.active));
    row.append(button(`${tab.loading ? '· ' : ''}${tab.title}`, () => command('select', tab.id), 'select'));
    const close = button('×', () => command('close', tab.id), 'close'); close.setAttribute('aria-label', `Close ${tab.title}`); row.append(close); tabs.append(row);
  }
  tabs.scrollLeft = scroll;
  const address = $<HTMLInputElement>('address');
  if (document.activeElement !== address) address.value = active?.url && active.url !== 'about:blank' ? active.url : '';
  $<HTMLButtonElement>('back').disabled = !s.back; $<HTMLButtonElement>('forward').disabled = !s.forward;
  $('reload').textContent = active?.loading ? '×' : '↻'; $('reload').setAttribute('aria-label', active?.loading ? 'Stop loading' : 'Reload');
  $('security').textContent = active?.url.startsWith('https:') ? 'https' : active?.url.startsWith('http:') ? 'http' : '○';
  $('security').title = active?.url.startsWith('https:') ? 'Encrypted connection — not an endorsement of this site' : 'HTTP pages are not encrypted';
  $('bookmark').textContent = s.bookmarks.some(b => b.url === active?.url) ? '★' : '☆';
  $<HTMLButtonElement>('bookmark').disabled = s.private || !/^https?:/.test(active?.url || '');
  $('menu').setAttribute('aria-expanded', String(s.panel)); $('panel').hidden = !s.panel;
  $('home-page').hidden = s.panel || (!!active?.url && active.url !== 'about:blank');
  const privacy = s.private ? 'Private · session kept in memory; downloads remain on disk. ' : '';
  $('notice').textContent = privacy + (active?.error || s.message || 'Octo Compact · one engine, less baggage');
  $('description').textContent = s.private ? 'A separate, temporary session. Sites and your network can still identify you. Bookmarks are read-only here.' : 'Your tabs, your bookmarks, and a quiet place to browse.';
  $('shortcuts').replaceChildren(); $('bookmarks').replaceChildren(); $('empty').hidden = s.bookmarks.length > 0;
  for (const [i, bookmark] of s.bookmarks.entries()) {
    const row = document.createElement('div'); row.append(button(bookmark.title || bookmark.url, () => command('navigate', bookmark.url), 'link'));
    if (!s.private) { const remove = button('Remove', () => command('removeBookmark', bookmark.url)); remove.setAttribute('aria-label', `Remove ${bookmark.title}`); row.append(remove); }
    $('bookmarks').append(row);
    if (i < 8) {
      const tile = button('', () => command('navigate', bookmark.url), 'shortcut'); const title = document.createElement('strong'); title.textContent = bookmark.title || 'Bookmark';
      const domain = document.createElement('span'); domain.textContent = new URL(bookmark.url).hostname; tile.append(title, domain); $('shortcuts').append(tile);
    }
  }
}
for (const action of ['new', 'back', 'forward', 'home', 'bookmark', 'private', 'clear', 'updates']) $(action).onclick = () => command(action);
$('reload').onclick = () => command(state?.tabs.find(t => t.id === state?.active)?.loading ? 'stop' : 'reload');
$('menu').onclick = () => command('panel', !state?.panel); $('dismiss').onclick = () => command('panel', false);
$('navigate').onsubmit = event => { event.preventDefault(); const input = $<HTMLInputElement>('address'); command('navigate', input.value); input.blur(); };
$('address').addEventListener('focus', () => $<HTMLInputElement>('address').select());
window.addEventListener('compact-focus', () => $<HTMLInputElement>('address').focus());
document.addEventListener('keydown', event => { if (event.key === 'Escape') command('panel', false); });
new ResizeObserver(() => { const height = Math.ceil($('chrome').getBoundingClientRect().height); document.documentElement.style.setProperty('--top', `${height}px`); command('height', height); }).observe($('chrome'));
window.compact.onState(render); command('ready');
