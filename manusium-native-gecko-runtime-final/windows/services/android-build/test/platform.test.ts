import { afterEach, describe, expect, it } from 'vitest';
import { canTransition, validateBuildRequest } from '../src/core';
import { createBuildApi } from '../src/api';
import { DurableBuildStore } from '../src/store';
import { checkWorkerCapabilities } from '../src/worker';
import { controlledDockerCommand, controlledWslCommand } from '../src/windows-host';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const oldTokens = process.env.OCTO_BUILD_API_TOKENS;
afterEach(() => { if (oldTokens === undefined) delete process.env.OCTO_BUILD_API_TOKENS; else process.env.OCTO_BUILD_API_TOKENS = oldTokens; });

describe('Android build platform', () => {
  it('accepts only validated release, architecture, target, and variant values', () => {
    expect(validateBuildRequest({ release: 'android-latest-release', architecture: 'x86_64', target: 'sdk_phone_x86_64', variant: 'userdebug', sourceRevision: 'android-latest-release' }).ok).toBe(true);
    expect(validateBuildRequest({ release: 'main', architecture: 'x86_64', target: 'sdk_phone_x86_64', variant: 'userdebug', sourceRevision: 'android-latest-release' }).ok).toBe(false);
    expect(validateBuildRequest({ release: 'android-latest-release', architecture: 'x86_64', target: 'aosp_cf_x86_64_only_phone-aosp_current-userdebug', variant: 'eng', sourceRevision: 'android-latest-release' }).ok).toBe(false);
  });
  it('rejects invalid state transitions and permits retry only from real failures', () => {
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'SUCCEEDED')).toBe(true);
    expect(canTransition('SUCCEEDED', 'RUNNING')).toBe(false);
    expect(canTransition('FAILED', 'QUEUED')).toBe(true);
  });
  it('uses durable persistence and idempotency for duplicate submissions', () => {
    const filename = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'octo-build-test-')), 'store.json'); const store = new DurableBuildStore(filename); const now = new Date().toISOString();
    const job = { id: 'job-one', ownerId: 'user-one', buildPlanId: 'plan-one', idempotencyKey: 'idempotency-1', status: 'QUEUED' as const, release: 'android-latest-release' as const, architecture: 'x86_64' as const, target: 'sdk_phone_x86_64' as const, variant: 'userdebug' as const, sourceRevision: 'android-latest-release', requestedAt: now, queuedAt: now, createdAt: now, updatedAt: now };
    expect(store.createJob(job).id).toBe('job-one'); expect(store.createJob({ ...job, id: 'job-two' }).id).toBe('job-one'); expect(new DurableBuildStore(filename).listJobs('user-one')).toHaveLength(1);
  });
  it('exposes authenticated durable API behavior without fake state', async () => {
    process.env.OCTO_BUILD_API_TOKENS = 'local-user-token'; const filename = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'octo-api-test-')), 'store.json'); const server = createBuildApi(new DurableBuildStore(filename)); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve())); const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address'); const base = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: 'Bearer local-user-token', 'content-type': 'application/json', 'idempotency-key': 'api-idempotency-1' };
    const request = { planId: 'plan-one', release: 'android-latest-release', architecture: 'x86_64', target: 'sdk_phone_x86_64', variant: 'userdebug', sourceRevision: 'android-latest-release' };
    const first = await fetch(`${base}/api/v1/android-builds`, { method: 'POST', headers, body: JSON.stringify(request) }); const second = await fetch(`${base}/api/v1/android-builds`, { method: 'POST', headers, body: JSON.stringify(request) }); const firstBody = await first.json() as { job: { id: string; status: string } }; const secondBody = await second.json() as { job: { id: string; status: string } };
    expect(first.status).toBe(201); expect(second.status).toBe(200); expect(secondBody.job.id).toBe(firstBody.job.id); expect(firstBody.job.status).toBe('QUEUED'); await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('reports the actual host capability state instead of claiming worker readiness', async () => { const report = await checkWorkerCapabilities(process.cwd()); if (process.platform !== 'linux') expect(report.available).toBe(false); expect(report.checkedAt).toBeTruthy(); });
  it('does not permit arbitrary WSL or Docker command construction', () => {
    expect(controlledWslCommand('Ubuntu-24.04', process.platform === 'win32' ? 'C:\\octo\\build' : '/tmp/octo-build').args).toContain('--work-root');
    expect(controlledDockerCommand('ghcr.io/octo/aosp-worker:1').args).toEqual(['run', '--rm', '--init', '--read-only', '--network', 'none', 'ghcr.io/octo/aosp-worker:1']);
    expect(() => controlledWslCommand('Ubuntu; rm -rf /', 'C:\\octo\\build')).toThrow();
    expect(() => controlledDockerCommand('latest && whoami')).toThrow();
  });
});
