import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import * as path from 'node:path';
import { DurableBuildStore } from './store';
import { validateBuildRequest, type BuildJob } from './core';
import { streamArtifact } from './artifacts';

const PORT = Number(process.env.OCTO_BUILD_API_PORT || 8787); const artifactRoot = process.env.OCTO_BUILD_ARTIFACT_ROOT || path.join(process.cwd(), '.android-build-artifacts');
const requestWindows = new Map<string, { started: number; count: number }>(); const MAX_REQUESTS_PER_MINUTE = 60; const MAX_QUEUED_PER_OWNER = 2;
function json(res: ServerResponse, status: number, body: unknown): void { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function ownerForToken(token: string): string { return `user-${createHash('sha256').update(token).digest('hex').slice(0, 24)}`; }
function configuredTokens(): string[] { return (process.env.OCTO_BUILD_API_TOKENS || '').split(',').map((x) => x.trim()).filter(Boolean); }
function auth(req: IncomingMessage): { ownerId: string } | undefined { const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]; if (!token || !configuredTokens().includes(token)) return undefined; const now = Date.now(); const entry = requestWindows.get(token); if (!entry || now - entry.started >= 60000) requestWindows.set(token, { started: now, count: 1 }); else if (++entry.count > MAX_REQUESTS_PER_MINUTE) return undefined; return { ownerId: ownerForToken(token) }; }
function workerAuth(req: IncomingMessage): boolean { const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]; return Boolean(token && process.env.OCTO_BUILD_WORKER_TOKEN && token === process.env.OCTO_BUILD_WORKER_TOKEN); }
async function body(req: IncomingMessage): Promise<unknown> { let size = 0; const chunks: Buffer[] = []; for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 128 * 1024) throw new Error('REQUEST_TOO_LARGE'); chunks.push(Buffer.from(chunk)); } return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
function jobPublic(job: BuildJob): Omit<BuildJob, 'ownerId' | 'idempotencyKey' | 'workerId'> { const { ownerId: _o, idempotencyKey: _i, workerId: _w, ...safe } = job; return safe; }
export function createBuildApi(store = new DurableBuildStore()) {
  return createServer(async (req, res) => {
    try {
      if (req.url === '/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'android-build-api' });
      if (req.url === '/ready' && req.method === 'GET') return json(res, configuredTokens().length ? 200 : 503, { ready: configuredTokens().length > 0 });
      if (req.url?.startsWith('/api/v1/workers') && req.method === 'POST') { if (!workerAuth(req)) return json(res, 401, { error: 'UNAUTHORIZED' }); const input = await body(req) as Record<string, unknown>; const now = new Date().toISOString(); const worker = store.registerWorker({ id: typeof input.id === 'string' ? input.id : randomUUID(), name: typeof input.name === 'string' ? input.name.slice(0, 80) : 'worker', status: input.available === true ? 'AVAILABLE' : 'UNAVAILABLE', platform: typeof input.platform === 'string' ? input.platform : 'unknown', architecture: typeof input.architecture === 'string' ? input.architecture : 'unknown', capabilities: Array.isArray(input.capabilities) ? input.capabilities.filter((x): x is string => typeof x === 'string').slice(0, 32) : [], lastHeartbeatAt: now, registeredAt: now, updatedAt: now }); return json(res, 200, { worker: { id: worker.id, status: worker.status, capabilities: worker.capabilities } }); }
      const user = auth(req); if (!user) return json(res, 401, { error: 'UNAUTHORIZED' });
      if (req.url === '/api/v1/android-builds' && req.method === 'GET') return json(res, 200, { jobs: store.listJobs(user.ownerId).map(jobPublic) });
      if (req.url === '/api/v1/android-builds' && req.method === 'POST') {
        const input = await body(req) as Record<string, unknown>; const validated = validateBuildRequest(input); if (validated.ok === false) return json(res, 422, { error: validated.code, message: validated.message });
        const idempotencyKey = req.headers['idempotency-key']; if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) return json(res, 400, { error: 'IDEMPOTENCY_KEY_REQUIRED' });
        if (store.listJobs(user.ownerId).filter((job) => job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'CANCELING').length >= MAX_QUEUED_PER_OWNER) return json(res, 429, { error: 'BUILD_QUOTA_EXCEEDED', message: 'The owner quota for active build jobs has been reached.' });
        const planId = typeof input.planId === 'string' ? input.planId : randomUUID(); const now = new Date().toISOString(); const job: BuildJob = { id: randomUUID(), ownerId: user.ownerId, buildPlanId: planId, idempotencyKey, status: 'QUEUED', ...validated.value, requestedAt: now, queuedAt: now, createdAt: now, updatedAt: now }; const created = store.createJob(job); return json(res, created.id === job.id ? 201 : 200, { job: jobPublic(created) });
      }
      const match = req.url?.match(/^\/api\/v1\/android-builds\/([^/]+)(?:\/(cancel|retry|events|logs|artifacts))?(?:\/([^/]+))?$/); if (!match) return json(res, 404, { error: 'NOT_FOUND' }); const [, id, action, artifactId] = match; const job = store.getJob(id, user.ownerId); if (!job) return json(res, 404, { error: 'NOT_FOUND' });
      if (!action && req.method === 'GET') return json(res, 200, { job: jobPublic(job), events: store.events(job.id), artifacts: store.artifacts(job.id).map(({ storageKey: _key, ...safe }) => safe) });
      if (action === 'cancel' && req.method === 'POST') { if (job.status === 'QUEUED') return json(res, 200, { job: jobPublic(store.transitionJob(id, 'CANCELED', { canceledAt: new Date().toISOString() })) }); if (job.status === 'RUNNING') return json(res, 200, { job: jobPublic(store.transitionJob(id, 'CANCELING')) }); return json(res, 409, { error: 'INVALID_STATE', message: 'This job cannot be canceled in its current state.' }); }
      if (action === 'retry' && req.method === 'POST') { try { return json(res, 200, { job: jobPublic(store.retryJob(id, user.ownerId)) }); } catch { return json(res, 409, { error: 'INVALID_STATE', message: 'Only failed jobs can be retried.' }); } }
      if (action === 'events' && req.method === 'GET') return json(res, 200, { events: store.events(job.id) });
      if (action === 'artifacts' && req.method === 'GET' && !artifactId) return json(res, 200, { artifacts: store.artifacts(job.id).map(({ storageKey: _key, ...safe }) => safe) });
      if (action === 'artifacts' && req.method === 'GET' && artifactId) { const artifact = store.artifacts(job.id).find((x) => x.id === artifactId); if (!artifact || new Date(artifact.expiresAt).getTime() <= Date.now()) return json(res, 404, { error: 'ARTIFACT_UNAVAILABLE' }); const stream = await streamArtifact(artifactRoot, artifact); res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${artifact.filename}"`, 'content-length': String(artifact.size), 'cache-control': 'no-store' }); stream.pipe(res); return; }
      return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    } catch (error) { return json(res, 400, { error: error instanceof Error && error.message === 'REQUEST_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST' }); }
  });
}
if (require.main === module) createBuildApi().listen(PORT, '127.0.0.1', () => console.log(`Android build API listening on 127.0.0.1:${PORT}`));
