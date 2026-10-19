# Custom Android Build capability

## Capability level

OctoSuite implements **Level 2: configuration plus setup guidance**.

The Devices tab can validate, save, edit, and delete local AOSP build plans. It can also copy the setup commands for the selected target and open the official AOSP build documentation. It does not submit a job, run a remote worker, create artifacts, or claim that a build has completed.

There is no AOSP build queue, authenticated build backend, Linux worker, artifact store, or validated artifact download path in this repository. A Windows Electron process cannot be treated as an AOSP build worker.

## Supported configuration

The current UI intentionally supports only the following verified values:

- Release manifest: `android-latest-release`.
- Architecture: `x86_64`.
- Target: `aosp_cf_x86_64_only_phone-aosp_current-userdebug` or `sdk_phone_x86_64`.
- Variant: `user`, `userdebug`, or `eng`.

A saved plan is stored locally at `.octobrowser/custom-android-builds.json` with restrictive file permissions. It is a plan, not a submitted job.

## Guidance

The copied guidance is:

```bash
repo init -u https://android.googlesource.com/platform/manifest -b android-latest-release
repo sync -j24
source build/envsetup.sh
lunch <selected-target>
m -j32
m emu_img_zip
```

Run these commands on a supported 64-bit Linux AOSP workstation. The final `emu_img_zip` output must be validated and then installed through the Android SDK before it can be used as a custom emulator image.

## Sources checked on 2026-10-19

- [AOSP build instructions](https://source.android.com/docs/setup/build/building): `android-latest-release`, `envsetup.sh`, `lunch`, build variants, `m`, and target selection.
- [AOSP setup requirements](https://source.android.com/docs/setup/start): 64-bit x86 Linux, glibc 2.17+, 400 GB free disk space, 64 GB RAM, required packages, Git, OpenJDK, Python 3, and Repo.
- [AOSP emulator images](https://source.android.com/docs/setup/create/avd): AVD system-image workflow, x86_64 image examples, and `emu_img_zip` packaging.

The guidance deliberately does not promise that the current Windows host can compile AOSP or that saving a plan creates an Android image.
