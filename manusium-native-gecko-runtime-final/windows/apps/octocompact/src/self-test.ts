/** Fixed, local-only installed-binary acceptance tests. No debugging port or fuse bypass. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { app } from 'electron';
import type { CompactWindow } from './main';
async function until(test: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
export async function selfTest(Browser: typeof CompactWindow, output: string): Promise<void> {
  const assertions: string[] = [];
  const check = (condition: unknown, label: string) => { assert(condition, label); assertions.push(label); };
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><title>${request.url === '/two' ? 'Second page' : 'First page'}</title><h1>Real Chromium test</h1><input id="entry"><a href="/two">Next</a>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const normal = new Browser();
  try {
    await until(() => !normal.win.webContents.isLoading() && normal.win.webContents.getURL().endsWith('/index.html'), 'trusted UI load');
    await until(async () => await normal.win.webContents.executeJavaScript('Boolean(window.compact)'), 'preload ready');
    if (app.commandLine.hasSwitch('compact-test-restart')) {
      check(normal.state().bookmarks.some(b => b.title === 'First page'), 'bookmarks survive process restart');
      check((await normal.ses.cookies.get({ url: base, name: 'normal-check' })).length === 1, 'normal cookie survives restart');
      check(!fs.existsSync(path.join(app.getPath('userData'), 'Partitions', 'compact-private')), 'no private partition directory');
    } else {
      await normal.win.webContents.executeJavaScript(`document.getElementById('address').value=${JSON.stringify(base + '/one')};document.getElementById('navigate').requestSubmit();`);
      await until(() => normal.state().tabs.find(t => t.id === normal.active)?.title === 'First page', 'address form navigates');
      check(normal.state().tabs.length === 1, 'one real initial tab');
      const page = normal.tabs.get(normal.active)!.webContents;
      check(await page.executeJavaScript('typeof process === "undefined" && typeof require === "undefined" && typeof window.compact === "undefined"'), 'web content has no Node or privileged IPC bridge');
      await page.executeJavaScript('document.querySelector("#entry").value="typed"');
      check(await page.executeJavaScript('document.querySelector("#entry").value === "typed"'), 'web page JavaScript works');
      await normal.win.webContents.executeJavaScript('document.getElementById("bookmark").click()');
      await until(() => normal.state().bookmarks.some(b => b.url === base + '/one'), 'bookmark saved through UI');
      check(fs.existsSync(path.join(app.getPath('userData'), 'bookmarks.json')), 'bookmark persisted');
      await normal.ses.cookies.set({ url: base, name: 'normal-check', value: 'yes', expirationDate: Date.now() / 1000 + 3600 });
      const first = normal.active;
      const second = normal.addTab(base + '/two');
      await until(() => normal.state().tabs.find(t => t.id === second)?.title === 'Second page', 'second tab loads');
      check(normal.tabs.size === 2, 'tab creation');
      await normal.command('select', first);
      check(normal.active === first, 'tab selection');
      normal.navigate(base + '/two');
      await until(() => normal.tabs.get(first)?.webContents.getTitle() === 'Second page', 'same-tab navigation');
      await normal.command('back');
      await until(() => normal.tabs.get(first)?.webContents.getTitle() === 'First page', 'back navigation');
      await normal.command('close', second);
      check(normal.tabs.size === 1, 'tab close');
      await assert.rejects(() => normal.command('navigate', 'file:///C:/Windows/win.ini'));
      check(true, 'privileged address rejected');
      const priv = new Browser(true);
      await until(() => !priv.win.webContents.isLoading(), 'private window');
      check(priv.ses.storagePath === null, 'private storage is memory-only');
      check((await priv.ses.cookies.get({ url: base })).length === 0, 'private cookies isolated from normal');
      priv.navigate(base + '/one');
      await until(() => priv.state().tabs.some(t => t.title === 'First page'), 'private tab loads');
      await priv.ses.cookies.set({ url: base, name: 'private-check', value: 'only-here' });
      check((await normal.ses.cookies.get({ name: 'private-check' })).length === 0, 'private cookie does not leak to normal');
      const before = JSON.stringify(normal.state().bookmarks);
      await priv.command('bookmark');
      check(JSON.stringify(normal.state().bookmarks) === before, 'private browsing cannot persist bookmarks');
      priv.win.close();
      const nextPrivate = new Browser(true);
      check((await nextPrivate.ses.cookies.get({ name: 'private-check' })).length === 0, 'next private window starts empty');
      nextPrivate.win.close();
      normal.win.setContentSize(390, 700);
      await until(async () => await normal.win.webContents.executeJavaScript('document.querySelector("nav").getBoundingClientRect().height > 90'), 'narrow touch layout');
      check(await normal.win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), 'no horizontal overflow at 390px');
      await normal.command('panel', true);
      check(!normal.tabs.get(normal.active)!.getVisible(), 'options do not sit behind web content');
      const screenshot = await normal.win.webContents.capturePage();
      fs.writeFileSync(output.replace(/\.json$/, '.png'), screenshot.toPNG());
      await normal.ses.cookies.flushStore();
    }
    fs.writeFileSync(output, JSON.stringify({ ok: true, assertions, electron: process.versions.electron, chromium: process.versions.chrome, platform: process.platform, arch: process.arch }, null, 2));
  } finally {
    normal.win.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
