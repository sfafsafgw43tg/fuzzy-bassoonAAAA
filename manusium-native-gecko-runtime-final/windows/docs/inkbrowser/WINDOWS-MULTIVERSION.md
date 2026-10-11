# Windows InkBrowser runtimes and Octo identity

## What changed

The Windows version picker now recognizes both per-user and bundled runtimes using
launch-time manifest/hash validation. Bundled versions cannot be removed through
the profile editor. Windows does not offer a misleading download/install button:
these modified builds are shipped by the Octo installer, not renamed vendor ZIPs.
An explicitly selected missing version never falls back to a legacy development
browser. Directory and manifest versions must match.

`tools/chromium-versions.json` pins the two existing catalog choices:

- `155.0.8059.39` (catalog default)
- `156.0.8078.12` (catalog beta)

These are inherited project pins, not a claim that their upstream tags or security
support have been independently verified here. The Windows source checkout must
resolve each exact tag; a missing tag fails the build. Update the catalog and pins
together, and re-test before publishing.

## Build on the dedicated Windows x64 runner

Prerequisites: Visual Studio C++ toolchain, Windows SDK, Python, depot_tools,
Node 22.12+, and at least 300 GB free for the separate version checkouts (actual
requirements may be higher). The runner needs access to Chromium's source and
build dependency hosts. Set `OCTO_CHROMIUM_SOURCE` to the build-cache parent.

```powershell
npm ci
npm run icons
npm run build:chromium:windows
npm run verify:chromium:windows
npm run dist:browser
npm run verify:chromium:packaged
npm run test:native-packaged:windows
```

The source build compiles InkBrowser's branding, Windows icon, product strings,
Windows shell identity and executable relaunch constants. It retains upstream
copyright/license notices. Packaging removes compiler object trees, not the
runtime DLLs, helper binaries or locale packs. The staging step rejects missing
required runtime files before replacing an existing staged version.

Generated files (Git-ignored):

```
resources/engines/chromium/155.0.8059.39/inkbrowser-chrome.exe
resources/engines/chromium/155.0.8059.39/runtime.json
resources/engines/chromium/156.0.8078.12/inkbrowser-chrome.exe
resources/engines/chromium/156.0.8078.12/runtime.json
```

Each directory contains the complete runtime payload, not just its executable.
The package verifier checks required DLLs/packs and the executable checksum for
**both** versions. Native smoke tests use the copied `win-unpacked` payload.
The ZIP artifact contains the whole packaged application and both runtimes.

The repository-root `.github/workflows/windows-chromium-release.yml` targets the
extracted source directory in this checkout. The copy inside the extracted tree
is retained for using that tree as a standalone repository. Both require the
self-hosted `inkbrowser-chromium` runner. The installer also needs OctoDetect;
the workflow builds it. Signed manifest testing requires the existing
`UPDATE_SIGNING_KEY` matching the committed public key, with optional
`UPDATE_KEY_PASSPHRASE`. No keys are generated or rotated automatically.

## Octo taskbar identity

All Octo windows receive the Octo AppUserModelID, icon and explicit relaunch
metadata. This addresses Explorer's taskbar context-menu label even when the
application is started using development `electron.exe`. Packaged Octo already
uses the branded `Octo.su.exe` and electron-builder resource editing. Development
Task Manager may still identify the underlying executable as Electron; use the
packaged build for a fully branded executable. Unpin old Electron shortcuts and
pin the installed Octo executable again if Explorer retains a stale shortcut.
Native Chromium windows use the separate InkBrowser brand.

## Installation layout and limits

Runtime paths are relative to the Octo executable directory:
`resources/engines/chromium/<version>/`. If Octo is deployed directly under
`C:\Program Files\OctoBrowser`, this gives the requested path. The existing
**suite** installer retains its layout under `OctoSuite\OctoBrowser`; its default
path was not changed (nor were existing user profiles moved).

Switching browser versions still uses the existing profile data directory.
Back up profiles before downgrading; automatic schema migration/rollback is not
implemented. Native InkBrowser does not yet have parity with Electron's Octo
password-save overlay. See `MIGRATION_NOTE.md`.

No Windows executable was built or launched in the Linux sandbox. TypeScript,
application bundling and fixture-based regression tests do not prove native
Windows execution or visible taskbar behavior. The Windows workflow must pass
and both visible runtimes must be manually checked before release. The existing
palette tests also currently reject the untouched purple startup CSS; this
unrelated suite failure is not suppressed by the workflow.
