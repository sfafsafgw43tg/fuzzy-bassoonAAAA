# Genymotion Desktop integration

Octo now treats Genymotion Desktop as an optional, local secondary Android backend. The integration uses the official `gmtool.exe` command-line interface and never handles Genymotion credentials or license activation.

## Supported from Devices

- Detect the Genymotion Desktop and GMTool installation.
- Enumerate installed devices using `gmtool admin list --json`, with a text-output fallback.
- Display running/stopped state, model, Android version, IP address, and an ADB endpoint when available.
- Enumerate installed hardware profiles and Android images.
- Create a device through `gmtool admin create` with the selected profile, image, and validated name.
- Start, stop, factory-reset, and delete devices through GMTool.
- Open Genymotion Desktop directly.

## Camera behavior

Genymotion's supported host-camera and media-injection features remain controlled by Genymotion Desktop. Octo reports this honestly in the UI. A physical UVC webcam or Genymotion media injection may work depending on the installed edition and host configuration. Genymotion Desktop 3.10+ adds experimental OBS Virtual Camera support on Windows. It must be configured in OBS at 1280×720, started, and then mapped to the front or back camera in Genymotion's Media Injection widget. Octo does not claim that every virtual-camera driver is supported.

The Devices page now reports the installed Genymotion version, the fixed 1280×720 camera limit, and whether the version is new enough for the experimental OBS path. It also opens Genymotion's media folder so image and video inputs can be prepared without guessing the path. Genymotion's Media Injection widget is still required for selecting the active front/back source; the official GMTool interface does not currently expose that mapping.

The stable Android Studio AVD `Virtual scene` option remains the recommended software-camera path when a deterministic camera is needed without a host camera endpoint.

## References

- https://docs.genymotion.com/tools/desktop/gmtool/
- https://docs.genymotion.com/features/media_injection/
- https://docs.genymotion.com/usage/desktop/vd_settings/
- https://docs.genymotion.com/changelog/desktop/3_x/
