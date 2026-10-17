#pragma once

#include "frame_queue.h"
#include <mfidl.h>
#include <wrl/client.h>
#include <atomic>

namespace octo::camera {
class VirtualCameraSource;

class VirtualCameraStream final : public IMFMediaStream {
 public:
  VirtualCameraStream(VirtualCameraSource* source, IMFStreamDescriptor* descriptor);

  IFACEMETHODIMP QueryInterface(REFIID riid, void** object) override;
  IFACEMETHODIMP_(ULONG) AddRef() override;
  IFACEMETHODIMP_(ULONG) Release() override;
  IFACEMETHODIMP BeginGetEvent(IMFAsyncCallback* callback, IUnknown* state) override;
  IFACEMETHODIMP EndGetEvent(IMFAsyncResult* result, IMFMediaEvent** event) override;
  IFACEMETHODIMP GetEvent(DWORD flags, IMFMediaEvent** event) override;
  IFACEMETHODIMP QueueEvent(MediaEventType type, REFGUID extendedType, HRESULT status, const PROPVARIANT* value) override;
  IFACEMETHODIMP GetMediaSource(IMFMediaSource** source) override;
  IFACEMETHODIMP GetStreamDescriptor(IMFStreamDescriptor** descriptor) override;
  IFACEMETHODIMP RequestSample(IUnknown* token) override;
  HRESULT Initialize();

 private:
  ~VirtualCameraStream() override;
  std::atomic<ULONG> refs_{1};
  VirtualCameraSource* source_;
  Microsoft::WRL::ComPtr<IMFStreamDescriptor> descriptor_;
  Microsoft::WRL::ComPtr<IMFMediaEventQueue> events_;
};
} // namespace octo::camera
