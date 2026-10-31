# Octo browser editions

## Octo Compact — Windows-tested candidate

A compact, single-engine desktop browser with tabs, address/search, bookmarks,
private windows, downloads and a narrow/touch-friendly interface. Uses one
supported prebuilt Electron/Chromium runtime; **no Chromium source compilation,
extra native browser engines, or emulator download**.

The real Windows installer was built, installed on a fresh hosted Windows VM,
launched and exercised, restarted, measured and uninstalled successfully in
[run 38160319029](https://github.com/sfafsafgw43tg/fuzzy-bassoonAAAA/actions/runs/38160319029).

- **Installed size:** 368.82 MiB, excluding user data.
- **Installer:** 115.14 MiB.
- [Download tested installer artifact](https://github.com/sfafsafgw43tg/fuzzy-bassoonAAAA/actions/runs/38160319029/artifacts/11710405759)
  (`compact-CANDIDATE-6`; extract and run `Octo-Compact-Setup-0.1.1.exe`).
- [Architecture, storage tradeoffs, security/update policy and verification evidence](manusium-native-gecko-runtime-final/windows/docs/compact/README.md).

This is a tested candidate, not a claim of production signing or automatic updates.
Artifacts have seven-day retention and may require GitHub access. Compact updates
are manual. Do not use the original source ZIP or old `install.bat` to install it.

## Full multi-engine InkBrowser suite — RELEASE INCOMPLETE

The older suite remains in `manusium-native-gecko-runtime-final/windows`.
Its custom source-built InkBrowser Windows payload is still unavailable and its
native Chromium build still requires the dedicated large Windows runner. The
Compact edition does not claim to finish that different release.

See [native runtime audit and blockers](manusium-native-gecko-runtime-final/windows/docs/inkbrowser/RUNTIME-RELEASE-STATUS.md).
The retained uploaded ZIP is old source, not a runtime or working installer.
