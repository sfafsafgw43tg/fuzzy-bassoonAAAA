import { describe, expect, it } from 'vitest';
import { customAndroidBuildGuide, validateCustomAndroidBuild } from '../src/main/android-custom-build';

describe('Custom Android Build capability', () => {
  it('accepts only documented targets and variants', () => {
    const result = validateCustomAndroidBuild({ name: 'Pixel test', target: 'sdk_phone_x86_64', variant: 'userdebug', notes: 'camera test' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.release).toBe('android-latest-release');
  });

  it('rejects unsupported combinations instead of silently falling back', () => {
    expect(validateCustomAndroidBuild({ name: 'bad', target: 'unknown', variant: 'eng' }).ok).toBe(false);
    expect(validateCustomAndroidBuild({ name: 'bad', target: 'sdk_phone_x86_64', variant: 'debug' }).ok).toBe(false);
    expect(validateCustomAndroidBuild({ name: 'bad!', target: 'sdk_phone_x86_64', variant: 'user' }).ok).toBe(false);
  });

  it('produces Level 2 guidance, not a fake build job or artifact', () => {
    const result = validateCustomAndroidBuild({ name: 'AOSP plan', target: 'sdk_phone_x86_64', variant: 'userdebug' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const guide = customAndroidBuildGuide(result.value);
      expect(guide.level).toBe(2);
      expect(guide.commands).toContain('m emu_img_zip');
      expect(guide).not.toHaveProperty('jobId');
      expect(guide).not.toHaveProperty('artifact');
    }
  });
});
