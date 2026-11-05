# Electron Advanced Settings and CreepJS Audit

Date: 2026-10-28
Profile workflow: create temporary profile -> open profile -> navigate to CreepJS
Created test profile: `p-8f4121141803`

## Electron base validation

The profile creator exposes Electron as the active base choice. The Electron-focused launcher, graphics, page-shim, and typecheck validation passed:

- TypeScript typecheck: passed
- Browser UI tests: 58 passed
- Graphics isolation tests: 7 passed, 1 skipped
- Page-shim tests: 7 passed
- Browser bundle build: passed

## Settings behavior change

The profile's explicit `WebGL: Off` setting now controls the actual tab capability. When enabled, Electron creates the page view with WebGL disabled, rather than leaving native WebGL available because the global graphics policy happened to be permissive. This is a truthful capability control; it does not impersonate another GPU.

## Fresh-profile CreepJS result

The fresh Electron profile opened CreepJS successfully. The captured result contains all requested sections: WebRTC, Timezone, Intl, Headless, Resistance, Worker, WebGL, Screen, Canvas, Fonts, DOMRect, SVGRect, Audio, Speech, Media, Tests, Workers, Iframes, Fonts, Timezone, Screen, Prototype, and JS Proxy.

Important findings from the current rollback build:

- User agent includes `Electron/44.9.3`.
- Platform is `Win32`.
- Headless similarity is `31% like headless`.
- WebGL is Microsoft Basic Render Driver under the software-rendering test flags.
- Window and Worker report the same WebGL identity in this run.
- CreepJS captures a private WebRTC host candidate: `10.169.11.153`.
- CreepJS reports 13 media devices.
- Worker reports Windows 10/Win32 while the profile UI can select other OS versions; this is a remaining runtime consistency gap.
- CreepJS reports moderate GPU confidence, not high confidence.

## Full-suite status

The complete suite was also run. Most tests passed, but the environment-independent suite is not fully green because of existing failures unrelated to the WebGL-off wiring:

- Auto-locale test had a stale source-string assertion; it was updated to match the current bounded network-preparation implementation.
- The esbuild diagnostic assertion expects a path format that differs on this Windows Node installation.
- The runtime-catalog test requires a `zip` executable that is not installed on the Windows host.

The focused Electron validation is green, but the CreepJS result must not be described as leak-free or high-confidence.
