# OctoSuite Security Findings Report

Date: 2026-10-28
Profile audited: `p-01a1bd5b4181`
Audit sources: packaged Octo.su profile, BrowserLeaks pages, CreepJS runtime harness

## Executive summary

The packaged profile is **not leak-free** and must not be described as undetectable or fully anti-detect. The audit reproduced a critical WebRTC private-network disclosure, native AMD WebGL disclosure, Electron branding, Windows 10/11 inconsistency, and permanent media-device exposure. The BrowserLeaks harness completed WebRTC, JavaScript, WebGL, canvas, fonts, and client-hints pages. DNS, features, and DOMRect pages were not completed because the audited profile closed before those navigations; those results remain unverified.

## Confirmed findings

### Critical: WebRTC exposes private and local addresses

BrowserLeaks reported remote IPv4 `45.134.212.72`, but also exposed local/private addresses including `10.169.11.153`, `172.24.208.1`, `172.30.48.1`, `172.20.0.1`, `192.168.1.88`, several other RFC1918 addresses, and IPv6 local addresses. CreepJS independently captured a host ICE candidate containing `10.169.11.153`.

Affected areas: profile WebRTC policy, Chromium native WebRTC configuration, profile startup switches, and the live profile configuration. JavaScript candidate filtering is not sufficient. The native policy must be verified in the actual packaged child process, and proxy lockdown must fail closed.

Status: **unresolved in the audited build**.

### High: native GPU is exposed in Window and Worker contexts

BrowserLeaks reported `Google Inc. (AMD)` and `ANGLE (AMD, AMD Radeon RX 6700 XT...)`. CreepJS reported the same native AMD renderer in Window and Worker contexts. This contradicts any arbitrary selected-GPU identity and demonstrates that the current WebGL shim does not control all native observation paths.

Status: **unresolved**. The safe choices are truthful native graphics or a tested WebGL-disabled mode. Arbitrary GPU-string impersonation is not accepted.

### High: Electron branding is exposed

BrowserLeaks and CreepJS reported `Electron/44.9.3` in `navigator.userAgent` and `appVersion`.

Status: **unresolved**. Remove accidental branding only through a supported, truthful compatibility policy; do not claim unsupported Chrome behavior.

### High: OS and client-hints mismatch

The profile was configured for Windows 11, but BrowserLeaks and CreepJS reported Windows 10 / `platformVersion: 10.0.0`. The user-agent also contains Windows NT 10.0. This is an internal consistency failure.

Status: **unresolved**. The product should either expose a truthful Windows identity or implement a complete, supported compatibility model rather than changing one JavaScript property.

### High: media devices and labels are exposed

BrowserLeaks reported permanently granted audio and video permissions and listed real device labels, including microphones, VB-CABLE, OBS cameras, Realme Webcam, AirPods, and multiple speakers. It also exposed device and group identifiers.

A defensive permission-check change was applied so undecided permissions now fail closed instead of being reported as granted. This requires a rebuild and a fresh profile/session to verify; the prior BrowserLeaks result predates that final change.

### Medium/High: canvas and font entropy remain visible

Canvas produced a stable fingerprint signature and reported a 99.9% uniqueness statistic. Font testing found 115 fonts and 82 unique metrics. This is expected for native rendering but increases fingerprint entropy. No arbitrary font or canvas identity is claimed as fixed.

### Medium: browser feature surface is broad

The JavaScript page reported Bluetooth, HID, Serial, USB, WebGPU, Web Audio, battery, clipboard, storage, and other APIs. Presence of an API is not by itself a leak, but each capability requires explicit permission and origin-scoped behavior.

## Unverified pages

The current harness did not finish DNS, Features Detection, or DOMRect because the profile closed during the run. These pages require an isolated rerun per URL or a harness that restarts the profile per page. They must not be marked passed.

## Root-cause themes

1. Page-world JavaScript shims do not control native WebGL, GPU-process, Worker, or Service Worker observation paths.
2. Profile startup and identity installation are not yet proven to precede every first navigation.
3. WebRTC native containment is not proven in the actual packaged profile process.
4. Existing permission-check behavior allowed undecided media requests to appear granted.
5. UA, UA-CH, OS, and Electron behavior are not represented by one coherent supported identity.
6. The audit harness is not resilient to profile closure, so partial results can be mistaken for a full pass.

## Required next fixes

- Verify and enforce native WebRTC `disable_non_proxied_udp` in the profile child, then test ICE, STUN, IPv4, IPv6, DNS, WebSocket, and proxy-failure paths.
- Offer a tested WebGL-disabled mode and document its compatibility cost. Do not return an arbitrary GPU renderer while native limits remain AMD.
- Make permission checks fail closed until explicit origin consent; verify with a fresh profile and BrowserLeaks.
- Decide whether truthful Electron/Chromium identity or a supported compatibility identity is the product policy; remove only accidental exposure.
- Make the BrowserLeaks harness restart or reconnect per page so all requested pages are measured.
- Run packaged-app regression tests, not only source/unit tests.
