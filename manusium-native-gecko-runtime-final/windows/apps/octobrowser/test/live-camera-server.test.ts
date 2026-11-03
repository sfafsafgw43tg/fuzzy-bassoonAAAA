import { describe, expect, it } from 'vitest';
import { LiveCameraStreamServer } from '../src/main/live-camera-server';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe('LiveCameraStreamServer', () => {
  it('binds only to localhost and reports a running stream', async () => {
    const server = new LiveCameraStreamServer();
    try {
      const status = await server.start();
      expect(status.running).toBe(true);
      expect(status.mjpegUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mjpeg$/);
      expect(status.websocketUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/ws$/);
      expect(status.contentType).toBe('');
    } finally { await server.stop(); }
  });

  it('publishes a selected JPEG repeatedly through MJPEG', async () => {
    const server = new LiveCameraStreamServer();
    try {
      const status = await server.start();
      server.setImage(jpeg, 'image/jpeg');
      const response = await fetch(status.mjpegUrl, { signal: AbortSignal.timeout(1000) });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('multipart/x-mixed-replace');
      const reader = response.body!.getReader();
      const first = await reader.read();
      const text = Buffer.from(first.value!).toString('latin1');
      expect(text).toContain('Content-Type: image/jpeg');
      expect(text).toContain('X-Octo-Frame: 1');
      await reader.cancel();
    } finally { await server.stop(); }
  });

  it('rejects invalid frames', async () => {
    const server = new LiveCameraStreamServer();
    await server.start();
    expect(() => server.setImage(Buffer.from('not an image'), 'image/jpeg')).toThrow(/valid JPEG or PNG/);
    await server.stop();
  });
});
