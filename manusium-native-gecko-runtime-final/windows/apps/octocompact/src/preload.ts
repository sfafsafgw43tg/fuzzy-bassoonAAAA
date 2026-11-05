import { contextBridge, ipcRenderer } from 'electron';
import type { CompactState } from './model';
contextBridge.exposeInMainWorld('compact', {
  command: (action: string, value?: unknown) => ipcRenderer.invoke('compact:command', action, value),
  onState: (listener: (state: CompactState) => void) => {
    ipcRenderer.on('compact:state', (_event, state: CompactState) => listener(state));
  },
});
// Focus stays in the trusted chrome; websites receive no preload bridge.
ipcRenderer.on('compact:focus', () => window.dispatchEvent(new Event('compact-focus')));
