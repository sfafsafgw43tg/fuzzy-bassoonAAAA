# Input, GPU, and Android camera research

## Input simulation

Electron's official [`webContents`](https://electronjs.org/docs/latest/api/web-contents) API documents `contents.insertText(text)` as inserting text into the focused element. The project already has an isolated `octo:smart-paste-to-focused` preload channel that types normalized clipboard text through the page's focused control. Input Simulation now uses Electron's main-process `clipboard.readText()` and that existing trusted channel instead of dispatching a literal `u` key sequence.

## WebGL and WebGPU

Electron's [offscreen-rendering documentation](https://electronjs.org/docs/latest/tutorial/offscreen-rendering) states that GPU-accelerated rendering is the mode that supports WebGL and 3D rendering; disabling hardware acceleration is a software-rendering mode.

Chrome's [WebGPU troubleshooting guidance](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) identifies these relevant prerequisites: graphics acceleration must be enabled, the GPU must not be blocklisted, the page must run in a secure context (or localhost during development), and GPU process crashes/drivers can make the adapter unavailable.

The previous page shim fabricated `GPUAdapterInfo`, limits, and features even in `real` mode, which could break applications and produce inconsistent values. It also hid `navigator.gpu` when WebGL was off. The fix leaves native WebGPU untouched unless the profile explicitly selects WebGPU Off/Disable, and makes WebGL Off independent from WebGPU Real.

## Android Emulator cameras

Android's [official camera support guide](https://developer.android.com/studio/run/emulator-use-camera) confirms that Android 11+ emulator images support advanced camera functionality including RAW capture, YUV reprocessing, logical cameras, sensor orientation, stabilization, edge enhancement, and concurrent cameras.

The [official extended-controls guide](https://developer.android.com/studio/run/emulator-extended-controls) documents the emulator Camera controls and notes that camera-related controls operate on the emulator's configured virtual scene. The host-camera path still depends on the emulator enumerating a source and the host driver allowing capture.

The current Octo chooser already provides:

- every enumerated `webcamN` source, not only `webcam0`;
- independent front and back selections, including sharing one source;
- Off controls;
- refresh and hot-plug rescans;
- optional live frame checks and measured resolution limits;
- explicit warnings when a saved endpoint is not currently enumerated, rather than pretending it works.

A Windows validation with the user's actual emulator and camera drivers is still required for end-to-end capture confirmation.
