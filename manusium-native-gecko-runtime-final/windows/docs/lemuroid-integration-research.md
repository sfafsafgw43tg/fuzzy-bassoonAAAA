# Lemuroid integration assessment

## Result

Lemuroid cannot replace Android Studio's AVD backend. It is an Android application and Libretro frontend, not an Android operating-system emulator, AVD manager, Camera HAL, or Windows virtual-camera bridge.

The Lemuroid repository describes itself as an all-in-one emulator **on Android**. Its supported systems are console platforms such as NES, SNES, Game Boy, PlayStation, PSP, Nintendo DS, and Nintendo 3DS. Its features cover ROM scanning, save states, touch controls, gamepads, shaders, and cloud saves. It does not provide Android app installation, Android system images, ADB, Camera2/CameraX device emulation, WebRTC camera injection, or an AVD-compatible guest OS. [1]

Its underlying LibretroDroid library is an Android C++ frontend for Libretro cores. The documented features are graphics, audio, gamepad events, touch input, save-state serialization, shaders, and disk support. Those are console-emulation features, not an Android-device runtime. [2]

The F-Droid build confirms that Lemuroid is distributed as an Android APK for Android 6.0 or later. Its permissions include microphone recording, storage, network, notifications, and foreground services, but this does not make it a camera provider or virtual Android device. [3]

By contrast, an AVD contains a hardware profile, system image, storage, skin, and device properties. Android's official documentation explicitly defines camera choices as Emulated, VirtualScene, or Webcam. This is the layer that controls whether an Android app's Camera provider can open a software camera or a host camera. [4]

## Safe integration boundary

The truthful integration is to keep Android Studio/Android Emulator as the Android-device backend and optionally offer Lemuroid as an APK installed inside a selected AVD. That would be an **optional Android app**, not a new device backend. The app would need to be built or downloaded from a verifiable release, verified against a pinned checksum, installed through ADB, and launched with its package activity. It would still use the AVD's existing camera configuration.

Adding a fake “Lemuroid device” backend would be misleading and would not fix host or virtual-camera crashes. It would also create a security problem because users could believe they had a separate Android system when they only had a console-emulator application.

## Recommended implementation

Keep the existing AVD backend and expose the stable **Virtual scene (software camera)** mode for front and back lenses. If Lemuroid is wanted in the product, add a separate optional app catalog entry named **Lemuroid**, with source URL, version, architecture, checksum, license notice, install status, uninstall action, and launch action. Do not label it as an AVD alternative and do not grant it special camera privileges beyond normal Android permissions.

## References

[1]: https://github.com/Swordfish90/Lemuroid "Lemuroid GitHub repository and README"
[2]: https://github.com/Swordfish90/LibretroDroid "LibretroDroid GitHub repository and documented library features"
[3]: https://f-droid.org/en/packages/com.swordfish.lemuroid/ "Lemuroid F-Droid package listing and permissions"
[4]: https://developer.android.com/studio/run/managing-avds "Android Developers: Create and manage virtual devices"
