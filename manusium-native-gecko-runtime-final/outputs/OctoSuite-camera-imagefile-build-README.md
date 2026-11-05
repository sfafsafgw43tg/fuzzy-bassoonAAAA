# OctoSuite camera imagefile build

This build uses the Android Emulator's supported native camera source instead of a Windows PnP webcam. The default source is `imagefile:` and the script also supports `videofile:`.

## Start

```powershell
Set-Location 'D:\src\octosuite-github-sync\manusium-native-gecko-runtime-final\windows'
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\android\start-octo-camera-bridge.ps1 `
  -CameraSource imagefile `
  -CameraFile 'D:\src\octosuite-github-sync\manusium-native-gecko-runtime-final\.work\camera-test\chosen-photo-test.jpg'
```

For a video source:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\android\start-octo-camera-bridge.ps1 `
  -CameraSource videofile `
  -CameraFile 'C:\path\to\camera-video.mp4'
```

The script starts the MJPEG server, boots the AVD, waits for Android's package service, creates the ADB reverse tunnel, installs `app.octo.avdcamera`, and launches it.

## Receiver APK controls

The receiver UI includes a port field with Connect, Pause/Resume preview, and Fit contain/crop controls. These controls manage the receiver preview and connection only. The Android system Camera uses the emulator's native `imagefile:` or `videofile:` camera source selected by the startup script.

## Octo.su Devices tab

Open **Devices**, select a running Android device, and open **Camera & microphone**. The dialog now contains **Open Octo Camera Controller**. That action starts the local MJPEG endpoint if necessary, creates the ADB reverse tunnel, waits for Android's package service, installs/verifies `app.octo.avdcamera`, and foregrounds the receiver. The existing camera picker, photo/video controls, preview, refresh, repair, microphone test, and live-image playlist controls remain in the same dialog.

## Verified results

- TypeScript typecheck: passed.
- Focused Android camera tests: 24 passed.
- Browser build: passed.
- Native camera C++ build and staging: passed.
- Receiver APK Gradle build: passed.
- AVD with `imagefile:` camera source: 2 Camera2 devices reported.
- Android system Camera app: launched without the previous zero-device crash.
- Receiver APK: live frame delivery confirmed at counts 1, 30, and 60.
- Receiver controls APK build: passed and installed; live frame delivery confirmed after installation.

`webcam0` is intentionally not used. The Android Emulator's documented `imagefile:` and `videofile:` modes provide the system Camera2 path without requiring a Windows PnP camera.
