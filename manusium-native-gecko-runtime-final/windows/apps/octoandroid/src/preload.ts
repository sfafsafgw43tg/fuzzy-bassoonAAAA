import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('octoAndroid', {
  status: () => ipcRenderer.invoke('avd:status'),
  start: (name: string) => ipcRenderer.invoke('avd:start', name),
  stop: (name: string) => ipcRenderer.invoke('avd:stop', name),
  rootCheck: (name: string) => ipcRenderer.invoke('avd:root-check', name),
  openStudio: () => ipcRenderer.invoke('avd:open-studio'),
});
