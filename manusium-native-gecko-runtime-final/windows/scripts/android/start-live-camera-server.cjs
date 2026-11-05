const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const candidates = [
  process.env.OCTO_CAMERA_FRAME,
  path.join(root, '.work', 'camera-test', 'chosen-photo-test.jpg'),
  path.join(root, 'windows', '.work', 'camera-test', 'chosen-photo-test.jpg'),
].filter(Boolean);
const framePath = candidates.find((file) => fs.existsSync(file));
if (!framePath) throw new Error('No JPEG frame found. Set OCTO_CAMERA_FRAME to a valid JPEG.');
let frame = fs.readFileSync(framePath);
if (frame[0] !== 0xff || frame[1] !== 0xd8) throw new Error(`Not a JPEG: ${framePath}`);
const port = Number(process.env.OCTO_CAMERA_PORT || 8765);
let version = 1;
let sourceStamp = `${fs.statSync(framePath).size}:${fs.statSync(framePath).mtimeMs}`;
function refreshFrame() {
  try {
    const stat = fs.statSync(framePath);
    const nextStamp = `${stat.size}:${stat.mtimeMs}`;
    if (nextStamp === sourceStamp) return;
    const next = fs.readFileSync(framePath);
    if (next[0] !== 0xff || next[1] !== 0xd8) return;
    frame = next;
    sourceStamp = nextStamp;
    version += 1;
    console.log(JSON.stringify({ event: 'frame-changed', framePath, frameBytes: frame.length, frameVersion: version }));
  } catch (error) {
    console.error(`Could not refresh live frame: ${error.message}`);
  }
}
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url?.startsWith('/health')) {
    refreshFrame();
    const body = JSON.stringify({ running: true, port, mjpegUrl: `http://127.0.0.1:${port}/mjpeg`, websocketUrl: '', frameBytes: frame.length, frameVersion: version, contentType: 'image/jpeg', framePath });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }
  if (req.method === 'GET' && req.url?.startsWith('/mjpeg')) {
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=octo-frame', Connection: 'close' });
    const send = () => {
      if (res.destroyed) return;
      refreshFrame();
      res.write(`--octo-frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\nX-Octo-Frame: ${version}\r\n\r\n`);
      res.write(frame);
      res.write('\r\n');
    };
    send();
    const timer = setInterval(send, 100);
    res.on('close', () => clearInterval(timer));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ running: true, port, framePath, frameBytes: frame.length })));
