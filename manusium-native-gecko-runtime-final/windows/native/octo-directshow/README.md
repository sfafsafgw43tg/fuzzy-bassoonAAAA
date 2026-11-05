# Octo DirectShow camera fallback

This target provides the Windows 10 fallback for Octo Camera. It is a DirectShow source filter registered under the Video Input Device category and is used when `MFCreateVirtualCamera` is unavailable. The filter exposes a stable 1280x720, 30 FPS RGB24 capture stream and converts frames from Octo Camera Studio's versioned NV12 shared-memory feed.

The implementation vendors the MIT-licensed DirectShow Base Classes and the MIT-licensed Softcam source-filter pattern. See `SOFTCAM-LICENSE` for the upstream license. Octo's `feed_protocol.h` remains the single producer/consumer contract, so Camera Studio does not need a second output format.

The normal control utility first attempts the Media Foundation camera on Windows 11. If that API is unavailable and the DirectShow DLL is present, it registers the DirectShow filter instead. Legacy DirectShow registration can require administrator approval because Windows stores capture-filter registration system-wide; the UI surfaces the native HRESULT if Windows denies elevation.

Build on Windows with Visual Studio 2022 Desktop development with C++, a Windows SDK, CMake, and the repository command:

```powershell
npm run check:native-camera
npm run build:native-camera
```

The staged files are `resources/native-camera/octo-camera-source.dll`, `resources/native-camera/octo-cameractl.exe`, `resources/native-camera/octo-camera-feed-publisher.exe`, and `resources/native-camera/octo-directshow-camera.dll`.

## Windows 10 launch

Windows 10 has no `MFCreateVirtualCamera`. OctoSuite therefore registers this filter under the DirectShow video-input category and uses the same shared NV12 publisher as the Media Foundation backend. The integrated launcher performs the registration, asks the emulator for its real webcam list, and passes the first reported `webcamN` to the back camera:

```powershell
.\windows\scripts\android\start-octo-camera-bridge.ps1 `
  -Avd 'Your-AVD' `
  -CameraFile 'C:\path\selected.jpg' `
  -NativeVirtualCamera `
  -InstallNativeCamera
```

The launcher stops if the emulator reports no webcam. It never invents `webcam0`, because doing so is the cause of the Android Camera crash observed with an unenumerated virtual endpoint. A DirectShow filter can still be visible to FFmpeg or OBS while not being accepted by a particular emulator build; in that case the emulator itself must be upgraded or a signed Media Foundation/PnP driver must be installed.
