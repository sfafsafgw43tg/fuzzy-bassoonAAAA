#include "camera_stream.h"
#include "camera_source.h"
#include <mfapi.h>
#include <mferror.h>
#include <propvarutil.h>

namespace octo::camera {
VirtualCameraStream::VirtualCameraStream(VirtualCameraSource* source, IMFStreamDescriptor* descriptor) : source_(source), descriptor_(descriptor) {}
VirtualCameraStream::~VirtualCameraStream() = default;
HRESULT VirtualCameraStream::Initialize() { return MFCreateEventQueue(&events_); }
HRESULT VirtualCameraStream::QueryInterface(REFIID riid, void** object) { if (!object) return E_POINTER; *object = nullptr; if (riid == IID_IUnknown || riid == __uuidof(IMFMediaEventGenerator) || riid == __uuidof(IMFMediaStream)) *object = static_cast<IMFMediaStream*>(this); else return E_NOINTERFACE; AddRef(); return S_OK; }
ULONG VirtualCameraStream::AddRef() { return ++refs_; }
ULONG VirtualCameraStream::Release() { ULONG value = --refs_; if (!value) delete this; return value; }
HRESULT VirtualCameraStream::BeginGetEvent(IMFAsyncCallback* callback, IUnknown* state) { return events_->BeginGetEvent(callback, state); }
HRESULT VirtualCameraStream::EndGetEvent(IMFAsyncResult* result, IMFMediaEvent** event) { return events_->EndGetEvent(result, event); }
HRESULT VirtualCameraStream::GetEvent(DWORD flags, IMFMediaEvent** event) { return events_->GetEvent(flags, event); }
HRESULT VirtualCameraStream::QueueEvent(MediaEventType type, REFGUID extendedType, HRESULT status, const PROPVARIANT* value) { return events_->QueueEventParamVar(type, extendedType, status, value); }
HRESULT VirtualCameraStream::GetMediaSource(IMFMediaSource** source) { if (!source) return E_POINTER; *source = source_; return source_->QueryInterface(IID_PPV_ARGS(source)); }
HRESULT VirtualCameraStream::GetStreamDescriptor(IMFStreamDescriptor** descriptor) { if (!descriptor) return E_POINTER; *descriptor = descriptor_.Get(); (*descriptor)->AddRef(); return S_OK; }
HRESULT VirtualCameraStream::RequestSample(IUnknown* token) {
  if (source_->IsShutdown()) return MF_E_SHUTDOWN;
  Microsoft::WRL::ComPtr<IMFMediaTypeHandler> handler;
  HRESULT hr = descriptor_->GetMediaTypeHandler(&handler);
  if (FAILED(hr)) return hr;
  Microsoft::WRL::ComPtr<IMFMediaType> type;
  hr = handler->GetCurrentMediaType(&type);
  if (FAILED(hr)) { hr = handler->GetMediaTypeByIndex(1, &type); if (FAILED(hr)) return hr; }
  UINT32 width = 0, height = 0;
  if (FAILED(hr = MFGetAttributeSize(type.Get(), MF_MT_FRAME_SIZE, &width, &height))) return hr;
  Microsoft::WRL::ComPtr<IMFMediaBuffer> buffer;
  const DWORD bytes = width * height * 3 / 2;
  if (FAILED(hr = MFCreateMemoryBuffer(bytes, &buffer))) return hr;
  BYTE* data = nullptr; DWORD maxLength = 0, currentLength = 0;
  if (FAILED(hr = buffer->Lock(&data, &maxLength, &currentLength))) return hr;
  Frame frame;
  source_->NextFrame(width, height, frame);
  if (frame.bytes.size() != bytes) frame.bytes.assign(bytes, 0);
  CopyMemory(data, frame.bytes.data(), bytes);
  buffer->Unlock();
  if (FAILED(hr = buffer->SetCurrentLength(bytes))) return hr;
  Microsoft::WRL::ComPtr<IMFSample> sample;
  if (FAILED(hr = MFCreateSample(&sample))) return hr;
  sample->AddBuffer(buffer.Get());
  const LONGLONG timestamp = frame.timestamp100ns > 0 ? frame.timestamp100ns : MFGetSystemTime();
  sample->SetSampleTime(timestamp);
  sample->SetSampleDuration(333333);
  return events_->QueueEventParamUnk(MEStreamSample, GUID_NULL, S_OK, sample.Get());
}
} // namespace octo::camera
