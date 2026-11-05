# GitHub Chromium research

**Date:** 2026-10-13

I searched for source-available Chromium forks and browser-profile projects. I excluded projects whose primary purpose is hiding automation, spoofing hardware/browser identity, bypassing detection systems, or defeating anti-abuse controls.

## Strong candidates for Octo’s legitimate Chromium work

### 1. ungoogled-chromium

Repository: <https://github.com/ungoogled-software/ungoogled-chromium>

This is the closest fit for a normal, auditable Chromium base. It provides Chromium source patches and build tooling, has a BSD-3-Clause license, and documents its patch set, revision, flags, and supported platforms. Its stated goals are removing Google web-service dependencies while retaining the default Chromium experience and improving privacy/control. It is not an anti-detect browser and does not provide a per-profile fabricated hardware identity.

Useful areas to study:

- `patches/` for auditable Chromium changes
- `docs/design.md` for how patches and substitutions are organized
- `docs/flags.md` for documented user-controlled settings
- `revision.txt` and `chromium_version.txt` for version pinning
- build/download scripts for reproducible packaging

Source and patch licenses must remain separate from Chromium and third-party licenses when code is reused.

### 2. Helium

Repository: <https://github.com/imputnet/helium>

Helium is a privacy-focused Chromium browser based on ungoogled-chromium. Its repository publishes patches, revision/dependency metadata, build tooling, and links to Windows packaging repositories. It uses GPL-3.0 for Helium-specific work and preserves upstream licenses for imported components.

Useful areas to study:

- the vendor-sorted `patches/` directory
- `deps.ini`, `revision.txt`, and `chromium_version.txt`
- Windows packaging and release repositories
- explicit license separation in `LICENSE` and `LICENSE.ungoogled_chromium`

It is a possible source of ordinary privacy and build ideas, but it should not be copied wholesale into Octo without a compatibility and license review.

### 3. Cromite

Repository: <https://github.com/uazo/cromite>

Cromite is a Chromium/Bromite-derived browser with ad blocking and privacy enhancements. It publishes Windows and Linux builds, source patches, build instructions, and a license statement. The repository identifies GPL-3.0 and notes that individual patches may have their own licenses.

Useful areas to study:

- `docs/PATCHES.md`
- `docs/HOW_TO_BUILD.md`
- Windows build/release workflow
- explicit separation of patch licenses
- ordinary ad blocking and privacy controls

Cromite is a full browser fork, not a drop-in module. Its patches would need to be selected individually and rebased against Octo’s pinned Chromium revision.

### 4. Brave Core

Repository: <https://github.com/brave/brave-core>

Brave Core is a mature Chromium customization tree. Its README documents the relationship between Chromium, `brave-core`, dependencies, patching, DEPS, and build configuration. It has an MPL-2.0 repository license, but imported components retain their own licenses.

Useful areas to study:

- `DEPS` and dependency pinning
- `patches/`, `chromium_src/`, and `BUILD.gn`
- Windows build instructions
- updater, installer, sandbox, and security review patterns
- patch synchronization and rebase workflow

Brave’s full product architecture is much larger than Octo’s native CDP adapter, so importing only narrowly scoped, reviewed ideas is safer than attempting a wholesale merge.

### 5. Chromium itself

Repository: <https://chromium.googlesource.com/chromium/src/>

Chromium’s official repository remains the authoritative source for the engine, GN build configuration, platform code, CDP protocol implementation, user-data directory behavior, and security documentation. Chromium’s README says to use the official depot_tools checkout instructions rather than a normal `git clone`.

Relevant documentation:

- Source checkout: <https://chromium.googlesource.com/chromium/src/+/main/docs/get_the_code.md>
- User-data directories: <https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md>
- GN configuration: <https://www.chromium.org/developers/gn-build-configuration>
- Security rules: <https://chromium.googlesource.com/chromium/src/+/HEAD/docs/security/rules.md>

### 6. Chrome DevTools Protocol and chromedp

Protocol documentation: <https://chromedevtools.github.io/devtools-protocol/>

Go client: <https://github.com/chromedp/chromedp>

These are appropriate references for Octo’s legitimate native-browser features: tab control, navigation, screenshots, diagnostics, performance tracing, storage inspection, and crash recovery. The protocol documentation warns that CDP is high privilege and not a stable public API, so Octo should keep its versioned adapter and strict localhost-only exposure.

The chromedp documentation also demonstrates isolated profile directories, visible browser startup, multiple tabs, and remote connections without requiring identity spoofing.

## Not suitable for direct import

GitHub search results also contain repositories marketed as “anti-detect,” “fingerprint browser,” or “stealth browser” projects. I am not recommending or integrating those sources because their central functionality is generally to conceal automation or fabricate browser/device identity. Their source quality, licensing, patch provenance, and security properties are also frequently unclear.

The supplied `debug.zip` falls into the same problem category from an integration perspective: it is an opaque compiled binary distribution, not auditable source. It must not be added to Octo’s runtime catalog without provenance, licensing, source/build evidence, and a complete dependency notice review.

## Recommended Octo plan

1. Keep the current verified Octo Chromium runtime contract and CDP adapter.
2. Study ungoogled-chromium first for ordinary privacy/build improvements.
3. Review Helium and Cromite patches individually, selecting only normal privacy, ad-blocking, permission, and build/reproducibility changes.
4. Use Chromium and CDP documentation for profile isolation, crash recovery, diagnostics, and performance work.
5. Keep profile separation based on real `--user-data-dir` directories, proxy configuration, permission policy, and storage isolation.
6. Do not add WebGL/Canvas/Audio identity fabrication, stealth scripts, automation hiding, or detection-evasion behavior.
7. Require a license/provenance record and Windows clean-install/CDP test for every bundled runtime.

## References

[1]: https://github.com/ungoogled-software/ungoogled-chromium "ungoogled-chromium source repository"
[2]: https://github.com/imputnet/helium "Helium source repository"
[3]: https://github.com/uazo/cromite "Cromite source repository"
[4]: https://github.com/brave/brave-core "Brave Core source repository"
[5]: https://chromium.googlesource.com/chromium/src/ "Official Chromium source repository"
[6]: https://chromedevtools.github.io/devtools-protocol/ "Chrome DevTools Protocol documentation"
[7]: https://github.com/chromedp/chromedp "chromedp CDP client repository"
[8]: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md "Chromium user data directory documentation"
