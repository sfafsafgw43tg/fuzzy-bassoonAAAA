#pragma once
#include <Windows.h>
#include <unknwn.h>

namespace octo::camera {
class ClassFactory final : public IClassFactory {
 public:
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** object) override;
  ULONG STDMETHODCALLTYPE AddRef() override;
  ULONG STDMETHODCALLTYPE Release() override;
  HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer, REFIID riid, void** object) override;
  HRESULT STDMETHODCALLTYPE LockServer(BOOL lock) override;
};
extern long g_serverLocks;
extern HMODULE g_module;
} // namespace octo::camera
