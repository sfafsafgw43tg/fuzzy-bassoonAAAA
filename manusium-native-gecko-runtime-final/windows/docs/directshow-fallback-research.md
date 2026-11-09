# Windows 10 DirectShow fallback research

- Microsoft documents DirectShow as a legacy capture API and describes capture filters as devices with at least one capture output pin: https://learn.microsoft.com/en-us/windows/win32/directshow/about-video-capture-devices and https://learn.microsoft.com/en-us/windows/win32/directshow/directshow-video-capture-filters
- `tshino/softcam` is an MIT-licensed DirectShow virtual webcam implementation. Its README states that it registers a DLL under the Video Input Device category and uses Microsoft DirectShow Base Classes, also MIT licensed in the referenced Windows Classic Samples: https://github.com/tshino/softcam
- The Octo fallback vendors the Softcam filter/base-class source under `native/octo-directshow`, retains `SOFTCAM-LICENSE`, and replaces Softcam's sender transport with Octo's existing NV12 shared-memory protocol.
- The fallback publishes RGB24 capture frames because the reference DirectShow filter negotiates `MEDIASUBTYPE_RGB24`; Octo NV12 frames are converted in the filter before delivery.
- The fallback is intended for older Windows versions where `MFCreateVirtualCamera` is unavailable. DirectShow registration may require elevation because legacy filter registration is system-wide.
