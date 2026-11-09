# OBS Virtual Camera to Android Emulator

1. Install OBS Studio.
2. Open OctoSuite → Android Devices → Camera and microphone.
3. Click **Start OBS Virtual Camera**. Octo starts OBS with `--startvirtualcam` and waits for Windows to enumerate it.
4. Refresh and select `OBS Virtual Camera` for one Android lens. Set the other lens to **Virtual scene** or **Off**; do not assign one endpoint to both lenses.
5. Save, stop the emulator, and cold-start it.

Compose the feed in OBS and click **Start Virtual Camera** if OBS did not start it automatically. The emulator consumes the Windows endpoint as `webcamN`; Octo validates it before launch and uses a conservative camera size to avoid Camera2 negotiation crashes.
