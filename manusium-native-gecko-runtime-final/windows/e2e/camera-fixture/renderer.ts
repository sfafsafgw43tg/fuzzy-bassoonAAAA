// Test-only harness: fake camera acquisition, production picker and capture owner.
import { cameraPicker, checkHostCamera } from '../../apps/octobrowser/src/renderer/launcher-android-cameras';
import { setDicts } from '../../packages/shell/renderer/i18n-client';
import { DICTS } from '../../packages/core/src/i18n';
setDicts(DICTS);
let acquisitions = 0;
let stops = 0;
let queuedComplete = false;
let resolveCapture: ((stream: unknown) => void) | undefined;
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
  enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'test-camera', label: 'Test camera' }],
  getUserMedia: () => { acquisitions++; return new Promise(resolve => { resolveCapture = resolve; }); },
  addEventListener() {}, removeEventListener() {},
} });
const picker = cameraPicker({ initial: { front: 'none', back: 'none', frontDevice: '', backDevice: '' } });
document.body.append(picker.element);
Object.assign(window, { cameraHarness: {
  value: picker.value,
  queue: () => { void checkHostCamera({ name: 'webcam0', device: 'Test camera', virtual: false }).then(() => { queuedComplete = true; }); },
  queuedComplete: () => queuedComplete,
  refresh: picker.refresh,
  stats: () => ({ acquisitions, stops }),
  listed: () => window.octo.invoke('fixture:list'),
  deliver: () => { resolveCapture?.({ getTracks: () => [{ stop: () => { stops++; } }] }); },
  remove: () => picker.element.remove(),
} });
