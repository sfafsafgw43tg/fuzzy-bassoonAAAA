export type BrowserIntegrationId =
  | 'camoufox'
  | 'cromite'
  | 'brave-browser'
  | 'librewolf'
  | 'chameleon-extension'
  | 'canvasblocker'
  | 'creepjs'
  | 'fingerprintjs-oss'
  | 'browserforge';

export type BrowserIntegrationClass = 'browser' | 'extension' | 'audit-tool' | 'automation-library';
export type BrowserIntegrationOrientation = 'hardening' | 'isolation' | 'measurement' | 'automation' | 'extension';

export interface BrowserIntegrationDescriptor {
  id: BrowserIntegrationId;
  name: string;
  classification: BrowserIntegrationClass;
  orientation: BrowserIntegrationOrientation;
  engine: string;
  base: string;
  os: string;
  officialUrl: string;
  sourceUrl: string;
  license: string;
  maintenance: string;
  limitation: string;
  /** Only capabilities implemented by the Octo adapter are true. */
  capabilities: {
    launch: boolean;
    perProfileData: boolean;
    proxy: boolean;
    advancedSettings: boolean;
    settingsSync: boolean;
    install: boolean;
  };
  /** Native browser integrations may be launched; tools/extensions remain informational. */
  executableCandidates: string[];
}

export const BROWSER_INTEGRATIONS: readonly BrowserIntegrationDescriptor[] = [
  {
    id: 'camoufox', name: 'Camoufox', classification: 'browser', orientation: 'isolation', engine: 'Gecko', base: 'Patched Firefox', os: 'Windows, Linux, macOS',
    officialUrl: 'https://camoufox.com/', sourceUrl: 'https://github.com/daijro/camoufox', license: 'MPL-2.0', maintenance: 'Active development; pre-release oriented',
    limitation: 'Official documentation warns that inconsistencies can still be detected and the project may not be production-stable. No universal spoofing or undetectability claim.',
    capabilities: { launch: false, perProfileData: false, proxy: false, advancedSettings: false, settingsSync: false, install: false }, executableCandidates: [],
  },
  {
    id: 'cromite', name: 'Cromite', classification: 'browser', orientation: 'hardening', engine: 'Chromium', base: 'Bromite-derived Chromium fork', os: 'Windows, Linux, Android',
    officialUrl: 'https://www.cromite.org/', sourceUrl: 'https://github.com/uazo/cromite', license: 'GPL-3.0', maintenance: 'Maintained releases',
    limitation: 'Privacy mitigations are not comprehensive; DRM and some Chromium services are unsupported. Uses a separate user-data directory.',
    capabilities: { launch: true, perProfileData: true, proxy: true, advancedSettings: false, settingsSync: true, install: false }, executableCandidates: [
      '%LOCALAPPDATA%\\Cromite\\Application\\chrome.exe', '%PROGRAMFILES%\\Cromite\\Application\\chrome.exe', '%PROGRAMFILES(X86)%\\Cromite\\Application\\chrome.exe',
    ],
  },
  {
    id: 'brave-browser', name: 'Brave Browser', classification: 'browser', orientation: 'hardening', engine: 'Chromium', base: 'Brave Core', os: 'Windows, Linux, macOS, Android, iOS',
    officialUrl: 'https://brave.com/download/', sourceUrl: 'https://github.com/brave/brave-core', license: 'MPL-2.0', maintenance: 'Active release channels',
    limitation: 'A normal privacy-oriented browser, not an anti-detection or CAPTCHA-bypass tool. Deleting profile data can cause data loss.',
    capabilities: { launch: true, perProfileData: true, proxy: true, advancedSettings: false, settingsSync: true, install: false }, executableCandidates: [
      '%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', '%PROGRAMFILES%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', '%PROGRAMFILES(X86)%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    ],
  },
  {
    id: 'librewolf', name: 'LibreWolf', classification: 'browser', orientation: 'hardening', engine: 'Gecko', base: 'Firefox', os: 'Windows, Linux, macOS',
    officialUrl: 'https://librewolf.net/', sourceUrl: 'https://librewolf.dev/librewolf/source', license: 'MPL-2.0 (source)', maintenance: 'Active maintenance; releases track Firefox',
    limitation: 'Hardening can break sites; DRM and Safe Browsing are disabled by default. Use Tor Browser for Tor/anonymity.',
    capabilities: { launch: true, perProfileData: true, proxy: true, advancedSettings: true, settingsSync: true, install: false }, executableCandidates: [
      '%PROGRAMFILES%\\LibreWolf\\librewolf.exe', '%PROGRAMFILES(X86)%\\LibreWolf\\librewolf.exe', '%LOCALAPPDATA%\\Programs\\LibreWolf\\librewolf.exe',
    ],
  },
  {
    id: 'chameleon-extension', name: 'Chameleon', classification: 'extension', orientation: 'extension', engine: 'Firefox WebExtension', base: 'Firefox', os: 'Firefox desktop and Android',
    officialUrl: 'https://sereneblue.github.io/chameleon', sourceUrl: 'https://github.com/sereneblue/chameleon', license: 'GPL-3.0-only', maintenance: 'Active releases observed',
    limitation: 'An extension, not a browser. WebExtension limits and site compatibility issues apply; it does not guarantee anonymity or bypass challenges.',
    capabilities: { launch: false, perProfileData: true, proxy: false, advancedSettings: false, settingsSync: false, install: false }, executableCandidates: [],
  },
  {
    id: 'canvasblocker', name: 'CanvasBlocker', classification: 'extension', orientation: 'extension', engine: 'Firefox WebExtension', base: 'Gecko', os: 'Firefox desktop and Android',
    officialUrl: 'https://addons.mozilla.org/en-US/firefox/addon/canvasblocker/', sourceUrl: 'https://github.com/kkapsner/CanvasBlocker', license: 'MPL-2.0', maintenance: 'Active release history observed',
    limitation: 'An extension, not a browser. API protection can break sites and multiple protection extensions can harm performance.',
    capabilities: { launch: false, perProfileData: true, proxy: false, advancedSettings: false, settingsSync: false, install: false }, executableCandidates: [],
  },
  {
    id: 'creepjs', name: 'CreepJS', classification: 'audit-tool', orientation: 'measurement', engine: 'Browser JavaScript', base: 'Runs in an existing browser', os: 'Browser-based; Windows download not verified',
    officialUrl: 'https://abrahamjuliot.github.io/creepjs', sourceUrl: 'https://github.com/abrahamjuliot/creepjs', license: 'MIT', maintenance: 'Repository activity; no official releases verified',
    limitation: 'Measures browser signals for research. It does not launch or configure a browser and does not provide spoofing.',
    capabilities: { launch: false, perProfileData: false, proxy: false, advancedSettings: false, settingsSync: false, install: false }, executableCandidates: [],
  },
  {
    id: 'fingerprintjs-oss', name: 'FingerprintJS OSS', classification: 'audit-tool', orientation: 'measurement', engine: 'Client-side JavaScript', base: 'Runs in an existing browser', os: 'Browser support documented; Windows-native app not verified',
    officialUrl: 'https://github.com/fingerprintjs/fingerprintjs', sourceUrl: 'https://github.com/fingerprintjs/fingerprintjs', license: 'MIT', maintenance: 'Maintained package releases',
    limitation: 'A browser library that measures signals; it is not a browser, profile manager, or spoofing system. Accuracy can be reduced by privacy tools.',
    capabilities: { launch: false, perProfileData: false, proxy: false, advancedSettings: false, settingsSync: false, install: false }, executableCandidates: [],
  },
  {
    id: 'browserforge', name: 'BrowserForge', classification: 'automation-library', orientation: 'automation', engine: 'Python library', base: 'Playwright/Pyppeteer integration', os: 'Windows support not explicitly verified',
    officialUrl: 'https://github.com/daijro/browserforge', sourceUrl: 'https://github.com/daijro/browserforge', license: 'Apache-2.0', maintenance: 'Recent package release observed',
    limitation: 'A Python automation/profile library, not a browser. Official README says fingerprint injection is deprecated and directs users to Camoufox.',
    capabilities: { launch: false, perProfileData: false, proxy: false, advancedSettings: false, settingsSync: false, install: false }, executableCandidates: [],
  },
] as const;

export function isBrowserIntegrationId(value: unknown): value is BrowserIntegrationId {
  return typeof value === 'string' && BROWSER_INTEGRATIONS.some((entry) => entry.id === value);
}

export function browserIntegration(id: unknown): BrowserIntegrationDescriptor | undefined {
  return isBrowserIntegrationId(id) ? BROWSER_INTEGRATIONS.find((entry) => entry.id === id) : undefined;
}
