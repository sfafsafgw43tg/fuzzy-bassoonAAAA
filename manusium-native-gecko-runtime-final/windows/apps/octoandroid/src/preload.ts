import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('octoAndroid', {
  status: () => ipcRenderer.invoke('avd:status'),
  images: () => ipcRenderer.invoke('avd:images'),
  create: (input: { name: string; image: string; device?: string }) => ipcRenderer.invoke('avd:create', input),
  delete: (name: string) => ipcRenderer.invoke('avd:delete', name),
  folder: (name: string) => ipcRenderer.invoke('avd:folder', name),
  start: (name: string) => ipcRenderer.invoke('avd:start', name),
  stop: (name: string) => ipcRenderer.invoke('avd:stop', name),
  rootCheck: (name: string) => ipcRenderer.invoke('avd:root-check', name),
  openStudio: () => ipcRenderer.invoke('avd:open-studio'),
});
