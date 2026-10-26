/**
 * packages/shell/src/prepare.ts
 *
 * Must run BEFORE app.whenReady(). Decides where Chromium stores its data:
 *
 *   - First run (no bootstrap.json): Chromium uses a throw-away temp folder
 *     while the first-run wizard asks for the language and the data folder.
 *     After the wizard the app relaunches itself.
 *   - Normal run: Chromium's userData/sessionData = <data folder>\engine,
 *     crash dumps = <data folder>\logs\crashes. Nothing is written to
 *     %APPDATA% except bootstrap.json.
 *   - Windows Sandbox session (--ephemeral-data-dir): data lives inside the
 *     disposable sandbox, bootstrap.json is never written.
 */
import { app } from 'electron';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { APPS, AppId, AppInfo, BootstrapState, BootstrapStore, DataLayout, isLang, ProfileManager } from '@octo/core';
import { toSafeChromiumSwitches } from './security-policy';

export interface PreparedApp {
  info: AppInfo;
  store: BootstrapStore;
  state: BootstrapState | null;
  layout: DataLayout | null;
  /** Folder containing the built UI (dist/). */
  distDir: string;
  portable: boolean;
  /** Running as a disposable Windows Sandbox session. */
  ephemeral: boolean;
  firstRunTempDir?: string;
  installDir: string;
}

/** Read "--name=value" from argv. */
export function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * Bootstrap file location for an app (portable mode = next to the exe).
 *
 * The product was renamed to Octo.su. A machine that still carries the file
 * under the previous name keeps using it, so an upgrade does not silently
 * lose the language and the data folder the user chose.
 */
export function bootstrapFileFor(info: AppInfo, portable: boolean): string {
  const exeDir = path.dirname(app.getPath('exe'));
  if (portable) return path.join(exeDir, `${info.id}.bootstrap.json`);
  const current = path.join(app.getPath('appData'), info.bootstrapDirName, 'bootstrap.json');
  if (fs.existsSync(current) || !info.legacyBootstrapDirName) return current;
  const legacy = path.join(app.getPath('appData'), info.legacyBootstrapDirName, 'bootstrap.json');
  return fs.existsSync(legacy) ? legacy : current;
}

export interface PrepareOptions {
  /** Use a different Chromium userData folder (per-profile browser processes). */
  engineDirFor?: (layout: DataLayout) => string;
  /** Extra Chromium switches decided per process (e.g. WebRTC policy of the profile). */
  extraSwitches?: (layout: DataLayout) => Array<[string, string?]>;
}

export function prepareApp(appId: AppId, distDir: string, opts: PrepareOptions = {}): PreparedApp {
  const info = APPS[appId];
  app.setName(info.productName);
  if (process.platform === 'win32') {
    // Windows caches taskbar/relaunch metadata by AppUserModelId. A fixed ID
    // for development builds makes a moved checkout inherit the old
    // node_modules\electron\dist location, so Explorer's "Open file location"
    // points at a deleted drive. Keep release IDs stable, but isolate each
    // development Electron executable by a short hash of its real path.
    const devSuffix = createHash('sha1').update(path.resolve(process.execPath).toLowerCase()).digest('hex').slice(0, 10);
    const taskbarAppId = app.isPackaged ? info.appUserModelId : `${info.appUserModelId}.Dev.${devSuffix}`;
    app.setAppUserModelId(taskbarAppId);
    // A window icon alone does not change Explorer's taskbar context menu.
    // Set explicit relaunch metadata even for development electron.exe launches.
    app.on('browser-window-created', (_event, window) => {
      window.setAppDetails({
        appId: taskbarAppId,
        appIconPath: path.join(distDir, 'assets', 'icon.ico'),
        appIconIndex: 0,
        relaunchDisplayName: info.productName,
        relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`,
      });
    });
  }


  const exeDir = path.dirname(app.getPath('exe'));
  const portable = fs.existsSync(path.join(exeDir, 'portable.flag'));
  const store = new BootstrapStore(bootstrapFileFor(info, portable));

  let isVmMode = hasFlag('disable-gpu') || hasFlag('vm-mode') || hasFlag('virtualbox-mode') || process.env.OCTO_VM_MODE === '1';
  let isGraphicsBlocked = false;
  const profileProcess = argValue('profile-process');

  {
    try {
      const bFile = bootstrapFileFor(info, portable);
      if (fs.existsSync(bFile)) {
        const raw = JSON.parse(fs.readFileSync(bFile, 'utf8'));
        if (raw?.dataDir) {
          const setFile = path.join(raw.dataDir, 'config', 'settings.json');
          if (fs.existsSync(setFile)) {
            const setObj = JSON.parse(fs.readFileSync(setFile, 'utf8'));
            isGraphicsBlocked = setObj?.privacyRuntime?.graphicsExposure === 'block';
            // A profile's page shim can consistently expose its selected WebGL
            // identity only when Chromium keeps the native GPU path. The old
            // app-level block ran first and forced d3d11-warp-webgl, which made
            // every enabled profile report Microsoft Basic Render Driver.
            if (isGraphicsBlocked && profileProcess && /^[a-z0-9-]{3,64}$/.test(profileProcess)) {
              try {
                const profile = new ProfileManager(new DataLayout(raw.dataDir)).get(profileProcess);
                if (profile.fingerprint?.enabled === true && profile.fingerprint.webgl !== 'off') isGraphicsBlocked = false;
              } catch { /* profile validation below remains authoritative */ }
            }
            if (setObj?.ui?.virtualBoxMode === true || setObj?.ui?.vmMode === true || setObj?.ui?.vmFriendlyMode === true) {
              isVmMode = true;
            }
          }
        }
      }
    } catch {}
  }

  if (isVmMode || isGraphicsBlocked) {
    if (isVmMode) process.env.OCTO_VM_MODE = '1';
    try { app.disableHardwareAcceleration(); } catch {}
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('in-process-gpu');
    // Keep Chromium's software rasterizer available. Disabling both hardware
    // acceleration and software rasterization leaves WebContentsView renderers
    // alive but unable to create a visible profile window on some Windows/VM
    // graphics stacks. Hardware GPU use is already disabled above.
  }

  // Force the Chromium sandbox for EVERY renderer (UI and web pages).
  app.enableSandbox();

  // Enable WebGPU when not running in software VM mode
  if (!isVmMode) {
    // WebGPU remains native when graphics exposure is native. Never enable
    // unsafe WebGPU or bypass Chromium's GPU blocklist.
  }

  // Privacy-related Chromium switches (no background pings/reporting).
  app.commandLine.appendSwitch('no-pings'); // disable <a ping> hyperlink auditing
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('disable-background-networking');
  const disabledFeatures = ['MediaRouter', 'DialMediaRouteProvider', 'OptimizationHints', 'AutofillServerCommunication', 'Translate', 'InterestFeedContentSuggestions'];
  if (isGraphicsBlocked) disabledFeatures.push('WebGPU');

  let state: BootstrapState | null;
  const explicitDataDir = argValue('profile-data-dir');
  const ephemeralDir = argValue('ephemeral-data-dir');
  const handoffDir = explicitDataDir && path.isAbsolute(explicitDataDir)
    ? explicitDataDir
    : ephemeralDir && path.isAbsolute(ephemeralDir)
      ? path.join(ephemeralDir, info.dataSubdir)
      : undefined;
  if (handoffDir) {
    const lang = argValue('lang-choice');
    state = {
      schema: 1,
      language: isLang(lang) ? lang : 'en',
      baseDir: explicitDataDir ? path.dirname(handoffDir) : (ephemeralDir as string),
      dataDir: handoffDir,
      firstRunAt: new Date().toISOString(),
    };
  } else {
    state = store.read();
  }

  let layout: DataLayout | null = null;
  let firstRunTempDir: string | undefined;
  if (state) {
    layout = new DataLayout(state.dataDir);
    layout.ensure(appId === 'octodetect' ? ['reports'] : ['downloads']);
    let profileGraphicsBlocked = false;
    if (profileProcess && /^[a-z0-9-]{3,64}$/.test(profileProcess)) {
      try {
        const profile = new ProfileManager(layout).get(profileProcess);
        const fingerprint = profile.fingerprint;
        profileGraphicsBlocked = fingerprint.enabled === true
          && fingerprint.webgl === 'off';
        if (fingerprint.enabled === true && (fingerprint.webgpu === 'off' || fingerprint.webgpu === 'disable')) {
          disabledFeatures.push('WebGPU');
        }
      } catch {
        // A missing or malformed profile is rejected by the profile manager;
        // do not let a failed policy lookup prevent the manager from starting.
      }
    }
    if (profileGraphicsBlocked) {
      // This is process-wide by design: each profile is a separate Electron
      // process. It closes the worker/OffscreenCanvas escape route that a
      // page-world shim cannot cover and prevents Chromium from exposing the
      // host adapter through WebGPU or GPU diagnostics.
      try { app.disableHardwareAcceleration(); } catch { /* before-ready only */ }
      app.commandLine.appendSwitch('disable-gpu');
      app.commandLine.appendSwitch('disable-gpu-compositing');
      app.commandLine.appendSwitch('disable-webgl');
      app.commandLine.appendSwitch('disable-3d-apis');
      disabledFeatures.push('WebGPU');
    }
    const engineDir = opts.engineDirFor ? opts.engineDirFor(layout) : layout.engine;
    fs.mkdirSync(engineDir, { recursive: true });
    app.setPath('userData', engineDir);
    app.setPath('sessionData', engineDir);
    for (const [sw, val] of toSafeChromiumSwitches(opts.extraSwitches?.(layout) ?? [])) {
      if (val === undefined) app.commandLine.appendSwitch(sw);
      else app.commandLine.appendSwitch(sw, val);
    }
    app.setPath('crashDumps', path.join(layout.logs, 'crashes'));
    // navigator.language / Accept-Language follow the chosen UI language (fixed, never random).
    app.commandLine.appendSwitch('lang', state.language === 'pl' ? 'pl-PL' : 'en-US');
  } else {
    firstRunTempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${info.id}-firstrun-`));
    app.setPath('userData', firstRunTempDir);
    app.setPath('sessionData', firstRunTempDir);
  }
  app.commandLine.appendSwitch('disable-features', [...new Set(disabledFeatures)].join(','));

  return {
    info,
    store,
    state,
    layout,
    distDir,
    portable,
    ephemeral: !!ephemeralDir,
    firstRunTempDir,
    installDir: exeDir,
  };
}

/**
 * Delete all selected data for an app and its tiny AppData bootstrap pointer.
 * Called only during a fresh --factory-reset relaunch, before windows and
 * Chromium sessions are created. The next launch therefore opens first-run.
 */
export function resetPreparedApp(prep: PreparedApp): void {
  if (prep.ephemeral) throw new Error('Cannot reset a disposable sandbox session');
  const dataDir = prep.state?.dataDir;
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  fs.rmSync(prep.store.path, { force: true, maxRetries: 3, retryDelay: 100 });
  // The per-app AppData directory contains only bootstrap.json. Remove it when
  // empty without touching the sibling application’s bootstrap directory.
  try { fs.rmdirSync(path.dirname(prep.store.path)); } catch { /* not empty / portable app */ }
}

/** Remove one internal relaunch flag while retaining Electron's app arguments. */
export function relaunchArgsWithout(flag: string): string[] {
  return process.argv.slice(1).filter((arg) => arg !== `--${flag}`);
}

/** Accept-Language header matching the UI language. Same for all users of a language. */
export function acceptLanguages(lang: 'en' | 'pl'): string {
  // Plain ordered list: Chromium generates the q-weights of the header itself.
  return lang === 'pl' ? 'pl-PL,pl,en-US,en' : 'en-US,en';
}

/**
 * Chromium user agent without "Electron/x" and app tokens, so pages see a
 * regular Chrome-on-Windows UA (reduces uniqueness; no device impersonation -
 * the engine IS Chromium, and version/OS are real).
 */
export function cleanUserAgent(ua: string): string {
  if (!ua) return '';
  return ua
    .replace(/HeadlessChrome/gi, 'Chrome')
    .replace(/\s?Electron\/[\d.]+/gi, '')
    .replace(/\s?(OctoBrowser(\.su)?|OctoDetect(\.su)?|Octo\.su|OB\.su|OD\.su|octosuite|octobrowser|octodetect)\/[\w.-]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
