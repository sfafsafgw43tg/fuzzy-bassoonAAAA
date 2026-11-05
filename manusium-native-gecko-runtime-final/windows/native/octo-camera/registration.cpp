#include "registration.h"
#include "octo_camera_guids.h"
#include <mfvirtualcamera.h>
#include <mfapi.h>
#include <mferror.h>
#include <shlwapi.h>
#include <dshow.h>
#include <filesystem>

namespace octo::camera {
static std::wstring ClsidKey() { return L"Software\\Classes\\CLSID\\" + std::wstring(kSourceClsid); }
static std::wstring DirectShowClsidKey() { return L"Software\\Classes\\CLSID\\" + std::wstring(kDirectShowClsid); }

using CreateVirtualCameraFn = HRESULT (WINAPI*)(
  MFVirtualCameraType, MFVirtualCameraLifetime, MFVirtualCameraAccess,
  LPCWSTR, LPCWSTR, const GUID*, ULONG, IMFVirtualCamera**);

static HRESULT CreateVirtualCamera(
    MFVirtualCameraType type, MFVirtualCameraLifetime lifetime,
    MFVirtualCameraAccess access, LPCWSTR friendlyName, LPCWSTR sourceId,
    IMFVirtualCamera** camera, HMODULE* module) {
  if (!camera || !module) return E_POINTER;
  *camera = nullptr;
  *module = LoadLibraryW(L"mfsensorgroup.dll");
  if (!*module) return HRESULT_FROM_WIN32(GetLastError());
  const auto create = reinterpret_cast<CreateVirtualCameraFn>(
      GetProcAddress(*module, "MFCreateVirtualCamera"));
  if (!create) {
    FreeLibrary(*module);
    *module = nullptr;
    return HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
  }
  const HRESULT hr = create(type, lifetime, access, friendlyName, sourceId,
                             nullptr, 0, camera);
  if (FAILED(hr)) {
    FreeLibrary(*module);
    *module = nullptr;
  }
  return hr;
}

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
  HMODULE module = nullptr;
  hr = CreateVirtualCamera(MFVirtualCameraType_SoftwareCameraSource, MFVirtualCameraLifetime_System, MFVirtualCameraAccess_CurrentUser,
    kFriendlyName, kSourceClsid, &camera, &module);
  if (SUCCEEDED(hr)) hr = camera->Start(nullptr);
  if (camera) { camera->Shutdown(); camera->Release(); }
  if (module) FreeLibrary(module);
  MFShutdown();
  return hr;
}

HRESULT UninstallCurrentUser() {
  HRESULT hr = MFStartup(MF_VERSION);
  if (FAILED(hr)) return hr;
  IMFVirtualCamera* camera = nullptr;
  HMODULE module = nullptr;
  hr = CreateVirtualCamera(MFVirtualCameraType_SoftwareCameraSource, MFVirtualCameraLifetime_System, MFVirtualCameraAccess_CurrentUser,
    kFriendlyName, kSourceClsid, &camera, &module);
  if (SUCCEEDED(hr)) { camera->Stop(); hr = camera->Remove(); camera->Shutdown(); camera->Release(); }
  if (module) FreeLibrary(module);
  MFShutdown();
  RegDeleteTreeW(HKEY_CURRENT_USER, ClsidKey().c_str());
  return SUCCEEDED(hr) || hr == MF_E_NOT_FOUND ? S_OK : hr;
}

using RegistrationFn = HRESULT (STDAPICALLTYPE*)();

static HRESULT CallDirectShowRegistration(const std::wstring& filterDll, const char* exportName) {
  if (filterDll.empty()) return E_INVALIDARG;
  std::error_code error;
  const auto absolute = std::filesystem::absolute(filterDll, error);
  if (error || !std::filesystem::is_regular_file(absolute, error)) return HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);
  HMODULE module = LoadLibraryW(absolute.c_str());
  if (!module) return HRESULT_FROM_WIN32(GetLastError());
  const auto entry = reinterpret_cast<RegistrationFn>(GetProcAddress(module, exportName));
  const HRESULT hr = entry ? entry() : HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
  FreeLibrary(module);
  return hr;
}

static void RemoveLegacyDirectShowEntry() {
  IFilterMapper2* mapper = nullptr;
  if (SUCCEEDED(CoCreateInstance(CLSID_FilterMapper2, nullptr, CLSCTX_INPROC_SERVER,
                                 IID_IFilterMapper2, reinterpret_cast<void**>(&mapper)))) {
    mapper->UnregisterFilter(&CLSID_VideoInputDeviceCategory, 0, CLSID_OctoCameraSource);
    mapper->Release();
  }
}

HRESULT InstallDirectShow(const std::wstring& filterDll) {
  const HRESULT hr = CallDirectShowRegistration(filterDll, "DllRegisterServer");
  if (SUCCEEDED(hr)) RemoveLegacyDirectShowEntry();
  return hr;
}

HRESULT UninstallDirectShow(const std::wstring& filterDll) {
  return CallDirectShowRegistration(filterDll, "DllUnregisterServer");
}

HRESULT IsDirectShowInstalled(bool& installed) {
  installed = false;
  HKEY key = nullptr;
  const LSTATUS status = RegOpenKeyExW(HKEY_CLASSES_ROOT, DirectShowClsidKey().c_str(), 0, KEY_READ, &key);
  if (status == ERROR_FILE_NOT_FOUND) return S_OK;
  if (status != ERROR_SUCCESS) return HRESULT_FROM_WIN32(status);
  installed = true;
  RegCloseKey(key);
  return S_OK;
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
