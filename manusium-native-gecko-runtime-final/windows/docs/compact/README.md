# Octo Compact — single-engine desktop edition

**Status: candidate, pending Windows build + clean-install evidence.** This is a
new small edition, not a completed source-built InkBrowser release. Use its
`Octo-Compact-Setup-<version>.exe`, not the full suite's old `install.bat` or the
original uploaded source ZIP. Do not advertise an installed size until
`installed-size.json` exists from a passing clean-install job.

## Inspection and fit

The existing application is TypeScript + Electron. Its entry point currently
requires Windows 10/11 x64, despite older metadata advertising Linux. The browser
uses isolated web-content views; the larger profile manager can additionally
launch external Chromium/Firefox through native protocols. Existing features
include tabs, bookmarks, history, downloads, encrypted profiles, private/temporary
sessions, proxy/privacy tools, extension support, and Android/VM companions.

The full Windows distribution stages two source-built Chromium versions, Firefox,
Electron for the browser, Electron for the audit companion, plus optional media
assets. Compiling Chromium needs hundreds of GB and a specialized Windows builder.
None of that is necessary for an ordinary lightweight tabbed browser.

Octo Compact reuses **one prebuilt, supported Electron/Chromium runtime** for both
trusted browser controls and sandboxed web content. It is deliberately a separate
app/data directory, not a migration that overwrites existing encrypted profiles.
The full suite and all its tests remain available.

### Engine alternatives considered

| Approach | Decision / tradeoff |
| --- | --- |
| Embedded Electron Chromium | Implemented. Compatible with existing TypeScript/Electron security policy; one runtime, no native compilation. Electron's runtime still dominates installed size. |
| Installed Chrome/Edge executable | Not a drop-in replacement for Electron WebContentsView or its browser UI. CDP external windows would regress this integrated experience and add an unmanaged engine dependency. |
| Evergreen WebView2 | Could make a Windows-only app's own payload much smaller when shared runtime is already installed. Requires a different host/control integration, IPC, session, permission and download implementation plus a new test matrix. Its shared runtime still consumes disk; reporting only the host's size would be misleading. Not implemented here. |
| Source-built Chromium / Gecko | Retained only in the full suite. Not downloaded or built for Compact. |

No Dolphin logos, names, assets or proprietary implementation are used. The
experience takes only common browser conventions: tabs, search/address input,
bookmarks/shortcut tiles, private windows and large touch targets.

## What is implemented

- Real tabs using sandboxed `WebContentsView`, back/forward, reload/stop,
  keyboard shortcuts, new-tab shortcuts, standard web rendering and JavaScript.
- Address/search input: explicit HTTP/HTTPS, HTTPS for typed domains, DuckDuckGo
  text search; privileged schemes cannot be typed into the address bar.
- Local bookmarks, bounded to 500 entries; deletion and persistence across
  restarts. Page titles are rendered as text, never inserted as HTML.
- Separate private windows with non-persistent Electron partitions and no disk
  cache. Bookmarks are read-only in private windows. Downloaded files remain;
  private browsing does not conceal identity from sites/network, OS swap or dumps.
- Save-dialog downloads, basic copy/paste context menus, and site permission
  prompts which default to Block. Unknown permissions and external-protocol
  launches are not silently granted. Cache/site-data clearing is explicit.
- Layout adapts down to 390px content width, with at least 44px toolbar touch
  targets, scrollable tabs, wrapping controls and local shortcuts. This is
  touch-friendly Windows desktop UI, **not an Android/iOS application**.
- One NSIS installer and branded executable, separate from the unfinished native
  multi-version release. No source compiler runs on the consumer machine.

This intentionally does not reproduce the suite's encrypted vault, anti-detect
profiles, Tor/proxy orchestration, extension management, history/session restore,
Android emulator or audit companion. Those remain in the existing suite. Compact
is not an anonymity tool and does not claim Chrome feature parity (including
Google account sync, DRM or Chrome Safe Browsing services).

## Security and updates

The same `SAFE_WEB_PREFERENCES` policy as the suite enforces renderer sandboxing,
context isolation, web security and no Node integration in web content. Websites
have no preload bridge. Commands are accepted only from the trusted local main
frame. Certificate validation is not bypassed. Packaging retains hardened fuses,
ASAR integrity validation, Electron/Chromium license notices and all runtime
resources/locales. No security resources are stripped for size.

Electron was updated from 44.4.5 to **44.7.0**, the registry's latest stable patch
at implementation time. `npm run check:compact:engine` requires an exact pin,
latest patch on that major, and a major within Electron's supported last-three
stable majors. It fails closed if verification is unavailable. Dependabot is
configured to propose Electron/packager/fuse updates weekly once its config is
active on the default branch. Updates must pass the full suite and clean-install
tests; shrinking the package is never a reason to keep an obsolete engine.

**Compact updates are manual:** its Updates control opens this repository's
release page. It does not silently install the full suite's incompatible update
manifest or claim automatic browser updates. A maintainer must publish tested
new installers and users must install them. No compact stable release is assumed
to exist yet. Automatic signed updates are future work. Code signing uses the
existing optional `CSC_LINK`/`CSC_KEY_PASSWORD` secrets; an unsigned candidate
must not be presented as a verified-publisher release.

## Build and disk use

From the `windows` directory on a Windows x64 machine:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run check:compact:engine
npm run typecheck
npm test
npm run dist:compact:windows
```

Use `--ignore-scripts` here to avoid downloading a second **development** Electron
runtime. Electron-builder obtains the one official target runtime it needs to
package. The compact build has no Chromium source fetch, gclient, GN, C++ compiler,
Firefox staging, emulator archive or second app. It bundles only its JS/UI/icon,
project license, Electron and Electron's required libraries/resources/notices.

The workflow uses disposable cache directories, retains one installer artifact
for seven days, and does not archive the unpacked app or node_modules. NSIS
compression is enabled; minification/no production source maps keep app code
small. The sparse checkout excludes the original 20 MB uploaded archive.

Unavoidable temporary space includes npm dependencies, the downloaded Electron
archive, unpacked target runtime, NSIS toolchain/staging, and compressed installer.
These briefly coexist. The fresh test VM also installs the runtime it tests.
Allow several GB for this packaging pipeline; this is a planning allowance,
**not a measured peak**. `build-size.json` records end-of-build logical sizes,
not peak disk allocation. No multi-hundred-GB Chromium source trees are needed.
Normal HTTP cache is capped at 64 MiB. Site storage, downloads and profiles are
separate from installed size and can grow; users can explicitly clear site data.

## Windows release evidence and acceptance

`.github/workflows/compact-windows.yml` uses **hosted `windows-latest`**, not the
unavailable `inkbrowser-chromium` source-build runner:

1. Full typecheck and unit suite, current-engine security check.
2. Build an actual Windows NSIS candidate with one embedded engine.
3. Download that exact candidate onto a second disposable Windows VM.
4. Require no existing compact install/profile, install silently, verify required
   runtime files, product metadata, license notices, fuses and absence of extra
   native engines or emulator payloads.
5. Launch the installed executable, exercise the actual address form/bookmark UI,
   real navigation, JavaScript, tabs, privilege isolation, private-cookie
   isolation and a narrow layout. Restart and verify normal cookie/bookmark
   persistence. No developer Electron binary or debugging-fuse bypass is used.
6. Measure installed logical file bytes and installer bytes; record embedded
   Electron/Chromium versions, SHA-256, commit, and test-profile bytes separately.
7. Uninstall and verify removal before writing the success/size receipt.

Evidence: `ci-logs/compact/{first,restart,installed-size,build-size}.json`, logs and
one narrow-window screenshot. Candidate installer artifact is stored once; the
size receipt binds the tested installer hash rather than uploading a duplicate
"verified" installer. A failed job or absent receipt means **unverified**.

Manual accessibility, graphics/driver compatibility, uncommon downloads and
permission flows, visual branding, real-world sites and release-signing checks
remain necessary before calling this production-ready. A scripted clean-install
pass is not evidence of performance across all machines.
