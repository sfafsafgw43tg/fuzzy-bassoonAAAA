#include "media_types.h"
#include <mfapi.h>
#include <mferror.h>

namespace octo::camera {

HRESULT BuildNv12Type(UINT32 width, UINT32 height, Microsoft::WRL::ComPtr<IMFMediaType>& type) {
  type.Reset();
  HRESULT hr = MFCreateMediaType(&type);
  if (FAILED(hr)) return hr;
  if (FAILED(hr = type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video))) return hr;
  if (FAILED(hr = type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12))) return hr;
  if (FAILED(hr = type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive))) return hr;
  if (FAILED(hr = MFSetAttributeSize(type.Get(), MF_MT_FRAME_SIZE, width, height))) return hr;
  if (FAILED(hr = MFSetAttributeRatio(type.Get(), MF_MT_FRAME_RATE, 30, 1))) return hr;
  if (FAILED(hr = MFSetAttributeRatio(type.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1))) return hr;
  if (FAILED(hr = type->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE))) return hr;
  return type->SetUINT32(MF_MT_DEFAULT_STRIDE, static_cast<UINT32>(width));
}

HRESULT BuildVideoTypeList(IMFStreamDescriptor** descriptor) {
  if (!descriptor) return E_POINTER;
  *descriptor = nullptr;
  Microsoft::WRL::ComPtr<IMFMediaType> types[2];
  HRESULT hr = BuildNv12Type(1920, 1080, types[0]);
  if (FAILED(hr)) return hr;
  hr = BuildNv12Type(1280, 720, types[1]);
  if (FAILED(hr)) return hr;
  IMFMediaType* raw[] = { types[0].Get(), types[1].Get() };
  return MFCreateStreamDescriptor(0, 2, raw, descriptor);
}

} // namespace octo::camera
