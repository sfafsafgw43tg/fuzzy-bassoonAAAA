/**
 * Self-contained ServiceWorkerGlobalScope fingerprint bootstrap.
 *
 * The main process serializes this function with a per-profile configuration
 * and registers the generated file through session.registerPreloadScript.
 * It intentionally does not depend on window, document, Electron, or imports.
 */
export function serviceWorkerFingerprintPreload(config: {
  userAgent: string;
  platform: string;
  languages: string[];
  uaPlatform: string;
  uaPlatformVersion: string;
  uaArchitecture: string;
  uaBitness: string;
  uaModel: string;
  uaBrands: Array<{ brand: string; version: string }>;
  uaFullVersionList: Array<{ brand: string; version: string }>;
  cores: number | null;
  memory: number | null;
  webgl: 'off' | 'real' | 'noise';
  vendor: string;
  renderer: string;
  seed: number;
}): void {
  const G = globalThis as unknown as Record<string, unknown>;
  const navigatorValue = G.navigator as Record<string, unknown> | undefined;
  const workerNavigator = (G.WorkerNavigator as { prototype?: object } | undefined)?.prototype;
  // A service-worker preload can execute more than once during a worker
  // lifecycle. Mark wrappers so repeated execution never creates proxy/wrapper
  // chains that confuse prototype auditors or recurse through apply traps.
  const WRAPPED = Symbol.for('octo.service-worker-native-wrapper');
  const define = (target: object | undefined, property: string, value: unknown): void => {
    if (!target) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (!descriptor?.get) return;
    try {
      Object.defineProperty(target, property, {
        configurable: true,
        enumerable: descriptor.enumerable ?? true,
        get: () => value,
      });
    } catch { /* protected platform property */ }
  };
  define(workerNavigator, 'userAgent', config.userAgent);
  define(workerNavigator, 'platform', config.platform);
  if (config.cores) define(workerNavigator, 'hardwareConcurrency', config.cores);
  if (config.memory) define(workerNavigator, 'deviceMemory', config.memory);
  if (config.languages.length) {
    const languages = Object.freeze(config.languages.slice());
    define(workerNavigator, 'languages', languages);
    define(workerNavigator, 'language', languages[0]);
  }
  const userAgentData = Object.freeze({
    brands: Object.freeze(config.uaBrands.map((item) => ({ brand: item.brand, version: item.version }))),
    mobile: false,
    platform: config.uaPlatform,
    toJSON: () => ({
      brands: config.uaBrands.map((item) => ({ brand: item.brand, version: item.version })),
      mobile: false,
      platform: config.uaPlatform,
    }),
    getHighEntropyValues: async (hints: string[]) => {
      const requested = new Set(Array.isArray(hints) ? hints : []);
      const values: Record<string, unknown> = {
        architecture: config.uaArchitecture,
        bitness: config.uaBitness,
        brands: config.uaBrands.map((item) => ({ brand: item.brand, version: item.version })),
        fullVersionList: config.uaFullVersionList.map((item) => ({ brand: item.brand, version: item.version })),
        mobile: false,
        model: config.uaModel,
        platform: config.uaPlatform,
        platformVersion: config.uaPlatformVersion,
      };
      return Object.fromEntries(Object.entries(values).filter(([key]) => !requested.size || requested.has(key)));
    },
  });
  define(workerNavigator, 'userAgentData', userAgentData);

  let state = config.seed >>> 0;
  const hash = (a: number, b = 0): number => {
    let h = (state ^ Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const gpuName = `${config.vendor} ${config.renderer}`.toLowerCase();
  const high = /rtx|rx [569]|rx 6|rx 7|m[2-4]|iris xe|radeon pro/.test(gpuName);
  const mid = /gtx|uhd|iris|vega|m1|m2/.test(gpuName);
  const texture = high ? 16384 : mid ? 8192 : 4096;
  const units = high || mid ? 16 : 8;
  const uniforms = high ? 1024 : 512;
  const varyings = high ? 30 : mid ? 15 : 8;
  let gpuSalt = 0;
  for (let i = 0; i < gpuName.length; i++) gpuSalt = Math.imul(gpuSalt ^ gpuName.charCodeAt(i), 16777619);

  const wrapContext = (context: unknown): unknown => {
    if (!context || (typeof context !== 'object' && typeof context !== 'function')) return context;
    const object = context as Record<string, unknown>;
    const wrap = (name: string, implementation: (args: unknown[], original: (...a: unknown[]) => unknown) => unknown): void => {
      const original = object[name];
      if (typeof original !== 'function') return;
      if ((original as unknown as Record<PropertyKey, unknown>)[WRAPPED] === true) return;
      const wrapped = (...args: unknown[]) => implementation(args, (...next) => Reflect.apply(original as (...a: unknown[]) => unknown, context, next));
      try {
        Object.defineProperty(wrapped, WRAPPED, { value: true, configurable: false });
        Object.defineProperty(object, name, { configurable: true, writable: true, value: wrapped });
      } catch { /* protected context */ }
    };
    wrap('getParameter', (args, original) => {
      const p = Number(args[0]);
      if (p === 0x1f00 || p === 0x9245) return config.vendor;
      if (p === 0x1f01 || p === 0x9246) return config.renderer;
      if (p === 0x0D33 || p === 0x8513) return texture;
      if (p === 0x0D3A) return new Int32Array([texture, texture]);
      if (p === 0x8872) return units;
      if (p === 0x8B4D || p === 0x8B4B) return uniforms;
      if (p === 0x8DFC) return varyings;
      return original(...args);
    });
    wrap('getShaderPrecisionFormat', (args, original) => Number(args[1]) === 0x8DF0
      ? { rangeMin: 127, rangeMax: 127, precision: 23 } : original(...args));
    wrap('getSupportedExtensions', (_args, original) => {
      const list = original() as unknown;
      if (!Array.isArray(list)) return list;
      return list.includes('WEBGL_debug_renderer_info') ? list : [...list, 'WEBGL_debug_renderer_info'];
    });
    wrap('getExtension', (args, original) => {
      const extension = original(...args) as Record<string, unknown> | null;
      if (String(args[0]) !== 'WEBGL_debug_renderer_info' || !extension) return extension;
      return new Proxy(extension, { get(target, property) {
        if (property === 'UNMASKED_VENDOR_WEBGL') return 0x9245;
        if (property === 'UNMASKED_RENDERER_WEBGL') return 0x9246;
        return Reflect.get(target, property);
      } });
    });
    if (config.webgl === 'noise') wrap('readPixels', (args, original) => {
      const result = original(...args);
      for (let i = args.length - 1; i >= 0; i--) {
        const candidate = args[i];
        if (!candidate || !ArrayBuffer.isView(candidate) || candidate instanceof DataView) continue;
        const view = candidate as unknown as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        for (let j = 0; j < bytes.length; j += 37) bytes[j] ^= hash(j ^ gpuSalt, bytes.length) & 1;
        break;
      }
      return result;
    });
    return context;
  };
  const replace = (prototype: object | undefined, name: string, implementation: (args: unknown[], original: (...a: unknown[]) => unknown) => unknown): void => {
    if (!prototype) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const original = descriptor.value as (...a: unknown[]) => unknown;
    if ((original as unknown as Record<PropertyKey, unknown>)[WRAPPED] === true) return;
    const wrapped = new Proxy(original, { apply: (_target, self, args) => implementation(args as unknown[], (...next) => Reflect.apply(original, self, next)) });
    try {
      Object.defineProperty(wrapped, WRAPPED, { value: true, configurable: false });
      Object.defineProperty(prototype, name, { ...descriptor, value: wrapped });
    } catch { /* protected prototype */ }
  };
  const offscreen = (G.OffscreenCanvas as { prototype?: object } | undefined)?.prototype;
  if (config.webgl === 'off') {
    replace(offscreen, 'getContext', (args, original) => ['webgl', 'webgl2', 'experimental-webgl', 'experimental-webgl2'].includes(String(args[0] ?? '').toLowerCase()) ? null : original(...args));
  } else if (offscreen) {
    replace(offscreen, 'getContext', (args, original) => {
      const context = original(...args);
      return ['webgl', 'webgl2', 'experimental-webgl', 'experimental-webgl2'].includes(String(args[0] ?? '').toLowerCase()) ? wrapContext(context) : context;
    });
  } else {
    wrapContext((G.WebGLRenderingContext as { prototype?: object } | undefined)?.prototype);
    wrapContext((G.WebGL2RenderingContext as { prototype?: object } | undefined)?.prototype);
  }
  void navigatorValue;
}
