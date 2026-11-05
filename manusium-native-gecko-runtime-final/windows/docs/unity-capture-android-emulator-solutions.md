# Unity Capture to Android Emulator: viable solutions

## Finding

The current OctoSuite MJPEG and ADB receiver path is working, but it is not a native Android camera. The receiver APK can display frames, while Chrome and Android Camera2 require the emulator's host-camera bridge.

The key compatibility problem is the Windows camera backend. Android Emulator release documentation says that Windows webcam capture uses Media Foundation and is limited to up to 720p/30 FPS. Unity Capture describes itself as a Windows DirectShow filter. A DirectShow filter can be visible to applications such as OBS or FFmpeg while still being absent from the emulator's Media Foundation enumeration. This matches the observed state: the receiver preview works, but `emulator -webcam-list` is empty.

## Solution comparison

### 1. Unity Capture directly into the stock Windows Emulator

This is not a reliable solution on the affected Windows 10 host. Registering the Unity Capture DLL, changing registry entries, or inventing `webcam0` cannot convert a DirectShow filter into a Media Foundation virtual camera. The emulator must list the endpoint itself before `-camera-back webcam0` is valid.

### 2. Unity Capture -> OBS -> OBS Virtual Camera

This is worth testing as a compatibility bridge, but it is not guaranteed. OBS can consume Unity Capture and publish a second virtual-camera endpoint. However, current Google issue 420844429 contains reports that OBS Virtual Camera is visible to Teams and other applications but not to the Windows Emulator. Therefore this route should be implemented as an automatic probe, not presented as guaranteed success.

Test order:

```powershell
ffmpeg -hide_banner -f dshow -list_devices true -i nul 2>&1
emulator.exe @AVD_NAME -webcam-list
```

If OBS Virtual Camera appears in the emulator list, launch with the enumerated name and keep front camera disabled:

```powershell
emulator.exe @AVD_NAME -camera-back webcam0 -camera-front none -no-snapshot-load -no-snapshot-save
```

### 3. A Windows Media Foundation/PnP virtual-camera driver

This is the correct native solution. The producer should receive OctoSuite frames, and a virtual-camera driver should expose a normal Windows camera with Media Foundation support and standard formats such as NV12 or YUY2. The emulator can then enumerate it and Android Camera2 can consume it.

The `MFCreateVirtualCamera` API is not available on the existing Windows 10 host, so an implementation based only on that API cannot work there. A compatible signed third-party driver or a kernel/PnP virtual-camera implementation is required. This is a driver-installation problem, not an APK problem.

### 4. Modify the emulator to consume MJPEG directly

A custom emulator build could add an HTTP/MJPEG camera source and bypass Windows camera enumeration. The stock Android Emulator does not expose such a configuration. This route is technically possible but is a fork of the emulator, not an OctoSuite-side integration, and is not suitable for a normal Android Studio installation.

### 5. Native emulator imagefile or virtual-scene camera

`imagefile:` and the Virtual Scene image importer are reliable for static images and do not depend on a Windows camera driver. They are not a continuous live webcam source and cannot provide arbitrary no-restart image updates to Chrome's Camera2 input.

## Decision

The safe implementation must have two explicit modes:

1. **Native host camera mode:** probe `emulator -webcam-list`; launch `webcamN` only when the emulator reports it. Unity Capture and OBS must not be labelled as working merely because DirectShow or the APK preview sees them.
2. **Live receiver mode:** use the existing vStudio MJPEG/ADB receiver, clearly labelled as an APK preview and not as a system Camera2 source.

For the requested Chrome/Camera2 result, the next real fix is a Media Foundation/PnP-compatible virtual-camera driver, or a host upgrade/driver package that provides one. The current Unity Capture DirectShow DLL cannot be made reliable for this emulator by registry repair alone.

## Sources

[1]: https://developer.android.com/studio/releases/emulator "Android Emulator release notes"
[2]: https://developer.android.com/studio/run/emulator-use-camera "Android camera support documentation"
[3]: https://github.com/schellingb/UnityCapture "Unity Capture official repository"
[4]: https://issuetracker.google.com/issues/420844429 "Google issue: virtual cameras not recognized by Android Emulator on Windows"
[5]: https://github.com/miaulightouch/obs-virtual-cam "OBS virtual camera implementation referenced by the Google issue"
