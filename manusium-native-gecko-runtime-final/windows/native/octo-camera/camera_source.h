#pragma once

#include "frame_queue.h"
#include "shared_frame_reader.h"
#include <mfidl.h>
#include <mfobjects.h>
#include <wrl/client.h>
#include <atomic>
#include <mutex>

namespace octo::camera {

class VirtualCameraStream;

class VirtualCameraSource final : public IMFMediaSourceEx, public IMFGetService {
 public:
  static HRESULT CreateInstance(REFIID riid, void** object);

  // IUnknown
  IFACEMETHODIMP QueryInterface(REFIID riid, void** object) override;
  IFACEMETHODIMP_(ULONG) AddRef() override;
  IFACEMETHODIMP_(ULONG) Release() override;

  // IMFMediaEventGenerator
  IFACEMETHODIMP BeginGetEvent(IMFAsyncCallback* callback, IUnknown* state) override;
  IFACEMETHODIMP EndGetEvent(IMFAsyncResult* result, IMFMediaEvent** event) override;
  IFACEMETHODIMP GetEvent(DWORD flags, IMFMediaEvent** event) override;
  IFACEMETHODIMP QueueEvent(MediaEventType type, REFGUID extendedType, HRESULT status, const PROPVARIANT* value) override;

  // IMFMediaSource
  IFACEMETHODIMP GetCharacteristics(DWORD* characteristics) override;
  IFACEMETHODIMP CreatePresentationDescriptor(IMFPresentationDescriptor** descriptor) override;
  IFACEMETHODIMP Start(IMFPresentationDescriptor* descriptor, const GUID* timeFormat, const PROPVARIANT* startPosition) override;
  IFACEMETHODIMP Stop() override;
  IFACEMETHODIMP Pause() override;
  IFACEMETHODIMP Shutdown() override;

  // IMFMediaSourceEx
  IFACEMETHODIMP GetSourceAttributes(IMFAttributes** attributes) override;
  IFACEMETHODIMP GetStreamAttributes(DWORD streamId, IMFAttributes** attributes) override;
  IFACEMETHODIMP SetD3DManager(IUnknown* manager) override;

  // IMFGetService. Frame-server sources must expose this interface.
  IFACEMETHODIMP GetService(REFGUID service, REFIID riid, LPVOID* object) override;

  HRESULT CreateStream(IMFMediaStream** stream);
  bool IsShutdown() const noexcept { return shutdown_.load(); }
  HRESULT NextFrame(std::uint32_t width, std::uint32_t height, Frame& frame);

 private:
  VirtualCameraSource();
  ~VirtualCameraSource() override;
  HRESULT Initialize();

  std::atomic<ULONG> refs_{1};
  std::atomic<bool> shutdown_{false};
  std::atomic<bool> started_{false};
  Microsoft::WRL::ComPtr<IMFMediaEventQueue> events_;
  Microsoft::WRL::ComPtr<IMFPresentationDescriptor> presentation_;
  Microsoft::WRL::ComPtr<VirtualCameraStream> stream_;
  SharedFrameReader reader_;
};

} // namespace octo::camera
