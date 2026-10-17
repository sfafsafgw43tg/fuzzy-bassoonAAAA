#include "registration.h"
#include <Windows.h>
#include <iostream>

int wmain(int argc, wchar_t** argv) {
  if (argc < 2) { std::wcerr << L"usage: octo-cameractl install --source <dll> | uninstall | status\n"; return 2; }
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
  if (FAILED(hr)) { std::wcerr << L"Octo Camera failed: 0x" << std::hex << static_cast<unsigned long>(hr) << L"\n"; return 1; }
  std::wcout << L"ok\n"; return 0;
}
