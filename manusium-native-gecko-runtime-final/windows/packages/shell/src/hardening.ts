/**
 * packages/shell/src/hardening.ts
 *
 * Application-wide Electron hardening (Electron security checklist):
 *   - no <webview> tags, no remote module, no Node integration anywhere;
 *   - UI windows cannot navigate away or open new windows;
 *   - every renderer is sandboxed (app.enableSandbox() in prepare.ts);
 *   - the default application menu (with dev tools shortcuts) is removed.
 */
import { app, Menu, WebContents } from 'electron';
import type { Logger } from '@octo/core';

/** WebContents ids that belong to browser TABS (web content) - managed by the browser app. */
export const tabContents = new Set<number>();

/**
 * Navigation policy shared by initial navigations and redirects. The old
 * spoofHeadless extension modifies page-visible identity values; it is not an
 * Electron security boundary. OctoSuite therefore keeps page identity intact
 * and blocks schemes that can execute local or script content instead.
 */
export function isSafeNavigationUrl(rawUrl: string, isBrowserTab: boolean): boolean {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (!isBrowserTab) return parsed.protocol === 'file:';
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' || (parsed.protocol === 'about:' && parsed.pathname === 'blank');
}

export function hardenApp(logger: Logger): void {
  Menu.setApplicationMenu(null);

  app.on('web-contents-created', (_e, contents: WebContents) => {
    // Never allow <webview>.
    contents.on('will-attach-webview', (ev) => {
      ev.preventDefault();
      logger.warn('security.webview-blocked');
    });

    // UI pages (file://) must never navigate to the web or open windows.
    contents.on('will-navigate', (ev, url) => {
      if (!isSafeNavigationUrl(url, tabContents.has(contents.id))) {
        ev.preventDefault();
        logger.warn('security.navigation-blocked');
      }
    });
    contents.on('will-redirect', (ev, url) => {
      if (!isSafeNavigationUrl(url, tabContents.has(contents.id))) {
        ev.preventDefault();
        logger.warn('security.redirect-blocked');
      }
    });
    contents.setWindowOpenHandler(() => {
      if (tabContents.has(contents.id)) return { action: 'deny' }; // browser installs its own handler later
      return { action: 'deny' };
    });
  });
}
