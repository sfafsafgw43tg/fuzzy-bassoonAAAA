import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { URL } from 'node:url';

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const FRAME_INTERVAL_MS = 100;

type WebSocketClient = { socket: Duplex; timer: NodeJS.Timeout };

export interface LiveCameraStreamStatus {
  running: boolean;
  port: number;
  mjpegUrl: string;
  websocketUrl: string;
  frameBytes: number;
  frameVersion: number;
  contentType: 'image/jpeg' | 'image/png' | '';
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
  response.end(body);
}

export class LiveCameraStreamServer {
  private server: Server | null = null;
  private frame = Buffer.alloc(0);
  private frameVersion = 0;
  private contentType: 'image/jpeg' | 'image/png' | '' = '';
  private clients = new Set<WebSocketClient>();
  private port = 0;

  async start(): Promise<LiveCameraStreamStatus> {
    if (this.server) return this.status();
    this.server = createServer((request, response) => { void this.route(request, response); });
    this.server.on('upgrade', (request, socket, head) => this.upgradeWebSocket(request, socket, head));
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        const address = server.address();
        this.port = typeof address === 'object' && address ? address.port : 0;
        resolve();
      });
    });
    return this.status();
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      clearInterval(client.timer);
      client.socket.destroy();
    }
    this.clients.clear();
    const server = this.server;
    this.server = null;
    this.port = 0;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  setImage(frame: Buffer, contentType: 'image/jpeg' | 'image/png' = 'image/jpeg'): LiveCameraStreamStatus {
    if (frame.length === 0 || frame.length > MAX_FRAME_BYTES) throw new Error('Camera frame must be a non-empty JPEG or PNG smaller than 8 MB');
    const jpeg = frame[0] === 0xff && frame[1] === 0xd8 && frame[frame.length - 2] === 0xff && frame[frame.length - 1] === 0xd9;
    const png = frame[0] === 0x89 && frame[1] === 0x50 && frame[2] === 0x4e && frame[3] === 0x47;
    if ((contentType === 'image/jpeg' && !jpeg) || (contentType === 'image/png' && !png)) {
      throw new Error('Camera stream accepts a valid JPEG or PNG frame');
    }
    this.frame = Buffer.from(frame);
    this.contentType = contentType;
    this.frameVersion += 1;
    return this.status();
  }

  status(): LiveCameraStreamStatus {
    const base = `http://127.0.0.1:${this.port}`;
    return { running: Boolean(this.server), port: this.port, mjpegUrl: `${base}/mjpeg`, websocketUrl: `ws://127.0.0.1:${this.port}/ws`, frameBytes: this.frame.length, frameVersion: this.frameVersion, contentType: this.contentType };
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${this.port}`);
    if (request.method === 'GET' && url.pathname === '/health') return writeJson(response, 200, this.status());
    if (request.method === 'GET' && url.pathname === '/mjpeg') return this.mjpeg(response);
    if (request.method === 'POST' && url.pathname === '/frame') return this.acceptFrame(request, response);
    if (request.method === 'GET' && url.pathname === '/ws') return writeJson(response, 426, { error: 'WebSocket upgrade required' });
    writeJson(response, 404, { error: 'Not found' });
  }

  private mjpeg(response: ServerResponse): void {
    response.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=octo-frame', 'cache-control': 'no-store', connection: 'close' });
    const send = () => {
      if (!this.frame.length || response.destroyed) return;
      response.write(`--octo-frame\r\nContent-Type: ${this.contentType}\r\nContent-Length: ${this.frame.length}\r\nX-Octo-Frame: ${this.frameVersion}\r\n\r\n`);
      response.write(this.frame);
      response.write('\r\n');
    };
    send();
    const timer = setInterval(send, FRAME_INTERVAL_MS);
    response.once('close', () => clearInterval(timer));
  }

  private async acceptFrame(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const part = Buffer.from(chunk as Buffer);
      size += part.length;
      if (size > MAX_FRAME_BYTES) { writeJson(response, 413, { error: 'Frame is too large' }); request.destroy(); return; }
      chunks.push(part);
    }
    const frame = Buffer.concat(chunks);
    const contentType = String(request.headers['content-type'] ?? '').split(';', 1)[0] === 'image/png' ? 'image/png' : 'image/jpeg';
    try { writeJson(response, 200, this.setImage(frame, contentType)); }
    catch (error) { writeJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid frame' }); }
  }

  private upgradeWebSocket(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const key = request.headers['sec-websocket-key'];
    if (head.length) socket.unshift(head);
    if (typeof key !== 'string' || request.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const client: WebSocketClient = { socket, timer: setInterval(() => this.sendWebSocketFrame(client), FRAME_INTERVAL_MS) };
    this.clients.add(client);
    socket.on('close', () => { clearInterval(client.timer); this.clients.delete(client); });
    socket.on('error', () => { clearInterval(client.timer); this.clients.delete(client); socket.destroy(); });
    this.sendWebSocketFrame(client);
  }

  private sendWebSocketFrame(client: WebSocketClient): void {
    if (!this.frame.length || client.socket.destroyed) return;
    const payload = this.frame;
    const length = payload.length;
    const header = length < 126 ? Buffer.from([0x82, length]) : length < 65536 ? Buffer.from([0x82, 126, length >> 8, length & 0xff]) : Buffer.from([0x82, 127, 0, 0, 0, 0, length >>> 24, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff]);
    client.socket.write(Buffer.concat([header, payload]));
  }
}
