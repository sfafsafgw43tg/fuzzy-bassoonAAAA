# InkBrowser native Chromium handoff

The supplied `InkBrowser-source-handoff.zip` is integrated as a **developer/CI-only** patch bundle.
It contains the native Chromium patch series for Chromium `155.0.8059.39`, but it does not contain
Chromium source, Visual Studio, the Windows SDK, or a compiled browser executable.

## Normal users

The normal Windows installer does **not** install Visual Studio, depot_tools, the Windows SDK, or
Chromium source. It must consume only a verified runtime produced by the Windows release workflow.
If a release does not contain a verified runtime, packaging must fail instead of silently compiling
or claiming that native Chromium is available.

## Windows build machine

The configured self-hosted runner must already have:

- Windows 10/11 x64;
- Visual Studio Build Tools and the Windows SDK required by the pinned Chromium checkout;
- Python and depot_tools (`fetch`, `gclient`, `gn`, `autoninja`);
- at least 300 GB free on `OCTO_CHROMIUM_SOURCE` (the source and output are large);
- a persistent source path on the large build drive.

Run from `windows`:

```powershell
npm ci
npm run check:chromium-patches
npm run build:chromium:windows
npm run verify:chromium:windows
npm run dist:browser
npm run verify:chromium:packaged
npm run installer
```

The build script performs this sequence:

1. checks out the pinned Chromium tag and synchronizes dependencies;
2. applies the 35 patches in `tools/inkbrowser/source/patches/series` using `git apply` with
   shell-disabled argument passing;
3. records an idempotency marker in the source checkout;
4. applies InkBrowser branding after the handoff branding patch;
5. runs GN with `tools/inkbrowser/gn/release.gn` and builds the `chrome` target;
6. stages and verifies `inkbrowser-chrome.exe`, its runtime payload, icon, manifest, and hashes.

A second run reuses the patch marker when the exact patch-series digest is unchanged. A changed or
malformed marker fails closed; it does not delete the checkout or silently apply a new series over
an unknown tree.

## What is and is not verified here

The repository tests can verify patch ordering, bundle completeness, digest generation, and exact
Git argument construction. Only the Windows runner can verify patch application against Chromium,
GN generation, compilation, Windows inherited-handle behavior, executable launch, GPU behavior, and
clean-machine installation. Linux tests must not be reported as proof of those Windows properties.

The handoff currently uses internal `fury` patch namespaces. Those names are retained inside the
native patch implementation until a compatibility-tested namespace migration is completed; the
built product and user-visible branding are InkBrowser.
