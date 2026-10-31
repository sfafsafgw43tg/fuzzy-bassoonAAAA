/** Shared AVD camera controls. A route is offered only after the emulator lists
 * it. Host capture testing is opt-in and can be stopped for Android-only use.
 * A configured endpoint is never labelled a verified camera without a live test.
 */
import { api } from '@octo/shell/renderer/bridge';
import { h, t } from '@octo/shell/renderer/i18n-client';
import { icon } from '@octo/shell/renderer/icons';
import { errText, field, run, select, toast } from './launcher-ui';
import {
  resolveAvdCameraSelection, classifyCameraFailure, pickCameraForEmulator, type CameraFailure,
} from '@octo/core/android-camera';
import { CameraTestManager } from './camera-test-manager';
const cameraTests = new CameraTestManager();

/** A lens is fed from a host camera (`webcam`), or it is off (`none`). */
export type CameraSource = 'none' | 'webcam' | 'emulated' | 'image' | 'video';
export type CameraFacing = 'front' | 'back';
export interface CameraResolution { width: number; height: number }

/** A camera the Android Emulator lists on this computer, under the name the emulator gave it. */
export interface EmulatorCamera {
  /** The name on the emulator's command line, e.g. "webcam0". */
  name: string;
  /** The Windows name of the camera, used to find the same camera in the browser. Empty when Windows gave none. */
  device: string;
  /** Vendor and product ID as "04f2:b6d0", when the camera has one. */
  hardwareId?: string;
  virtual: boolean;
  foreign?: boolean;
}

/** Why the emulator's list is empty: it timed out, it reported a failure, or it found no camera. */
export type CameraProblem = '' | 'timeout' | 'reported' | 'none';

/** What the main process answers. These cameras are listed, not yet proven to work. */
export interface CameraChoices {
  webcams: EmulatorCamera[];
  emulatorAvailable: boolean;
  hostCameraCount?: number;
  emulatorPath?: string;
  sdkRoot?: string;
  problem?: CameraProblem;
  detail?: string;
}

export interface CameraSelection {
  front: CameraSource;
  back: CameraSource;
  /** Emulator endpoint (webcam0...) of the camera on that lens; '' when the lens is off. */
  frontDevice: string;
  backDevice: string;
  /** What a check measured, so Android is not told a resolution that cannot arrive. */
  frontLimit?: CameraResolution;
  backLimit?: CameraResolution;
  /** Provider selected for the endpoint, used to request provider-specific setup. */
  cameraProvider?: 'lensio' | 'obs' | 'directshow';
}

export interface CameraPickerOptions {
  /** What the device is configured with right now. */
  initial: Partial<CameraSelection>;
  /** AVD name used when configuring the live-image companion. */
  deviceName?: string;
  /** Called after every scan, with the selection that will be saved. */
  onChange?: (value: CameraSelection) => void;
  /** Called after every scan, with the cameras that work right now. */
  onWorking?: (working: Array<{ name: string; label: string }>) => void;
}

export interface CameraPicker {
  element: HTMLElement;
  value: () => CameraSelection;
  refresh: () => Promise<void>;
}

/** The outcome of opening one camera. */
export interface CameraCheck {
  ok: boolean;
  width: number;
  height: number;
  failure?: CameraFailure;
}

/** How long a camera may take to send its first picture. A phone used as a webcam can take several seconds. */
const FIRST_PICTURE_MS = 8000;
/** The longest one whole check may take, including a driver that never answers. */
const CHECK_LIMIT_MS = 12000;
/** How often the emulator's list is re-read while the picker is on screen. */
const POLL_MS = 5000;
/**
 * A check is reused for this long when a picker opens again (the creator
 * rebuilds its panel on every step), so a camera is not opened again each time.
 * Refresh always checks again.
 */
const RECENT_CHECK_MS = 15_000;
/** The last check of each camera, shared by every picker on screen. */
const recentChecks = new Map<string, { at: number; check: CameraCheck }>();

const NO_PICTURE: CameraCheck = { ok: false, width: 0, height: 0, failure: 'failed' };

/** Checks run one at a time: two cameras opened together can starve each other. */
let checkQueue: Promise<unknown> = Promise.resolve();
function queued<T>(task: () => Promise<T>): Promise<T> {
  const next = checkQueue.then(task, task);
  checkQueue = next.catch(() => undefined);
  return next;
}

/** Null when the call failed: an unanswered list must not read as "no cameras". */
async function loadCameraChoices(): Promise<CameraChoices | null> {
  const result = await run(api.invoke<CameraChoices>('mgr:android-camera-choices'));
  return result ?? null;
}

function sourceOf(device: string): CameraSource {
  return device ? 'webcam' : 'none';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function videoInputs(): Promise<MediaDeviceInfo[]> {
  return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
}

/** How many cameras Windows reports to the browser. Counting needs no permission, so it works before any check. */
async function countWindowsCameras(): Promise<number> {
  try { return (await videoInputs()).length; } catch { return 0; }
}

/** The name shown for a camera: its Windows name, else its hardware ID, else a plain label. Never a device path or a number. */
function displayName(camera: EmulatorCamera): string {
  const label = camera.device || (camera.hardwareId ? t('android.camera.hardwareName', { id: camera.hardwareId }) : t('android.camera.webcam'));
  return camera.virtual ? `${t('android.camera.virtualDevice')} · ${label}` : label;
}

/** One open camera, so that whatever happens it can be released at once. */
interface Attempt {
  stream?: MediaStream;
  video?: HTMLVideoElement;
  closed: boolean;
  lease: NonNullable<ReturnType<CameraTestManager['begin']>>;
}

function release(attempt: Attempt): void {
  attempt.closed = true;
  attempt.stream?.getTracks().forEach((track) => track.stop());
  attempt.stream = undefined;
  if (attempt.video) {
    attempt.video.srcObject = null;
    attempt.video.remove();
    attempt.video = undefined;
  }
}

/** Resolves true once the camera has reported its picture size, or false after the wait. */
function firstPicture(video: HTMLVideoElement, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let timer = 0;
    const done = () => { window.clearTimeout(timer); resolve(video.videoWidth > 0); };
    timer = window.setTimeout(done, ms);
    if (video.videoWidth > 0) done();
    else video.addEventListener('loadedmetadata', done, { once: true });
  });
}

/**
 * Open the emulator's camera, wait for its first picture, and report what came
 * back. Browser labels stay hidden until a camera has been opened with
 * permission, so when no camera has a label yet, one short default stream
 * reveals them; that stream is closed before the real camera is opened.
 */
async function pictureOf(emulator: EmulatorCamera, attempt: Attempt): Promise<CameraCheck> {
  try {
    let cameras = await videoInputs();
    if (attempt.closed || attempt.lease.signal.aborted) return NO_PICTURE;
    if (!pickCameraForEmulator(cameras, emulator) && cameras.every((item) => !item.label)) {
      const reveal = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      attempt.lease.track(reveal);
      if (attempt.lease.signal.aborted) return NO_PICTURE;
      reveal.getTracks().forEach((track) => track.stop());
      // Windows drivers that allow one user need a moment before they can be opened again.
      await delay(300);
      cameras = await videoInputs();
    }
    if (attempt.closed || attempt.lease.signal.aborted) return NO_PICTURE;
    const match = pickCameraForEmulator(cameras, emulator);
    if (!match) return { ok: false, width: 0, height: 0, failure: 'unavailable' };
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: match.deviceId } }, audio: false });
    attempt.lease.track(stream);
    // A late driver response is stopped even when the manager is already off.
    if (attempt.closed || attempt.lease.signal.aborted) {
      stream.getTracks().forEach((track) => track.stop());
      return NO_PICTURE;
    }
    attempt.stream = stream;
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    // In the page but off screen: some builds decode nothing for a detached video.
    video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.append(video);
    attempt.video = video;
    video.srcObject = stream;
    await firstPicture(video, FIRST_PICTURE_MS);
    const track = stream.getVideoTracks()[0];
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width > 0 && height > 0 && track?.readyState === 'live') return { ok: true, width, height };
    return NO_PICTURE;
  } catch (error) {
    console.debug('[camera] check failed', error);
    return { ok: false, width: 0, height: 0, failure: classifyCameraFailure(error as { name?: unknown; message?: unknown }) };
  }
}

/**
 * Open one emulator camera, see whether it sends a picture, and release it at
 * once. Nothing is kept open: a camera that is held here is one the emulator
 * or a website cannot use.
 */
export function checkHostCamera(camera: EmulatorCamera): Promise<CameraCheck> {
  const generation = cameraTests.generation;
  return queued(async () => {
    if (!cameraTests.enabled || generation !== cameraTests.generation) return NO_PICTURE;
    const lease = cameraTests.begin();
    if (!lease) return NO_PICTURE;
    const attempt: Attempt = { closed: false, lease };
    const cancelled = new Promise<CameraCheck>(resolve => lease.signal.addEventListener('abort', () => resolve(NO_PICTURE), { once: true }));
    let timer = 0;
    const limit = new Promise<CameraCheck>((resolve) => {
      timer = window.setTimeout(() => resolve(NO_PICTURE), CHECK_LIMIT_MS);
    });
    try {
      return await Promise.race([pictureOf(camera, attempt), limit, cancelled]);
    } finally {
      window.clearTimeout(timer);
      release(attempt);
      lease.close();
    }
  });
}

export function cameraPicker(options: CameraPickerOptions): CameraPicker {
  const selection: CameraSelection = {
    front: options.initial.front === 'none' ? 'none' : options.initial.front === 'emulated' ? 'emulated' : options.initial.front === 'video' ? 'video' : 'webcam',
    back: options.initial.back === 'none' ? 'none' : options.initial.back === 'emulated' ? 'emulated' : options.initial.back === 'video' ? 'video' : 'webcam',
    frontDevice: options.initial.front === 'none' || options.initial.front === 'emulated' ? '' : options.initial.frontDevice ?? '',
    backDevice: options.initial.back === 'none' || options.initial.back === 'emulated' ? '' : options.initial.backDevice ?? '',
    frontLimit: options.initial.frontLimit,
    backLimit: options.initial.backLimit,
    cameraProvider: options.initial.cameraProvider,
  };
  // A remembered measurement is a fact about the camera, not about this window.
  const measured = new Map<string, CameraResolution>();
  if (selection.frontDevice && selection.frontLimit) measured.set(selection.frontDevice, selection.frontLimit);
  if (selection.backDevice && selection.backLimit) measured.set(selection.backDevice, selection.backLimit);

  let listed: EmulatorCamera[] = [];
  /** The last check of each listed camera, valid only while the camera keeps its name and device. */
  const checks = new Map<string, { key: string; check: CameraCheck }>();
  let loaded = false;
  let loadFailed = false;
  let noEmulator = false;
  let checking = false;
  let scanning = false;
  let attached = false;
  let disposed = false;
  let problem: CameraProblem = '';
  let detail = '';
  let windowsCount = 0;
  let hostCameraCount = 0;
  let liveImages: string[] = [];
  let liveImageIndex = 0;
  let liveFacing: CameraFacing = 'back';
  let liveFit: 'fill' | 'fit' | 'stretch' | 'blur' = 'fill';
  let liveMode: 'manual' | 'auto' | 'random' = 'manual';
  let liveInterval = 6;
  const videoDetected = new Map<CameraFacing, boolean>();

  const keyOf = (camera: EmulatorCamera): string => `${camera.name}\u0001${camera.device}`;
  const checkOf = (camera: EmulatorCamera): CameraCheck | undefined => {
    const entry = checks.get(camera.name);
    return entry?.key === keyOf(camera) ? entry.check : undefined;
  };
  /** The listed cameras that opened and sent a picture, in the emulator's order. */
  const working = (): EmulatorCamera[] => listed.filter((camera) => checkOf(camera)?.ok === true);

  const backSlot = h('div', { class: 'vbox-live-host' });
  const frontSlot = h('div', { class: 'vbox-live-host' });
  const statusSlot = h('div', { class: 'camera-scan-status', role: 'status' });
  const livePanel = h('section', { class: 'camera-live-panel', hidden: 'true' });
  const previewVideo = h('video', { class: 'android-camera-preview', autoplay: '', muted: '', playsinline: '', hidden: 'true', 'aria-label': t('android.camera.preview') }) as HTMLVideoElement;
  const previewButton = h('button', { type: 'button', class: 'btn small', text: t('android.camera.preview') }) as HTMLButtonElement;
  const previewStatus = h('p', { class: 'hint', 'aria-live': 'polite', text: t('android.camera.previewHint') });
  let previewStream: MediaStream | undefined;
  const stopPreview = (): void => {
    previewStream?.getTracks().forEach((track) => track.stop());
    previewStream = undefined;
    previewVideo.srcObject = null;
    previewVideo.hidden = true;
    previewButton.textContent = t('android.camera.preview');
  };
  const startPreview = async (): Promise<void> => {
    stopPreview();
    if (selection.front === 'image' || selection.back === 'image') {
      previewStatus.textContent = 'A still image is configured for the selected camera.';
      return;
    }
    if (selection.front === 'video' || selection.back === 'video') {
      previewStatus.textContent = t('android.camera.videoFileHint');
      return;
    }
    const endpoint = selection.backDevice || selection.frontDevice;
    if (!endpoint || selection.back === 'none' && selection.front === 'none') {
      previewStatus.textContent = t('android.camera.previewOff');
      return;
    }
    previewButton.disabled = true;
    try {
      let devices = await videoInputs();
      if (devices.every((device) => !device.label)) {
        const reveal = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        reveal.getTracks().forEach((track) => track.stop());
        await delay(250);
        devices = await videoInputs();
      }
      const emulator = listed.find((item) => item.name === endpoint);
      const match = emulator ? pickCameraForEmulator(devices, emulator) : undefined;
      if (!match) {
        previewStatus.textContent = t('android.camera.previewUnavailable');
        return;
      }
      previewStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: match.deviceId } }, audio: false });
      previewVideo.srcObject = previewStream;
      previewVideo.hidden = false;
      await previewVideo.play().catch(() => undefined);
      previewButton.textContent = t('android.camera.stopPreview');
      previewStatus.textContent = t('android.camera.previewLive', { name: match.label || endpoint });
    } catch (error) {
      stopPreview();
      previewStatus.textContent = t('android.camera.previewFailed', { reason: classifyCameraFailure(error as { name?: unknown; message?: unknown }) });
    } finally {
      previewButton.disabled = false;
    }
  };
  previewButton.onclick = () => { if (previewStream) stopPreview(); else void startPreview(); };
  const obsButton = h('button', { type: 'button', class: 'btn small', text: t('android.camera.startObs') }) as HTMLButtonElement;
  obsButton.onclick = async () => {
    obsButton.disabled = true;
    const result = await api.invoke<{ ok: boolean; message: string }>('mgr:android-start-obs')
      .catch((error: unknown) => ({ ok: false, message: errText(error) }));
    toast(result.message, result.ok ? 'ok' : 'info');
    previewStatus.textContent = result.message;
    obsButton.disabled = false;
    await scan(true);
  };
  const refreshButton = h('button', { type: 'button', class: 'btn small' },
    icon('refreshCircle', 14), h('span', { text: t('common.refresh') })) as HTMLButtonElement;
  refreshButton.onclick = () => void scan(true);
  const hostToggle = h('input', { type: 'checkbox' }) as HTMLInputElement;
  hostToggle.checked = cameraTests.enabled;
  hostToggle.onchange = () => cameraTests.setEnabled(hostToggle.checked);
  const both = h('button', { type: 'button', class: 'btn small', text: t('android.camera.useWebcam0Both') });
  both.onclick = () => {
    if (!listed.some((camera) => camera.name === 'webcam0')) return;
    cameraTests.setEnabled(false);
    setDevice('front', 'webcam0'); setDevice('back', 'webcam0');
    paintLenses(); paintStatus(); emit();
  };
  const off = h('button', { type: 'button', class: 'btn small', text: t('android.camera.disableBoth') });
  off.onclick = () => { cameraTests.setEnabled(false); setDevice('front', ''); setDevice('back', ''); paintLenses(); paintStatus(); emit(); };

  async function useObs(facing: CameraFacing): Promise<void> {
    stopPreview();
    const result = await api.invoke<{ ok: boolean; message: string }>('mgr:android-start-obs')
      .catch((error: unknown) => ({ ok: false, message: errText(error) }));
    toast(result.message, result.ok ? 'ok' : 'info');
    await scan(true);
    const virtual = listed.find(camera => camera.virtual);
    if (!virtual) {
      toast(t('android.camera.virtualUnavailable'), 'info');
      paintStatus();
      return;
    }
    setSource(facing, 'webcam', virtual.name);
    paintLenses(); paintStatus(); emit();
  }

  async function useLiveImage(facing: CameraFacing): Promise<void> {
    stopPreview();
    liveFacing = facing;
    const picked = await api.invoke<string[]>('mgr:pick-images', {
      extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'],
    }).catch(() => []);
    if (!picked.length) return;
    if (!options.deviceName) {
      toast(t('android.camera.liveImageUnavailable'), 'info');
      return;
    }
    const result = await api.invoke<{ ok: boolean; message: string }>('mgr:android-live-image', {
      deviceName: options.deviceName,
      imagePaths: picked,
      activeIndex: 0,
      imageFit: liveFit,
      playlistMode: liveMode,
      playlistInterval: liveInterval,
    }).catch((error: unknown) => ({ ok: false, message: errText(error) }));
    toast(result.message, result.ok ? 'ok' : 'info');
    if (!result.ok) return;
    liveImages = picked;
    liveImageIndex = 0;
    paintLivePanel();
    await scan(true);
    const virtual = listed.find(camera => camera.virtual);
    if (!virtual) {
      toast(t('android.camera.virtualUnavailable'), 'info');
      paintStatus();
      return;
    }
    setSource(facing, 'webcam', virtual.name);
    selection.cameraProvider = 'lensio';
    paintLenses(); paintStatus(); emit();
  }

  async function switchLiveImage(facing: CameraFacing, delta: number): Promise<void> {
    if (!options.deviceName || !liveImages.length) {
      toast(t('android.camera.liveImagePlaylistEmpty'), 'info');
      return;
    }
    stopPreview();
    liveImageIndex = (liveImageIndex + delta + liveImages.length) % liveImages.length;
    await activateLiveImage(facing, liveImageIndex);
  }

  async function activateLiveImage(facing: CameraFacing, index: number): Promise<void> {
    if (!options.deviceName || !liveImages.length) return;
    liveFacing = facing;
    liveImageIndex = (index + liveImages.length) % liveImages.length;
    const result = await api.invoke<{ ok: boolean; message: string }>('mgr:android-live-image', {
      deviceName: options.deviceName,
      activeIndex: liveImageIndex,
      imageFit: liveFit,
      playlistMode: liveMode,
      playlistInterval: liveInterval,
    }).catch((error: unknown) => ({ ok: false, message: errText(error) }));
    toast(result.message, result.ok ? 'ok' : 'info');
    if (!result.ok) return;
    paintLivePanel();
    await scan(true);
    const virtual = listed.find(camera => camera.virtual);
    if (!virtual) { toast(t('android.camera.virtualUnavailable'), 'info'); paintStatus(); return; }
    setSource(facing, 'webcam', virtual.name);
    selection.cameraProvider = 'lensio';
    paintLenses(); paintStatus(); emit();
  }

  function paintLivePanel(): void {
    livePanel.hidden = liveImages.length === 0;
    if (!liveImages.length) { livePanel.replaceChildren(); return; }
    const cards = liveImages.map((file, index) => {
      const button = h('button', {
        type: 'button',
        class: `camera-live-image-card${index === liveImageIndex ? ' active' : ''}`,
        title: t('android.camera.selectImage', { n: String(index + 1) }),
        'aria-label': t('android.camera.selectImage', { n: String(index + 1) }),
      }) as HTMLButtonElement;
      const image = h('img', { class: 'camera-live-image-thumb', alt: t('android.camera.selectImage', { n: String(index + 1) }) }) as HTMLImageElement;
      const caption = h('span', { class: 'camera-live-image-caption', text: `${index + 1}` });
      button.append(image, caption);
      button.onclick = () => { button.disabled = true; void activateLiveImage(liveFacing, index).finally(() => { button.disabled = false; }); };
      void api.invoke<string | null>('mgr:read-image-preview', file).then((src) => { if (src) image.src = src; }).catch(() => undefined);
      return button;
    });
    const fit = select<string>(liveFit, [
      ['fill', t('android.camera.fitFill')], ['fit', t('android.camera.fitContain')],
      ['stretch', t('android.camera.fitStretch')], ['blur', t('android.camera.fitBlur')],
    ], (value) => { liveFit = value as typeof liveFit; void activateLiveImage(liveFacing, liveImageIndex); });
    const mode = select<string>(liveMode, [
      ['manual', t('android.camera.playlistManual')], ['auto', t('android.camera.playlistAuto')],
      ['random', t('android.camera.playlistRandom')],
    ], (value) => { liveMode = value as typeof liveMode; void activateLiveImage(liveFacing, liveImageIndex); });
    const interval = h('input', { type: 'number', min: '0.5', max: '3600', step: '0.5', value: String(liveInterval), title: t('android.camera.playlistInterval') }) as HTMLInputElement;
    interval.onchange = () => { liveInterval = Math.max(0.5, Math.min(3600, Number(interval.value) || 6)); interval.value = String(liveInterval); void activateLiveImage(liveFacing, liveImageIndex); };
    livePanel.replaceChildren(
      h('div', { class: 'camera-live-panel-head' },
        h('strong', { text: t('android.camera.liveImagePanel') }),
        h('span', { class: 'camera-lensio-badge', text: t('android.camera.lensioBridge') }),
        h('span', { class: 'hint', text: t('android.camera.liveImageCount', { n: String(liveImages.length) }) })),
      h('p', { class: `hint ${listed.length ? '' : 'warn'}`, text: listed.length
        ? t('android.camera.lensioEndpointReady', { endpoints: listed.map((camera) => camera.name).join(', ') })
        : t('android.camera.lensioEndpointWaiting') }),
      h('div', { class: 'camera-live-settings' },
        field('android.camera.imageFit', fit), field('android.camera.playlistMode', mode),
        field('android.camera.playlistInterval', interval)),
      h('div', { class: 'camera-live-image-grid' }, ...cards));
  }

  async function pickVideo(facing: CameraFacing): Promise<void> {
    stopPreview();
    const file = await api.invoke<string | null>('mgr:pick-file', { extensions: ['mp4', 'mkv', 'avi', 'mov'] }).catch(() => null);
    if (!file) return;
    const valid = await api.invoke<{ detected: boolean }>('mgr:validate-camera-video', file).catch(() => ({ detected: false }));
    if (!valid.detected) { toast(t('android.camera.videoFileInvalid'), 'info'); return; }
    videoDetected.set(facing, true);
    setSource(facing, 'video', file);
    paintLenses(); paintStatus(); emit();
  }
  async function pickImage(facing: CameraFacing): Promise<void> {
    stopPreview();
    const file = await api.invoke<string | null>('mgr:pick-file', { extensions: ['png', 'jpg', 'jpeg'] }).catch(() => null);
    if (!file) return;
    setSource(facing, 'image', file);
    paintLenses(); paintStatus(); emit();
  }
  const manager = h('fieldset', { class: 'camera-manager' },
    h('legend', { text: t('android.camera.manager') }),
    h('label', {}, hostToggle, h('span', { text: t('android.camera.hostTesting') })),
    h('p', { class: 'hint', text: t('android.camera.androidOnlyHint') }),
    h('div', { class: 'camera-picker-foot' }, both, off),
    h('p', { class: 'hint', text: t('android.camera.restartHint') }));
  const unsubscribe = cameraTests.subscribe(() => {
    hostToggle.checked = cameraTests.enabled;
    recentChecks.clear();
    paintStatus();
    if (cameraTests.enabled) void scan(true);
  });
  // A camera plugged in or removed is picked up by itself: Windows reports several
  // changes per plug, so the rescan waits for them to settle and never overlaps
  // (scan() is already guarded). Nothing runs while the picker is not on screen.
  let deviceSettle: ReturnType<typeof setTimeout> | undefined;
  const onDeviceChange = (): void => {
    if (!element.isConnected) return;
    clearTimeout(deviceSettle);
    deviceSettle = setTimeout(() => void scan(false), 700);
  };
  navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
  const element = h('div', { class: 'camera-picker' },
    manager,
    livePanel,
    h('div', { class: 'grid2' }, backSlot, frontSlot),
    h('div', { class: 'camera-picker-foot' }, refreshButton, obsButton, previewButton),
    previewVideo,
    previewStatus,
    statusSlot);

  const emit = (): void => {
    selection.frontLimit = selection.frontDevice ? measured.get(selection.frontDevice) : undefined;
    selection.backLimit = selection.backDevice ? measured.get(selection.backDevice) : undefined;
    options.onChange?.(value());
  };

  function value(): CameraSelection {
    return { ...selection };
  }

  function deviceOf(facing: CameraFacing): string {
    const source = facing === 'front' ? selection.front : selection.back;
    return source === 'emulated' ? 'emulated' : facing === 'front' ? selection.frontDevice : selection.backDevice;
  }

  function setDevice(facing: CameraFacing, device: string): void {
    if (facing === 'front') { selection.front = sourceOf(device); selection.frontDevice = device; }
    else { selection.back = sourceOf(device); selection.backDevice = device; }
  }

  function setSource(facing: CameraFacing, source: CameraSource, device = ''): void {
    if (facing === 'front') { selection.front = source; selection.frontDevice = source === 'webcam' || source === 'image' || source === 'video' ? device : ''; }
    else { selection.back = source; selection.backDevice = source === 'webcam' || source === 'image' || source === 'video' ? device : ''; }
  }

  /** Discovery must not erase an explicit endpoint or reactivate Off. */
  function assign(): void {
    const result = resolveAvdCameraSelection({ front: selection.front, back: selection.back },
      { front: selection.frontDevice, back: selection.backDevice },
      listed.map(camera => ({ id: camera.name, name: camera.device })));
    if (selection.front !== 'emulated' && selection.front !== 'image' && selection.front !== 'video') setDevice('front', result.front);
    if (selection.back !== 'emulated' && selection.back !== 'image' && selection.back !== 'video') setDevice('back', result.back);
  }

  async function choose(facing: CameraFacing, id: string): Promise<void> {
    stopPreview();
    if (id === 'emulated') { setSource(facing, 'emulated'); paintLenses(); paintStatus(); emit(); return; }
    if (id === 'virtualcam') {
      const result = await api.invoke<{ ok: boolean; message: string }>('mgr:android-start-lensio')
        .catch((error: unknown) => ({ ok: false, message: errText(error) }));
      toast(result.message, result.ok ? 'ok' : 'info');
      await scan(true);
      const virtual = listed.find(camera => camera.virtual);
      if (!virtual) {
        toast(t('android.camera.virtualUnavailable'), 'info');
        paintStatus();
        return;
      }
      setSource(facing, 'webcam', virtual.name);
      selection.cameraProvider = 'lensio';
      paintLenses(); paintStatus(); emit();
      return;
    }
    if (id === 'image') {
      await pickImage(facing); return;
    }
    if (id === 'video') {
      await pickVideo(facing); return;
    }
    if (id && !/^webcam\d+$/.test(id)) return;
    setSource(facing, id ? 'webcam' : 'none', id);
    paintLenses(); paintStatus(); emit();
  }

  function lensField(facing: CameraFacing): HTMLElement {
    const key = facing === 'front' ? 'android.cameraFront' : 'android.cameraBack';
    // Do not invent webcam0 when the emulator returned an empty list. Keep a
    // currently selected endpoint visible only long enough for scan() to clear
    // it after a completed discovery pass.
    const options: Array<[string, string]> = [
      ['', t('android.camera.off')],
      ['image', t('android.camera.imageFile')],
      ['video', t('android.camera.videoFile')],
    ];
    const source = facing === 'front' ? selection.front : selection.back;
    const video = h('button', { type: 'button', class: 'btn small camera-quick-switch', text: t('android.camera.quickVideo') }) as HTMLButtonElement;
    video.onclick = () => { void pickVideo(facing); };
    const photo = h('button', { type: 'button', class: 'btn small camera-quick-switch', text: t('android.camera.choosePhoto') }) as HTMLButtonElement;
    photo.onclick = () => { photo.disabled = true; void pickImage(facing).finally(() => { photo.disabled = false; }); };
    const currentDevice = deviceOf(facing);
    const currentCamera = currentDevice ? listed.find(camera => camera.name === currentDevice) : undefined;
    const currentCheck = currentCamera ? checkOf(currentCamera) : undefined;
    const isDetected = source === 'emulated' || source === 'image' || (source === 'video' ? (videoDetected.get(facing) ?? Boolean(currentDevice && /\.(mp4|mkv|avi|mov)$/i.test(currentDevice))) : Boolean(currentDevice && listed.some(camera => camera.name === currentDevice)));
    const isConfigured = source === 'image' ? Boolean(currentDevice) : source !== 'none' && (source !== 'webcam' || Boolean(currentDevice));
    const isLive = source === 'webcam' ? currentCheck?.ok === true : undefined;
    const badge = (label: string, state: boolean | undefined): HTMLElement => h('span', { class: `camera-source-badge ${state === true ? 'ok' : state === false ? 'off' : 'unknown'}`, text: `${label}: ${state === true ? t('android.camera.statusYes') : state === false ? t('android.camera.statusNo') : t('android.camera.statusUnknown')}` });
    return field(key, h('div', { class: 'camera-source-controls' },
      select<string>(source === 'video' ? 'video' : source === 'image' ? 'image' : '', options, id => { void choose(facing, id); }),
      h('div', { class: 'camera-source-status', 'aria-label': t('android.camera.sourceStatus') },
        badge(t('android.camera.detected'), isDetected), badge(t('android.camera.configured'), isConfigured), badge(t('android.camera.liveFrames'), isLive)),
      h('div', { class: 'camera-quick-switches' }, photo, video)));
  }

  function paintLenses(): void {
    both.disabled = !listed.some((camera) => camera.name === 'webcam0');
    backSlot.replaceChildren(lensField('back'));
    frontSlot.replaceChildren(lensField('front'));
  }

  function line(warn: boolean, text: string): HTMLElement {
    return h('p', { class: warn ? 'hint warn' : 'hint', text });
  }

  /** Keep configured, enumerated and capture-verified camera states distinct. */
  function paintStatus(): void {
    const lines: HTMLElement[] = [];
    if (!cameraTests.enabled) lines.push(line(false, t('android.camera.testingOff')));
    if (selection.front === 'image' || selection.back === 'image') lines.push(line(false, t('android.camera.imageFileHint')));
    if (selection.front === 'video' || selection.back === 'video') lines.push(line(false, t('android.camera.videoFileHint')));
    if (selection.frontDevice && selection.frontDevice === selection.backDevice) lines.push(line(true, t('android.camera.sharedWarning')));
    const unlisted = [...new Set([
      selection.front === 'webcam' ? selection.frontDevice : '',
      selection.back === 'webcam' ? selection.backDevice : '',
    ].filter(id => id && !listed.some(camera => camera.name === id)))];
    if (loaded && unlisted.length) lines.push(line(true, t('android.camera.manualWarning', { endpoints: unlisted.join(', ') })));
    if (loadFailed) lines.push(line(true, t('android.camera.scanFailed')));
    else if (!loaded || checking) lines.push(line(false, t('android.camera.scanning')));
    else if (noEmulator) lines.push(line(true, t('android.camera.noEmulator')));
    else {
      if (!listed.length || (cameraTests.enabled && !working().length)) {
        lines.push(line(true, t(cameraTests.enabled ? 'android.camera.msgNone' : 'android.camera.noneListed')));
        if (problem === 'timeout') lines.push(line(false, t('android.camera.timedOut')));
        else if (problem === 'reported') lines.push(line(false, t('android.camera.emulatorSaid', { detail })));
        if (!listed.length) {
          const count = Math.max(windowsCount, hostCameraCount);
          if (count > 0) lines.push(line(false, t('android.camera.windowsSees', { count })));
          if (problem === 'none') lines.push(line(false, t('android.camera.msgAvdHint')));
        }
      }
      const refused = listed.map((camera) => checkOf(camera)).filter((item): item is CameraCheck => item !== undefined && !item.ok);
      if (refused.some((item) => item.failure === 'permission')) lines.push(line(false, t('android.camera.blocked')));
      else if (refused.some((item) => item.failure === 'unavailable')) lines.push(line(false, t('android.camera.notFound')));
      else if (refused.length) lines.push(line(false, t('android.camera.notSending')));
      if (cameraTests.enabled && working().length) {
        const selected = [selection.frontDevice, selection.backDevice]
          .filter((id, index, all): id is string => !!id && all.indexOf(id) === index)
          .map((id) => listed.find((camera) => camera.name === id))
          .filter((camera): camera is EmulatorCamera => !!camera && checkOf(camera)?.ok === true)
          .map(displayName);
        if (selected.length) lines.push(line(false, t('android.camera.selectedWorking', { cameras: selected.join(', ') })));
      }
    }
    statusSlot.replaceChildren(...lines);
  }

  /**
   * One pass: read the emulator's list, then open the cameras that need it. A
   * manual pass checks every listed camera only while host testing is enabled. A
   * poll checks only the cameras it has not checked yet, so a busy webcam is not
   * reopened every few seconds.
   */
  async function scan(manual: boolean): Promise<void> {
    if (scanning || disposed) return;
    scanning = true;
    refreshButton.disabled = true;
    if (element.isConnected) attached = true;
    try {
      const next = await loadCameraChoices();
      if (!next) {
        // The call failed. The picker keeps what it shows; it does not clear the lenses.
        loadFailed = true;
        return;
      }
      loadFailed = false;
      loaded = true;
      noEmulator = !next.emulatorAvailable;
      listed = next.webcams;
      problem = next.problem ?? '';
      detail = next.detail ?? '';
      hostCameraCount = next.hostCameraCount ?? 0;
      windowsCount = await countWindowsCameras();
      // A completed scan is authoritative: never keep saving a route the
      // emulator did not list. The user can start the provider and Refresh.
      if (loaded && listed.length === 0) {
        if (selection.front !== 'emulated' && selection.front !== 'image' && selection.front !== 'video' && selection.frontDevice) setDevice('front', '');
        if (selection.back !== 'emulated' && selection.back !== 'image' && selection.back !== 'video' && selection.backDevice) setDevice('back', '');
      }
      // A camera that is gone, or renamed, loses its check.
      for (const [name, entry] of checks) {
        if (!listed.some((camera) => camera.name === name && keyOf(camera) === entry.key)) checks.delete(name);
      }
      const due = cameraTests.enabled ? listed.filter((camera) => manual || checkOf(camera) === undefined) : [];
      if (due.length) {
        checking = true;
        paintStatus();
        for (const camera of due) {
          // The panel this picker belongs to was replaced: stop opening cameras for it.
          if (!cameraTests.enabled || (attached && !element.isConnected)) break;
          const generation = cameraTests.generation;
          const key = keyOf(camera);
          const known = manual ? undefined : recentChecks.get(key);
          let check: CameraCheck;
          if (known && Date.now() - known.at < RECENT_CHECK_MS) {
            check = known.check;
          } else {
            check = await checkHostCamera(camera);
            if (!cameraTests.enabled || generation !== cameraTests.generation) break;
            recentChecks.set(key, { at: Date.now(), check });
          }
          checks.set(camera.name, { key, check });
          if (check.ok) measured.set(camera.name, { width: check.width, height: check.height });
          else measured.delete(camera.name);
        }
        checking = false;
      }
      // A replaced picker must not write its old selection back into the device it was made for.
      if (attached && !element.isConnected) return;
      assign();
      paintLenses();
      emit();
      options.onWorking?.(working().map((camera) => ({ name: camera.name, label: displayName(camera) })));
    } finally {
      scanning = false;
      checking = false;
      refreshButton.disabled = false;
      paintStatus();
    }
  }

  // Every caller places the picker on the page right after building it. Once it has
  // been seen there, taking it off again stops its camera work and its reports.
  window.setTimeout(() => { if (element.isConnected) attached = true; }, 0);

  // Hot-plug: re-read the list while the picker is on screen. Once it is gone
  // (replaced or closed), the timer stops and no more camera work is started for it.
  const poll = window.setInterval(() => {
    if (!element.isConnected) {
      dispose();
      return;
    }
    attached = true;
    void scan(false);
  }, POLL_MS);

  const observer = new MutationObserver(() => {
    if (element.isConnected) attached = true;
    else if (attached) dispose();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.clearInterval(poll); clearTimeout(deviceSettle);
    navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    observer.disconnect(); unsubscribe();
    stopPreview();
    cameraTests.setEnabled(false);
  }

  paintLenses();
  paintStatus();
  void scan(false);
  return {
    element,
    value,
    refresh: () => scan(true),
  };
}
