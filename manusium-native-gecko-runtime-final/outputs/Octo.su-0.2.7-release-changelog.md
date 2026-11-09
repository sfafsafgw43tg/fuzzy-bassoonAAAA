# Octo.su 0.2.7 — Rooted Android and Liquid Glass update

## Highlights

### Android 16 rooted devices

- Added support for AOSP/userdebug Android 16 devices using API 36 images.
- Rooted builds now require live ADB verification instead of relying on a requested-build flag.
- Added a visible `ROOTED DEVICE` status line and rooted device badge.
- Added a dedicated **Root Checker** action in the Android device menu.
- Root Checker runs `adb root` followed by `adb shell id` and reports whether the device actually returns `uid=0(root)`.
- Advanced rooted installation supports custom Magisk/SuperSU module staging and hardware/identity customization.

### Android camera integration

- Webcam0 remains available as an explicit camera choice even when the emulator reports an incomplete camera list during startup.
- Camera configuration uses the Android emulator camera choices without the removed legacy provider path.
- Removed the redundant virtual-camera startup prompt from the launch flow.
- Updated the camera helper to support Unity Capture, OBS, and DirectShow diagnostic modes without the legacy integration.

### Liquid Glass interface

- Added a responsive Liquid Glass effect to the launcher.
- Added a Settings toggle to enable or disable the effect.
- Added a configurable blur intensity slider from 0–32px.
- Tuned dark mode with smoke-tinted transparency for improved text contrast.
- Preserved keyboard focus, readable status text, and existing launcher contrast behavior.

### Legacy integration removal

- Removed `LensioCam.apk` and `LensioStudio.exe` from the Windows resources.
- Removed remaining Lensio provider, UI, documentation, and helper-script references.
- Verified that the final local ZIP contains no Lensio entries.

## Verification

- TypeScript typecheck: passed.
- Full Vitest suite: **1,042 passed, 6 skipped**.
- PowerShell camera helper syntax: passed.
- Final local Electron app package: built successfully.
- ZIP inspection: 100 entries, 3 executables, no Lensio entries.

## Packaging note

The strict native-Chromium packaging gate still requires the pinned source-built InkBrowser runtime at `resources/engines/chromium/155.0.8059.39/`. The runtime must include its verified `runtime.json`, `inkbrowser-chrome.exe`, required Chromium DLL/Pak files, and a matching SHA-256. The current source checkout does not contain that runtime, so the local app package was built with the native-runtime verification gate skipped. This does not alter the application code; it only means the native Chromium payload must be staged before producing a release-complete package.

## Commit

`d2109f7` — `feat: finalize rooted Android integration`

Branch: `arena/c10966b9-fuzzy-bassoonaaaa`


## Live AVD verification

The `OctoRoot-Android16` AVD was launched and verified live on Windows. It booted as Android 16/API 36 with `ro.build.type=userdebug` and `ro.debuggable=1`. `adb root` returned `restarting adbd as root`, and `adb shell id` returned `uid=0(root)`. The emulator also enumerated the host camera as `webcam0` (`Iriun Webcam`, YUY2). The Android Studio integration regression checks passed with 109 tests passing.


## Rooted creator IPC fix — 2026-11-09

### Problem

The Devices-tab creator visibly allowed **Rooted build**, but the `mgr:android-create-spec` IPC handler did not forward the rooted flag to `createAndroidAvdFromSpec`. New devices were therefore written with `octobrowser.rooted=0`, even when the user selected Rooted.

### Fix

- Forwarded `rooted: true` from the renderer creator through the manager IPC handler.
- Forwarded Magisk/SuperSU module paths, manager selection, and stage/boot installation mode.
- Preserved the backend guard requiring an AOSP `default` system image for rooted builds.
- Kept root status truthful: `ROOTED DEVICE` is shown only after `adb root` followed by `adb shell id` returns `uid=0(root)`.
- Added a regression assertion covering the complete renderer → manager → AVD backend handoff.

### Verification

- Full Windows regression suite: **1,043 passed, 6 skipped**.
- Test files: **105 passed, 1 skipped**.
- TypeScript typecheck: passed.
- Focused Android creator/AVD/root suite: **147 passed**.
- Fixed package: `Octo.su-0.2.7-rooted-fix-win-x64.zip`.
- ZIP inspection: **100 entries**, `Octo.su.exe` present, `resources/app.asar` present, native-camera payload present.
- Root checker implementation is packaged inside `resources/app.asar` as application code; it is not a separate binary.

### User action after updating

Existing devices created with the broken build retain `octobrowser.rooted=0`. Delete and recreate the device using **Rooted build** and an installed AOSP `default` image, then use **Root Checker** after launch.

### Commit

`c220c2a` — `fix: forward rooted Android creator mode`


## Complete rooted device creation hardening — 2026-11-09

Rooted creation now performs a real verification during the quiet first boot instead of waiting until a later manual launch. The emulator is allowed to finish booting, Octo.su runs `adb root`, checks `adb shell id`, and persists `octobrowser.rootVerified=1` only when the result contains `uid=0(root)`. The configuration file is updated only after the emulator has shut down, avoiding a live AVD/config race. Failed verification is reported in the creation progress message and remains visibly unverified.

The complete lifecycle was tested with a temporary AOSP device using `system-images;android-35;default;x86_64`. It booted on `emulator-5554`; `adb root` returned `restarting adbd as root`, and `adb shell id` returned `uid=0(root)` with `context=u:r:su:s0`. The temporary AVD was deleted after verification.

The final hardened build passed **1,044 tests**, with **6 skipped**, across **105 passing test files** and **1 skipped test file**. The focused rooted lifecycle suite passed **158 tests**. The distributable is `Octo.su-0.2.7-rooted-complete-win-x64.zip`, containing `Octo.su.exe` and `resources/app.asar`.

The SDK test also exposed a local Android SDK warning: `cmdline-tools;latest` has a package manifest identifying `latest-2`. The successful end-to-end test used the actual `latest-2` tool path. Octo.su should use the SDK tool path selected by its discovery layer rather than assuming the directory name is authoritative.
