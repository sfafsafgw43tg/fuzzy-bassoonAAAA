import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type CustomAndroidBuildVariant = 'user' | 'userdebug' | 'eng';
export type CustomAndroidBuildTarget = 'aosp_cf_x86_64_only_phone-aosp_current-userdebug' | 'sdk_phone_x86_64';

export interface CustomAndroidBuildConfig {
  id: string;
  name: string;
  release: 'android-latest-release';
  architecture: 'x86_64';
  target: CustomAndroidBuildTarget;
  variant: CustomAndroidBuildVariant;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomAndroidBuildCatalogue { configs: CustomAndroidBuildConfig[] }

const MAX_CONFIGS = 30;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const NOTES_MAX = 2000;
const filePath = () => path.join(os.homedir(), '.octobrowser', 'custom-android-builds.json');

export function customAndroidBuildPath(): string { return filePath(); }

export function supportedCustomAndroidBuildTargets(): CustomAndroidBuildTarget[] {
  return ['aosp_cf_x86_64_only_phone-aosp_current-userdebug', 'sdk_phone_x86_64'];
}

export function readCustomAndroidBuilds(): CustomAndroidBuildCatalogue {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8').replace(/^\uFEFF/, '')) as { configs?: unknown };
    const configs = Array.isArray(raw.configs) ? raw.configs : [];
    return { configs: configs.map((item) => normalizeConfig(item)).filter((item): item is CustomAndroidBuildConfig => item !== null).slice(0, MAX_CONFIGS) };
  } catch { return { configs: [] }; }
}

function normalizeConfig(input: unknown): CustomAndroidBuildConfig | null {
  if (!input || typeof input !== 'object') return null;
  const item = input as Partial<CustomAndroidBuildConfig>;
  const name = String(item.name ?? '').trim();
  const target = String(item.target ?? '') as CustomAndroidBuildTarget;
  const variant = String(item.variant ?? '') as CustomAndroidBuildVariant;
  if (!NAME.test(name) || !supportedCustomAndroidBuildTargets().includes(target) || !['user', 'userdebug', 'eng'].includes(variant)) return null;
  return {
    id: String(item.id || cryptoId(name)), name, release: 'android-latest-release', architecture: 'x86_64', target, variant,
    notes: String(item.notes ?? '').slice(0, NOTES_MAX), createdAt: String(item.createdAt || new Date().toISOString()), updatedAt: String(item.updatedAt || new Date().toISOString()),
  };
}

function cryptoId(name: string): string {
  return `${Date.now().toString(36)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)}`;
}

export function validateCustomAndroidBuild(input: Partial<CustomAndroidBuildConfig>): { ok: true; value: CustomAndroidBuildConfig } | { ok: false; message: string } {
  const name = String(input.name ?? '').trim();
  if (!NAME.test(name)) return { ok: false, message: 'Use 1-64 letters, numbers, spaces, hyphens or underscores, starting with a letter or number.' };
  const target = String(input.target ?? '') as CustomAndroidBuildTarget;
  if (!supportedCustomAndroidBuildTargets().includes(target)) return { ok: false, message: 'That AOSP target is not supported by this version.' };
  const variant = String(input.variant ?? '') as CustomAndroidBuildVariant;
  if (!['user', 'userdebug', 'eng'].includes(variant)) return { ok: false, message: 'Choose user, userdebug, or eng.' };
  const now = new Date().toISOString();
  const current = readCustomAndroidBuilds().configs.find((item) => item.id === input.id);
  return { ok: true, value: { id: String(input.id || cryptoId(name)), name, release: 'android-latest-release', architecture: 'x86_64', target, variant, notes: String(input.notes ?? '').trim().slice(0, NOTES_MAX), createdAt: current?.createdAt || now, updatedAt: now } };
}

export function saveCustomAndroidBuild(input: Partial<CustomAndroidBuildConfig>): { ok: true; config: CustomAndroidBuildConfig } | { ok: false; message: string } {
  const validated = validateCustomAndroidBuild(input);
  if (!validated.ok) return validated;
  const current = readCustomAndroidBuilds().configs;
  const configs = [validated.value, ...current.filter((item) => item.id !== validated.value.id)].slice(0, MAX_CONFIGS);
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify({ configs }, null, 2) + '\n', { mode: 0o600 });
  return { ok: true, config: validated.value };
}

export function deleteCustomAndroidBuild(id: string): boolean {
  const current = readCustomAndroidBuilds().configs;
  const configs = current.filter((item) => item.id !== String(id ?? ''));
  if (configs.length === current.length) return false;
  fs.writeFileSync(filePath(), JSON.stringify({ configs }, null, 2) + '\n', { mode: 0o600 });
  return true;
}

export function customAndroidBuildGuide(config: CustomAndroidBuildConfig): { level: 2; commands: string[]; sources: string[] } {
  const lunch = config.target === 'sdk_phone_x86_64' ? 'sdk_phone_x86_64' : `${config.target.replace(/-aosp_current-userdebug$/, '')}-aosp_current-${config.variant}`;
  return {
    level: 2,
    commands: [
      'repo init -u https://android.googlesource.com/platform/manifest -b android-latest-release',
      'repo sync -j24',
      'source build/envsetup.sh',
      `lunch ${lunch}`,
      'm -j32',
      'm emu_img_zip',
    ],
    sources: ['https://source.android.com/docs/setup/start', 'https://source.android.com/docs/setup/build/building', 'https://source.android.com/docs/setup/create/avd'],
  };
}
