/**
 * Local Electron graphics observation. Run with OCTO_ELECTRON_BINARY pointing
 * at the built Electron executable; ordinary Vitest runs skip this because
 * they do not have an Electron application host.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const electronBinary = process.env.OCTO_ELECTRON_BINARY;
const enabled = !!electronBinary && process.env.OCTO_ELECTRON_INTEGRATION === '1';

type Observation = {
  webgl: boolean;
  webgl2: boolean;
  debugRenderer: boolean;
  gpu: 'missing' | 'adapter' | 'null' | 'error';
  workerWebgl: boolean | null;
};

const child = String.raw`
const { app, BrowserWindow, ipcMain } = require('electron');
const block = process.argv.includes('--block');
ipcMain.on('octo:get-tab-config', (event) => { event.returnValue = undefined; });
if (block) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-webgl');
  app.commandLine.appendSwitch('disable-3d-apis');
  app.commandLine.appendSwitch('disable-features', 'WebGPU');
}
app.whenReady().then(async () => {
  const tabConfig = Buffer.from(JSON.stringify({
    canvas: 'allow', hw: 'allow', hwValues: { hardwareConcurrency: 4, deviceMemory: 8 },
    volume: 1, sinkId: '', cameraLabel: '', microphoneLabel: '',
    fp: {
      enabled: true, platform: 'Win32', brands: [{ brand: 'Chromium', version: '44' }],
      fullVersionList: [{ brand: 'Chromium', version: '44.0.0.0' }], uaFullVersion: '44.0.0.0',
      chPlatform: 'Windows', platformVersion: '10.0.0', architecture: 'x86', bitness: '64',
      languages: ['en-US'], cores: 4, memory: 8,
      screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
      windowSize: { width: 1920, height: 1040 }, deviceScaleFactor: 1,
      webglVendor: 'Test Vendor', webglRenderer: 'Test Renderer', canvas: 'allow',
      webgl: block ? 'off' : 'real', audio: 'real', clientRects: 'real', fonts: 'real',
      webgpu: 'real', webrtcMode: 'real', webrtcIp: '', mediaDevices: null,
      doNotTrack: false, battery: 'real', mobile: false, model: '', formFactor: 'Desktop', seed: 1234,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
  }), 'utf8').toString('base64');
  const win = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false,
    preload: process.env.OCTO_TAB_PRELOAD || undefined,
    additionalArguments: ['--octo-cfg=' + tabConfig],
    webgl: !block,
  }});
  await Promise.race([
    win.loadURL('data:text/html,<canvas id="c"></canvas>'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('loadURL timeout')), 10000)),
  ]);
  const result = await win.webContents.executeJavaScript(${JSON.stringify(`(async () => {
  const c = document.getElementById('c');
  const gl = c.getContext('webgl');
  const gl2 = c.getContext('webgl2');
  let gpu = 'missing';
  if (navigator.gpu) { try { gpu = await navigator.gpu.requestAdapter() ? 'adapter' : 'null'; } catch { gpu = 'error'; } }
  let workerWebgl = null;
  if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function') {
    workerWebgl = await Promise.race([new Promise((resolve) => {
      const src = 'onmessage = () => { const c = new OffscreenCanvas(1,1); postMessage(!!(c.getContext("webgl") || c.getContext("webgl2"))); }';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = (e) => { resolve(e.data); w.terminate(); }; w.postMessage(0);
    }), new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
  }
  return { webgl: !!gl, webgl2: !!gl2, debugRenderer: !!(gl && gl.getExtension('WEBGL_debug_renderer_info')), gpu, workerWebgl };
})()`)})
  console.log(JSON.stringify(result));
  app.exit(0);
}).catch((error) => { console.error(String(error)); app.exit(2); });
`;

function observe(mode: 'native' | 'block'): Promise<Observation> {
  if (!electronBinary) throw new Error('OCTO_ELECTRON_BINARY is required');
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(tmpdir(), `octo-graphics-${process.pid}-${mode}.cjs`);
    writeFileSync(scriptPath, child, 'utf8');
    const args = [scriptPath];
    if (mode === 'block') args.push('--block');
    const p = spawn(electronBinary, args, {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        OCTO_TAB_PRELOAD: path.resolve(__dirname, '..', 'dist', 'preload-tab.js'),
      },
      windowsHide: true,
    });
    let output = '';
    let errorOutput = '';
    p.stdout.on('data', (chunk) => { output += String(chunk); });
    p.stderr.on('data', (chunk) => { errorOutput += String(chunk); });
    p.on('error', reject);
    p.on('close', (code) => {
      try { unlinkSync(scriptPath); } catch { /* best effort */ }
      if (code !== 0) return reject(new Error(`Electron exited ${code}; stdout: ${output}; stderr: ${errorOutput}; command: ${electronBinary} ${args.join(' ')}`));
      try { resolve(JSON.parse(output.trim().split('\n').pop() || '') as Observation); } catch (e) { reject(e); }
    });
  });
}

it('uses the WebGL profile overlay while preserving native WebGPU', () => {
  // Resolved from this file's directory: the TypeScript project targets CJS,
  // where import.meta is not available.
  const source = readFileSync(path.resolve(__dirname, '..', 'src', 'preload', 'page-shim.ts'), 'utf8');
  expect(source).toMatch(/WebGLRenderingContext|WebGL2RenderingContext/);
  expect(source).not.toContain('GPUAdapterInfo');
  expect(source).toContain('Keep native WebGPU untouched when it is enabled');
  expect(source).toContain("p === 0x9245");
});

it('patches worker-created OffscreenCanvas contexts and SharedWorker bootstraps', () => {
  const source = readFileSync(path.resolve(__dirname, '..', 'src', 'preload', 'page-shim.ts'), 'utf8');
  expect(source).toContain('const patchContext = (context: unknown)');
  expect(source).toContain("replace(offscreen, 'getContext'");
  expect(source).toContain('const nativeSharedWorker');
  expect(source).toContain('new Proxy(nativeSharedWorker');
  expect(source).toContain('hashWorker(j ^ gpuSalt');
  expect(source).toContain("fixedWorker('userAgent', config.userAgent)");
  expect(source).toContain('userAgent: fp.userAgent');
});

it('registers a real per-profile Service Worker preload', () => {
  const runtime = readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'runtime.ts'), 'utf8');
  const worker = readFileSync(path.resolve(__dirname, '..', 'src', 'preload', 'service-worker.ts'), 'utf8');
  expect(runtime).toContain("type: 'service-worker'");
  expect(runtime).toContain('registerPreloadScript');
  expect(runtime).toContain('serviceWorkerFingerprintPreload.toString()');
  expect(worker).toContain('OffscreenCanvas');
  expect(worker).toContain('UNMASKED_RENDERER_WEBGL');
  expect(worker).toContain('hardwareConcurrency');
  expect(worker).toContain("define(workerNavigator, 'userAgent', config.userAgent)");
});

it('covers Canvas exports and all common AudioBuffer/Analyser readback APIs', () => {
  const source = readFileSync(path.resolve(__dirname, '..', 'src', 'preload', 'page-shim.ts'), 'utf8');
  for (const name of ['toDataURL', 'toBlob', 'convertToBlob', 'transferToImageBitmap', 'getImageData']) {
    expect(source).toContain(`'${name}'`);
  }
  for (const name of ['getChannelData', 'copyFromChannel', 'getFloatFrequencyData', 'getByteFrequencyData', 'getFloatTimeDomainData', 'getByteTimeDomainData', 'startRendering']) {
    expect(source).toContain(`'${name}'`);
  }
  expect(source).toContain('perturbAudio');
  expect(source).toContain('perturbBytes');
});

it('applies process-level GPU disabling when a profile turns WebGL/WebGPU off', () => {
  const source = readFileSync(path.resolve(__dirname, '..', '..', '..', 'packages', 'shell', 'src', 'prepare.ts'), 'utf8');
  expect(source).toContain("fingerprint.webgl === 'off'");
  expect(source).toContain("app.commandLine.appendSwitch('disable-gpu')");
  expect(source).toContain("app.commandLine.appendSwitch('disable-webgl')");
  expect(source).toContain("app.commandLine.appendSwitch('disable-3d-apis')");
  expect(source).toContain("disabledFeatures.push('WebGPU')");
});

it('does not let the app-level graphics block force Basic Render Driver for enabled WebGL profiles', () => {
  const source = readFileSync(path.resolve(__dirname, '..', '..', '..', 'packages', 'shell', 'src', 'prepare.ts'), 'utf8');
  expect(source).toContain("profile.fingerprint.webgl !== 'off'");
  expect(source).toContain('isGraphicsBlocked = false');
  expect(source).toContain("fingerprint.webgpu === 'off' || fingerprint.webgpu === 'disable'");
});

it('keeps a WebGL context available when an enabled fingerprint profile needs the overlay', () => {
  const source = readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
  expect(source).toContain("p.fingerprint?.enabled === true && p.fingerprint.webgl !== 'off'");
  expect(source).toContain("appSettings.privacyRuntime.graphicsExposure === 'block'");
  expect(source).not.toContain("switches.push(['ignore-gpu-blocklist'])");
  const windowSource = readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'window.ts'), 'utf8');
  expect(windowSource).toContain("p.fingerprint?.enabled === true && p.fingerprint.webgl !== 'off'");
});

describe.skipIf(!enabled)('local Electron graphics isolation observation', () => {
  it('observes block/native/block across fresh processes without CDP attachment', async () => {
    const nativeBefore = await observe('native');
    const blocked = await observe('block');
    const nativeAfter = await observe('native');

    // Native values are host-dependent and intentionally not asserted.
    expect(nativeBefore).toBeTruthy();
    expect(nativeAfter).toBeTruthy();
    expect(blocked.webgl).toBe(false);
    expect(blocked.webgl2).toBe(false);
    expect(blocked.debugRenderer).toBe(false);
    expect(['missing', 'null']).toContain(blocked.gpu);
    if (blocked.workerWebgl !== null) expect(blocked.workerWebgl).toBe(false);
  });
});
