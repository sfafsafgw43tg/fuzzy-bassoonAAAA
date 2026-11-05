export {};
declare global {
  interface Window {
    octoCamera: {
      avds: () => Promise<string[]>;
      devices: () => Promise<Array<{ serial: string; state: string }>>;
      pick: (kind: 'image' | 'video') => Promise<string>;
      apply: (input: { avd: string; source: string; type: 'image' | 'video'; width: number; height: number; fit: 'stretch' | 'fit' | 'crop'; serial?: string; crop?: { x: number; y: number; width: number; height: number }; filter?: 'none' | 'grayscale' | 'sepia' | 'bright' | 'contrast'; videoLoop?: boolean; videoSpeed?: number }) => Promise<{ message: string; source: string }>;
      applyLive: (input: { source: string; type: 'image' | 'video'; width: number; height: number; fit: 'stretch' | 'fit' | 'crop'; serial?: string; crop?: { x: number; y: number; width: number; height: number }; filter?: 'none' | 'grayscale' | 'sepia' | 'bright' | 'contrast'; videoLoop?: boolean; videoSpeed?: number }) => Promise<{ message: string; source: string }>;
      installController: (serial?: string) => Promise<string>;
    };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const avd = $<HTMLSelectElement>('avd');
const serial = $<HTMLSelectElement>('serial');
const connection = $('connection');
const sourceName = $('sourceName');
const sourceType = $('sourceType');
const image = $<HTMLImageElement>('image');
const movie = $<HTMLVideoElement>('movie');
const empty = $('empty');
const stage = $('stage');
const cropBox = $('cropBox');
const measureTop = $('measureTop');
const measureBottom = $('measureBottom');
const cropReadout = $('cropReadout');
const statusEl = $('status');
const deviceStatus = $('deviceStatus');
const preset = $<HTMLSelectElement>('preset');
const width = $<HTMLInputElement>('width');
const height = $<HTMLInputElement>('height');
const fit = $<HTMLSelectElement>('fit');
const filter = $<HTMLSelectElement>('filter');
const videoControls = $('videoControls');
const videoLoop = $<HTMLInputElement>('videoLoop');
const videoSpeed = $<HTMLSelectElement>('videoSpeed');
const applyButton = $<HTMLButtonElement>('apply');
const applyLiveButton = $<HTMLButtonElement>('applyLive');

let source = '';
let type: 'image' | 'video' = 'image';
let liveReady = false;
let liveTimer: number | undefined;
let liveApplying = false;
let crop = { x: .12, y: .08, w: .76, h: .84 };
let drag: { kind: string; pointerId: number; startX: number; startY: number; initial: { x: number; y: number; w: number; h: number } } | null = null;

function setStatus(text: string, bad = false): void {
  statusEl.textContent = text;
  statusEl.style.color = bad ? '#ff8b78' : '';
}
function updateLiveButton(): void {
  applyLiveButton.disabled = !liveReady || type !== 'image' || !source;
  applyLiveButton.textContent = liveReady && type === 'image' ? 'Apply resized photo — restart camera' : 'Apply photo as full-frame camera';
}
function scheduleLiveApply(): void {
  if (!liveReady || type !== 'image' || !source) return;
  window.clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => setStatus('Photo frame changed. Click Apply resized photo — restart camera to load it.'), 450);
}
function output(): void { $('output').textContent = `${Number(width.value) || 0} × ${Number(height.value) || 0}`; }
function imageRect(): { x: number; y: number; width: number; height: number } {
  const r = stage.getBoundingClientRect();
  const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
  let w = r.width, h = r.height;
  if (w / h > ratio) w = h * ratio; else h = w / ratio;
  return { x: (r.width - w) / 2, y: (r.height - h) / 2, width: w, height: h };
}
function renderCrop(): void {
  if (!image.naturalWidth || type !== 'image') return;
  const r = imageRect();
  cropBox.style.left = `${r.x + crop.x * r.width}px`;
  cropBox.style.top = `${r.y + crop.y * r.height}px`;
  cropBox.style.width = `${crop.w * r.width}px`;
  cropBox.style.height = `${crop.h * r.height}px`;
  const sw = Math.max(1, Math.round(crop.w * image.naturalWidth));
  const sh = Math.max(1, Math.round(crop.h * image.naturalHeight));
  measureTop.textContent = `${sw} px`;
  measureBottom.textContent = `${sh} px`;
  cropReadout.textContent = `${Math.max(1, Math.round(crop.x * image.naturalWidth))}, ${Math.max(1, Math.round(crop.y * image.naturalHeight))} · ${sw} × ${sh} px`;
}
function clamp(): void {
  crop.w = Math.max(.04, Math.min(1 - crop.x, crop.w));
  crop.h = Math.max(.04, Math.min(1 - crop.y, crop.h));
  crop.x = Math.max(0, Math.min(1 - crop.w, crop.x));
  crop.y = Math.max(0, Math.min(1 - crop.h, crop.y));
}
function pointerMove(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const r = imageRect();
  const dx = (event.clientX - drag.startX) / r.width;
  const dy = (event.clientY - drag.startY) / r.height;
  const b = drag.initial;
  if (drag.kind === 'move') {
    crop.x = b.x + dx;
    crop.y = b.y + dy;
  } else {
    let left = b.x, top = b.y, right = b.x + b.w, bottom = b.y + b.h;
    if (drag.kind.includes('w')) left = b.x + dx;
    if (drag.kind.includes('e')) right = b.x + b.w + dx;
    if (drag.kind.includes('n')) top = b.y + dy;
    if (drag.kind.includes('s')) bottom = b.y + b.h + dy;
    crop = { x: Math.min(left, right), y: Math.min(top, bottom), w: Math.abs(right - left), h: Math.abs(bottom - top) };
  }
  clamp();
  renderCrop();
  scheduleLiveApply();
}
function stopDrag(): void {
  drag = null;
  cropBox.classList.remove('dragging');
}

cropBox.addEventListener('pointerdown', (event) => {
  if (!image.naturalWidth || type !== 'image') return;
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]');
  drag = { kind: target?.dataset.handle || 'move', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, initial: { ...crop } };
  cropBox.classList.add('dragging');
  cropBox.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
});
cropBox.addEventListener('pointermove', pointerMove);
cropBox.addEventListener('pointerup', (event) => {
  if (drag?.pointerId === event.pointerId) stopDrag();
});
cropBox.addEventListener('pointercancel', stopDrag);
window.addEventListener('resize', renderCrop);
image.addEventListener('load', () => {
  crop = { x: .12, y: .08, w: .76, h: .84 };
  cropBox.hidden = false;
  empty.hidden = true;
  renderCrop();
  updateLiveButton();
});

async function refresh(): Promise<void> {
  try {
    const [a, d] = await Promise.all([window.octoCamera.avds(), window.octoCamera.devices()]);
    avd.replaceChildren(...a.map(x => new Option(x, x)));
    serial.replaceChildren(new Option('Auto-detect', ''), ...d.map(x => new Option(`${x.serial} · ${x.state}`, x.serial)));
    const ready = d.some(x => x.state === 'device');
    connection.textContent = ready ? 'ADB connected' : 'ADB waiting';
    connection.className = `pill ${ready ? '' : 'muted'}`;
    deviceStatus.textContent = d.length ? `${d.length} ADB device(s) detected.` : 'Start an AVD or connect a device.';
  } catch (e) {
    connection.textContent = 'ADB unavailable';
    connection.className = 'pill muted';
    setStatus(String(e), true);
  }
}
function applyPreset(): void {
  const ratios: { [key: string]: number } = { '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '3:2': 3 / 2 };
  const ratio = ratios[preset.value];
  if (ratio) { const base = 720; width.value = String(Math.round(base * ratio)); height.value = String(base); output(); scheduleLiveApply(); }
}
async function choose(kind: 'image' | 'video'): Promise<void> {
  const picked = await window.octoCamera.pick(kind);
  if (!picked) return;
  source = picked;
  type = kind;
  sourceName.textContent = picked.split(/[\\/]/).pop() || picked;
  sourceType.textContent = kind === 'image' ? 'Photo' : 'Video';
  sourceType.className = 'pill';
  empty.hidden = true;
  videoControls.hidden = kind !== 'video';
  if (kind === 'image') {
    movie.hidden = true;
    movie.pause();
    image.hidden = false;
    image.src = `file://${picked}`;
  } else {
    image.hidden = true;
    cropBox.hidden = true;
    movie.hidden = false;
    movie.src = `file://${picked}`;
    movie.playbackRate = Number(videoSpeed.value);
    movie.load();
  }
  updateLiveButton();
  if (kind === 'image' && liveReady) scheduleLiveApply();
  setStatus(kind === 'image' && liveReady ? 'New photo ready. Click Reapply photo live — no restart.' : 'Source ready. Configure the frame and apply it.');
}

$('photo').onclick = () => void choose('image');
$('video').onclick = () => void choose('video');
$('refresh').onclick = () => void refresh();
preset.onchange = applyPreset;
width.oninput = () => { output(); scheduleLiveApply(); };
height.oninput = () => { output(); scheduleLiveApply(); };
fit.onchange = scheduleLiveApply;
filter.onchange = scheduleLiveApply;
videoSpeed.onchange = () => { movie.playbackRate = Number(videoSpeed.value); };
applyButton.onclick = async () => {
  if (!source) { setStatus('Choose a photo or video first.', true); return; }
  if (!avd.value) { setStatus('Choose an Android Virtual Device first.', true); return; }
  try {
    applyButton.disabled = true;
    setStatus(type === 'image' ? 'Preparing the photo and applying it to the running emulator…' : 'Preparing the video source and starting the emulator…');
    const result = await window.octoCamera.apply({ avd: avd.value, source, type, width: Number(width.value) || 1280, height: Number(height.value) || 720, fit: fit.value as 'stretch' | 'fit' | 'crop', serial: serial.value || undefined, crop: { x: crop.x * image.naturalWidth, y: crop.y * image.naturalHeight, width: crop.w * image.naturalWidth, height: crop.h * image.naturalHeight }, filter: filter.value as 'none' | 'grayscale' | 'sepia' | 'bright' | 'contrast', videoLoop: videoLoop.checked, videoSpeed: Number(videoSpeed.value) });
    liveReady = type === 'image';
    updateLiveButton();
    setStatus(result.message);
  } catch (e) { setStatus(String(e), true); }
  finally { applyButton.disabled = false; }
};

async function applyCurrentLive(manual: boolean): Promise<void> {
  if (!source || type !== 'image') { setStatus('Choose a photo for live reapplication.', true); return; }
  if (liveApplying) return;
  try {
    liveApplying = true;
    applyLiveButton.disabled = true;
    if (manual) setStatus('Preparing the resized photo and restarting the camera input…');
    const result = await window.octoCamera.applyLive({ source, type, width: Number(width.value) || 1280, height: Number(height.value) || 720, fit: fit.value as 'stretch' | 'fit' | 'crop', serial: serial.value || undefined, crop: { x: crop.x * image.naturalWidth, y: crop.y * image.naturalHeight, width: crop.w * image.naturalWidth, height: crop.h * image.naturalHeight }, filter: filter.value as 'none' | 'grayscale' | 'sepia' | 'bright' | 'contrast', videoLoop: videoLoop.checked, videoSpeed: Number(videoSpeed.value) });
    setStatus(result.message);
  } catch (e) { setStatus(String(e), true); }
  finally { liveApplying = false; updateLiveButton(); }
}
applyLiveButton.onclick = () => { void applyCurrentLive(true); };

updateLiveButton();
output();
void refresh();
