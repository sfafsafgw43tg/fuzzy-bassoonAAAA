#include "class_factory.h"
#include <Windows.h>
#include <mfapi.h>

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    DisableThreadLibraryCalls(module);
    octo::camera::g_module = module;
    // MFStartup is intentionally performed by the frame-server activation path,
    // not from DllMain. The source itself does not run work under the loader lock.
  }
  return TRUE;
}
