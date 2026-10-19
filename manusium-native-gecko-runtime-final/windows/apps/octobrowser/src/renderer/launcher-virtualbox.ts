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
interface AndroidLaunchPrefs {
  proxyId: string; cameraFront: CameraSource; cameraBack: CameraSource;
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
      initial: {
        front: saved?.cameraFront ?? machine.cameraFront,
        back: saved?.cameraBack ?? machine.cameraBack,
        frontDevice: rememberedFrontCamera,
        backDevice: rememberedBackCamera,
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
        const result = await run(api.invoke<{ ok: boolean; cameraWarning?: string; notes?: string[] }>('mgr:android-launch', {
          name: machine.name, proxyId, cameraFront: camera.front, cameraBack: camera.back,
          cameraFrontDevice: camera.frontDevice, cameraBackDevice: camera.backDevice,
          cameraDevice: camera.backDevice || camera.frontDevice,
          cameraLimits: { front: camera.frontLimit, back: camera.backLimit },
          microphoneEnabled: checked(microphone), microphoneDevice,
          bootMode: valueOf(boot), networkSpeed: valueOf(netSpeed), locale: valueOf(language),
          secondaryDisplay: valueOf(display),
        }));
        if (!result?.ok) return;
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
    virtualBrowserHost.append(chromeAndroidPanel(machines));
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
  const refreshButton = h('button', { class: 'btn small', 'aria-label': t('android.chrome.refresh') }, icon('refreshCircle', 14), h('span', { text: t('android.chrome.refresh') })) as HTMLButtonElement;
  const status = h('p', { class: 'hint', 'aria-live': 'polite', text: t('android.chrome.checking') });
  const camera = h('p', { class: 'small muted', 'aria-live': 'polite', text: t('android.chrome.cameraHint') });
  const version = h('span', { class: 'pill', text: t('android.chrome.notChecked') });
  const setStatus = (text: string, ok = false) => { status.textContent = text; status.classList.toggle('ok', ok); status.classList.toggle('warn', !ok); };
  async function refresh(): Promise<void> {
    open.disabled = true;
    if (!selected) { setStatus(t('android.chrome.none')); version.textContent = t('android.chrome.notInstalled'); return; }
    const result = await run(api.invoke<{ running: boolean; installed: boolean; version: string; reason: string }>('mgr:android-chrome-status', selected));
    open.disabled = !(result?.installed === true);
    version.textContent = result?.installed ? `${t('android.chrome.ready')} ${result.version || ''}`.trim() : t('android.chrome.notInstalled');
    setStatus(result?.reason || t('android.chrome.unavailable'), result?.installed === true);
    camera.textContent = result?.installed ? t('android.chrome.cameraHint') : t('android.chrome.installHint');
  }
  open.onclick = async () => {
    if (!selected) return;
    open.disabled = true;
    const result = await run(api.invoke<{ opened: boolean; reason: string; version?: string }>('mgr:android-open-chrome', selected, (url as HTMLInputElement).value));
    if (result?.opened) { setStatus(t('android.chrome.opened'), true); toast(t('android.chrome.opened'), 'ok'); }
    else { setStatus(result?.reason || t('android.chrome.failed')); toast(t('android.chrome.failed'), 'err', status.textContent); }
    await refresh();
  };
  refreshButton.onclick = () => void refresh();
  void refresh();
  return h('section', { class: 'vm-section android-chrome-section', 'aria-labelledby': 'android-chrome-title' },
    h('div', { class: 'vm-section-head' },
      h('div', {}, h('h2', { id: 'android-chrome-title' }, t('android.chrome.title'), h('span', { class: 'pill warn', text: t('android.chrome.beta') })), h('p', { class: 'hint', text: t('android.chrome.desc') }), status, camera),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.chrome.selectDevice') }), deviceSelect),
        h('label', { class: 'field' }, h('span', { class: 'lbl', text: t('android.chrome.url') }), url), version, refreshButton, open)));
}
