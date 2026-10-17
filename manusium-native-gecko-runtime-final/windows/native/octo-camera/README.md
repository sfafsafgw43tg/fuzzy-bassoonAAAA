# Octo Camera native source

This directory contains the Windows Media Foundation virtual-camera source used by Octo Suite.

## Supported target

- Windows 11 build 22000 or newer for the Media Foundation virtual-camera registration API.
- Visual Studio 2022 with **Desktop development with C++**.
- Windows 10 SDK 10.0.22621 or newer.
- Media Foundation SDK libraries shipped with the Windows SDK.

The project uses a **current-user** virtual camera by default. This avoids an administrator prompt and keeps registration scoped to the account running Octo Suite. System-wide registration is intentionally a separate explicit option.

## Build

From a Visual Studio Developer PowerShell:

```powershell
cmake -S native/octo-camera -B native/octo-camera/build -A x64
cmake --build native/octo-camera/build --config Release
```

The build produces:

- `octo-camera-source.dll`: the COM custom media source loaded by the Windows frame-server pipeline.
- `octo-cameractl.exe`: register, unregister, and inspect the Octo Camera registration.

Register for the current user:

```powershell
.\octo-cameractl.exe install --source .\octo-camera-source.dll
```

Remove it:

```powershell
.\octo-cameractl.exe uninstall
```

The camera is published as `Octo Camera (Windows Virtual Camera)` by Windows. The source advertises NV12 at 1920x1080 and 1280x720, both at 30 fps. The source is request-driven and never returns a borrowed buffer: every sample owns its byte storage.

## Feed contract

The source reads the latest frame from the named mapping `Local\\OctoSuite.VirtualCamera.NV12.v1`. The mapping layout is defined in `feed_protocol.h`:

1. A fixed header with magic, version, dimensions, stride, frame byte count, sequence and 100-ns timestamp.
2. One tightly packed NV12 frame immediately after the header.

When the mapping is absent or contains an invalid frame, the source returns a black NV12 frame at the negotiated size. This keeps camera clients alive while the producer starts and prevents the Android CameraProvider crash caused by malformed or changing dimensions. The producer must publish only 1280x720 or 1920x1080 NV12 frames and should update the header and payload under the sequence-lock protocol described in the header.

## Windows 10 note

`MFCreateVirtualCamera` is a Windows 11 API. This project does not pretend to provide a Windows 10 implementation through that API. A separate DirectShow filter would be required for Windows 10 and is not included in this phase.

## References

- [MFCreateVirtualCamera](https://learn.microsoft.com/en-us/windows/win32/api/mfvirtualcamera/nf-mfvirtualcamera-mfcreatevirtualcamera)
- [IMFVirtualCamera](https://learn.microsoft.com/en-us/windows/win32/api/mfvirtualcamera/nn-mfvirtualcamera-imfvirtualcamera)
- [Frame Server Custom Media Source](https://learn.microsoft.com/en-us/windows-hardware/drivers/stream/frame-server-custom-media-source)
