# Rollback CreepJS Report

Date: 2026-10-28
Revision: `85285ec`
Profile: `p-01a1bd5b4181`

## Result

The live packaged profile opened CreepJS successfully, but its output does **not** match the supplied reference image and is not a high-confidence anti-detect result.

### Browser identity

- User agent contains `Electron/44.9.3`.
- Platform: `Win32`.
- Languages: `en-US`, `pl`.
- CreepJS headless similarity: `31% like headless`.
- CreepJS reported `0% headless` and `0% stealth` on separate indicators.

### WebGL

The audit was run with software rendering flags, so the observed identity was:

- Vendor: `Google Inc. (Microsoft)`
- Renderer: `ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)`

Window and Worker returned the same Microsoft Basic Render Driver identity. This is consistent between contexts, but it is not the NVIDIA-style output shown in the reference image.

### WebRTC

CreepJS captured a private host ICE candidate:

```text
10.169.11.153 typ host
```

The page also reported 13 media devices, including dual microphone/audio/webcam entries. This is a confirmed privacy leak in the rollback build.

### Other observations

CreepJS exposed Electron in `appVersion`, reported network and battery values, and completed the main test navigation. The harness did not claim that every lower-page visual section matched the screenshot; it captured the page text and direct Window/Worker WebGL probes.

## Conclusion

The rollback is functional enough to launch the profile and load CreepJS, but it fails the requested reference behavior in three important ways: Electron branding remains, WebRTC exposes a private host address, and GPU-disabled rendering reports Microsoft Basic Render Driver. The rollback should not be described as fully spoofed or leak-proof.
