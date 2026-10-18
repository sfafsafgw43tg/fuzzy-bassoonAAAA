#include "registration.h"
#include <Windows.h>
#include <objbase.h>
#include <shellapi.h>
#include <iostream>

namespace {
bool IsAccessDenied(HRESULT hr) {
  return hr == E_ACCESSDENIED || hr == HRESULT_FROM_WIN32(ERROR_ACCESS_DENIED);
}

HRESULT RunElevatedDirectShow(const std::wstring& action, const std::wstring& filterDll) {
  wchar_t modulePath[MAX_PATH]{};
  const DWORD length = GetModuleFileNameW(nullptr, modulePath, ARRAYSIZE(modulePath));
  if (length == 0 || length >= ARRAYSIZE(modulePath)) return HRESULT_FROM_WIN32(GetLastError());
  const std::wstring parameters = action + L" \"" + filterDll + L"\"";
  SHELLEXECUTEINFOW execute{};
  execute.cbSize = sizeof(execute);
  execute.fMask = SEE_MASK_NOCLOSEPROCESS;
  execute.lpVerb = L"runas";
  execute.lpFile = modulePath;
  execute.lpParameters = parameters.c_str();
  execute.nShow = SW_HIDE;
  if (!ShellExecuteExW(&execute)) return HRESULT_FROM_WIN32(GetLastError());
  WaitForSingleObject(execute.hProcess, INFINITE);
  DWORD exitCode = 1;
  GetExitCodeProcess(execute.hProcess, &exitCode);
  CloseHandle(execute.hProcess);
  return exitCode == 0 ? S_OK : HRESULT_FROM_WIN32(ERROR_ACCESS_DENIED);
}
}

int wmain(int argc, wchar_t** argv) {
  if (argc < 2) { std::wcerr << L"usage: octo-cameractl install --source <dll> --directshow <dll> | uninstall --directshow <dll> | status\n"; return 2; }
  const HRESULT com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(com) && com != RPC_E_CHANGED_MODE) {
    std::wcerr << L"COM initialization failed: 0x" << std::hex << static_cast<unsigned long>(com) << L"\n";
    return 1;
  }
  const std::wstring command = argv[1];
  HRESULT hr = S_OK;
  std::wstring sourcePath;
  std::wstring directShowPath;
  for (int i = 2; i + 1 < argc; i += 2) {
    const std::wstring option = argv[i];
    if (option == L"--source") sourcePath = argv[i + 1];
    else if (option == L"--directshow") directShowPath = argv[i + 1];
    else { std::wcerr << L"unknown option\n"; if (SUCCEEDED(com)) CoUninitialize(); return 2; }
  }
  const HRESULT apiMissing = HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
  if (command == L"register-directshow" || command == L"unregister-directshow") {
    if (argc != 3) { std::wcerr << L"registration command requires a DirectShow DLL path\n"; if (SUCCEEDED(com)) CoUninitialize(); return 2; }
    hr = command == L"register-directshow" ? octo::camera::InstallDirectShow(argv[2]) : octo::camera::UninstallDirectShow(argv[2]);
  } else if (command == L"install") {
    if (sourcePath.empty()) { std::wcerr << L"install requires --source <octo-camera-source.dll>\n"; if (SUCCEEDED(com)) CoUninitialize(); return 2; }
    hr = octo::camera::InstallCurrentUser(sourcePath);
    if (hr == apiMissing && !directShowPath.empty()) {
      hr = octo::camera::InstallDirectShow(directShowPath);
      if (IsAccessDenied(hr)) hr = RunElevatedDirectShow(L"register-directshow", directShowPath);
    }
  } else if (command == L"uninstall") {
    hr = octo::camera::UninstallCurrentUser();
    if (hr == apiMissing && !directShowPath.empty()) {
      hr = octo::camera::UninstallDirectShow(directShowPath);
      if (IsAccessDenied(hr)) hr = RunElevatedDirectShow(L"unregister-directshow", directShowPath);
    }
  } else if (command == L"status") {
    bool installed = false;
    hr = octo::camera::IsInstalled(installed);
    if (SUCCEEDED(hr) && !installed && !directShowPath.empty()) {
      bool directShowInstalled = false;
      hr = octo::camera::IsDirectShowInstalled(directShowInstalled);
      installed = directShowInstalled;
    }
    if (SUCCEEDED(hr)) { std::wcout << (installed ? L"installed\n" : L"not installed\n"); return installed ? 0 : 1; }
  } else { std::wcerr << L"unknown command\n"; return 2; }
  const bool success = SUCCEEDED(hr);
  if (!success) {
    std::wcerr << L"Octo Camera failed: 0x" << std::hex << static_cast<unsigned long>(hr) << L"\n";
    if (hr == HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND)) {
      std::wcerr << L"Install Windows 11 version 22H2 or newer from Settings > Windows Update; build 22000 or newer is required. There is no separate API package. Windows 10 needs a DirectShow backend.\n";
    }
  }
  else std::wcout << (directShowPath.empty() ? L"ok\n" : L"ok (Media Foundation or DirectShow fallback)\n");
  if (SUCCEEDED(com)) CoUninitialize();
  return success ? 0 : 1;
}
