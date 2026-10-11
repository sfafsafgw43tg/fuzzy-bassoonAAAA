# Android webcam0 on both facings

These controls belong to the OctoBrowser Android device manager, not Octo Compact.
They configure the Android Emulator's AVD files; they are not a Windows device-disable switch.

## In the updated device manager

1. Stop the AVD if it is running.
2. Open its camera settings and choose **Use webcam0 for front and back**.
3. Leave **Test cameras in Octo (uses the webcam temporarily)** unchecked.
4. Save, then cold-start the AVD (including when starting it from Android Studio).

The saved `config.ini` contains:

```ini
hw.camera.front=webcam0
hw.camera.back=webcam0
```

Octo's launch arguments preserve the same two endpoints. An empty or failed emulator
camera enumeration no longer clears an explicitly configured endpoint. This does
**not** prove that webcam0 exists or produces frames. Manual/unlisted and shared
endpoint warnings remain visible. Drivers may refuse simultaneous front/back
capture; using one facing at a time or separate physical webcams may be necessary.

**Off** is a real per-facing choice. **Turn both Android cameras off** persists
`hw.camera.front=none` and `hw.camera.back=none`; a later scan or launch does not
reactivate them. Save and cold-start for these guest changes too.

## Giving Android the camera

Host testing defaults to off each renderer session. Turning it off, using the
webcam0 preset, or closing the picker cancels this manager's pending tests and stops
its owned media tracks. If an unabortable camera permission/driver request returns
later, that stream is stopped on arrival. Old queued tests cannot resume after an
off/on cycle. Refresh while testing is off reads camera metadata, not live video.

This affects Octo's camera **tests**, not Windows camera enablement or other apps.
Close Windows Camera, conferencing software, other browser camera tabs and other
emulator instances if they are holding the device. Do not disable the Windows
camera device: Android needs that device enabled too. OS-wide exclusive access
cannot be guaranteed here.

## Validation boundaries

- Unit tests cover shared/manual mappings, persistent Off, real temporary AVD
  config/metadata save-read-launch resolution, capture ownership and late streams.
- `e2e/android-camera-controls.spec.ts` exercises the production picker in a real
  Electron window using controlled enumeration and media responses, including
  zero enumerated cameras, no capture by default, cancellation and panel removal.
- `.github/workflows/android-camera-controls.yml` runs these on Windows.
- The UI fixture is **not** a physical webcam/Android guest test. Actual guest
  frames, driver compatibility and installation of a new release require separate
  Windows hardware/release verification; this patch does not establish them.
