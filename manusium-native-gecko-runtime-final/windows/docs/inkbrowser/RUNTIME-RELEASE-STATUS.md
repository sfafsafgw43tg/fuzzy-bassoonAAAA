# InkBrowser Windows runtime: INCOMPLETE

Audit date: 2026-10-11. **No runtime binary, complete installer, or successful
clean Windows runtime execution is available. Do not ship this as a working
InkBrowser release.** The original uploaded ZIP contains older source only.

## What the source actually is

There is no separate InkBrowser source fork or runtime download configured in
this repository. The implemented Windows builder uses upstream
`https://chromium.googlesource.com/chromium/src.git`, fetched with Chromium's
`depot_tools`, plus the project-owned source overlay. GitHub's Chromium mirror
confirmed these tags during this audit:

| Pin | Upstream commit |
| --- | --- |
| 155.0.8059.39 | 3ff7ac5a9224be9156d7f8703a06e22890aafd34 |
| 156.0.8078.12 | 634b046faf2137b83af71c87baf362b533af9104 |

Tag existence does not establish successful compilation or compatibility of
this overlay/GN configuration. No claim is made that this is a complete
anti-detect Chromium fork. The native modifications currently implemented are
branding/relaunch identity and the GN feature configuration, not Octo's Electron
fingerprinting shims. The profile manager rejects incompatible protection modes.

## Acquisition -> compilation -> payload -> installer -> launch

1. `tools/chromium-versions.json` pins both versions;
   `tools/chromium-versions.mjs build` loops over them.
2. `tools/build-chromium-source.mjs` uses `fetch --nohooks --no-history chromium`,
   fetches/checks out the requested tag, then runs `gclient sync -n -v -jN` and
   `gclient runhooks`. Each version has a separate source/output tree under
   `$env:OCTO_CHROMIUM_SOURCE\chromium\<version>\src`.
3. It applies `tools/inkbrowser/source/BRANDING` and
   `tools/lib/chromium-branding.mjs` to product strings, source icons,
   install identity and the hard-coded Windows relaunch executable name.
4. It copies `tools/inkbrowser/gn/release.gn` to `out/InkBrowser/args.gn`, runs
   `gn gen <out> --fail-on-unused-args`, then `autoninja -C <out> chrome`.
   These steps have NOT run successfully for these pins in this session.
5. `tools/lib/chromium-payload.mjs` stages build output excluding object/symbol
   trees. The newly compiled executable becomes `inkbrowser-chrome.exe`; this
   is not a renamed vendor download. DLLs, packs, locales, source provenance,
   executable SHA-256, `runtime.json` and Chromium license are staged under
   `resources/engines/chromium/<version>/`.
6. `apps/octobrowser/electron-builder.yml` copies `resources/engines` into the
   packaged app. `tools/build-installer.mjs` requires both complete runtime
   payloads before invoking Inno Setup. `installer/octosuite.iss` includes the
   packaged app directories. The current suite layout is
   `OctoSuite\OctoBrowser\resources\engines\chromium\<version>`; it is NOT yet
   the previously requested standalone `C:\Program Files\OctoBrowser` layout.
7. `apps/octobrowser/src/main/manager.ts` resolves the profile's exact
   `chromiumRuntime` through `packages/shell/src/engine-runtime.ts`, starts the
   executable through `native-engine.ts` with an isolated profile and CDP port,
   and manages navigation/tabs over CDP. A packaged app does not fall back to
   raw Electron or system Chrome when a runtime is absent.

## Evidence and exact blockers

- Local environment: Linux x64, approximately **19 GB free** on a 21 GB volume.
  No PowerShell, Windows/MSVC/SDK, depot_tools, GN or autoninja were found.
  The Windows build entry point refuses Linux. This machine cannot perform the
  requested clean Windows install or visible native launch.
- Sandbox network access is limited to GitHub and npm/Python registries. It
  excludes Chromium's googlesource, CIPD/Google Storage and Microsoft toolchain
  download hosts. A GitHub source mirror alone is not a complete build input:
  `DEPS`, hooks and toolchains still need their upstream download services.
- `resources/engines` contains only its README. GitHub releases and Actions
  artifacts were empty at audit time. No trusted prebuilt InkBrowser download
  URL, binary package, checksums or build provenance has been supplied.
- Runner inventory API returned **403 Resource not accessible by integration**.
  This means runner availability is unknown, NOT proof that no runner exists.
  The workflow requires labels `self-hosted, windows, x64, inkbrowser-chromium`.
- Dispatch by workflow filename returned **404** while the workflow was absent
  from the default branch's registered workflow list. The PR now also enables
  a branch-scoped push trigger on the release workflow itself to attempt a run
  without merging. A queued/failed run is not a build result.
- The GN configuration enables proprietary codecs (`ffmpeg_branding="Chrome"`).
  Upstream Chromium source licensing is available, but complete third-party
  notices and codec redistribution obligations have not been audited for an
  actual produced payload. Do not equate copying the top-level LICENSE with
  a completed distribution-license review.
- Update signing requires a matching `UPDATE_SIGNING_KEY` in repository secrets;
  access/presence is not verified. Optional Authenticode inputs are `CSC_LINK`,
  `CSC_KEY_PASSWORD`, and `OCTO_SIGNTOOL`. Never put private keys in chat or Git.

## Input/access needed to finish

Provide an authorized Windows x64 builder with the above runner labels (or
access to an equivalent Windows build machine), Python, Git and depot_tools.
Both pinned upstream `docs/windows_build_instructions.md` files require
**Visual Studio 2026 >=18.0.0**, Desktop C++ plus **ATL/MFC**,
**Windows 11 SDK 10.0.28000.2270** (directories named `10.0.28000.0`), and
**SDK Debugging Tools >=10.0.26100.3323**. The earlier VS 2022 description was
outdated; the builder header and CI preflight have been corrected.
The source docs recommend more than 16 GB RAM; provide a suitably sized build
machine rather than assuming a standard hosted runner can compile both pins. Set `OCTO_CHROMIUM_SOURCE` to a large fixed local drive.
The existing preflight requires at least 300 GB free; two retained Chromium
checkouts/build trees may require substantially more. Allow Chromium dependency
and toolchain downloads and several hours of compilation. The desktop runtime
tests use a fresh hosted Windows runner after the build, not a developer's PC.

Alternatively, supply the genuine prebuilt InkBrowser Windows packages for both
pins, with their source/overlay revision, build settings, full DLL/resource/locale
payload, license notices and trusted checksums. No stock Chrome, stub or source
archive is an acceptable replacement.

On the configured Windows builder, the workflow executes:

```powershell
npm ci
npm run icons
npm run build:chromium:windows
npm run verify:chromium:windows
npm run dist:browser
npm run verify:chromium:packaged
npm run test:native-packaged:windows
npm run dist:detect
npm run verify:windows:branding
npm run installer
# Sign/hash with the configured release key, then run clean-machine CI below.
```

## Release acceptance gate (implemented, not passed)

`.github/workflows/windows-chromium-release.yml` builds on the large self-hosted
runner. Its output is explicitly named `CANDIDATE`. A separate `clean-install`
job on a disposable `windows-latest` VM downloads that exact candidate, refuses
a pre-existing installation, installs it, and calls `tools/ci/installer-e2e.ps1`.

For **each pinned version**, that script invokes
`tools/test-packaged-chromium.mjs win32-x64 --root=<installed OctoBrowser>`.
The harness verifies required payload files/hash and executes the **installed
binary in place**, not a copied binary or a system Chrome. Native integration
uses the same runtime resolver and process/CDP implementation as the app and
checks navigation, JavaScript, tabs and shutdown. App-window mode is visible on
Windows in this gate; Windows tests retain the browser sandbox. Required native
runtime absence must throw, never skip. The installer test also starts both
packaged Electron applications and checks uninstall.

Only the successful clean-install job uploads the final installer artifact.
Logs remain available on failure. These tests do not by themselves automate all
picker interactions or prove taskbar visual appearance: exact-version selection
from the Octo UI, icons/taskbar behavior, requested standalone install path and
license completeness remain release acceptance work on real Windows.


## Validation evidence from this audit

- Local full suite: 943 passed, 5 optional native tests skipped because there is
  no local browser. The negative tests explicitly require a runtime and confirm
  that its absence fails rather than passes/skips.
- Hosted Windows and Ubuntu, Node 22 and 24: regression/negative-runtime tests
  and actual esbuild/npm execution passed in
  [run 38155686376](https://github.com/sfafsafgw43tg/fuzzy-bassoonAAAA/actions/runs/38155686376).
  These are NOT successful InkBrowser execution tests.
- The first source-build run was accepted by GitHub after the branch trigger
  was added, but remained queued with `runner_name: null`. It is superseded by
  the corrected toolchain-preflight revision. No native compilation started
  during that observation. See the PR comment for the latest run identifier.

The attempted cancellation of superseded build run `38155686407` returned
**403 Resource not accessible by integration**. A repository maintainer should
cancel that old queued run before starting the corrected revision on a builder.
Do not mistake either a queued run or the passing regression job for native
build evidence. Source requirements were checked directly against both pinned
versions of Chromium's `docs/windows_build_instructions.md`; the SDK directory
version was also checked against `build/vs_toolchain.py` at the primary pin.
