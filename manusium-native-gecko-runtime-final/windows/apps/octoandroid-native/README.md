# Octo Android Manager — Native Windows

This is the standalone native Windows Android emulator manager. It does not use Electron or the Octo.su browser runtime.

## Features

- Enumerates Android Studio AVDs through `emulator.exe -list-avds`.
- Creates AVDs through `avdmanager` and installed system images.
- Classic, Rooted Android 36, and Custom system-image presets.
- Starts emulators with `webcam0` mapped to front and back cameras.
- Stops running emulators through ADB emulator console.
- Runs a live root check using `adb root` and `adb shell id`.
- Opens the selected AVD folder in Windows Explorer.
- Deletes AVDs through `avdmanager delete avd`.
- Opens Android Studio when installed in a standard Windows location.

## Build

From a Visual Studio Developer PowerShell:

```powershell
cmake -S . -B build -G "Visual Studio 18 2026" -A x64
cmake --build build --config Release
```

The executable is written to `build/Release/OctoAndroidManager.exe`.

The manager resolves the SDK from `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or `%LOCALAPPDATA%\Android\Sdk`.
