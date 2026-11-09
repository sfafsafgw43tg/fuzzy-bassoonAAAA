import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
const root = path.resolve(__dirname, '..');

test('camera manager keeps manual dual mapping, respects Off, and releases late capture', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octo-camera-ui-'));
  const uiErrors: string[] = [];
  const result = await build({ entryPoints: [path.join(root, 'e2e/camera-fixture/renderer.ts')], bundle: true, write: false, platform: 'browser', format: 'iife', tsconfig: path.join(root, 'tsconfig.json') });
  fs.writeFileSync(path.join(dir, 'renderer.js'), result.outputFiles[0].text);
  fs.copyFileSync(path.join(root, 'apps/octobrowser/src/renderer/launcher.css'), path.join(dir, 'launcher.css'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'"><link rel="stylesheet" href="launcher.css"><body><script src="renderer.js"></script></body>');
  fs.writeFileSync(path.join(dir, 'preload.cjs'), `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('octo', { invoke: (name) => ipcRenderer.invoke(name), on: () => () => {} });`);
  fs.writeFileSync(path.join(dir, 'main.cjs'), `const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); app.enableSandbox(); app.setPath('userData',path.join(__dirname,'data')); let listed=false;
    ipcMain.handle('fixture:list',()=>{listed=true;}); ipcMain.handle('mgr:android-camera-choices',()=>({emulatorAvailable:true,hostCameraCount:3,problem:listed?'':'none',webcams:listed?[{name:'webcam0',device:'Test camera',virtual:false}]:[]}));
    app.whenReady().then(()=>{const win=new BrowserWindow({width:900,height:700,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,preload:path.join(__dirname,'preload.cjs')}});win.loadFile(path.join(__dirname,'index.html'));}); app.on('window-all-closed',()=>app.quit());`);
  const app = await electron.launch({ args: [path.join(dir, 'main.cjs')], timeout: 60000 });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => uiErrors.push(error.message));
    const harness = (expression: string) => page.evaluate(expression);
    await expect(page.getByText('The Android Emulator did not list a webcam.', { exact: false })).toBeVisible();
    const checkbox = page.getByRole('checkbox');
    await expect(checkbox).not.toBeChecked();
    expect(await harness('window.cameraHarness.stats()')).toEqual({ acquisitions: 0, stops: 0 });
    await page.getByRole('button', { name: 'Use webcam0 for front and back' }).click();
    expect(await harness('window.cameraHarness.value()')).toMatchObject({ front: 'webcam', back: 'webcam', frontDevice: 'webcam0', backDevice: 'webcam0' });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await harness('window.cameraHarness.refresh()');
    expect(await harness('window.cameraHarness.value()')).toMatchObject({ frontDevice: 'webcam0', backDevice: 'webcam0' });
    expect(await harness('window.cameraHarness.stats()')).toEqual({ acquisitions: 0, stops: 0 });
    await page.getByRole('button', { name: 'Turn both Android cameras off' }).click();
    await harness('window.cameraHarness.refresh()');
    expect(await harness('window.cameraHarness.value()')).toMatchObject({ front: 'none', back: 'none', frontDevice: '', backDevice: '' });
    await harness('window.cameraHarness.listed()');
    await checkbox.check();
    await expect.poll(async () => (await harness('window.cameraHarness.stats()') as { acquisitions: number }).acquisitions).toBe(1);
    await harness('window.cameraHarness.queue()');
    // Off and immediately on must not resurrect a previously queued capture.
    await page.evaluate(() => { const toggle = document.querySelector('input[type=checkbox]') as HTMLInputElement; toggle.click(); toggle.click(); });
    await expect.poll(() => harness('window.cameraHarness.queuedComplete()'), { timeout: 2000 }).toBe(true);
    expect((await harness('window.cameraHarness.stats()') as { acquisitions: number }).acquisitions).toBe(1);
    await checkbox.uncheck();
    await harness('window.cameraHarness.deliver()');
    await expect.poll(async () => (await harness('window.cameraHarness.stats()') as { stops: number }).stops).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Use webcam0 for front and back' }).click();
    await checkbox.check();
    await expect.poll(async () => (await harness('window.cameraHarness.stats()') as { acquisitions: number }).acquisitions).toBe(2);
    const before = (await harness('window.cameraHarness.stats()') as { stops: number }).stops;
    await harness('window.cameraHarness.remove()');
    await harness('window.cameraHarness.deliver()');
    await expect.poll(async () => (await harness('window.cameraHarness.stats()') as { stops: number }).stops).toBeGreaterThan(before);
    expect(uiErrors).toEqual([]);
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
