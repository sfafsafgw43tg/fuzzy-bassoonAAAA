#pragma once

#include <Windows.h>
#include <string>

namespace octo::camera {
inline constexpr wchar_t kFriendlyName[] = L"Octo Camera";
inline constexpr wchar_t kSourceClsid[] = L"{6E5E5D49-7B17-4D0E-A8B3-5E5A4B0C8D21}";

HRESULT InstallCurrentUser(const std::wstring& sourceDll);
HRESULT UninstallCurrentUser();
HRESULT InstallDirectShow(const std::wstring& filterDll);
HRESULT UninstallDirectShow(const std::wstring& filterDll);
HRESULT IsInstalled(bool& installed);

} // namespace octo::camera
