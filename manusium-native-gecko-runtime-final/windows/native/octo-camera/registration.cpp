#include "registration.h"
#include "octo_camera_guids.h"
#include <mfvirtualcamera.h>
#include <mfapi.h>
#include <mferror.h>
#include <shlwapi.h>
#include <filesystem>

namespace octo::camera {
static std::wstring ClsidKey() { return L"Software\\Classes\\CLSID\\" + std::wstring(kSourceClsid); }

HRESULT InstallCurrentUser(const std::wstring& sourceDll) {
  if (sourceDll.empty()) return E_INVALIDARG;
  std::error_code error;
  const auto absolute = std::filesystem::absolute(sourceDll, error);
  if (error || !std::filesystem::is_regular_file(absolute, error)) return HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);
  HKEY clsid = nullptr, inproc = nullptr;
  LSTATUS status = RegCreateKeyExW(HKEY_CURRENT_USER, ClsidKey().c_str(), 0, nullptr, 0, KEY_WRITE, nullptr, &clsid, nullptr);
  if (status != ERROR_SUCCESS) return HRESULT_FROM_WIN32(status);
  status = RegCreateKeyExW(clsid, L"InprocServer32", 0, nullptr, 0, KEY_WRITE, nullptr, &inproc, nullptr);
  if (status == ERROR_SUCCESS) {
    const std::wstring path = absolute.wstring();
    status = RegSetValueExW(inproc, nullptr, 0, REG_SZ, reinterpret_cast<const BYTE*>(path.c_str()), static_cast<DWORD>((path.size() + 1) * sizeof(wchar_t)));
    if (status == ERROR_SUCCESS) status = RegSetValueExW(inproc, L"ThreadingModel", 0, REG_SZ, reinterpret_cast<const BYTE*>(L"Both"), 10 * sizeof(wchar_t));
  }
  if (inproc) RegCloseKey(inproc);
  if (clsid) RegCloseKey(clsid);
  if (status != ERROR_SUCCESS) return HRESULT_FROM_WIN32(status);

  HRESULT hr = MFStartup(MF_VERSION);
  if (FAILED(hr)) return hr;
  IMFVirtualCamera* camera = nullptr;
  hr = MFCreateVirtualCamera(MFVirtualCameraType_SoftwareCameraSource, MFVirtualCameraLifetime_System, MFVirtualCameraAccess_CurrentUser,
    kFriendlyName, kSourceClsid, nullptr, 0, &camera);
  if (SUCCEEDED(hr)) hr = camera->Start(nullptr);
  if (camera) { camera->Shutdown(); camera->Release(); }
  MFShutdown();
  return hr;
}

HRESULT UninstallCurrentUser() {
  HRESULT hr = MFStartup(MF_VERSION);
  if (FAILED(hr)) return hr;
  IMFVirtualCamera* camera = nullptr;
  hr = MFCreateVirtualCamera(MFVirtualCameraType_SoftwareCameraSource, MFVirtualCameraLifetime_System, MFVirtualCameraAccess_CurrentUser,
    kFriendlyName, kSourceClsid, nullptr, 0, &camera);
  if (SUCCEEDED(hr)) { camera->Stop(); hr = camera->Remove(); camera->Shutdown(); camera->Release(); }
  MFShutdown();
  RegDeleteTreeW(HKEY_CURRENT_USER, ClsidKey().c_str());
  return SUCCEEDED(hr) || hr == MF_E_NOT_FOUND ? S_OK : hr;
}

HRESULT IsInstalled(bool& installed) {
  installed = false;
  HKEY key = nullptr;
  const LSTATUS status = RegOpenKeyExW(HKEY_CURRENT_USER, ClsidKey().c_str(), 0, KEY_READ, &key);
  if (status == ERROR_FILE_NOT_FOUND) return S_OK;
  if (status != ERROR_SUCCESS) return HRESULT_FROM_WIN32(status);
  installed = true;
  RegCloseKey(key);
  return S_OK;
}
} // namespace octo::camera
