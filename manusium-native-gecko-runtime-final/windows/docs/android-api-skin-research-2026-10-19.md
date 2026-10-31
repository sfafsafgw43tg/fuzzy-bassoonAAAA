# Android API and AVD skin research

- Android's official platform release page lists Android 16 as API 36. Source: https://developer.android.com/tools/releases/platforms
- Android's official AVD documentation says system images are installed through SDK Manager, the API level is part of the system image selection, and emulator skins can be predefined or custom. Source: https://developer.android.com/studio/run/managing-avds
- Official SDK Manager documentation describes installing packages such as `platforms;android-36` and system images through SDK tools, while noting the newer Android CLI is replacing the deprecated `sdkmanager`. Source: https://developer.android.com/tools/sdkmanager
- Android 17 was not listed as a stable API in the official release table when checked on 2026-10-19. The implementation must therefore expose API 37 only when the local SDK reports a real available package, rather than fabricating an Android 17 package.
- Custom skins are local filesystem definitions. A skin must be validated as a real emulator skin directory/archive before being written to an AVD `skin.path` setting.
