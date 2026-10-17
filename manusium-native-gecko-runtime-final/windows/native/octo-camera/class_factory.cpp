#include "class_factory.h"
#include "camera_source.h"
#include "octo_camera_guids.h"
#include <objbase.h>

namespace octo::camera {
long g_serverLocks = 0;
HMODULE g_module = nullptr;

HRESULT ClassFactory::QueryInterface(REFIID riid, void** object) { if (!object) return E_POINTER; *object = nullptr; if (riid == IID_IUnknown || riid == IID_IClassFactory) *object = static_cast<IClassFactory*>(this); else return E_NOINTERFACE; AddRef(); return S_OK; }
ULONG ClassFactory::AddRef() { return 2; }
ULONG ClassFactory::Release() { return 1; }
HRESULT ClassFactory::CreateInstance(IUnknown* outer, REFIID riid, void** object) { if (outer) return CLASS_E_NOAGGREGATION; return VirtualCameraSource::CreateInstance(riid, object); }
HRESULT ClassFactory::LockServer(BOOL lock) { if (lock) InterlockedIncrement(&g_serverLocks); else InterlockedDecrement(&g_serverLocks); return S_OK; }
}

extern "C" HRESULT __declspec(dllexport) __stdcall DllGetClassObject(REFCLSID clsid, REFIID riid, void** object) {
  if (clsid != octo::camera::CLSID_OctoCameraSource) return CLASS_E_CLASSNOTAVAILABLE;
  static octo::camera::ClassFactory factory;
  return factory.QueryInterface(riid, object);
}
extern "C" HRESULT __declspec(dllexport) __stdcall DllCanUnloadNow() {
  return octo::camera::g_serverLocks == 0 ? S_OK : S_FALSE;
}
