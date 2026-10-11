> **RELEASE INCOMPLETE:** No built and clean-install-tested Windows runtime is available.
> See [runtime source audit and exact blockers](RUNTIME-RELEASE-STATUS.md).

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

These are inherited project pins. Their tag references were checked through the
Chromium GitHub mirror; native builds and security support remain unverified here. The Windows source checkout must
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
and both visible runtimes must be manually checked before release. The startup CSS now uses the existing theme palette; the palette tests pass
without suppressing them.


## Installer and Electron taskbar follow-up

`install.bat` in a source checkout is a developer setup, **not a downloadable
prebuilt browser release**. It now fails on dependency or runtime errors instead
of marking them optional. It requires both staged InkBrowser versions, including
their DLLs, packs and valid manifests. A failed npm install/ci cannot be converted
to success based on stale dependency files, and `-SkipDependencies` checks the
existing dependency state rather than bypassing it.

Source setup uses `npm run package:local:windows` to rebuild both applications,
package their real branded executables, verify Windows product metadata, and run
native tests against the copied runtimes. The desktop shortcut is created last
and targets `release/octobrowser/win-unpacked/Octo.su.exe` directly. Normal source
`open.bat` also uses this executable. `npm run dev` remains explicitly unbranded
at the executable level. Close old Electron instances, unpin their taskbar icon,
and pin the newly packaged Octo executable after successful setup.

End users should install the complete `OctoSuite-Setup-*.exe` produced by the
Windows release build (or extract its complete browser ZIP). That is the path
that includes InkBrowser without npm, Visual Studio, or local Chromium compilation.
No such executable has been built in this Linux session; the source ZIP alone
still cannot supply the missing runtimes.

Windows-only installer tests are in `scripts/tests/installer-runtime.Tests.ps1`
and run in the Windows release workflow. They were not executed in the Linux
sandbox. To diagnose an individual npm failure, retain the installer log; the
completion screenshot does not include npm's underlying error.

## esbuild repair-loop fix

The earlier installer incorrectly looked for `esbuild/bin/esbuild.exe` on
Windows. Upstream keeps the Windows executable in
`node_modules/@esbuild/win32-x64/esbuild.exe` (or a nested/fallback location),
while `esbuild/bin/esbuild` is a JavaScript CLI. The dependency checker now uses
those real locations. This resolves a false missing-binary check; it is separate
from building or distributing InkBrowser itself.

Dependency repairs acquire `.octo-deps.lock` in the source root, outside
`node_modules`, before checking or changing dependencies. A second installer
fails with a clear message instead of concurrently running npm. After a killed
installer, confirm its Node/npm child processes have stopped before removing a
leftover lock. npm is invoked through `node npm-cli.js` with `shell: false`,
avoiding Node 24's DEP0190 shell warning.

Use the updated files under `manusium-native-gecko-runtime-final/windows` on
the PR branch. The repository's original uploaded ZIP is retained unchanged and
contains the older installer. With other installers closed, run
`node tools/ensure-deps.mjs` once from the updated Windows source folder. A
successful dependency repair does not mean that the native browser runtimes
have been built; the subsequent runtime check still requires their full payloads.
