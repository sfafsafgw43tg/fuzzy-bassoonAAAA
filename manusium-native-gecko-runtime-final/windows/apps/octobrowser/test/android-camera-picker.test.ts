import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..', '..', '..');
const picker = fs.readFileSync(path.join(root, 'apps/octobrowser/src/renderer/launcher-android-cameras.ts'), 'utf8');

describe('the camera picker follows the cameras by itself', () => {
  it('rescans when a camera is plugged in or removed, once the changes settle', () => {
    expect(picker).toContain("navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);");
    expect(picker).toContain('deviceSettle = setTimeout(() => void scan(false), 700);');
  });

  it('does nothing while the picker is not on screen', () => {
    expect(picker).toContain('if (!element.isConnected) return;');
  });

  it('keeps the manual Refresh button', () => {
    expect(picker).toContain('refreshButton.onclick = () => void scan(true);');
  });

  it('labels virtual endpoints and confirms a selected source only after a live frame check', () => {
    expect(picker).toContain("camera.virtual ? `${t('android.camera.virtualDevice')} · ${label}` : label");
    expect(picker).toContain("['emulated', t('android.camera.emulated')]");
    expect(picker).toContain("if (id === 'emulated')");
    expect(picker).toContain("t('android.camera.selectedWorking', { cameras: selected.join(', ') })");
    expect(picker).toContain('cameraTests.enabled && working().length');
  });

  it('keeps the startup lens selector limited to Android Studio modes while preserving the integrated quick actions', () => {
    expect(picker).toContain("['', t('android.camera.none')]");
    expect(picker).toContain("['emulated', t('android.camera.emulated')]");
    expect(picker).toContain("['webcam0', 'Webcam0']");
    expect(picker).not.toContain("['virtualcam', 'Live image · Unity Capture']");
    expect(picker).not.toContain("['image', t('android.camera.imageFile')]");
    expect(picker).not.toContain("['video', t('android.camera.videoFile')]");
    expect(picker).toContain("const photo = h('button'");
    expect(picker).toContain("const video = h('button'");
    expect(picker).toContain("selection.cameraProvider = 'unity-capture'");
  });

  it('connects live OBS and selected-image output through webcam0 when available', () => {
    expect(picker).toContain("listed.find(camera => camera.name === 'webcam0') ?? listed.find(camera => camera.virtual)");
    expect(picker).toContain("text: 'Connect webcam0 to back camera'");
    expect(picker).toContain("setDevice('back', 'webcam0')");
    expect(picker).not.toContain("setDevice('front', 'webcam0'); setDevice('back', 'webcam0')");
  });

  it('labels the localhost stream as preview-only and keeps webcam0 as the emulator endpoint', () => {
    expect(picker).toContain('The emulator transport is the native webcam endpoint selected below.');
    expect(picker).toContain('Native virtual camera connection is not active.');
  });
});
