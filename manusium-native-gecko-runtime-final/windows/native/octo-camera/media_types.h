#pragma once

#include <mfapi.h>
#include <mfidl.h>
#include <wrl/client.h>

namespace octo::camera {

HRESULT BuildNv12Type(UINT32 width, UINT32 height, Microsoft::WRL::ComPtr<IMFMediaType>& type);
HRESULT BuildVideoTypeList(IMFStreamDescriptor** descriptor);

} // namespace octo::camera
