#include "registration.h"
#include <Windows.h>
#include <objbase.h>
#include <iostream>

int wmain(int argc, wchar_t** argv) {
  if (argc < 2) { std::wcerr << L"usage: octo-cameractl install --source <dll> | uninstall | status\n"; return 2; }
  const HRESULT com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(com) && com != RPC_E_CHANGED_MODE) {
    std::wcerr << L"COM initialization failed: 0x" << std::hex << static_cast<unsigned long>(com) << L"\n";
    return 1;
  }
  const std::wstring command = argv[1];
  HRESULT hr = S_OK;
  if (command == L"install") {
    if (argc != 4 || std::wstring(argv[2]) != L"--source") { std::wcerr << L"install requires --source <octo-camera-source.dll>\n"; return 2; }
    hr = octo::camera::InstallCurrentUser(argv[3]);
  } else if (command == L"uninstall") {
    hr = octo::camera::UninstallCurrentUser();
  } else if (command == L"status") {
    bool installed = false; hr = octo::camera::IsInstalled(installed);
    if (SUCCEEDED(hr)) { std::wcout << (installed ? L"installed\n" : L"not installed\n"); return installed ? 0 : 1; }
  } else { std::wcerr << L"unknown command\n"; return 2; }
  const bool success = SUCCEEDED(hr);
  if (!success) {
    std::wcerr << L"Octo Camera failed: 0x" << std::hex << static_cast<unsigned long>(hr) << L"\n";
    if (hr == HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND)) {
      std::wcerr << L"Install Windows 11 version 22H2 or newer from Settings > Windows Update; build 22000 or newer is required. There is no separate API package. Windows 10 needs a DirectShow backend.\n";
    }
  }
  else std::wcout << L"ok\n";
  if (SUCCEEDED(com)) CoUninitialize();
  return success ? 0 : 1;
}
