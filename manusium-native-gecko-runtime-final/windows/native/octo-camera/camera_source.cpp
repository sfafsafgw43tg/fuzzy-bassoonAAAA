#include "camera_source.h"
#include "camera_stream.h"
#include "media_types.h"
#include <mfapi.h>
#include <mferror.h>
#include <propvarutil.h>
#include <wrl.h>
#include <new>

namespace octo::camera {
using Microsoft::WRL::ComPtr;

VirtualCameraSource::VirtualCameraSource() = default;
VirtualCameraSource::~VirtualCameraSource() = default;

HRESULT VirtualCameraSource::CreateInstance(REFIID riid, void** object) {
  if (!object) return E_POINTER;
  *object = nullptr;
  ComPtr<VirtualCameraSource> source;
  source.Attach(new (std::nothrow) VirtualCameraSource());
  if (!source) return E_OUTOFMEMORY;
  HRESULT hr = source->Initialize();
  if (FAILED(hr)) return hr;
  return source->QueryInterface(riid, object);
}

HRESULT VirtualCameraSource::Initialize() {
  HRESULT hr = MFCreateEventQueue(&events_);
  if (FAILED(hr)) return hr;
  ComPtr<IMFStreamDescriptor> descriptor;
  hr = BuildVideoTypeList(&descriptor);
  if (FAILED(hr)) return hr;
  hr = MFCreatePresentationDescriptor(1, descriptor.GetAddressOf(), &presentation_);
  if (FAILED(hr)) return hr;
  hr = presentation_->SelectStream(0);
  if (FAILED(hr)) return hr;
  stream_.Attach(new (std::nothrow) VirtualCameraStream(this, descriptor.Get()));
  if (!stream_) return E_OUTOFMEMORY;
  return stream_->Initialize();
}

HRESULT VirtualCameraSource::QueryInterface(REFIID riid, void** object) {
  if (!object) return E_POINTER;
  *object = nullptr;
  if (riid == IID_IUnknown || riid == __uuidof(IMFMediaEventGenerator) || riid == __uuidof(IMFMediaSource) || riid == __uuidof(IMFMediaSourceEx)) *object = static_cast<IMFMediaSourceEx*>(this);
  else if (riid == __uuidof(IMFGetService)) *object = static_cast<IMFGetService*>(this);
  else return E_NOINTERFACE;
  AddRef();
  return S_OK;
}
ULONG VirtualCameraSource::AddRef() { return ++refs_; }
ULONG VirtualCameraSource::Release() { ULONG value = --refs_; if (!value) delete this; return value; }

HRESULT VirtualCameraSource::BeginGetEvent(IMFAsyncCallback* callback, IUnknown* state) { if (shutdown_) return MF_E_SHUTDOWN; return events_->BeginGetEvent(callback, state); }
HRESULT VirtualCameraSource::EndGetEvent(IMFAsyncResult* result, IMFMediaEvent** event) { if (shutdown_) return MF_E_SHUTDOWN; return events_->EndGetEvent(result, event); }
HRESULT VirtualCameraSource::GetEvent(DWORD flags, IMFMediaEvent** event) { if (shutdown_) return MF_E_SHUTDOWN; return events_->GetEvent(flags, event); }
HRESULT VirtualCameraSource::QueueEvent(MediaEventType type, REFGUID extendedType, HRESULT status, const PROPVARIANT* value) { if (shutdown_) return MF_E_SHUTDOWN; return events_->QueueEventParamVar(type, extendedType, status, value); }

HRESULT VirtualCameraSource::GetCharacteristics(DWORD* characteristics) { if (!characteristics) return E_POINTER; if (shutdown_) return MF_E_SHUTDOWN; *characteristics = MFMEDIASOURCE_IS_LIVE; return S_OK; }
HRESULT VirtualCameraSource::CreatePresentationDescriptor(IMFPresentationDescriptor** descriptor) { if (!descriptor) return E_POINTER; *descriptor = nullptr; if (shutdown_) return MF_E_SHUTDOWN; return presentation_->Clone(descriptor); }
HRESULT VirtualCameraSource::Start(IMFPresentationDescriptor*, const GUID*, const PROPVARIANT*) { if (shutdown_) return MF_E_SHUTDOWN; started_ = true; return QueueEvent(MESourceStarted, GUID_NULL, S_OK, nullptr); }
HRESULT VirtualCameraSource::Stop() { if (shutdown_) return MF_E_SHUTDOWN; started_ = false; return QueueEvent(MESourceStopped, GUID_NULL, S_OK, nullptr); }
HRESULT VirtualCameraSource::Pause() { return shutdown_ ? MF_E_SHUTDOWN : MF_E_INVALID_STATE_TRANSITION; }
HRESULT VirtualCameraSource::Shutdown() { if (shutdown_.exchange(true)) return MF_E_SHUTDOWN; started_ = false; stream_.Reset(); if (events_) events_->Shutdown(); events_.Reset(); presentation_.Reset(); return S_OK; }
HRESULT VirtualCameraSource::GetService(REFGUID, REFIID, LPVOID*) { return MF_E_UNSUPPORTED_SERVICE; }
HRESULT VirtualCameraSource::CreateStream(IMFMediaStream** stream) { if (!stream) return E_POINTER; *stream = stream_.Get(); if (!*stream) return MF_E_SHUTDOWN; (*stream)->AddRef(); return S_OK; }
HRESULT VirtualCameraSource::NextFrame(std::uint32_t width, std::uint32_t height, Frame& frame) { return reader_.ReadLatest(frame, width, height) || !frame.bytes.empty() ? S_OK : E_FAIL; }
HRESULT VirtualCameraSource::GetSourceAttributes(IMFAttributes** attributes) { if (!attributes) return E_POINTER; *attributes = nullptr; return MF_E_UNSUPPORTED_SERVICE; }
HRESULT VirtualCameraSource::GetStreamAttributes(DWORD, IMFAttributes** attributes) { if (!attributes) return E_POINTER; *attributes = nullptr; return MF_E_UNSUPPORTED_SERVICE; }
HRESULT VirtualCameraSource::SetD3DManager(IUnknown*) { return E_NOTIMPL; }

} // namespace octo::camera
