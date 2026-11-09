

## Octo Camera Controller workflow

The APK now launches `ControllerActivity`, which lets the user choose a photo or video directly inside the emulator. The selected media is copied to the app-private `files/selected-media` file and described by `files/selection.json`.

OctoSuite retrieves the selection using the debug APK's `adb exec-out run-as` channel, then restarts the AVD with the native `imagefile:` or `videofile:` camera argument. A normal APK cannot replace the global Camera2 HAL while the emulator is already running, so changing the selected source intentionally requires an AVD restart.

Build and install from Windows:

```powershell
.\gradlew.bat :app:assembleDebug --no-daemon
.\windows\scripts\android\install-octo-camera-controller.ps1
.\windows\scripts\android\sync-octo-camera-selection.ps1
.\windows\scripts\android\restart-avd-with-octo-camera.ps1 -AvdName Google-Pixel-9
```

The packaged Octo.su bundle includes `resources/octo-camera/OctoCameraController.apk`.
