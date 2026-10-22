# Android camera integration research

## Findings

The Android Emulator has two different camera paths that must not be conflated:

- `webcamN` is a host camera endpoint enumerated by the emulator. It depends on Windows capture permissions, DirectShow/Media Foundation, the virtual-camera driver, and a stream format the guest Camera HAL can negotiate.
- `emulated` is the emulator's software camera. It does not depend on host-camera enumeration and is the safest fallback when opening a host or virtual camera crashes the Android Camera provider. Android's documentation calls the interactive variant the **virtual scene camera**.

The app previously treated every non-`none` camera as a host webcam and explicitly rejected the software camera. That made the stable emulator camera unavailable in the UI and caused users to retry a failing host path.

## Implemented decision

The Android camera picker now exposes **Virtual scene (software camera)** independently for the front and back lenses. Selecting it writes `hw.camera.front=emulated` or `hw.camera.back=emulated`, persists the source type, and does not invoke host-camera testing. Host endpoints continue to require a validated `webcamN` endpoint. Unknown endpoints are never silently replaced with `webcam0`.

Host-camera limits remain conservative:

- an unmeasured host camera advertises 640x480;
- a measured host camera is capped at 1280x720;
- the software camera advertises the same safe 1280x720 ceiling;
- both active lenses use the lower common limit because Android exposes one pair of camera-size limits to applications.

The UI uses native labelled selects and status text. Camera testing remains opt-in, and the software camera choice never opens a host device. This avoids an accessibility and reliability problem where merely opening the settings panel could claim a camera device.

## GitHub projects reviewed

[Google's android-emulator-webrtc](https://github.com/google/android-emulator-webrtc) provides React components, WebSocket signaling, WebRTC video/audio transport, reconnection, and GPS updates for an emulator gateway. It is useful if Octo later needs remote emulator streaming, but it is not a Windows virtual-camera driver and does not solve Camera HAL negotiation.

[Google's android-emulator-container-scripts](https://github.com/google/android-emulator-container-scripts) provides Linux/Docker/KVM packaging and a WebRTC gateway. Its requirements and GPU/KVM assumptions make it unsuitable as a direct Windows AVD plugin. Its gateway architecture is a possible future reference for remote display/control, not for local camera injection.

ADB display/control tools are useful for device workflows, but they do not provide a host camera-to-Android Camera HAL bridge and should not be presented as a camera fix.

The Android Emulator source and hardware-property documentation confirm that valid camera values include `emulated`, `webcam<N>`, and `none`: [hardware-properties.ini](https://android.googlesource.com/platform/external/qemu/+/b5b78438ae9ff3b90aafdab0f4f25585affc22fb/android/avd/hardware-properties.ini) and [Android Emulator camera support](https://developer.android.com/studio/run/emulator-use-camera).

The current command-line documentation also requires the AVD name when using `-webcam-list`. Octo now probes host cameras with `@<AVD name> -webcam-list` for launch, media-check, repair, and device-update operations. The global picker keeps its legacy no-AVD form for older SDK tools, while a selected device always uses the named form: [Android Emulator command-line options](https://developer.android.com/studio/run/emulator-commandline).

## Operational limitation

No software change can guarantee that an arbitrary third-party Windows virtual-camera driver works in every emulator build. The driver must enumerate in `emulator -webcam-list`, return frames in a supported format, and not be held by another process. The new Virtual scene option is the deterministic path for camera-based Android testing when those host conditions are not met.
