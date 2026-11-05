# Supplied `debug.zip` review

**Review date:** 2026-10-13  
**Repository branch reviewed:** `arena/c10966b9-fuzzy-bassoonaaaa`  
**Archive:** `/home/ubuntu/upload/debug.zip`  
**Archive SHA-256:** `600e3d3a508507c22394428c1091cf1a4451b4a4e66cc0e6a67196004d7994ca`

## Executive summary

The supplied archive is a **compiled Windows browser distribution**, not a source checkout or a reusable Chromium feature library. It contains a Chromium 142.0.7444.273-style runtime, a custom `ginsbrowser.exe` launcher, a `chrome_proxy.exe`, nested debug archives, and Widevine. It does not contain source files, patches, GN arguments, dependency manifests, build provenance, SBOM/SPDX data, or a complete third-party notice inventory.

It therefore cannot be safely imported as “a large part of the code” into Octo’s Chromium runtime. Copying the binary into the app would also bypass Octo’s current runtime contract, which requires a supported executable name, a pinned catalog entry, a manifest, and checksum verification. The archive’s included Widevine license expressly says the component is proprietary and may not be distributed without a separate Google license.

No project files were changed as a result of this review except this report.

## Archive evidence

### Contents

The outer archive has 273 entries. The main runtime contains:

- `chrome.dll` — approximately 279 MB
- `ginsbrowser.exe` — approximately 3.1 MB
- `chrome_proxy.exe` — approximately 1.3 MB
- `chrome_elf.dll`, `chrome_wer.dll`
- `libEGL.dll`, `libGLESv2.dll`, Vulkan/DirectX runtime files
- `resources.pak`, `icudtl.dat`, V8 snapshot data, locale files
- `Installer/setup.exe`
- `WidevineCdm/4.10.2891.0/win_x64/widevinecdm.dll`
- nested `142.0.7444.273/debug.zip` and `debug_2.7z`
- `debug.log`

The nested `debug.zip` is another compiled Chrome-style package containing locale files, setup, Widevine, and resource data. It also contains no source or build metadata. The sandbox does not have a `7z` executable, so `debug_2.7z` was listed only as an opaque nested artifact and was not extracted.

### Custom executable metadata

Static PE inspection of `ginsbrowser.exe` found:

- PE32+ Windows x64 GUI executable
- imports `chrome_elf.dll`
- product name: `GinsBrowser`
- company name: `The GinsBrowser Authors`
- product short name: `GinsBrowser`
- copyright string: `Copyright @LASTCHANGE_YEAR@ The GinsBrowser Authors. All rights reserved.`
- embedded Chromium strings such as `chrome_exe`, `ChromeMain`, `devtools`, `webrtc`, `headless`, and `profile-directory`
- an embedded publisher string: `Dicloak Technology Limited`

These strings are observations from the binary, not proof of ownership, authorization, source provenance, or licensing.

### Debug log

`debug.log` contains repeated Windows DPAPI/OS cryptography failures:

```text
components\\os_crypt\\sync\\os_crypt_win.cc:128] Failed to decrypt: The parameter is incorrect. (0x57)
```

This indicates the captured profile/debug environment had encrypted-data decryption problems. It is not evidence that the runtime is suitable for Octo profile data or that its credential behavior is compatible with Octo’s keyring/vault model.

### Archive safety

The outer archive did not contain absolute paths, drive-letter paths, or `..` traversal entries in its central directory listing. That is only an archive-structure check; it is not a malware or supply-chain assessment. No executable was run.

## Licensing and provenance findings

The archive includes only a clearly identified Widevine license among the searched notice/license paths:

```text
Google LLC and its affiliates ... own all legal right, title and interest ...
You may not use, modify, sell, or otherwise distribute the Software without a separate license agreement with Google.
```

The archive does **not** include, in its visible paths:

- Chromium source or a source revision
- Chromium `LICENSE`/third-party notice bundle covering the compiled dependency graph
- `chrome/installer/third_party` output or an equivalent generated credits inventory
- GN args or target name
- DEPS/dependency lock data tied to this binary
- build ID/provenance attestation
- SPDX/SBOM output
- signed maintainer release metadata
- a license statement covering the GinsBrowser modifications

The presence of `WidevineCdm` makes the archive unsuitable for redistribution by Octo unless the distributor has a separate license agreement. It must not be copied into an Octo installer or runtime catalog on the current evidence.

## Review of Octo’s current native Chromium contract

The repository already has several appropriate controls:

- `engine-runtime.ts` requires `runtime.json`, a platform entry, a supported executable name, and an executable SHA-256.
- Windows Chromium distributions are intentionally limited to the source-built `inkbrowser-chrome.exe` contract or the explicitly marked ungoogled `chrome.exe` contract.
- `runtime-catalog.ts` verifies the archive SHA-256 before extraction.
- Archive paths are checked for absolute paths and `..` traversal.
- Required runtime files are checked for the ungoogled distribution.
- Native Chromium uses a separate profile directory and CDP tab control.
- Session restoration, configured start pages, search-provider preferences, and plain-text address-bar search are now handled by the native manager.

The supplied archive does not satisfy those controls:

1. Its executable is `ginsbrowser.exe`, not an accepted Octo Chromium executable.
2. Its version is `142.0.7444.273`, while the active pinned runtime path is based on the repository’s supported catalog versions.
3. Its archive-level provenance and checksum are not tied to a maintainer-controlled release asset.
4. Its dependency/license inventory is incomplete.
5. Its Widevine component is explicitly non-redistributable without a separate license.
6. Its custom modifications cannot be audited from the archive.

## What can be safely reused

Because no source is present, no implementation files can be imported. The following are safe **design requirements** to use as independent work, without copying the binary:

- Keep runtime discovery manifest-driven and checksum-verified.
- Preserve a complete Chromium runtime directory rather than copying only an executable.
- Keep profile data isolated per browser profile.
- Use CDP for normal tab, navigation, session, crash-recovery, and diagnostics features.
- Expose ordinary browser settings such as search provider, downloads, permissions, WebRTC policy, and graphics enable/disable behavior without fabricating browser identity.
- Keep runtime startup diagnostics and crash logs separate from user profile secrets.
- Keep the browser runtime and launcher branding separate from the profile data directory.

These are already largely represented in Octo’s native engine architecture and should be implemented from auditable source, not reverse-engineered from this opaque binary.

## Features explicitly excluded from import

I did not import or reproduce any code intended to:

- spoof or fabricate WebGL, Canvas, Audio, DOM, platform, or hardware identity;
- hide automation or CDP control from websites;
- evade bot/detection systems;
- rewrite `navigator`/User-Agent values to impersonate unrelated devices;
- inject stealth scripts or patch page APIs for identity masking.

Those behaviors are not verifiable from this archive and are outside the legitimate browser/privacy scope of the current native runtime.

## Recommended next steps

To make this a valid candidate for a future **separate** runtime, a maintainer would need all of the following:

1. Written authorization to redistribute the exact archive and its modifications.
2. A separately licensed or removed Widevine component.
3. The exact Chromium source revision and the GinsBrowser patch set, or an authoritative build attestation tying the binary to a reviewed source tree.
4. GN args, target, DEPS/dependency state, and a generated third-party license/credits inventory.
5. A maintainer-controlled release asset with a recorded acquisition date and SHA-256.
6. A runtime manifest using an explicit new distribution identifier, not `source-built` or `ungoogled-chromium`.
7. Windows clean-install launch and CDP validation on the target machine.
8. A decision on whether its browser shell is compatible with Octo’s separate launcher/UI architecture.

Until these are supplied, the correct action is to keep the archive out of the installer and out of the Chromium catalog. The current checked and licensed runtime paths remain the supported options.
