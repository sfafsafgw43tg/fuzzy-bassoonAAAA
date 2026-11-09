# Android Studio / AVD camera build review

## Result

The standalone Android camera diagnostic now has a reproducible build path. It includes a committed Gradle 8.7 wrapper, uses Android Gradle Plugin 8.6.1 for `compileSdk = 35`, and builds with JDK 17. A clean build completed successfully in Sandbox:

- `clean`
- `:app:assembleDebug`
- `:app:testDebugUnitTest`
- 42 Gradle tasks completed
- Debug APK produced at `android/avd-camera-check/app/build/outputs/apk/debug/app-debug.apk`

The host Octo Android Devices implementation also passed its focused suite earlier: 6 test files and 175 tests passed, and the Windows-side TypeScript typecheck passed.

This proves the Android artifact and host-side camera wiring compile and pass automated tests. It does **not** prove a Windows DirectShow provider or an Android Camera HAL is producing frames. That last step requires the Windows machine, Android Emulator, AVD, and a real virtual-camera driver.

## What was improved

### Reproducible standalone build

The diagnostic module now carries `gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`, and `gradle-wrapper.properties`. A separate Gradle installation is no longer required.

The build is aligned with the official AGP compatibility guidance: AGP 8.6 supports API level 35, requires Gradle 8.7, and requires JDK 17 [6].

Build on Windows:

```powershell
cd D:\src\windows\android\avd-camera-check
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest
```

Install and inspect the APK:

```powershell
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
adb shell pm grant app.octo.avdcamera android.permission.CAMERA
adb shell am start -n app.octo.avdcamera/.MainActivity
```

### Accessibility fixes

The diagnostic screen was previously reachable only through a hidden three-tap gesture. That is not discoverable or keyboard/TalkBack friendly. A visible **Open diagnostics** button is now available, while the legacy gesture remains supported.

The main camera status and selected-camera text now use polite accessibility live regions. Camera previews have an accessible label. The scanner status also announces state changes and its preview has a label.

These changes follow Android guidance to provide descriptions for controls, use readable contrast, and provide touch targets large enough for touch interaction [4]. They also align with WCAG 2.2 expectations for operable controls and target size [5].

### Camera pipeline review

The existing CameraX implementation is sound for a diagnostic stream:

- It binds by the exact Camera2 camera ID instead of assuming camera `0` or `1`.
- It uses `STRATEGY_KEEP_ONLY_LATEST`, which is appropriate when analysis must not block preview.
- It copies the YUV plane buffers before returning and closes every `ImageProxy`.
- It unbinds the provider and shuts down executors during lifecycle teardown.
- It performs bounded application-level retries instead of killing camera services.

These choices match the CameraX image-analysis contract: analyzers should process quickly, use a suitable backpressure strategy, and always release `ImageProxy` [3].

### AVD camera behavior

The host setup uses the emulator's own `-webcam-list` output and writes `hw.camera.back` and `hw.camera.front`. It cold-boots host-camera AVDs so a stale snapshot cannot preserve an old camera graph.

The official AVD documentation distinguishes **Webcam** from **Emulated** and **VirtualScene**: Webcam uses the development computer's camera, while the other options produce software-generated imagery [1]. The official emulator documentation separately describes advanced camera capabilities and virtual-scene workflows [2]. The project therefore does not treat VirtualScene as proof that a host virtual camera works.

## Windows acceptance test

Run the following after starting the real camera provider:

```powershell
$emulator = "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe"
& $emulator -webcam-list
```

The output must include the endpoint selected for the AVD, such as `webcam0`.

Configure and cold-boot the AVD:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\scripts\android\setup-avd-cameras.ps1 `
  -AvdName Pixel_8 `
  -BackCamera webcam0 `
  -FrontCamera none `
  -Launch
```

Then verify the guest camera:

```powershell
adb wait-for-device
adb shell pm grant app.octo.avdcamera android.permission.CAMERA
adb shell am start -n app.octo.avdcamera/.MainActivity
adb shell dumpsys media.camera
adb logcat -d -s AvdCamera:D CameraService:D cameraserver:D '*:S'
```

The setup is successful only when the diagnostic app reports an active preview and a current frame, not merely when `config.ini` contains `webcam0`.

## Prompt-engineered build contract

Use this as the repeatable implementation and verification prompt for future Android camera changes:

> **Role:** Senior Android/Windows integration engineer and accessibility reviewer.
>
> **Task:** Modify only the Octo Android Devices and `android/avd-camera-check` code needed to make a real Android Studio AVD consume a host camera or virtual DirectShow camera.
>
> **Required behavior:**
> 1. Enumerate cameras from the selected emulator's `-webcam-list`; never infer camera numbers from Windows order.
> 2. Write `hw.camera.back` and `hw.camera.front` to the stopped AVD's `config.ini`.
> 3. Never assign one endpoint to both lenses.
> 4. Cold-boot host-camera launches and pass matching `-camera-back` / `-camera-front` flags.
> 5. Require a live Camera2/CameraX frame before reporting the camera as active.
> 6. Keep `ImageAnalysis` non-blocking, close every `ImageProxy`, and release lifecycle resources.
> 7. Keep diagnostics keyboard accessible, TalkBack discoverable, labelled, and announced through live status updates.
> 8. Do not fabricate cameras, modify SELinux, kill camera services, or claim host-camera success from configuration alone.
>
> **Verification contract:** Run the Android Gradle wrapper build, Android unit tests, host TypeScript tests, and typecheck. On Windows, run `-webcam-list`, cold-boot a real AVD, install the APK, and verify a live preview plus `dumpsys media.camera` output. Report unavailable hardware validation explicitly.
>
> **Output:** Summarize changed files, test commands, artifacts, remaining environment-dependent checks, and any accessibility or security findings.

## Code-review verdict

**Verdict: Approve with environment-dependent integration testing still required.**

### Critical issues

None found in the reviewed change set.

### Major issues

1. **Windows Camera HAL validation remains pending.** The Sandbox cannot enumerate DirectShow devices or boot the user's Windows AVD. This is an infrastructure limitation, not a source-test failure.
2. **A virtual-camera provider remains an external prerequisite.** OBS Virtual Camera, Unity Capture/vStudio, or another DirectShow provider must publish a real camera endpoint before the emulator can enumerate it. The project correctly refuses to invent one.

### Minor issues

1. The build uses CameraX 1.3.4. It is stable and passed the build, but a future maintenance pass should evaluate a current CameraX release together with the project's minimum Android API.
2. The diagnostic activity uses Views/XML rather than Compose. This is not a defect; the existing implementation is small and now has explicit accessibility semantics.

### Positive findings

- Camera IDs are treated as opaque values.
- Endpoint assignment is explicit and validated.
- Preview readiness is based on actual streaming state.
- Recovery is bounded and non-destructive.
- Camera buffers are detached before being delivered to application code.
- The diagnostic screen is internal and does not expose an exported ADB activity.
- The build is now reproducible without a globally installed Gradle.

## References

[1]: https://developer.android.com/studio/run/managing-avds "Create and manage virtual devices"
[2]: https://developer.android.com/studio/run/emulator-use-camera "Camera support in the Android Emulator"
[3]: https://developer.android.com/media/camera/camerax/analyze "CameraX image analysis"
[4]: https://developer.android.com/guide/topics/ui/accessibility/apps "Make Android apps more accessible"
[5]: https://www.w3.org/TR/WCAG22/ "Web Content Accessibility Guidelines 2.2"
[6]: https://developer.android.com/build/releases/agp-8-6-0-release-notes "Android Gradle Plugin 8.6.0 compatibility"
