/**
 * A deliberately page-world read-back probe. It reports only values a page can
 * already read; device labels and raw WebRTC addresses are never returned.
 */
export interface FingerprintProbeSnapshot {
  userAgent: string;
  platform: string;
  language: string;
  languages: string[];
  uaDataPlatform: string;
  uaDataPlatformVersion: string;
  uaDataArchitecture: string;
  uaDataModel: string;
  uaDataBrands: Array<{ brand: string; version: string }>;
  uaDataFullVersionList: Array<{ brand: string; version: string }>;
  timezone: string;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  screen: { width: number; height: number; availWidth: number; availHeight: number; colorDepth: number; pixelRatio: number };
  webgl: {
    available: boolean; debugInfo: boolean; vendor: string; renderer: string;
    standardVendor: string; standardRenderer: string; unmaskedVendor: string; unmaskedRenderer: string;
  };
  webgpuAvailable: boolean;
  canvas: {
    hash: string;
    blankReadback: boolean;
    rendering?: { text: string; emoji: string; paintGpu: string; paintCpu: string; combined: string };
  };
  audioHash: string;
  rectsHash: string;
  fonts: { availableCount: number; testedCount: number };
  mediaDevices: { audioInputs: number; audioOutputs: number; videoInputs: number; labelsVisible: number };
  geolocationPermission: string;
  webrtc: { available: boolean; hostCandidates: number; serverReflexiveCandidates: number; relayCandidates: number };
  errors: string[];
}

/** Serialized into the active profile page's main world by WebContents.executeJavaScript. */
export const FINGERPRINT_PROBE_SCRIPT = String.raw`(() => (async () => {
  const errors = [];
  const fail = (key) => { if (errors.length < 20 && !errors.includes(key)) errors.push(key); };
  const read = (key, fn, fallback) => { try { return fn(); } catch { fail(key); return fallback; } };
  const hash = (value) => {
    const text = String(value);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  const n = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const brandList = (value) => Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object')
      .map((item) => ({ brand: String(item.brand || ''), version: String(item.version || '') }))
      .filter((item) => item.brand && item.version)
    : [];
  const nav = navigator;
  const uaData = nav.userAgentData;
  let high = {};
  if (uaData && typeof uaData.getHighEntropyValues === 'function') {
    try { high = await uaData.getHighEntropyValues(['architecture', 'fullVersionList', 'model', 'platformVersion']); }
    catch { fail('ua-hints'); }
  }

  const canvas = read('canvas', () => {
    const make2d = () => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 64;
      const ctx = c.getContext('2d'); if (!ctx) throw new Error('2d-unavailable');
      return { c, ctx };
    };
    const render = (kind) => {
      const { c, ctx } = make2d();
      ctx.clearRect(0, 0, c.width, c.height);
      if (kind === 'text') {
        ctx.font = 'bold 17px Arial'; ctx.fillStyle = '#f3f4f6'; ctx.fillText('Octo Canvas', 9, 34);
      } else if (kind === 'emoji') {
        ctx.font = '28px "Segoe UI Emoji", sans-serif'; ctx.fillText('🛡️🦊', 18, 40);
      } else {
        const gradient = ctx.createLinearGradient(0, 0, c.width, c.height);
        gradient.addColorStop(0, '#2677d8'); gradient.addColorStop(1, '#8cf8a3');
        ctx.fillStyle = gradient; ctx.fillRect(4, 4, 72, 42);
        ctx.beginPath(); ctx.arc(112, 31, 19, 0, Math.PI * 2); ctx.fillStyle = '#e879f9'; ctx.fill();
        ctx.font = '12px sans-serif'; ctx.fillStyle = '#111827'; ctx.fillText('GPU/CPU', 88, 58);
      }
      return hash(c.toDataURL());
    };
    const gpuPaint = (() => {
      try {
        const c = document.createElement('canvas'); c.width = 32; c.height = 32;
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        if (!gl) return '';
        gl.clearColor(0.15, 0.47, 0.85, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        const pixels = new Uint8Array(32 * 32 * 4); gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return hash(Array.from(pixels).join(','));
      } catch { fail('canvas-gpu-paint'); return ''; }
    })();
    const paintCpu = render('paint');
    const textHash = render('text');
    const emojiHash = render('emoji');
    const combinedCanvas = make2d();
    combinedCanvas.ctx.fillStyle = '#2677d8'; combinedCanvas.ctx.fillRect(2, 2, 72, 22);
    combinedCanvas.ctx.font = 'bold 13px sans-serif'; combinedCanvas.ctx.fillStyle = '#fff'; combinedCanvas.ctx.fillText('Octo audit', 5, 18);
    combinedCanvas.ctx.font = '24px "Segoe UI Emoji", sans-serif'; combinedCanvas.ctx.fillText('🛡️', 88, 28);
    combinedCanvas.ctx.fillStyle = '#8cf8a3'; combinedCanvas.ctx.fillRect(2, 34, 124, 22);
    const combined = hash(combinedCanvas.c.toDataURL());
    const blank = document.createElement('canvas'); blank.width = combinedCanvas.c.width; blank.height = combinedCanvas.c.height;
    return {
      hash: combined,
      blankReadback: combinedCanvas.c.toDataURL() === blank.toDataURL(),
      rendering: { text: textHash, emoji: emojiHash, paintGpu: gpuPaint, paintCpu, combined },
    };
  }, { hash: '', blankReadback: false });

  const webgl = read('webgl', () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return {
      available: false, debugInfo: false, vendor: '', renderer: '',
      standardVendor: '', standardRenderer: '', unmaskedVendor: '', unmaskedRenderer: '',
    };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const standardVendor = String(gl.getParameter(gl.VENDOR) || '');
    const standardRenderer = String(gl.getParameter(gl.RENDERER) || '');
    const unmaskedVendor = ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || '') : '';
    const unmaskedRenderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
    return {
      available: true,
      debugInfo: !!ext,
      vendor: ext ? unmaskedVendor : standardVendor,
      renderer: ext ? unmaskedRenderer : standardRenderer,
      standardVendor, standardRenderer, unmaskedVendor, unmaskedRenderer,
    };
  }, {
    available: false, debugInfo: false, vendor: '', renderer: '',
    standardVendor: '', standardRenderer: '', unmaskedVendor: '', unmaskedRenderer: '',
  });

  let audioHash = '';
  try {
    const Audio = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (Audio) {
      const context = new Audio(1, 4096, 44100);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle'; oscillator.frequency.value = 997;
      gain.gain.value = 0.15;
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(0);
      const buffer = await context.startRendering();
      const samples = buffer.getChannelData(0);
      let signature = '';
      for (let i = 64; i < samples.length; i += 31) signature += Math.round(samples[i] * 1e7) + ',';
      audioHash = hash(signature);
    }
  } catch { fail('audio'); }

  const rectsHash = read('rects', () => {
    const el = document.createElement('span');
    el.textContent = 'Octo';
    el.style.cssText = 'position:fixed;left:-10000px;top:-10000px;font:13px Arial;white-space:nowrap';
    (document.body || document.documentElement).appendChild(el);
    const r = el.getBoundingClientRect();
    el.remove();
    return hash([r.x, r.y, r.width, r.height].map((v) => Number(v).toFixed(4)).join(','));
  }, '');

  const fontNames = ['Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Helvetica', 'Impact', 'Roboto', 'Segoe UI', 'Times New Roman', 'Verdana'];
  let fontCount = 0;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const sample = 'mmmmmmmmwwww';
      ctx.font = '72px monospace';
      const baseline = ctx.measureText(sample).width;
      for (const name of fontNames) {
        ctx.font = '72px "' + name + '", monospace';
        if (ctx.measureText(sample).width !== baseline) fontCount++;
      }
    }
  } catch { fail('fonts'); }

  let media = { audioInputs: 0, audioOutputs: 0, videoInputs: 0, labelsVisible: 0 };
  try {
    if (nav.mediaDevices && nav.mediaDevices.enumerateDevices) {
      const devices = await nav.mediaDevices.enumerateDevices();
      media = {
        audioInputs: devices.filter((d) => d.kind === 'audioinput').length,
        audioOutputs: devices.filter((d) => d.kind === 'audiooutput').length,
        videoInputs: devices.filter((d) => d.kind === 'videoinput').length,
        labelsVisible: devices.filter((d) => !!d.label).length,
      };
    }
  } catch { fail('media-devices'); }

  let geolocationPermission = 'unsupported';
  try {
    if (nav.permissions && nav.permissions.query) {
      geolocationPermission = (await nav.permissions.query({ name: 'geolocation' })).state;
    }
  } catch { geolocationPermission = 'unavailable'; fail('geolocation-permission'); }

  const webrtc = { available: typeof window.RTCPeerConnection === 'function', hostCandidates: 0, serverReflexiveCandidates: 0, relayCandidates: 0 };
  if (webrtc.available) {
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: [] });
      const gathered = new Promise((resolve) => {
        const timer = setTimeout(resolve, 900);
        pc.onicecandidate = (event) => {
          if (!event.candidate) { clearTimeout(timer); resolve(); return; }
          const candidate = String(event.candidate.candidate || '');
          const type = /\btyp\s+(host|srflx|relay)\b/i.exec(candidate)?.[1]?.toLowerCase();
          if (type === 'host') webrtc.hostCandidates++;
          else if (type === 'srflx') webrtc.serverReflexiveCandidates++;
          else if (type === 'relay') webrtc.relayCandidates++;
        };
      });
      pc.createDataChannel('octo-audit');
      await pc.setLocalDescription(await pc.createOffer());
      await gathered;
    } catch { fail('webrtc'); }
    finally { try { pc?.close(); } catch { /* already closed */ } }
  }

  return {
    userAgent: read('user-agent', () => nav.userAgent, ''),
    platform: read('platform', () => nav.platform, ''),
    language: read('language', () => nav.language, ''),
    languages: read('languages', () => Array.from(nav.languages || []), []),
    uaDataPlatform: uaData ? read('ua-platform', () => uaData.platform, '') : '',
    uaDataPlatformVersion: String(high.platformVersion || ''),
    uaDataArchitecture: String(high.architecture || ''),
    uaDataModel: String(high.model || ''),
    uaDataBrands: uaData ? read('ua-brands', () => brandList(uaData.brands), []) : [],
    uaDataFullVersionList: uaData ? read('ua-full-version-list', () => brandList(high.fullVersionList), []) : [],
    timezone: read('timezone', () => Intl.DateTimeFormat().resolvedOptions().timeZone || '', ''),
    hardwareConcurrency: read('cpu', () => n(nav.hardwareConcurrency), null),
    deviceMemory: read('memory', () => n(nav.deviceMemory), null),
    screen: {
      width: read('screen-width', () => n(screen.width), null),
      height: read('screen-height', () => n(screen.height), null),
      availWidth: read('screen-avail-width', () => n(screen.availWidth), null),
      availHeight: read('screen-avail-height', () => n(screen.availHeight), null),
      colorDepth: read('screen-depth', () => n(screen.colorDepth), null),
      pixelRatio: read('pixel-ratio', () => n(window.devicePixelRatio), null),
    },
    webgl,
    webgpuAvailable: read('webgpu', () => !!nav.gpu, false),
    canvas,
    audioHash,
    rectsHash,
    fonts: { availableCount: fontCount, testedCount: fontNames.length },
    mediaDevices: media,
    geolocationPermission,
    webrtc,
    errors,
  };
})())()`;
