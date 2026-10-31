# Octo DirectShow camera fallback

This target provides the Windows 10 fallback for Octo Camera. It is a DirectShow source filter registered under the Video Input Device category and is used when `MFCreateVirtualCamera` is unavailable. The filter exposes a stable 1280x720, 30 FPS RGB24 capture stream and converts frames from Octo Camera Studio's versioned NV12 shared-memory feed.

The implementation vendors the MIT-licensed DirectShow Base Classes and the MIT-licensed Softcam source-filter pattern. See `SOFTCAM-LICENSE` for the upstream license. Octo's `feed_protocol.h` remains the single producer/consumer contract, so Camera Studio does not need a second output format.

The normal control utility first attempts the Media Foundation camera on Windows 11. If that API is unavailable and the DirectShow DLL is present, it registers the DirectShow filter instead. Legacy DirectShow registration can require administrator approval because Windows stores capture-filter registration system-wide; the UI surfaces the native HRESULT if Windows denies elevation.

Build on Windows with Visual Studio 2022 Desktop development with C++, a Windows SDK, CMake, and the repository command:

```powershell
npm run check:native-camera
npm run build:native-camera
```

The staged files are `resources/native-camera/octo-camera-source.dll`, `resources/native-camera/octo-cameractl.exe`, and `resources/native-camera/octo-directshow-camera.dll`.
