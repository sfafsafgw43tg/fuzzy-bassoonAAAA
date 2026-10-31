/**
 * apps/octobrowser/src/renderer/launcher-virtualbox.ts
 *
 * The Android devices page: the state of the Android Studio emulator (AVD),
 * the AVDs you have, the network bar - and the "New Android device" button, which opens the complete
 * guided creator in `launcher-android-create.ts`. This page keeps no Octo VM
 * log and never talks to a remote service.
 */
import { api, clear } from '@octo/shell/renderer/bridge';
import { h, t } from '@octo/shell/renderer/i18n-client';
import { icon } from '@octo/shell/renderer/icons';
import { S, SavedProxy, busy, closeModal, confirmDialog, input, modal, popupMenu, run, seg, select, toast, toggle } from './launcher-ui';
import { androidNetworkBar, deviceSettingsDialog, type DeviceIdentity } from './launcher-android';
import { androidCreateWizard } from './launcher-android-create';
import { androidMediaDialog, androidStoresDialog } from './launcher-android-media';
import { closeAndroidScreen, openAndroidScreen } from './launcher-android-screen';
import { cameraPicker, type CameraSource } from './launcher-android-cameras';
import { runInstall } from './launcher-android-install';

type BootMode = 'quick' | 'cold';
type NetworkSpeed = 'full' | 'lte' | 'umts' | 'edge' | 'gsm';
interface AndroidDevice { id: string; brand: string; model: string; width: number; height: number; density: number; inches: number; ramMb: number; shippedApi: number; year: number }
interface AndroidSystem { id: string; runsHere?: boolean; label: string; api: number; release: string; abi: string; imageBytes: number; googlePlay: boolean; installed: boolean; family?: 'phone' | 'tv' | 'wear' | 'automotive'; familyLabel?: string }
interface MediaCompanion { plugin: string; ready?: boolean; requirements?: Array<{ key: string; ok: boolean }>; pluginName: string; enabled: boolean; bundleAvailable: boolean; bundleBytes: number; installed: boolean; path: string; files: number; pythonAvailable: boolean; virtualCameraDriver: boolean; virtualMicrophoneDriver: boolean; running: boolean }
interface AndroidMachine { name: string; path: string; target: string; running: boolean; deviceLabel: string; resolution: string; ramMb: number; dataPartition: string; cameraFront: CameraSource; cameraBack: CameraSource; cameraFrontDevice: string; cameraBackDevice: string; cameraDevice: string; microphoneEnabled: boolean; networkSpeed: NetworkSpeed; incomplete: boolean; diskBytes: number; identity?: DeviceIdentity }
interface AndroidStatus { javaVersion?: number; javaHome?: string; searched: string[]; missing: '' | 'sdk' | 'cmdline-tools' | 'emulator'; manualSdkRoot: boolean; available: boolean; sdkRoot: string; studioAppPath: string; avdManagerAvailable: boolean; emulatorAvailable: boolean; adbAvailable: boolean; defaultDirectory: string; mediaCompanion: MediaCompanion; devices: AndroidDevice[]; systems: AndroidSystem[] }
interface AndroidResult { available: boolean; machines: AndroidMachine[] }
interface ChromeCameraChoice { name: string; device: string; virtual: boolean; foreign?: boolean }
interface ChromeCameraChoices { webcams: ChromeCameraChoice[]; emulatorAvailable: boolean; hostCameraCount?: number; problem?: string; detail?: string }
interface CustomAndroidBuild { id: string; name: string; release: string; architecture: string; target: string; variant: string; notes: string; createdAt: string; updatedAt: string }
interface AndroidLaunchPrefs {
  proxyId: string; cameraFront: CameraSource; cameraBack: CameraSource;
  cameraProvider?: 'lensio' | 'obs' | 'directshow';
  cameraFrontDevice: string; cameraBackDevice: string; cameraDevice: string;
  microphoneEnabled: boolean; microphoneDevice: string; bootMode: BootMode; networkSpeed: NetworkSpeed; secondaryDisplay?: 'none' | 'secondary1080'; locale: string;
}
interface AndroidLocale { tag: string; label: string }

const MB = 1_000_000;
const GB = 1_000_000_000;
const dataSize = (value: number) => value >= GB ? `${(value / GB).toFixed(value >= 10 * GB ? 1 : 2)} GB` : `${Math.max(0, Math.round(value / MB))} MB`;

// ------------------------------------------------------------------ Android

function proxyUsage(proxy: SavedProxy): string {
  return proxy.usageLimitBytes ? `${dataSize(proxy.usageBytes)} / ${dataSize(proxy.usageLimitBytes)}` : `${dataSize(proxy.usageBytes)} · ${t('proxy.usageUnlimited')}`;
}

const checked = (control: HTMLElement) => (control.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.checked === true;
const valueOf = (control: HTMLElement) => (control as unknown as { value: string }).value;

function sdkSetup(status: AndroidStatus | undefined, reload: () => Promise<void>): HTMLElement {
  const missing = status?.missing ?? 'sdk';
  const choose = h('button', { class: 'btn small' }, icon('folder', 14), h('span', { text: t('android.chooseSdk') }));
  const install = h('button', { class: 'btn small primary' }, icon('download', 14), h('span', { text: t(missing === 'sdk' ? 'android.installStudio' : 'android.installTools') }));
  choose.onclick = async () => {
    const chosen = await run(api.invoke<string | null>('mgr:pick-folder'));
    if (!chosen) return;
    const result = await run(api.invoke<{ ok: boolean; path: string; message: string }>('mgr:android-set-sdk', chosen));
    if (result?.ok) { toast(t('android.sdkSet', { path: result.path }), 'ok'); await reload(); }
    else toast(t('android.sdkRejected'), 'err', result?.message);
  };
  const installHost = h('div', { class: 'install-host' });
  install.onclick = async () => {
    install.disabled = true;
    const ok = await runInstall(installHost, {
      title: t(missing === 'sdk' ? 'android.installStudio' : 'android.installTools'),
      note: t('android.install.wait'),
      task: () => api.invoke<{ ok: boolean; message: string }>('mgr:android-install-tools'),
    });
    install.disabled = false;
    toast(t(ok ? 'android.installDone' : 'android.installFailed'), ok ? 'ok' : 'err');
    await reload();
  };
  const searched = h('details', { class: 'hint' }, h('summary', { text: t('android.searched') }));
  for (const candidate of status?.searched ?? []) searched.append(h('div', { class: 'small muted ell', text: candidate }));
  const reset = status?.manualSdkRoot ? h('button', { class: 'btn small', text: t('android.forgetSdk') }) : null;
  if (reset) reset.onclick = async () => { await run(api.invoke<boolean>('mgr:android-clear-sdk')); await reload(); };
  const card = h('div', { class: 'empty compact android-setup' },
    h('div', { class: 'empty-icon' }, icon('smartphone', 38)),
    h('h2', { text: t(missing === 'sdk' ? 'android.unavailable' : 'android.toolsMissing') }),
    h('p', { class: 'muted', text: t(missing === 'sdk' ? 'android.unavailableDesc' : 'android.toolsMissingDesc') }),
    h('div', { class: 'row center' }, install, choose, reset),
    searched);
  card.append(installHost);
  return card;
}

function androidLaunchDialog(machine: AndroidMachine, load: () => Promise<void>, prefs?: AndroidLaunchPrefs, locales: AndroidLocale[] = [], onStarting?: () => void): void {
  modal(t('android.launchTitle'), (box) => {
    // Everything starts from what this device was launched with last time.
    const saved = prefs;
    const eligible = (proxy: SavedProxy) => proxy.type === 'socks5'
      || (!proxy.hasCredentials && (proxy.type === 'http' || proxy.type === 'https'));
    let compatible = S.proxies.filter(eligible);
    let proxyId = saved?.proxyId && compatible.some((item) => item.id === saved.proxyId) ? saved.proxyId : '';
    let proxyMode: 'none' | 'new' | 'saved' = proxyId ? 'saved' : 'none';
    let newProxyType: 'http' | 'https' | 'socks5' = 'http';
    const proxyBody = h('div', { class: 'android-proxy-body' });
    const proxySlot = h('div', { class: 'android-proxy-picker' });
    const proxyAddress = input('', { placeholder: t('android.proxyAddressPh'), maxlength: '1024', autocomplete: 'off' });
    const proxyName = input('', { placeholder: t('proxy.name'), maxlength: '48', autocomplete: 'off' });
    const typeSlot = h('div', {});
    const proxyNote = h('p', { class: 'hint', text: t('android.proxyEligibleHint') });
    const saveProxy = h('button', { class: 'btn small primary', text: t('android.proxySave') }) as HTMLButtonElement;
    const quickProxy = h('div', { class: 'android-proxy-add' });

    const paintProxy = (): void => {
      compatible = S.proxies.filter(eligible);
      if (proxyId && !compatible.some((item) => item.id === proxyId)) proxyId = '';
      const options: Array<[string, string]> = compatible.map((item): [string, string] =>
        [item.id, `${item.name || `${item.host}:${item.port}`} · ${item.type.toUpperCase()} · ${proxyUsage(item)}`]);
      proxySlot.replaceChildren(options.length
        ? select<string>(proxyId || options[0][0], options, (value) => { proxyId = value; })
        : h('p', { class: 'hint warn', text: t('proxy.noSaved') }));
      if (!proxyId && options.length) proxyId = options[0][0];
    };
    const paintTypes = (): void => {
      typeSlot.replaceChildren(seg<'http' | 'https' | 'socks5'>(newProxyType,
        [['http', 'HTTP'], ['https', 'HTTPS'], ['socks5', 'SOCKS5']], (value) => { newProxyType = value; paintTypes(); }));
    };
    const paintProxyMode = (): void => {
      proxyBody.replaceChildren();
      if (proxyMode === 'new') { proxyBody.append(quickProxy); queueMicrotask(() => proxyAddress.focus()); }
      else if (proxyMode === 'saved') { paintProxy(); proxyBody.append(proxySlot); }
      else proxyBody.append(h('p', { class: 'hint', text: t('android.noProxy') }));
    };
    const proxyModes = seg<'none' | 'new' | 'saved'>(proxyMode,
      [['none', t('proxy.none'), 'close'], ['new', t('proxy.new'), 'plus'], ['saved', t('proxy.saved'), 'bookmark']], (value) => {
        proxyMode = value;
        if (value !== 'saved') proxyId = '';
        paintProxyMode();
      }, 'big');
    paintTypes();
    quickProxy.append(typeSlot, h('div', { class: 'grid2' }, proxyAddress, proxyName), proxyNote,
      h('div', { class: 'row' }, saveProxy));
    paintProxyMode();

    saveProxy.onclick = async () => {
      const address = proxyAddress.value.trim();
      if (!address) { proxyNote.classList.add('warn'); proxyNote.textContent = t('android.proxyAddressRequired'); return; }
      saveProxy.disabled = true;
      const before = new Set(S.proxies.map((item) => item.id));
      const result = await run(api.invoke<{ added: number; errors: Array<{ line: number; error: string }> }>(
        'mgr:proxies-add', address, newProxyType, proxyName.value.trim()));
      const list = result?.added ? await api.invoke<SavedProxy[]>('mgr:proxies').catch(() => undefined) : undefined;
      saveProxy.disabled = false;
      if (!result?.added) {
        proxyNote.classList.add('warn');
        proxyNote.textContent = result?.errors[0]?.error || t('proxy.err.format');
        return;
      }
      if (list) S.proxies = list;
      const created = S.proxies.find((item) => !before.has(item.id) && eligible(item));
      proxyId = created?.id ?? proxyId;
      proxyMode = 'saved';
      paintProxyMode();
      toast(t('proxy.added', { n: result.added }), 'ok');
    };
    const rememberedBackCamera = saved?.cameraBackDevice || machine.cameraBackDevice || saved?.cameraDevice || machine.cameraDevice || '';
    const rememberedFrontCamera = saved?.cameraFrontDevice || machine.cameraFrontDevice || '';
    // One picker for both lenses. It offers only the cameras that send a picture
    // on this computer right now; a lens with none is Off.
    const cameras = cameraPicker({
      deviceName: machine.name,
      initial: {
        front: saved?.cameraFront ?? machine.cameraFront,
        back: saved?.cameraBack ?? machine.cameraBack,
        frontDevice: rememberedFrontCamera,
        backDevice: rememberedBackCamera,
        cameraProvider: saved?.cameraProvider,
      },
    });
    const microphone = toggle(saved?.microphoneEnabled ?? machine.microphoneEnabled, 'android.media.microphone');
    let microphoneDevice = saved?.microphoneDevice ?? '';
    let microphoneDevices: MediaDeviceInfo[] = [];
    let microphoneStream: MediaStream | undefined;
    let microphonePermissionStream: MediaStream | undefined;
    let microphonePermissionTimer = 0;
    let microphoneContext: AudioContext | undefined;
    let microphoneFrame = 0;
    const microphoneSlot = h('div', {});
    const microphoneMeter = h('span', { class: 'media-level-fill' });
    const microphonePreview = h('button', { class: 'btn small', text: t('android.media.previewMicrophone') }) as HTMLButtonElement;
    const releaseMicrophonePermission = () => {
      window.clearTimeout(microphonePermissionTimer);
      microphonePermissionStream?.getTracks().forEach((track) => track.stop());
      microphonePermissionStream = undefined;
    };
    const stopMicrophonePreview = () => {
      cancelAnimationFrame(microphoneFrame);
      microphoneStream?.getTracks().forEach((track) => track.stop());
      releaseMicrophonePermission();
      void microphoneContext?.close();
      microphoneStream = undefined; microphoneContext = undefined;
      microphoneMeter.style.width = '0%';
      microphonePreview.textContent = t('android.media.previewMicrophone');
    };
    microphonePreview.onclick = async () => {
      if (microphoneStream) { stopMicrophonePreview(); return; }
      const selected = microphoneDevices.find((item) => item.label === microphoneDevice);
      const permissionTrack = microphonePermissionStream?.getAudioTracks()[0];
      const permissionMatches = Boolean(selected && permissionTrack
        && (permissionTrack.getSettings().deviceId === selected.deviceId || permissionTrack.label === selected.label));
      let stream = permissionMatches ? microphonePermissionStream : undefined;
      if (microphonePermissionStream && !permissionMatches) {
        releaseMicrophonePermission();
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      if (permissionMatches) { microphonePermissionStream = undefined; window.clearTimeout(microphonePermissionTimer); }
      stream ??= await navigator.mediaDevices.getUserMedia({ audio: selected ? { deviceId: { exact: selected.deviceId } } : true, video: false }).catch(() => undefined);
      if (!stream) { toast(t('android.media.microphonePermission'), 'err'); return; }
      microphoneStream = stream;
      microphoneContext = new AudioContext();
      const source = microphoneContext.createMediaStreamSource(stream);
      const analyser = microphoneContext.createAnalyser();
      analyser.fftSize = 256;
      const gain = microphoneContext.createGain(); gain.gain.value = 0.65;
      source.connect(analyser); source.connect(gain); gain.connect(microphoneContext.destination);
      const levels = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        if (!microphoneStream) return;
        analyser.getByteFrequencyData(levels);
        const average = levels.reduce((sum, value) => sum + value, 0) / Math.max(1, levels.length);
        microphoneMeter.style.width = `${Math.min(100, average * 1.8)}%`;
        microphoneFrame = requestAnimationFrame(draw);
      };
      draw();
      microphonePreview.textContent = t('android.media.stopPreview');
      window.setTimeout(stopMicrophonePreview, 20_000);
    };
    // Persistent permission exposes labels without opening a source. When a
    // grant stream is necessary, retain it very briefly and hand it directly
    // to Preview if it is the selected endpoint.
    void (async () => {
      let listed = await navigator.mediaDevices.enumerateDevices();
      if (!listed.some((item) => item.kind === 'audioinput' && item.label)) {
        microphonePermissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        listed = await navigator.mediaDevices.enumerateDevices();
      }
      microphoneDevices = listed.filter((item) => item.kind === 'audioinput'
        && item.deviceId !== 'default' && item.deviceId !== 'communications' && Boolean(item.label));
      // Only active endpoints are offered. A stale remembered label is not
      // appended as if it were still connected.
      if (!microphoneDevices.some((item) => item.label === microphoneDevice)) microphoneDevice = microphoneDevices[0]?.label ?? '';
      const options: Array<[string, string]> = microphoneDevices.length
        ? microphoneDevices.map((item): [string, string] => [item.label, item.label])
        : [['', t('android.media.defaultMicrophone')]];
      microphoneSlot.replaceChildren(h('div', { class: 'media-preview-select' },
        h('label', { class: 'field grow' }, h('span', { class: 'lbl', text: t('android.media.hostMicrophone') }),
          select<string>(microphoneDevice, options, (value) => { stopMicrophonePreview(); microphoneDevice = value; })), microphonePreview),
      h('div', { class: 'media-level', title: t('android.media.microphoneLevel') }, microphoneMeter),
      h('p', { class: 'hint', text: t('android.media.hostMicrophoneHint') }));
      microphonePermissionTimer = window.setTimeout(releaseMicrophonePermission, 1_500);
    })().catch(() => {
      releaseMicrophonePermission();
      microphoneSlot.replaceChildren(h('p', { class: 'hint warn', text: t('android.media.microphonePermission') }));
    });
    // The language the device boots in, remembered per device.
    const language = select<string>(saved?.locale ?? '', (locales.length ? locales : [{ tag: '', label: t('android.language.system') }])
      .map((item): [string, string] => [item.tag, item.tag ? item.label : t('android.language.system')]));
    const boot = select<BootMode>(saved?.bootMode ?? 'quick', [['quick', t('android.boot.quick')], ['cold', t('android.boot.cold')]]);
    const netSpeed = select<NetworkSpeed>(saved?.networkSpeed ?? 'full', [['full', t('android.net.full')], ['lte', 'LTE'], ['umts', 'UMTS (3G)'], ['edge', 'EDGE'], ['gsm', 'GSM']]);
    const display = select<'none' | 'secondary1080'>(saved?.secondaryDisplay ?? 'none', [['none', t('android.displays.none')], ['secondary1080', t('android.displays.secondary1080')]]);
    const launch = h('button', { class: 'btn primary', text: t('android.launch') });
    const cancel = h('button', { class: 'btn', text: t('common.cancel') });
    cancel.onclick = () => { stopMicrophonePreview(); closeModal(); };
    launch.onclick = async () => {
      stopMicrophonePreview();
      const camera = cameras.value();
      launch.disabled = true;
      const label = launch.textContent;
      launch.textContent = t('android.starting');
      onStarting?.();
      // Return to the device list immediately so its row visibly says
      // "Starting…" during the emulator's six-second health check.
      closeModal();
      try {
        const result = await run(api.invoke<{ ok: boolean; cameraWarning?: string; notes?: string[]; lensio?: { installed: boolean; launched: boolean; message: string } }>('mgr:android-launch', {
          name: machine.name, proxyId, cameraFront: camera.front, cameraBack: camera.back,
          cameraProvider: camera.cameraProvider,
          cameraFrontDevice: camera.frontDevice, cameraBackDevice: camera.backDevice,
          cameraDevice: camera.backDevice || camera.frontDevice,
          cameraLimits: { front: camera.frontLimit, back: camera.backLimit },
          microphoneEnabled: checked(microphone), microphoneDevice,
          bootMode: valueOf(boot), networkSpeed: valueOf(netSpeed), locale: valueOf(language),
          secondaryDisplay: valueOf(display),
        }));
        if (!result?.ok) {
          toast(result?.lensio?.message || result?.notes?.join(' ') || t('android.launch.notApplied'), 'info');
          return;
        }
        if (result.cameraWarning) {
          toast(t('android.camera.disabledForLaunch'), 'info', result.cameraWarning);
        } else if (result.notes?.length) {
          toast(t('android.launch.notApplied'), 'info', result.notes.join(' '));
        } else toast(t('android.launched', { name: machine.name }), 'ok');
      } finally {
        launch.disabled = false;
        launch.textContent = label;
        await load();
      }
    };
    box.append(h('p', { class: 'hint', text: t('android.launchHint') }),
      h('div', { class: 'field' },
        h('span', { class: 'lbl', text: t('android.proxy') }), proxyModes, proxyBody),
      cameras.element,
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.boot') }), boot),
        h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.network') }), netSpeed)),
      microphone, microphoneSlot,
      h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.language') }), language),
      h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.displays.label') }), display),
      h('p', { class: 'hint', text: t('android.displays.hint') }),
      h('p', { class: 'hint', text: t(saved ? 'android.launchRemembered' : 'android.languageHint') }),
      h('p', { class: 'hint', text: t('android.proxyHint') }),
      h('div', { class: 'modal-actions' }, cancel, launch));
  }, 'wide');
}

/** One lens in the device row: the host camera it uses, or Off. */
function cameraLabel(device: string): string {
  return device ? `${t('android.camera.webcam')} · ${device}` : t('android.camera.off');
}

const startingAvds = new Set<string>();

function androidRow(machine: AndroidMachine, load: () => Promise<void>): HTMLElement {
  // A device whose system image is gone cannot boot: say so instead of
  // starting an emulator that dies one second later.
  const isStarting = startingAvds.has(machine.name);
  const launch = h('button', {
    class: `btn small ${machine.running ? '' : 'primary'}${isStarting ? ' is-busy' : ''}`.trim(),
    text: isStarting ? t('android.starting') : (machine.running ? t('android.stop') : t('android.launch')),
    disabled: !machine.running && machine.incomplete,
    title: !machine.running && machine.incomplete ? t('android.incompleteHint') : '',
  }) as HTMLButtonElement;
  if (isStarting) launch.disabled = true;
  const stopDevice = async (force: boolean) => {
    launch.disabled = true;
    launch.textContent = t('android.stopping');
    const result = await run(api.invoke<{ stopped: boolean; how: string }>('mgr:android-stop', machine.name, force));
    launch.disabled = false;
    if (result?.stopped) toast(t('android.stopped', { name: machine.name }), 'ok');
    if (result?.stopped) closeAndroidScreen(machine.name);
    await load();
  };
  const openLaunch = async () => {
    const [prefs, locales] = await Promise.all([
      api.invoke<AndroidLaunchPrefs>('mgr:android-launch-prefs', machine.name).catch(() => undefined),
      api.invoke<AndroidLocale[]>('mgr:android-locales').catch(() => []),
    ]);
    androidLaunchDialog(machine, async () => {
      startingAvds.delete(machine.name);
      await load();
    }, prefs, locales ?? [], () => {
      startingAvds.add(machine.name);
      launch.disabled = true;
      launch.classList.add('is-busy');
      launch.textContent = t('android.starting');
    });
  };
  launch.onclick = () => { if (machine.running) void stopDevice(false); else void openLaunch(); };
  const folder = h('button', { class: 'icon-btn tiny', title: t('android.folder'), 'aria-label': t('android.folder') }, icon('folder', 16));
  folder.onclick = async () => {
    folder.disabled = true;
    const result = await run(api.invoke<boolean>('mgr:android-folder', machine.name));
    folder.disabled = false;
    if (!result) toast(t('android.folderFailed'), 'err');
  };
  const settings = h('button', { class: 'icon-btn tiny', title: t('android.settings'), 'aria-label': t('android.settings') }, icon('settings', 16));
  const openSettings = () => deviceSettingsDialog({
    name: machine.name, running: machine.running,
    ramMb: machine.ramMb || undefined, dataGb: Number.parseInt(machine.dataPartition, 10) || undefined,
    width: Number(machine.resolution.split('x')[0]) || undefined, height: Number(machine.resolution.split('x')[1]) || undefined,
    cameraFront: machine.cameraFront, cameraBack: machine.cameraBack,
    cameraFrontDevice: machine.cameraFrontDevice, cameraBackDevice: machine.cameraBackDevice,
    cameraDevice: machine.cameraDevice, microphoneEnabled: machine.microphoneEnabled, networkSpeed: machine.networkSpeed,
    handset: machine.deviceLabel || machine.name,
    identity: machine.identity,
  }, load);
  settings.onclick = openSettings;
  const openMedia = () => androidMediaDialog({ name: machine.name, running: machine.running, handset: machine.deviceLabel }, load);
  const media = h('button', { class: 'icon-btn tiny', title: t('android.media.deviceAction'), 'aria-label': t('android.media.deviceAction') }, icon('camera', 16));
  media.onclick = openMedia;
  const screen = h('button', { class: 'icon-btn tiny', title: t('android.screen.open'), 'aria-label': t('android.screen.open') }, icon('monitor', 16));
  screen.onclick = () => openAndroidScreen({ name: machine.name, handset: machine.deviceLabel });
  const more = h('button', { class: 'icon-btn tiny', title: t('vm.more'), 'aria-label': t('vm.more') }, icon('dots', 17));
  more.onclick = () => popupMenu(more, [
    ...(machine.running ? [{ icon: 'monitor', label: t('android.screen.open'), fn: () => openAndroidScreen({ name: machine.name, handset: machine.deviceLabel }) }] : []),
    ...(machine.running
      ? [{ icon: 'stop', label: t('android.stop'), fn: () => void stopDevice(false) },
        { icon: 'close', label: t('android.forceStop'), danger: true, fn: () => void stopDevice(true) }] as const
      : [{ icon: 'play', label: t('android.launch'), fn: () => void openLaunch() }] as const),
    { icon: 'folder', label: t('android.folder'), fn: () => void folder.click() },
    { icon: 'camera', label: t('android.media.deviceAction'), fn: openMedia },
    { icon: 'download', label: t('android.stores.action'), fn: () => androidStoresDialog({ name: machine.name, running: machine.running, handset: machine.deviceLabel }, load) },
    { icon: 'settings', label: t('android.settings'), fn: openSettings },
    {
      icon: 'close', label: t('android.delete'), danger: true, fn: () => confirmDialog(t('android.deleteConfirm', { name: machine.name }), async () => {
        const done = await api.invoke<boolean>('mgr:android-delete', machine.name);
        if (!done) throw new Error(t('android.deleteFailed'));
        void load();
        return true;
      }, 'android.deleted'),
    },
  ]);
  const specs = [machine.deviceLabel, machine.resolution, machine.ramMb ? `${machine.ramMb} MB RAM` : '', machine.dataPartition, machine.diskBytes ? t('android.onDisk', { size: dataSize(machine.diskBytes) }) : ''].filter(Boolean).join(' · ');
  const mediaLine = [
    `${t('android.cameraBack')}: ${cameraLabel(machine.cameraBackDevice)}`,
    `${t('android.cameraFront')}: ${cameraLabel(machine.cameraFrontDevice)}`,
    machine.microphoneEnabled ? t('android.microphoneOn') : t('android.microphoneOff'),
  ].join(' · ');
  return h('div', { class: `vm-row android-row${machine.incomplete ? ' incomplete' : ''}` }, h('div', { class: 'vm-mark' }, icon('smartphone', 19)),
    h('div', { class: 'vm-name grow' },
      h('div', { class: 'vm-meta' }, h('b', { class: 'vm-title-text', text: machine.name }),
        h('span', { class: 'pill engine-tag', text: t('android.backend.avd') }),
        machine.running ? h('span', { class: 'pill ok', text: t('android.running') }) : null,
        isStarting && !machine.running ? h('span', { class: 'pill warn', text: t('android.starting') }) : null,
        machine.incomplete ? h('span', { class: 'pill bad', text: t('android.incomplete') }) : null),
      h('span', { class: 'small muted vm-detail', text: specs || (S.init?.settings?.ui?.hideDirectoryPaths ? (t('settings.pathHidden') || '••••••••••••••••') : (machine.target || machine.path)) }),
      h('span', { class: 'small muted vm-detail', text: mediaLine })),
    h('div', { class: 'vm-actions' }, folder, ...(machine.running ? [screen] : []), media, settings, launch, more));
}

/**
 * One compact chip per backend: is it here, which version, and the single
 * button that fixes it when it is not. This replaces the old prose line that
 * only said which engine "is in charge".
 */
function engineChip(opts: { title: string; ready: boolean; detail: string; action: HTMLElement | null }): HTMLElement {
  return h('div', { class: `engine-chip${opts.ready ? ' on' : ''}` },
    h('span', { class: 'engine-mark' }, icon(opts.ready ? 'check' : 'alert', 15)),
    h('div', { class: 'engine-copy' },
      h('b', { class: 'ell', text: opts.title }),
      h('span', { class: 'small muted ell', text: opts.detail })),
    opts.action);
}

/**
 * The Android devices page: the Android Studio emulator (AVD) state, the
 * AVDs you have, the
 * network bar - and the "New Android device" button, which opens the complete
 * guided creator in `launcher-android-create.ts`. This page keeps no Octo VM
 * log and never talks to a remote service.
 */
export async function renderVirtualBox(v: HTMLElement): Promise<void> {
  const androidList = h('div', { class: 'vm-list' });
  const androidRefresh = h('button', { class: 'btn small' }, icon('refreshCircle', 14), h('span', { text: t('net.refresh') }));
  const androidImport = h('button', { class: 'btn small' }, icon('folder', 14), h('span', { text: t('android.findExisting') }));
  const androidCreate = h('button', { class: 'btn primary' }, icon('plus', 15), h('span', { text: t('android.create') }));
  const cameraStudio = h('button', { class: 'btn small', title: t('android.cameraStudio.open') }, icon('camera', 14), h('span', { text: t('android.cameraStudio.open') })) as HTMLButtonElement;
  const nativeCamera = h('button', { class: 'btn small', title: t('android.nativeCamera.install') }, icon('camera', 14), h('span', { text: t('android.nativeCamera.install') })) as HTMLButtonElement;
  const removeNativeCamera = h('button', { class: 'btn small', title: t('android.nativeCamera.remove') }, icon('close', 14), h('span', { text: t('android.nativeCamera.remove') })) as HTMLButtonElement;
  const openStudio = h('button', { class: 'btn small' }, icon('externalLink', 14), h('span', { text: t('android.openStudio') })) as HTMLButtonElement;
  openStudio.onclick = async () => {
    openStudio.disabled = true;
    const result = await run(api.invoke<{ opened: boolean; message: string }>('mgr:android-open-studio'));
    openStudio.disabled = false;
    toast(result?.opened ? t('android.studioOpened') : t('android.studioUnavailable'), result?.opened ? 'ok' : 'err', result?.message);
  };
  const engines = h('div', { class: 'engine-row' });
  const installHost = h('div', {});
  const setupHost = h('div', {});
  const netHost = h('div', {});
  const virtualBrowserHost = h('div', {});

  v.append(h('div', { class: 'toolbar' }, h('h1', { text: t('android.title') })),
    h('section', { class: 'vm-section android-section' },
      h('div', { class: 'vm-section-head' },
        h('div', {}, h('h2', { text: t('android.sectionTitle') }), h('p', { class: 'hint', text: t('android.desc') })),
        h('div', { class: 'row' }, openStudio, cameraStudio, nativeCamera, removeNativeCamera, androidCreate, androidImport, androidRefresh)),
      engines, installHost, setupHost, netHost, androidList, virtualBrowserHost));

  let status: AndroidStatus | undefined;
  let catalog: unknown;

  const loadAndroid = async (): Promise<void> => {
    androidRefresh.classList.add('spinning');
    const [sdkStatus, result] = await Promise.all([
      run(api.invoke<AndroidStatus>('mgr:android-status')),
      run(api.invoke<AndroidResult>('mgr:android-list')),
    ]);
    androidRefresh.classList.remove('spinning');
    status = sdkStatus;
    openStudio.disabled = !Boolean(sdkStatus?.studioAppPath);
    const nativeStatus = await run(api.invoke<{ supported: boolean; available: boolean; installed: boolean; message: string }>('mgr:native-camera-status'));
    // Keep the action available when the optional DLL is absent so the user
    // receives an actionable error instead of an apparently dead button. It
    // is disabled only on unsupported platforms or after registration.
    nativeCamera.disabled = !nativeStatus?.supported || nativeStatus.installed;
    removeNativeCamera.disabled = !nativeStatus?.installed;
    nativeCamera.title = nativeStatus?.message || t('android.nativeCamera.install');
    const avdReady = sdkStatus?.available === true && sdkStatus.avdManagerAvailable === true;

    // ---- engine --------------------------------------------------------
    clear(engines);
    const installTools = avdReady ? null : h('button', { class: 'btn small' }, icon('download', 14), h('span', { text: t('android.installTools') }));
    if (installTools) {
      installTools.onclick = async () => {
        installTools.disabled = true;
        const ok = await runInstall(installHost, {
          title: t('android.backend.avd'),
          note: t('android.install.wait'),
          task: () => api.invoke<{ ok: boolean; message: string }>('mgr:android-install-tools'),
        });
        installTools.disabled = false;
        toast(t(ok ? 'android.installDone' : 'android.installFailed'), ok ? 'ok' : 'err');
        await loadAndroid();
      };
    }
    const sdkDetail = avdReady ? (S.init?.settings?.ui?.hideDirectoryPaths ? (t('settings.pathHidden') || '••••••••••••••••') : (sdkStatus?.sdkRoot ?? '')) : t('android.engineMissing');
    engines.append(engineChip({
      title: t('android.backend.avd'), ready: avdReady, action: installTools,
      detail: sdkDetail,
    }));
    // The button stays usable even when the SDK was not detected: the
    // creator's first step is where it is installed, located or overridden,
    // so disabling it here only created a dead end.
    androidCreate.disabled = false;

    // ---- repair card, only when the emulator cannot be used ------------
    clear(setupHost);
    if (!avdReady) setupHost.append(sdkSetup(sdkStatus, loadAndroid));

    // ---- network bar ---------------------------------------------------
    clear(netHost);
    netHost.append(androidNetworkBar(loadAndroid));

    // ---- device list ---------------------------------------------------
    clear(androidList);
    const machines = result?.machines ?? [];
    clear(virtualBrowserHost);
    // Chrome Android is its own lower Devices workspace. Keep it visible even
    // when the older Virtual Android Browser beta toggle is disabled; the panel
    // reports its own Chrome/AVD readiness and does not launch anything until
    // the user presses its explicit button.
    virtualBrowserHost.append(chromeAndroidPanel(machines), customAndroidBuildPanel());
    if (machines.some((machine) => machine.incomplete)) {
      androidList.append(h('p', { class: 'hint warn vm-note', text: t('android.incompleteNote') }));
    }
    for (const machine of machines) androidList.append(androidRow(machine, loadAndroid));
    if (!machines.length && avdReady) {
      const createFirst = h('button', { class: 'btn primary' }, icon('plus', 15), h('span', { text: t('android.create') }));
      createFirst.onclick = () => openCreator();
      androidList.append(h('div', { class: 'empty compact' },
        h('div', { class: 'empty-icon' }, icon('smartphone', 38)),
        h('h2', { text: t('android.none') }),
        h('p', { class: 'muted', text: t('android.noneDesc') }),
        h('div', { class: 'row center' }, createFirst)));
    }
  };

  /** Open the five-step creator with everything it needs already loaded. */
  function openCreator(phoneId?: string): void {
    void (async () => {
      androidCreate.disabled = true;
      if (!catalog) catalog = await run(api.invoke('mgr:android-catalog'));
      androidCreate.disabled = false;
      if (!catalog) return;
      androidCreateWizard({
        catalog: catalog as Parameters<typeof androidCreateWizard>[0]['catalog'],
        sdk: status as Parameters<typeof androidCreateWizard>[0]['sdk'],
        reload: loadAndroid,
        phoneId,
      });
    })();
  }

  // Devices created earlier into a folder of the user's choosing have no
  // pointer in the AVD home, so nothing could see them. Pointing at that
  // folder once adopts every device inside it.
  androidImport.onclick = async () => {
    const chosen = await run(api.invoke<string | null>('mgr:pick-folder'));
    if (!chosen) return;
    androidImport.disabled = true;
    const found = await run(api.invoke<{ added: number; names: string[] }>('mgr:android-import-folder', chosen));
    androidImport.disabled = false;
    if (!found) return;
    if (found.added) toast(t('android.findExistingDone', { n: String(found.added), path: chosen }), 'ok', found.names.join(', '));
    else toast(t('android.findExistingNone', { path: chosen }), 'err');
    await loadAndroid();
  };
  androidRefresh.onclick = () => void loadAndroid();
  androidCreate.onclick = () => openCreator();
  cameraStudio.onclick = async () => {
    cameraStudio.disabled = true;
    try {
      const result = await run(api.invoke<{ started: boolean; message: string }>('mgr:plugin-start', 'vstudio-mobile'));
      if (result?.started) toast(t('android.cameraStudio.started'), 'ok', result.message);
      else toast(t('android.cameraStudio.failed'), 'err', result?.message);
    } finally {
      cameraStudio.disabled = false;
    }
  };
  nativeCamera.onclick = async () => {
    nativeCamera.disabled = true;
    try {
      const result = await run(api.invoke<{ installed: boolean; message: string }>('mgr:native-camera-install'));
      if (result?.installed) toast(t('android.nativeCamera.installed'), 'ok', result.message);
      else toast(t('android.nativeCamera.failed'), 'err', result?.message);
      await loadAndroid();
    } catch (error) {
      // If IPC itself fails, do not leave the control permanently dead.
      nativeCamera.disabled = false;
      toast(t('android.nativeCamera.failed'), 'err', error instanceof Error ? error.message : String(error));
    }
  };
  removeNativeCamera.onclick = async () => {
    removeNativeCamera.disabled = true;
    const result = await run(api.invoke<{ installed: boolean; message: string }>('mgr:native-camera-uninstall'));
    if (!result?.installed) toast(t('android.nativeCamera.removed'), 'ok', result?.message);
    else toast(t('android.nativeCamera.failed'), 'err', result?.message);
    await loadAndroid();
  };
  await loadAndroid();
}

function virtualAndroidBrowserPanel(machines: AndroidMachine[]): HTMLElement {
  let selected = machines.find((machine) => machine.running)?.name ?? machines[0]?.name ?? '';
  const options: Array<[string, string]> = machines.length
    ? machines.map((machine): [string, string] => [machine.name, `${machine.deviceLabel || machine.name}${machine.running ? ' · ' + t('android.running') : ''}`])
    : [['', t('android.virtualBrowser.none')]];
  const deviceSelect = select<string>(selected, options, (value) => { selected = value; });
  const open = h('button', { class: 'btn primary', 'aria-label': t('android.virtualBrowser.open') }, icon('globe', 14), h('span', { text: t('android.virtualBrowser.open') })) as HTMLButtonElement;
  const status = h('p', { class: 'hint', 'aria-live': 'polite', text: t('android.virtualBrowser.desc') });
  open.disabled = !selected;
  open.onclick = async () => {
    if (!selected) return;
    open.disabled = true;
    open.textContent = t('android.virtualBrowser.opening');
    const result = await run(api.invoke<{ opened: boolean; reason: string }>('mgr:android-open-browser', selected));
    open.disabled = false;
    open.replaceChildren(icon('globe', 14), h('span', { text: t('android.virtualBrowser.open') }));
    if (result?.opened) { status.textContent = t('android.virtualBrowser.opened'); toast(t('android.virtualBrowser.opened'), 'ok'); }
    else { status.textContent = result?.reason || t('android.virtualBrowser.noBrowser'); toast(t('android.virtualBrowser.failed'), 'err', status.textContent); }
  };
  return h('section', { class: 'vm-section android-virtual-browser', 'aria-labelledby': 'virtual-android-browser-title' },
    h('div', { class: 'vm-section-head' },
      h('div', {}, h('h2', { id: 'virtual-android-browser-title' }, t('android.virtualBrowser.title'), h('span', { class: 'pill warn', text: t('android.virtualBrowser.beta') })), status),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.virtualBrowser.selectDevice') }), deviceSelect), open)));
}

function customAndroidBuildPanel(): HTMLElement {
  const name = input('', { maxlength: '64', autocomplete: 'off', placeholder: t('android.build.namePlaceholder'), 'aria-label': t('android.build.name') });
  const target = h('select', { class: 'input', 'aria-label': t('android.build.target') }) as HTMLSelectElement;
  const variant = h('select', { class: 'input', 'aria-label': t('android.build.variant') }) as HTMLSelectElement;
  const targetOptions: Array<[string, string]> = [
    ['aosp_cf_x86_64_only_phone-aosp_current-userdebug', 'AOSP Cuttlefish x86_64 phone · userdebug'],
    ['sdk_phone_x86_64', 'AOSP Emulator x86_64'],
  ];
  for (const [value, label] of targetOptions) target.append(h('option', { value, text: label }));
  const refreshVariants = () => {
    const values = target.value === 'aosp_cf_x86_64_only_phone-aosp_current-userdebug' ? ['userdebug'] : ['user', 'userdebug', 'eng'];
    variant.replaceChildren(...values.map((value) => h('option', { value, text: value })));
  };
  target.onchange = refreshVariants;
  refreshVariants();
  const notes = h('textarea', { class: 'input', rows: '3', maxlength: '2000', placeholder: t('android.build.notesPlaceholder'), 'aria-label': t('android.build.notes') }) as HTMLTextAreaElement;
  const save = h('button', { class: 'btn primary', type: 'button', 'aria-label': t('android.build.save') }, icon('save', 14), h('span', { text: t('android.build.save') })) as HTMLButtonElement;
  const guide = h('button', { class: 'btn small', type: 'button', 'aria-label': t('android.build.guide') }, icon('book', 14), h('span', { text: t('android.build.guide') })) as HTMLButtonElement;
  const refreshJobs = h('button', { class: 'btn small', type: 'button', 'aria-label': t('android.build.refreshJobs') }, icon('refreshCircle', 14), h('span', { text: t('android.build.refreshJobs') })) as HTMLButtonElement;
  const exportAllJson = h('button', { class: 'btn small', type: 'button', 'aria-label': t('android.build.exportJson') }, h('span', { text: t('android.build.exportJson') })) as HTMLButtonElement;
  const exportAllYaml = h('button', { class: 'btn small', type: 'button', 'aria-label': t('android.build.exportYaml') }, h('span', { text: t('android.build.exportYaml') })) as HTMLButtonElement;
  const status = h('p', { class: 'hint', 'aria-live': 'polite', text: t('android.build.level2') });
  const backendStatus = h('p', { class: 'hint', 'aria-live': 'polite', text: t('android.build.backendChecking') });
  const remoteJobs = h('div', { class: 'android-build-remote-jobs', role: 'list', 'aria-label': t('android.build.remoteJobs') });
  const commandBlock = h('pre', { class: 'android-build-commands', hidden: 'true', tabindex: '0', 'aria-label': t('android.build.commands') });
  const list = h('div', { class: 'android-build-list', role: 'list' });
  let configs: CustomAndroidBuild[] = [];
  const download = (content: string, format: 'json' | 'yaml', id = 'catalogue') => {
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `octosuite-android-builds-${id}.${format}` }) as HTMLAnchorElement;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const exportPlan = async (config: CustomAndroidBuild, format: 'json' | 'yaml') => {
    const result = await run(api.invoke<{ ok: boolean; content?: string; message?: string }>('mgr:android-build-export', { format, id: config.id }));
    if (!result?.ok || result.content === undefined) { status.textContent = result?.message?.startsWith('android.') ? t(result.message) : t('android.build.exportFailed'); return; }
    download(result.content, format, config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'plan');
    status.textContent = t('android.build.exported', { format: format.toUpperCase() });
  };
  const paint = () => list.replaceChildren(...configs.map((config) => {
    const remove = h('button', { class: 'btn small danger', type: 'button', 'aria-label': t('android.build.delete', { name: config.name }), text: t('common.delete') }) as HTMLButtonElement;
    remove.onclick = async () => { if (await run(api.invoke<boolean>('mgr:android-build-delete', config.id))) { configs = configs.filter((item) => item.id !== config.id); paint(); status.textContent = t('android.build.deleted'); } else status.textContent = t('android.build.deleteFailed'); };
    const edit = h('button', { class: 'btn small', type: 'button', text: t('common.edit') }) as HTMLButtonElement;
    edit.onclick = () => { (name as HTMLInputElement).value = config.name; target.value = config.target; refreshVariants(); variant.value = config.variant; notes.value = config.notes; save.dataset.id = config.id; };
    const submit = h('button', { class: 'btn small', type: 'button', 'aria-label': t('android.build.submit'), text: t('android.build.submit'), disabled: backendStatus.dataset.ready !== 'true' }) as HTMLButtonElement;
    submit.onclick = async () => { submit.disabled = true; const result = await run(api.invoke<{ ok: boolean; job?: { id: string; status: string }; message?: string }>('mgr:android-build-remote-submit', formForPlan(config))); if (result?.ok && result.job) { status.textContent = t('android.build.submitted'); await loadJobs(); } else status.textContent = t('android.build.submitFailed'); submit.disabled = backendStatus.dataset.ready !== 'true'; };
    const json = h('button', { class: 'btn small', type: 'button', 'aria-label': t('android.build.exportPlanJson', { name: config.name }), text: 'JSON' }) as HTMLButtonElement;
    const yaml = h('button', { class: 'btn small', type: 'button', 'aria-label': t('android.build.exportPlanYaml', { name: config.name }), text: 'YAML' }) as HTMLButtonElement;
    json.onclick = () => void exportPlan(config, 'json'); yaml.onclick = () => void exportPlan(config, 'yaml');
    return h('div', { class: 'card-specs android-build-item', role: 'listitem' }, h('div', { class: 'row between' }, h('strong', { text: config.name }), h('span', { class: 'pill', text: t('android.build.draft') })), h('p', { class: 'small muted', text: `${config.release} · ${config.architecture} · ${config.target} · ${config.variant}` }), config.notes ? h('p', { class: 'small muted', text: config.notes }) : h('span', {}), h('div', { class: 'row' }, edit, submit, json, yaml, remove));
  }));
  const formInput = () => ({ id: save.dataset.id || '', name: (name as HTMLInputElement).value, target: target.value, variant: variant.value, notes: notes.value });
  const formForPlan = (config: CustomAndroidBuild) => ({ id: config.id, name: config.name, target: config.target, variant: config.variant, notes: config.notes, release: config.release, architecture: config.architecture });
  save.onclick = async () => { save.disabled = true; const result = await run(api.invoke<{ ok: boolean; config?: CustomAndroidBuild; message?: string }>('mgr:android-build-save', formInput())); save.disabled = false; if (!result?.ok || !result.config) { status.textContent = result?.message || t('android.build.invalid'); return; } configs = [result.config, ...configs.filter((item) => item.id !== result.config?.id)]; delete save.dataset.id; status.textContent = t('android.build.saved'); paint(); };
  guide.onclick = async () => { const result = await run(api.invoke<{ ok: boolean; guide?: { commands: string[] }; message?: string }>('mgr:android-build-guide', formInput())); if (!result?.ok || !result.guide) { status.textContent = result?.message || t('android.build.invalid'); return; } const commands = result.guide.commands.join('\n'); commandBlock.textContent = commands; commandBlock.hidden = false; try { await navigator.clipboard.writeText(commands); status.textContent = t('android.build.guideReady'); } catch { status.textContent = t('android.build.copyFailed'); } window.open('https://source.android.com/docs/setup/build/building', '_blank'); };
  const exportCatalogue = async (format: 'json' | 'yaml') => { const result = await run(api.invoke<{ ok: boolean; content?: string; message?: string }>('mgr:android-build-export', { format })); if (!result?.ok || result.content === undefined) { status.textContent = result?.message?.startsWith('android.') ? t(result.message) : t('android.build.exportFailed'); return; } download(result.content, format); status.textContent = t('android.build.exported', { format: format.toUpperCase() }); };
  exportAllJson.onclick = () => void exportCatalogue('json'); exportAllYaml.onclick = () => void exportCatalogue('yaml');
  const loadJobs = async () => { const result = await run(api.invoke<{ ok: boolean; jobs?: Array<{ id: string; status: string; progress?: number; errorCode?: string }> }>('mgr:android-build-remote-list')); if (!result?.ok || !result.jobs) { remoteJobs.replaceChildren(); return; } remoteJobs.replaceChildren(...result.jobs.map((job) => h('div', { class: 'card-specs', role: 'listitem' }, h('strong', { text: t('android.build.remoteJob', { id: job.id, status: job.status }) }), h('span', { class: 'small muted', text: job.progress === undefined ? '' : `${job.progress}%` })))); };
  const loadBackend = async () => { const state = await run(api.invoke<string>('mgr:android-build-backend-state')); const ready = state === 'READY_FOR_SUBMISSION'; backendStatus.dataset.ready = String(ready); backendStatus.textContent = ready ? t('android.build.backendReady') : t('android.build.backendUnavailable'); refreshJobs.disabled = !ready; paint(); if (ready) await loadJobs(); };
  refreshJobs.onclick = () => void loadJobs();
  const load = async () => { const result = await run(api.invoke<{ configs: CustomAndroidBuild[] }>('mgr:android-builds')); configs = result?.configs ?? []; paint(); void loadBackend(); };
  const panel = h('section', { class: 'vm-section android-custom-build', 'aria-labelledby': 'android-build-title' }, h('div', { class: 'vm-section-head' }, h('div', {}, h('h2', { id: 'android-build-title' }, t('android.build.title'), h('span', { class: 'pill warn', text: t('android.build.level') })), h('p', { class: 'hint', text: t('android.build.desc') }), status, backendStatus), h('div', { class: 'android-build-form' }, h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.build.name') }), name), h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.build.target') }), target), h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.build.variant') }), variant)), h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.build.notes') }), notes), h('div', { class: 'row' }, save, guide, refreshJobs, exportAllJson, exportAllYaml), commandBlock)), h('h3', { class: 'spec-title', text: t('android.build.savedTitle') }), list, remoteJobs);
  void load();
  return panel;
}
function chromeAndroidPanel(machines: AndroidMachine[]): HTMLElement {
  let selected = machines.find((machine) => machine.running)?.name ?? machines[0]?.name ?? '';
  const options: Array<[string, string]> = machines.length
    ? machines.map((machine): [string, string] => [machine.name, `${machine.deviceLabel || machine.name}${machine.running ? ' · ' + t('android.running') : ''}`])
    : [['', t('android.chrome.none')]];
  const deviceSelect = select<string>(selected, options, (value) => {
    selected = value;
    void refresh();
  });
  const url = input('https://noai.duckduckgo.com/', { type: 'url', autocomplete: 'url', spellcheck: 'false', 'aria-label': t('android.chrome.url') });
  const open = h('button', { class: 'btn primary', 'aria-label': t('android.chrome.open') }, icon('globe', 14), h('span', { text: t('android.chrome.open') })) as HTMLButtonElement;
  const install = h('button', { class: 'btn small', 'aria-label': t('android.chrome.install') }, icon('download', 14), h('span', { text: t('android.chrome.install') })) as HTMLButtonElement;
  const refreshButton = h('button', { class: 'btn small', 'aria-label': t('android.chrome.refresh') }, icon('refreshCircle', 14), h('span', { text: t('android.chrome.refresh') })) as HTMLButtonElement;
  const status = h('p', { class: 'hint', 'aria-live': 'polite', text: t('android.chrome.checking') });
  const camera = h('p', { class: 'small muted', 'aria-live': 'polite', text: t('android.chrome.cameraHint') });
  const cameraStatus = h('p', { class: 'small muted', 'aria-live': 'polite', text: t('android.chrome.cameraChecking') });
  const browserCameras = h('p', { class: 'small muted', 'aria-live': 'polite', text: t('android.chrome.browserCameraChecking') });
  const cameraSelect = select<string>('', [['', t('android.chrome.cameraNone')]], () => undefined);
  const cameraRefresh = h('button', { class: 'btn small', 'aria-label': t('android.chrome.cameraRefresh') }, icon('refreshCircle', 14), h('span', { text: t('android.chrome.cameraRefresh') })) as HTMLButtonElement;
  const previewButton = h('button', { class: 'btn small', 'aria-label': t('android.chrome.previewCamera') }, icon('monitor', 14), h('span', { text: t('android.chrome.previewCamera') })) as HTMLButtonElement;
  const previewVideo = h('video', { class: 'android-camera-preview chrome-camera-preview', autoplay: '', muted: '', playsinline: '', hidden: 'true', 'aria-label': t('android.chrome.previewCamera') }) as HTMLVideoElement;
  const previewStatus = h('p', { class: 'small muted', 'aria-live': 'polite', text: t('android.chrome.previewHint') });
  const obs = h('button', { class: 'btn small', 'aria-label': t('android.chrome.startObs') }, icon('camera', 14), h('span', { text: t('android.chrome.startObs') })) as HTMLButtonElement;
  const applyCamera = h('button', { class: 'btn small', 'aria-label': t('android.chrome.applyCamera') }, icon('check', 14), h('span', { text: t('android.chrome.applyCamera') })) as HTMLButtonElement;
  const version = h('span', { class: 'pill', text: t('android.chrome.notChecked') });
  let cameraChoices: ChromeCameraChoices | undefined;
  let previewStream: MediaStream | undefined;
  const stopPreview = (): void => {
    previewStream?.getTracks().forEach((track) => track.stop());
    previewStream = undefined;
    previewVideo.srcObject = null;
    previewVideo.hidden = true;
    previewButton.textContent = t('android.chrome.previewCamera');
  };
  const setStatus = (text: string, ok = false) => { status.textContent = text; status.classList.toggle('ok', ok); status.classList.toggle('warn', !ok); };
  const setCameraStatus = (text: string, ok = false) => { cameraStatus.textContent = text; cameraStatus.classList.toggle('ok', ok); cameraStatus.classList.toggle('warn', !ok); };
  async function browserCameraLabels(): Promise<string[]> {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      let devices = await navigator.mediaDevices.enumerateDevices();
      // Chromium hides labels until the user grants a normal camera permission.
      if (devices.every((device) => !device.label) && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        stream.getTracks().forEach((track) => track.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      }
      return devices.filter((device) => device.kind === 'videoinput' && device.label).map((device) => device.label);
    } catch {
      return [];
    }
  }
  async function refresh(): Promise<void> {
    open.disabled = true;
    if (!selected) { setStatus(t('android.chrome.none')); version.textContent = t('android.chrome.notInstalled'); return; }
    const result = await run(api.invoke<{ running: boolean; installed: boolean; version: string; reason: string }>('mgr:android-chrome-status', selected));
    open.disabled = !(result?.installed === true);
    version.textContent = result?.installed ? `${t('android.chrome.ready')} ${result.version || ''}`.trim() : t('android.chrome.notInstalled');
    setStatus(result?.reason || t('android.chrome.unavailable'), result?.installed === true);
    camera.textContent = result?.installed ? t('android.chrome.cameraHint') : t('android.chrome.installHint');
  }
  async function refreshCameras(): Promise<void> {
    cameraRefresh.disabled = true;
    const [result, browserLabels] = await Promise.all([
      run(api.invoke<ChromeCameraChoices>('mgr:android-camera-choices')),
      browserCameraLabels(),
    ]);
    cameraChoices = result ?? undefined;
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const browserKeys = browserLabels.map(normalize);
    cameraSelect.replaceChildren(...(result?.webcams?.length
      ? result.webcams.map((item) => {
        const routeLabel = item.device || item.name;
        const browserMatch = browserLabels.find((label) => normalize(label) === normalize(routeLabel) || normalize(label).includes(normalize(routeLabel)) || normalize(routeLabel).includes(normalize(label)));
        return new Option(`${item.virtual ? 'Virtual · ' : ''}${browserMatch || routeLabel} (${item.name})`, item.name);
      })
      : [new Option(t('android.chrome.cameraNone'), '')]));
    const first = result?.webcams?.[0]?.name ?? '';
    cameraSelect.value = first;
    obs.disabled = !result?.emulatorAvailable;
    applyCamera.disabled = !first || !selected;
    setCameraStatus(result?.webcams?.length ? t('android.chrome.cameraDetected', { count: String(result.webcams.length) }) : (result?.detail || t('android.chrome.cameraUnavailable')), Boolean(result?.webcams?.length));
    browserCameras.textContent = browserLabels.length
      ? t('android.chrome.browserCameraDetected', { count: String(browserLabels.length), names: browserLabels.join(', ') })
      : t('android.chrome.browserCameraUnavailable');
    if (browserKeys.length && result?.webcams?.length && !result.webcams.some((item) => browserKeys.includes(normalize(item.device)))) {
      cameraStatus.textContent = t('android.chrome.cameraMismatch');
      cameraStatus.classList.add('warn');
    }
    cameraRefresh.disabled = false;
  }
  async function togglePreview(): Promise<void> {
    if (previewStream) { stopPreview(); return; }
    const route = cameraChoices?.webcams?.find((item) => item.name === cameraSelect.value);
    if (!route) { previewStatus.textContent = t('android.chrome.previewOff'); return; }
    previewButton.disabled = true;
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      if (devices.every((device) => !device.label)) {
        const reveal = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        reveal.getTracks().forEach((track) => track.stop());
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        devices = await navigator.mediaDevices.enumerateDevices();
      }
      const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const match = devices.find((device) => device.kind === 'videoinput' && route.device
        && (normalize(device.label) === normalize(route.device) || normalize(device.label).includes(normalize(route.device)) || normalize(route.device).includes(normalize(device.label))));
      if (!match) { previewStatus.textContent = t('android.chrome.previewUnavailable'); return; }
      previewStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: match.deviceId } }, audio: false });
      previewVideo.srcObject = previewStream;
      previewVideo.hidden = false;
      await previewVideo.play().catch(() => undefined);
      previewButton.textContent = t('android.chrome.stopPreview');
      previewStatus.textContent = t('android.chrome.previewLive', { name: match.label || route.name });
    } catch {
      stopPreview();
      previewStatus.textContent = t('android.chrome.previewFailed');
    } finally { previewButton.disabled = false; }
  }
  open.onclick = async () => {
    if (!selected) return;
    open.disabled = true;
    const result = await run(api.invoke<{ opened: boolean; reason: string; version?: string }>('mgr:android-open-chrome', selected, (url as HTMLInputElement).value));
    if (result?.opened) { setStatus(t('android.chrome.opened'), true); toast(t('android.chrome.opened'), 'ok'); }
    else { setStatus(result?.reason || t('android.chrome.failed')); toast(t('android.chrome.failed'), 'err', status.textContent); }
    await refresh();
  };
  install.onclick = async () => {
    if (!selected) return;
    install.disabled = true;
    const result = await run(api.invoke<{ opened: boolean; reason: string }>('mgr:android-install-chrome', selected));
    if (result?.opened) toast(t('android.chrome.installOpened'), 'ok');
    else toast(t('android.chrome.installFailed'), 'err', result?.reason);
    install.disabled = false;
    await refresh();
  };
  cameraRefresh.onclick = () => { stopPreview(); void refreshCameras(); };
  previewButton.onclick = () => void togglePreview();
  obs.onclick = async () => {
    obs.disabled = true;
    const result = await run(api.invoke<{ started: boolean; camera: string; reason: string }>('mgr:android-start-obs'));
    toast(result?.started ? t('android.chrome.obsStarted') : t('android.chrome.obsFailed'), result?.started ? 'ok' : 'err', result?.reason);
    obs.disabled = false;
    await refreshCameras();
  };
  applyCamera.onclick = async () => {
    if (!selected || !cameraSelect.value) return;
    applyCamera.disabled = true;
    const changed = await run(api.invoke<string[]>('mgr:android-settings', selected, {
      cameraFront: 'none', cameraBack: 'webcam', cameraFrontDevice: '', cameraBackDevice: cameraSelect.value,
      cameraDevice: cameraSelect.value, microphoneEnabled: true,
    }));
    toast(Array.isArray(changed) ? t('android.chrome.cameraApplied') : t('android.chrome.cameraFailed'), Array.isArray(changed) ? 'ok' : 'err');
    applyCamera.disabled = false;
  };
  refreshButton.onclick = () => void refresh();
  void refresh();
  void refreshCameras();
  return h('section', { class: 'vm-section android-chrome-section', 'aria-labelledby': 'android-chrome-title' },
    h('div', { class: 'vm-section-head' },
      h('div', {}, h('h2', { id: 'android-chrome-title' }, t('android.chrome.title'), h('span', { class: 'pill warn', text: t('android.chrome.beta') })), h('p', { class: 'hint', text: t('android.chrome.desc') }), status, camera),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.chrome.selectDevice') }), deviceSelect),
        h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.chrome.url') }), url), version, refreshButton, install, open),
      h('div', { class: 'row chrome-camera-controls' },
        h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.chrome.cameraSelect') }), cameraSelect), cameraRefresh, previewButton, obs, applyCamera),
      previewVideo, previewStatus, cameraStatus, browserCameras));
}
