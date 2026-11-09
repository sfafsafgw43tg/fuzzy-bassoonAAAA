# OpenStream versus OctoSuite emulator camera input

## Executive summary

OpenStream and OctoSuite solve opposite media-routing problems. OpenStream turns an Android phone into a camera source for OBS Studio. OctoSuite must make the Android Emulator consume a Windows-hosted camera endpoint as `webcamN`, while allowing OctoSuite to change the producer image or video without restarting the emulator. Installing the OpenStream APK or OBS plugin alone cannot satisfy that requirement.

## Data-flow comparison

### OpenStream

```text
Android phone camera
  -> OpenStream Android app
  -> network transport (SRT/control discovery)
  -> OpenStream OBS plugin
  -> OBS source/mixer
```

The Android application is a capture producer. The OBS plugin is a receiver/source. The Android app does not implement an Android Emulator camera HAL, and the OBS plugin does not automatically register a Windows DirectShow webcam endpoint for an emulator to enumerate.

### OctoSuite

```text
OctoSuite Devices panel
  -> local MJPEG/WebSocket or media producer
  -> virtual-camera driver (Unity Capture, OBS Virtual Camera, or DirectShow filter)
  -> Windows camera enumeration
  -> Android Emulator webcamN
  -> Android CameraProvider / browser getUserMedia()
```

The emulator accepts the host endpoint only when its own `emulator -webcam-list` command enumerates it and the selected `webcamN` is passed to `-camera-front` or `-camera-back`. The endpoint must expose a normal camera format and remain open for the lifetime of the emulator camera session.

## Why a driver is required

A browser inside Android cannot consume an arbitrary HTTP URL as a camera. The Android Emulator's supported host-camera path is a host webcam device exposed through the emulator's camera bridge. Therefore the final adapter must be a Windows camera driver or DirectShow-compatible virtual filter. A local MJPEG server is useful as a producer/control plane, but it is not itself a webcam device.

OctoSuite now treats these as separate layers:

1. **Producer:** selected image, video, OBS scene, or physical webcam.
2. **Driver bridge:** Unity Capture, OBS Virtual Camera, or a generic DirectShow endpoint.
3. **Emulator mapping:** enumerated `webcamN` passed to the AVD.
4. **Guest consumer:** Android CameraProvider and the browser/application using the camera.

## Refactored driver-backed provider policy

The emulator launch path must use only these driver-backed provider identities:

| Provider | Driver/endpoint responsibility | Suitable for selected images? |
|---|---|---:|
| `unity-capture` | OctoSuite/vStudio producer publishes frames into Unity Capture | Yes |
| `obs` | OBS publishes its active scene through OBS Virtual Camera | Yes, after the scene is configured |
| `directshow` | A registered DirectShow virtual camera or physical camera | Depends on producer |

OpenStream is intentionally not a provider value in OctoSuite. It may be staged as an optional phone-to-OBS asset, but it is never passed as an emulator camera provider.

## Runtime safety rules

- Never pass an unverified or unenumerated endpoint to the emulator.
- Do not invent `webcam0` when the emulator reports no webcams; show the user the diagnostic state instead.
- Cold-boot host-camera launches when the emulator has stale camera state, and avoid saving stale webcam assignments into quick-boot snapshots.
- Keep front and back lens assignments independent; assigning the same host endpoint to both can crash some emulator camera providers.
- Verify the selected endpoint before claiming that the Android camera is live.
- Treat the local MJPEG/WebSocket service as a frame producer only; it cannot replace the Windows camera driver layer.

## Asset bootstrap policy

`windows/scripts/setup-openstream-camera.ps1` can stage a signed/checksummed OpenStream release asset for optional OBS/phone workflows. It refuses to install a plugin or APK when a SHA-256 checksum is unavailable or incorrect. The GitHub workflow runs in staging mode and publishes the verified assets as an artifact; it does not silently install software on a developer workstation.

For OctoSuite emulator image injection, use the existing driver path and the Devices-tab live-image controls. The selected image is sent continuously to the producer, and the producer remains attached to the virtual-camera driver while the AVD is running.
