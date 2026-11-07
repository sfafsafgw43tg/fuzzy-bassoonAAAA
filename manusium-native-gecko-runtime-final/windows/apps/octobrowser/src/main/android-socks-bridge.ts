/**
 * A loopback-only HTTP CONNECT adapter for Android Emulator.
 *
 * Android Emulator accepts an HTTP proxy but not SOCKS5. This bridge gives it
 * a short-lived local HTTP endpoint and opens every destination through the
 * user's SOCKS5 proxy. Credentials stay in the main process and never appear
 * in the emulator command line.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SocksClient } from 'socks';

export interface Socks5Target { host: string; port: number; username?: string; password?: string }
export interface SocksHttpBridge { url: string; close: () => void }

const DISCONNECT_ERRORS = new Set(['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE']);

function isDisconnectError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && DISCONNECT_ERRORS.has(String((error as { code?: unknown }).code)));
}

function closeResponse(response: http.ServerResponse): void {
  if (!response.destroyed) response.destroy();
}

function endProxyError(response: http.ServerResponse, error: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  if (!response.headersSent) response.writeHead(isDisconnectError(error) ? 499 : 502);
  response.end(isDisconnectError(error) ? undefined : error instanceof Error ? error.message : String(error));
}

function destination(raw: string, fallbackPort: number): { host: string; port: number } {
  const value = raw.trim();
  const ipv6 = /^\[([^\]]+)](?::(\d+))?$/.exec(value);
  if (ipv6) return { host: ipv6[1], port: Number(ipv6[2] || fallbackPort) };
  const split = value.lastIndexOf(':');
  if (split > 0 && /^\d+$/.test(value.slice(split + 1))) return { host: value.slice(0, split), port: Number(value.slice(split + 1)) };
  return { host: value, port: fallbackPort };
}

async function through(proxy: Socks5Target, host: string, port: number) {
  const result = await SocksClient.createConnection({
    command: 'connect', timeout: 30_000,
    proxy: { host: proxy.host, port: proxy.port, type: 5, userId: proxy.username || undefined, password: proxy.password || undefined },
    destination: { host, port },
  });
  return result.socket;
}

/** Start on 127.0.0.1 with an OS-selected port; callers close it with the AVD. */
export async function startSocksHttpBridge(proxy: Socks5Target): Promise<SocksHttpBridge> {
  const sockets = new Set<{ destroy: () => void }>();
  const server = http.createServer((request, response) => {
    request.on('error', (error) => { if (isDisconnectError(error)) closeResponse(response); });
    response.on('error', (error) => { if (isDisconnectError(error)) closeResponse(response); });
    void (async () => {
      const hostHeader = String(request.headers.host ?? '');
      const targetUrl = new URL(request.url?.startsWith('http://') ? request.url : `http://${hostHeader}${request.url || '/'}`);
      const port = Number(targetUrl.port || 80);
      const socket = await through(proxy, targetUrl.hostname, port);
      sockets.add(socket);
      const cleanup = () => sockets.delete(socket);
      socket.once('close', cleanup);
      socket.on('error', (error) => { if (isDisconnectError(error)) cleanup(); });
      const headers: http.OutgoingHttpHeaders = { ...request.headers, host: targetUrl.host };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      const outbound = http.request({
        method: request.method, path: `${targetUrl.pathname}${targetUrl.search}`,
        headers, createConnection: () => socket,
      }, (incoming) => {
        incoming.on('error', (error) => endProxyError(response, error));
        response.writeHead(incoming.statusCode ?? 502, incoming.statusMessage, incoming.headers);
        incoming.pipe(response);
      });
      outbound.on('error', (error) => endProxyError(response, error));
      request.on('aborted', () => { outbound.destroy(); cleanup(); });
      response.on('close', () => { if (!response.writableEnded) outbound.destroy(); cleanup(); });
      request.pipe(outbound);
    })().catch((error) => endProxyError(response, error));
  });
  server.on('connect', (request, client, head) => {
    void (async () => {
      const target = destination(request.url || '', 443);
      const remote = await through(proxy, target.host, target.port);
      sockets.add(client); sockets.add(remote);
      const clean = () => {
        sockets.delete(client); sockets.delete(remote);
        if (!client.destroyed) client.destroy();
        if (!remote.destroyed) remote.destroy();
      };
      client.once('close', clean); remote.once('close', clean);
      client.on('error', (error) => { if (isDisconnectError(error)) clean(); });
      remote.on('error', (error) => { if (isDisconnectError(error)) clean(); });
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n', (error) => { if (error) clean(); });
      if (head.length && !remote.destroyed) remote.write(head, (error) => { if (error) clean(); });
      client.pipe(remote); remote.pipe(client);
    })().catch((error) => {
      if (!client.destroyed) {
        if (isDisconnectError(error)) client.destroy();
        else client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      }
    });
  });
  server.on('clientError', (error, socket) => { if (!socket.destroyed) socket.destroy(); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => { for (const socket of sockets) socket.destroy(); sockets.clear(); server.close(); },
  };
}
