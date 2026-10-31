import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { customAndroidBuildGuide, exportCustomAndroidBuilds, validateCustomAndroidBuild } from '../src/main/android-custom-build';

describe('Custom Android Build capability', () => {
  it('accepts only documented targets and variants', () => {
    const result = validateCustomAndroidBuild({ name: 'Pixel test', target: 'sdk_phone_x86_64', variant: 'userdebug', notes: 'camera test' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.release).toBe('android-latest-release');
  });

  it('rejects unsupported combinations instead of silently falling back', () => {
    expect(validateCustomAndroidBuild({ name: 'bad', target: 'unknown' as never, variant: 'eng' }).ok).toBe(false);
    expect(validateCustomAndroidBuild({ name: 'bad', target: 'sdk_phone_x86_64', variant: 'debug' as never }).ok).toBe(false);
    expect(validateCustomAndroidBuild({ name: 'bad!', target: 'sdk_phone_x86_64', variant: 'user' }).ok).toBe(false);
    expect(validateCustomAndroidBuild({ name: '../../secret', target: 'sdk_phone_x86_64', variant: 'user' }).ok).toBe(false);
    expect(validateCustomAndroidBuild({ name: 'C:\\Windows\\file', target: 'sdk_phone_x86_64', variant: 'user' }).ok).toBe(false);
    expect(validateCustomAndroidBuild({ name: 'bad\u0000name', target: 'sdk_phone_x86_64', variant: 'user' }).ok).toBe(false);
    expect(validateCustomAndroidBuild({ name: 'Cuttlefish', target: 'aosp_cf_x86_64_only_phone-aosp_current-userdebug', variant: 'eng' }).ok).toBe(false);
  });

  it('produces Level 2 guidance, not a fake build job or artifact', () => {
    const result = validateCustomAndroidBuild({ name: 'AOSP plan', target: 'sdk_phone_x86_64', variant: 'userdebug' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const guide = customAndroidBuildGuide(result.value);
      expect(guide.level).toBe(2);
      expect(guide.commands).toContain('m emu_img_zip');
      expect(guide.commands.join('\n')).toContain('lunch sdk_phone_x86_64-userdebug');
      expect(guide.commands.join('\n').split('\n')).toHaveLength(6);
      expect(guide).not.toHaveProperty('jobId');
      expect(guide).not.toHaveProperty('artifact');
    }
  });

  it('keeps the fixed Cuttlefish target and never inserts notes into commands', () => {
    const result = validateCustomAndroidBuild({ name: 'Cuttlefish', target: 'aosp_cf_x86_64_only_phone-aosp_current-userdebug', variant: 'userdebug', notes: '$(do-not-run)' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const commands = customAndroidBuildGuide(result.value).commands.join('\n');
      expect(commands).toContain('lunch aosp_cf_x86_64_only_phone-aosp_current-userdebug');
      expect(commands).not.toContain('do-not-run');
      expect(commands).not.toContain('$("');
    }
  });

  it('exports a versioned catalogue in JSON and YAML without fake build state', () => {
    const json = JSON.parse(exportCustomAndroidBuilds('json')) as { schema: number; capabilityLevel: number; configs: unknown[] };
    expect(json.schema).toBe(1);
    expect(json.capabilityLevel).toBe(2);
    expect(json.configs).toEqual([]);
    const yaml = YAML.parse(exportCustomAndroidBuilds('yaml')) as typeof json;
    expect(yaml.schema).toBe(1);
    expect(yaml.capabilityLevel).toBe(2);
    expect(yaml).not.toHaveProperty('jobId');
    expect(yaml).not.toHaveProperty('artifact');
  });

  it('accepts maximum valid name and notes lengths without losing notes', () => {
    const name = `A${'x'.repeat(63)}`;
    const notes = 'ą'.repeat(2000);
    const result = validateCustomAndroidBuild({ name, target: 'sdk_phone_x86_64', variant: 'user', notes });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.notes).toBe(notes);
  });
});
