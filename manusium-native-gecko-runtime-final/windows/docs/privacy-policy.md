# OctoSuite Defensive Privacy Policy

## Scope

OctoSuite aims to prevent accidental disclosure of network, device, profile, and application data. It does not promise anonymity, arbitrary hardware impersonation, or immunity from browser-fingerprinting and anti-abuse systems.

## Network and WebRTC

Proxy routing is applied before profile geo-IP resolution. Profiles configured for proxy lockdown must fail closed when the route cannot be used. DNS, IPv4, IPv6, WebSocket, WebTransport, STUN, TURN, and WebRTC behavior must be tested as separate paths. WebRTC is disabled or restricted according to the profile policy. JavaScript rewriting is not treated as a network security boundary.

## WebGL and graphics

A profile may use truthful native graphics, intentionally disable WebGL, or use a tested coherent privacy mode. OctoSuite must not expose an arbitrary vendor/renderer string while native limits, extensions, shader precision, canvas output, WebGPU, or worker behavior contradict that identity. When a coherent model is unavailable, disabling the API is safer than fabricating a GPU identity.

## Identity and client hints

User-Agent, UA-CH, platform, OS/build behavior, screen, viewport, language, timezone, hardware values, and feature availability must be internally consistent and supported by the shipped Electron/Chromium version. Electron branding must not be hidden by claiming an unsupported browser version.

## Device and permissions

Camera, microphone, display capture, geolocation, notifications, clipboard, HID, USB, serial, Bluetooth, and local fonts are denied by default unless a user-visible, origin-scoped decision allows them. Device labels and identifiers are not fabricated. Before permission, device exposure should be minimized.

## Profile isolation

Cookies, HTTP cache, service-worker registrations, Cache Storage, IndexedDB, Local Storage, extensions, downloads, and permissions are scoped to the profile's storage partition. Reset and delete-on-close operations must verify that persistent registrations and storage are removed.

## IPC and preload

Remote pages are sandboxed, context-isolated, and have no Node.js, filesystem, shell, or arbitrary Electron access. IPC handlers validate the sender, frame, origin, channel, and payload. Synchronous IPC is avoided for remote content. Certificate verification remains enabled.

## Diagnostics

CreepJS and BrowserLeaks are diagnostic tools, not acceptance-score targets. Reports must state exact browser build, operating system, GPU, profile mode, proxy mode, and test limitations. Raw credentials, cookies, tokens, full sensitive URLs, and high-entropy fingerprints are never uploaded or committed.
