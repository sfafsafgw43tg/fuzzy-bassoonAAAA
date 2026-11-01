import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('octoCamera', {
  avds: (): Promise<string[]> => ipcRenderer.invoke('camera:avds'),
  devices: (): Promise<Array<{ serial: string; state: string }>> => ipcRenderer.invoke('camera:devices'),
  pick: (kind: 'image' | 'video'): Promise<string> => ipcRenderer.invoke('camera:pick', kind),
  apply: (input: { avd: string; source: string; type: 'image' | 'video'; width: number; height: number; fit: 'stretch' | 'fit' | 'crop'; serial?: string }) => ipcRenderer.invoke('camera:apply', input),
  installController: (serial?: string): Promise<string> => ipcRenderer.invoke('camera:install-controller', serial),
});
