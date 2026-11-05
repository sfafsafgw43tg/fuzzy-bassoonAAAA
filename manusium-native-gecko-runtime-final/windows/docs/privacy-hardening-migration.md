# Privacy Hardening Migration Note

## Permission behavior

Undecided camera, microphone, display-capture, and external-device permissions now fail closed in Electron's permission-check handler. A site must receive an explicit origin-scoped approval through the OctoSuite permission UI before media access is considered granted.

This may change behavior for profiles that previously retained Chromium permission state: websites may request permission again, and `enumerateDevices()` may return fewer devices until consent exists. This is intentional. It prevents sites from seeing real labels, counts, device IDs, or group IDs before the user approves access.

## Existing profile data

No profile data, cookies, secrets, or browser storage are migrated or deleted by this change. A fresh profile or cleared origin permissions is recommended when validating the new behavior.

## Graphics policy

The project does not treat arbitrary GPU-string replacement as a valid privacy fix. Users should select truthful native graphics or an explicitly tested WebGL-disabled mode. A profile reporting an NVIDIA string while native limits and the actual GPU are AMD is considered inconsistent and unsupported.

## Network policy

Profiles using WebRTC lockdown must be tested after rebuilding the packaged child process. Page-level ICE filtering is defense in depth only; it is not a substitute for Chromium's native WebRTC policy or a fail-closed proxy route.

## Compatibility trade-offs

Strict permission and network policies can break video calls, screen sharing, Bluetooth/USB workflows, and sites that require WebRTC. These capabilities should be enabled only with a visible, origin-scoped user decision.
