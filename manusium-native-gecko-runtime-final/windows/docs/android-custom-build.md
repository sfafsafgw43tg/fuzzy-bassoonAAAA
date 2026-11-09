# Custom Android Build capability

## Capability levels

OctoSuite preserves **Level 1** local plan configuration and **Level 2** verified setup guidance and JSON/YAML export. It now also contains an optional authenticated **Level 3 development backend path** and a real Linux worker implementation. The Windows Electron process remains an orchestrator and is never treated as an AOSP worker.

The Devices tab enables remote submission controls only when the Electron main process has both `OCTO_BUILD_API_URL` and `OCTO_BUILD_API_TOKEN`. Without those values, local plans, guidance, and exports remain fully usable and no job is created.

Level 4 is not claimed unless a supported Linux worker passes capability checks, executes AOSP, produces an emulator archive, validates and stores it, and an authorized download is tested. See [android-build-platform.md](android-build-platform.md) for setup and exact blockers.

## Supported configuration

- Release manifest: `android-latest-release`.
- Architecture: `x86_64`.
- Target: `aosp_cf_x86_64_only_phone-aosp_current-userdebug` or `sdk_phone_x86_64`.
- Variant: `user`, `userdebug`, or `eng` where supported.

Plans are stored locally at `.octobrowser/custom-android-builds.json` with restrictive file permissions. A plan is not a job until an authenticated backend accepts it and persists a queue record.

## Guidance

```bash
repo init -u https://android.googlesource.com/platform/manifest -b android-latest-release
repo sync -j24
source build/envsetup.sh
lunch <selected-target>
m -j32
m emu_img_zip
```

These commands require a supported 64-bit Linux AOSP environment. On Windows, use a controlled WSL2 or Docker Linux environment, or an authenticated remote worker. The app never executes user-provided commands.

## Sources checked on 2026-10-19

- [AOSP build instructions](https://source.android.com/docs/setup/build/building)
- [AOSP setup requirements](https://source.android.com/docs/setup/start)
- [AOSP emulator images](https://source.android.com/docs/setup/create/avd)
