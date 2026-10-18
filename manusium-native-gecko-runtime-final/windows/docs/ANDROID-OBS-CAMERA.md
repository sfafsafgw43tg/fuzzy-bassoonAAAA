# Android Emulator camera through OBS

OctoSuite now writes the mobile Camera Studio configuration with an explicit OBS bridge route. The intended path is:

```text
Camera Studio scene
  -> Unity Capture virtual camera
  -> OBS camera source
  -> OBS Virtual Camera
  -> Android Emulator webcam0
```

Start Camera Studio first and leave its camera output as **Unity Capture virtual camera**. Open OBS Studio, create a scene, add **Video Capture Device**, and select **Unity Capture virtual camera** as the source. Apply the scene filters, transforms, overlays, or media you need. Click **Start Virtual Camera** in OBS.

In OctoSuite, refresh the Android camera list and select **OBS Virtual Camera** for exactly one AVD facing. Keep the other facing set to **Off** or **Virtual Scene**. Do not assign the same `webcamN` endpoint to both front and back cameras because Android Emulator can stop its camera provider when both lenses open the same host stream.

The updated Camera Studio configuration contains `outputs.obs_scene: true` and an `obs` route object describing the source and destination names. Older Camera Studio payloads that do not understand those metadata fields still work: OBS remains the video compositor and the native Windows camera remains the capture boundary.

If OBS Virtual Camera is not listed, click Refresh after starting OBS Virtual Camera. If Android Camera still stops, cold-boot the AVD, use one OBS endpoint only, and verify that Windows privacy settings allow desktop applications to access the camera. `webcam0` is an emulator endpoint, not a Windows device name; choose the endpoint whose label contains **OBS Virtual Camera**.
