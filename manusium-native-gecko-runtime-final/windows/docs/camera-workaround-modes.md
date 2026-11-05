# Camera workaround modes

## Native mode

On Windows 11 build 22000 or newer, OctoSuite uses the native Media Foundation virtual-camera source. The frame publisher writes 1280x720 NV12 frames to the shared feed, `octo-cameractl.exe` registers the current-user virtual camera, and the launcher verifies `emulator -webcam-list` before starting the AVD.

This is the only mode that can provide the selected image as a real host camera to Android Camera2 and Chrome. A changed source image is republished without restarting the emulator.

## Windows 10 mode

Windows 10 does not provide `MFCreateVirtualCamera`. The bundled DirectShow filter is registered as a legacy video-input filter and uses the same NV12 publisher. This path is useful for applications that enumerate DirectShow filters, but the installed Android Emulator 37.2.12.0 returns an empty `-webcam-list` on this host. OctoSuite must therefore stop instead of passing a fabricated `webcam0`.

A user-mode Media Foundation wrapper DLL cannot bypass this limitation. It can implement a Media Foundation source, but it cannot create the PnP/AVStream camera device that the Windows 10 emulator backend needs. A signed kernel/AVStream virtual-camera driver or a Windows upgrade is required for native Camera2 on this host.

## Receiver mode

The existing vStudio/MJPEG server and `app.octo.avdcamera` APK provide an alternative stream that does not use emulator webcam enumeration:

```text
OctoSuite image or video
  -> MJPEG server
  -> ADB reverse tcp:8765
  -> Octo Camera Controller APK
```

This mode supports live source changes and is suitable for viewing or controlling the stream inside the receiver APK. It is not a system Camera2 provider, so Chrome and unrelated Android applications cannot select it as a camera.

## Custom emulator mode

The stock emulator has no command-line option for an MJPEG/WebSocket camera source. Making the stream visible to Chrome without a host webcam requires a modified emulator camera backend and a maintained custom emulator build. This is a separate product from the standard Android Studio emulator and cannot be achieved by changing the APK or launcher arguments.

## Launcher policy

OctoSuite uses these safety rules:

1. Native mode launches only after the emulator returns a real `webcamN` entry.
2. Receiver mode is explicitly labelled as an APK stream, not a Camera2 camera.
3. Auto mode may fall back from native mode to receiver mode, but it never claims that the receiver is a system camera.
4. The launcher never invents or forces `webcam0`.
