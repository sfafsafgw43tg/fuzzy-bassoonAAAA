import { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, Menu, shell, protocol } from 'electron';
import type { Session, WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SAFE_WEB_PREFERENCES } from '@octo/shell/security-policy';
import { destination, webURL, cleanBookmarks, sessionPartition, RELEASES, MAX_BOOKMARKS, chromeAsset } from './model';
import type { Bookmark, CompactState } from './model';

app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'octo-compact', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Octo Compact');
app.setAppUserModelId('su.octo.compact');
// Separate from the multi-engine suite; no migration or duplicate profile copy.
const testOutput = app.commandLine.getSwitchValue('compact-self-test');
const testData = app.commandLine.getSwitchValue('compact-test-data');
if (testOutput && (!path.isAbsolute(testOutput) || !path.isAbsolute(testData))) throw new Error('Self-test needs absolute output and isolated data paths');
app.setPath('userData', testOutput ? testData : path.join(app.getPath('appData'), 'OctoCompact'));
app.setPath('sessionData', app.getPath('userData'));
app.commandLine.appendSwitch('disk-cache-size', '67108864');
const windows = new Map<number, CompactWindow>();
const configured = new WeakSet<Session>();
const uiURL = 'octo-compact://app/index.html';
const bookmarksFile = () => path.join(app.getPath('userData'), 'bookmarks.json');
function readBookmarks(): Bookmark[] {
  try { const file = bookmarksFile(); if (fs.statSync(file).size > 3_000_000) return []; return cleanBookmarks(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return []; }
}
function saveBookmarks(bookmarks: Bookmark[]): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const temp = `${bookmarksFile()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(cleanBookmarks(bookmarks)));
  fs.renameSync(temp, bookmarksFile());
}
function owner(contents: WebContents): CompactWindow | undefined {
  return [...windows.values()].find(w => [...w.tabs.values()].some(t => t.webContents === contents));
}
function setupSession(ses: Session): void {
  if (configured.has(ses)) return;
  configured.add(ses);
  const grants = new Set<string>();
  ses.setPermissionCheckHandler((_wc, permission, origin) => grants.has(`${origin}:${permission}`));
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    let origin: string;
    let currentOrigin: string;
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; currentOrigin = new URL(wc.getURL()).origin; } catch { callback(false); return; }
    if (!['media', 'geolocation', 'notifications', 'fullscreen', 'clipboard-sanitized-write'].includes(permission) || !webURL(origin) || origin !== currentOrigin) { callback(false); return; }
    const parent = owner(wc);
    if (!parent) { callback(false); return; }
    void dialog.showMessageBox(parent.win, { type: 'question', title: 'Site permission', message: `${origin} requests ${permission}.`, buttons: ['Block', 'Allow this session'], defaultId: 0, cancelId: 0 }).then(({ response }) => {
      if (response === 1) grants.add(`${origin}:${permission}`);
      callback(response === 1);
    }).catch(() => callback(false));
  });
  ses.on('will-download', (_event, item, contents) => {
    const parent = owner(contents);
    item.setSaveDialogOptions({ title: 'Save download — files remain after private browsing', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
    item.once('done', (_e, state) => {
      if (parent && !parent.win.isDestroyed()) { parent.message = `Download ${state}: ${item.getFilename()}`; parent.send(); }
    });
  });
}

export class CompactWindow {
  readonly win: BrowserWindow;
  readonly ses: Session;
  readonly tabs = new Map<number, WebContentsView>();
  readonly errors = new Map<number, string>();
  active = 0;
  top = 112;
  panel = false;
  message = '';
  constructor(readonly privateWindow = false) {
    this.ses = session.fromPartition(sessionPartition(privateWindow, crypto.randomUUID()), { cache: !privateWindow });
    setupSession(this.ses);
    this.win = new BrowserWindow({ width: 1080, height: 760, minWidth: 360, minHeight: 480, title: privateWindow ? 'Octo Compact — Private' : 'Octo Compact', backgroundColor: '#f5f7f6', autoHideMenuBar: true,
      icon: path.join(__dirname, 'icon.ico'), webPreferences: { ...SAFE_WEB_PREFERENCES, preload: path.join(__dirname, 'preload.js') } });
    const windowId = this.win.webContents.id;
    windows.set(windowId, this);
    this.win.webContents.on('will-navigate', e => e.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.win.webContents.on('will-attach-webview', e => e.preventDefault());
    this.win.webContents.on('did-finish-load', () => this.send());
    this.shortcuts(this.win.webContents);
    this.win.on('resize', () => this.layout());
    this.win.on('closed', () => {
      windows.delete(windowId);
      for (const view of this.tabs.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
      this.tabs.clear();
      if (privateWindow) void Promise.all([this.ses.clearStorageData(), this.ses.clearCache()]).catch(() => undefined);
    });
    void this.win.loadURL(uiURL).catch(error => { this.message = `Browser UI could not load: ${error.message}`; });
    this.addTab();
  }
  shortcuts(wc: WebContents): void {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      if (input.control || input.meta) {
        const action = key === 'l' ? 'address' : key === 't' ? 'new' : key === 'w' ? 'close' : key === 'r' ? 'reload' : key === 'd' ? 'bookmark' : key === 'n' && input.shift ? 'private' : '';
        if (action) { event.preventDefault(); if (action === 'address') { this.win.webContents.focus(); this.win.webContents.send('compact:focus'); } else void this.command(action).catch(e => { this.message = String(e); this.send(); }); }
      } else if (input.alt && ['arrowleft', 'arrowright'].includes(key)) { event.preventDefault(); void this.command(key === 'arrowleft' ? 'back' : 'forward'); }
    });
  }
  addTab(url = 'about:blank'): number {
    if (this.tabs.size >= 40) { this.message = 'Close a tab before opening another (40-tab limit).'; this.send(); return this.active; }
    const view = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, session: this.ses } });
    const wc = view.webContents;
    this.tabs.set(wc.id, view);
    this.win.contentView.addChildView(view);
    wc.setWindowOpenHandler(({ url: target }) => { if (webURL(target)) this.addTab(target); return { action: 'deny' }; });
    wc.on('will-attach-webview', event => event.preventDefault());
    wc.on('will-navigate', (event, target) => { if (!webURL(target) && target !== 'about:blank') event.preventDefault(); });
    wc.on('will-redirect', (event, target) => { if (!webURL(target)) event.preventDefault(); });
    wc.on('will-frame-navigate', event => { if (!webURL(event.url) && !['about:', 'blob:', 'data:'].some(s => event.url.startsWith(s))) event.preventDefault(); });
    const update = () => { this.layout(); this.send(); };
    wc.on('page-title-updated', update); wc.on('did-start-loading', update); wc.on('did-stop-loading', update); wc.on('did-navigate', update); wc.on('did-navigate-in-page', update);
    wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => { if (mainFrame && code !== -3) { this.errors.set(wc.id, description); this.send(); } });
    wc.on('render-process-gone', (_event, details) => { this.errors.set(wc.id, `Page stopped (${details.reason}). Reload to retry.`); this.send(); });
    wc.on('context-menu', (_event, params) => {
      const menu = Menu.buildFromTemplate([
        ...(webURL(params.linkURL) ? [{ label: 'Open link in new tab', click: () => this.addTab(params.linkURL) }] : []),
        { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ]);
      menu.popup({ window: this.win });
    });
    this.shortcuts(wc);
    this.active = wc.id;
    this.panel = false;
    this.navigate(url);
    return wc.id;
  }
  navigate(input: string): void {
    const wc = this.tabs.get(this.active)?.webContents;
    if (!wc) return;
    const url = destination(input);
    this.errors.delete(wc.id);
    this.panel = false;
    void wc.loadURL(url).catch(error => { if (!wc.isDestroyed()) { this.errors.set(wc.id, String(error.message)); this.send(); } });
    this.layout();
  }
  layout(): void {
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    const top = Math.min(this.top, height - 100);
    for (const [id, view] of this.tabs) {
      view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
      const url = view.webContents.getURL();
      view.setVisible(id === this.active && !this.panel && !!url && url !== 'about:blank');
    }
  }
  state(): CompactState {
    const current = this.tabs.get(this.active)?.webContents;
    return { active: this.active, private: this.privateWindow, panel: this.panel, message: this.message, bookmarks: readBookmarks(),
      back: !!current?.navigationHistory.canGoBack(), forward: !!current?.navigationHistory.canGoForward(),
      tabs: [...this.tabs].map(([id, v]) => ({ id, title: v.webContents.getTitle() || 'New tab', url: v.webContents.getURL(), loading: v.webContents.isLoading(), error: this.errors.get(id) || '' })) };
  }
  send(): void { if (!this.win.isDestroyed()) this.win.webContents.send('compact:state', this.state()); }
  async command(action: string, value?: unknown): Promise<void> {
    const current = this.tabs.get(this.active)?.webContents;
    switch (action) {
      case 'ready': break;
      case 'navigate': if (typeof value !== 'string') throw new Error('Invalid address'); this.navigate(value); break;
      case 'new': this.addTab(); break;
      case 'private': new CompactWindow(true); break;
      case 'select': if (typeof value === 'number' && this.tabs.has(value)) { this.active = value; this.panel = false; } break;
      case 'close': {
        const id = typeof value === 'number' ? value : this.active;
        const tab = this.tabs.get(id); if (!tab) break;
        this.win.contentView.removeChildView(tab); this.tabs.delete(id); this.errors.delete(id); tab.webContents.close();
        if (!this.tabs.size) { this.win.close(); return; }
        if (id === this.active) this.active = [...this.tabs.keys()].at(-1)!;
        break;
      }
      case 'back': if (current?.navigationHistory.canGoBack()) current.navigationHistory.goBack(); break;
      case 'forward': if (current?.navigationHistory.canGoForward()) current.navigationHistory.goForward(); break;
      case 'reload': this.errors.delete(this.active); current?.reload(); break;
      case 'stop': current?.stop(); break;
      case 'home': this.navigate('about:blank'); break;
      case 'panel': this.panel = value === true; break;
      case 'height': if (typeof value === 'number' && Number.isFinite(value)) this.top = Math.round(Math.max(96, Math.min(240, value))); break;
      case 'bookmark': {
        if (this.privateWindow || !current || !webURL(current.getURL())) break;
        const bookmarks = readBookmarks(); const url = current.getURL();
        const existing = bookmarks.find(b => b.url === url);
        saveBookmarks(existing ? bookmarks.filter(b => b.url !== url) : [{ title: current.getTitle() || url, url }, ...bookmarks].slice(0, MAX_BOOKMARKS));
        for (const win of windows.values()) win.send();
        break;
      }
      case 'removeBookmark': if (!this.privateWindow && typeof value === 'string') saveBookmarks(readBookmarks().filter(b => b.url !== value)); break;
      case 'clear': {
        const answer = await dialog.showMessageBox(this.win, { type: 'warning', message: 'Clear cookies, site storage and cache for this session? This signs you out. Bookmarks are kept.', buttons: ['Cancel', 'Clear'], defaultId: 0, cancelId: 0 });
        if (answer.response === 1) { await this.ses.clearStorageData(); await this.ses.clearCache(); this.message = 'Site data and cache cleared. Active sites can store new data.'; }
        break;
      }
      case 'updates': await shell.openExternal(RELEASES); break;
      default: throw new Error('Unknown command');
    }
    this.layout(); this.send();
  }
}

ipcMain.handle('compact:command', async (event, action: unknown, value: unknown) => {
  const win = windows.get(event.sender.id);
  if (!win || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== uiURL || typeof action !== 'string') throw new Error('Untrusted browser command');
  try { await win.command(action, value); } catch (error) { win.message = error instanceof Error ? error.message : 'Command failed'; win.send(); }
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const first = [...windows.values()][0]?.win; if (first) { first.restore(); first.focus(); } });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // The file-privilege fuse remains off. Serve only these trusted assets via
    // a secure local scheme, registered only in the chrome's default session.
    protocol.handle('octo-compact', request => {
      const asset = chromeAsset(request.url);
      if (request.method !== 'GET' || !asset) return new Response('Not found', { status: 404 });
      const mime = asset.endsWith('.html') ? 'text/html' : asset.endsWith('.css') ? 'text/css' : 'text/javascript';
      return new Response(new Uint8Array(fs.readFileSync(path.join(__dirname, asset))), { headers: { 'Content-Type': `${mime}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' } });
    });
    if (process.platform !== 'win32' && app.isPackaged) throw new Error('This compact release targets Windows x64.');
    if (testOutput) {
      const { selfTest } = await import('./self-test');
      try { await selfTest(CompactWindow, testOutput); app.exit(0); }
      catch (error) { fs.writeFileSync(testOutput, JSON.stringify({ ok: false, error: String(error instanceof Error ? error.stack : error) })); app.exit(1); }
    } else new CompactWindow();
  }).catch(error => { dialog.showErrorBox('Octo Compact could not start', String(error)); app.exit(1); });
  app.on('window-all-closed', () => { if (!testOutput) app.quit(); });
}
