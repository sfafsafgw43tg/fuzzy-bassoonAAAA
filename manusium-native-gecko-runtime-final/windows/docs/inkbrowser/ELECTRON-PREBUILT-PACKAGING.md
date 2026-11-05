# Prebuilt Electron/Chromium packaging

Electron's official documentation says a manual Windows distribution can use downloaded prebuilt binaries. The application must be placed under `resources/app` with `package.json`, the app main file, and its assets; the Electron directory containing `electron.exe` and `resources` is the runnable distribution. The same documentation states that the Windows executable may be renamed and its icon/metadata edited.

This repository's normal source installer now follows that layout under `release/<app>/win-unpacked/` and does not invoke `electron-builder`.

Electron's installation documentation states that the npm package contains the JavaScript API but downloads the platform Electron binary through its install step. It documents `npx install-electron --no` as the on-demand repair path, and says the binary is required for an Electron app to run.

The dependency setup therefore runs the Electron install script explicitly after npm installs with scripts disabled, verifies `path.txt` and the platform binary, and records the dependency stamp only after that verification succeeds.

References:

- https://electronjs.org/docs/latest/tutorial/application-distribution — official manual prebuilt-binary layout and Windows rebranding guidance.
- https://electronjs.org/docs/latest/tutorial/installation — official prebuilt binary download/install behavior and cache/mirror guidance.
- https://electronjs.org/docs/latest/api/command-line-switches — official Electron command-line and logging guidance.
