import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertTransition, type ArtifactRecord, type BuildEvent, type BuildJob, type BuildPlan, type BuildStoreData, type WorkerRecord } from './core';

export function defaultStorePath(): string { return process.env.OCTO_BUILD_STORE_PATH || path.join(os.homedir(), '.octobrowser', 'android-build-platform.json'); }
const empty = (): BuildStoreData => ({ schemaVersion: 1, plans: [], jobs: [], events: [], workers: [], artifacts: [] });

export class DurableBuildStore {
  private data: BuildStoreData;
  constructor(private readonly filename = defaultStorePath()) { this.data = this.read(); }
  private read(): BuildStoreData {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filename, 'utf8').replace(/^\uFEFF/, '')) as Partial<BuildStoreData>;
      return { ...empty(), ...parsed, schemaVersion: 1, plans: Array.isArray(parsed.plans) ? parsed.plans : [], jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [], events: Array.isArray(parsed.events) ? parsed.events : [], workers: Array.isArray(parsed.workers) ? parsed.workers : [], artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [] };
    } catch { return empty(); }
  }
  private write(): void {
    const dir = path.dirname(this.filename); fs.mkdirSync(dir, { recursive: true });
    const temp = `${this.filename}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, this.filename);
  }
  snapshot(): BuildStoreData { return structuredClone(this.data); }
  upsertPlan(plan: BuildPlan): void { this.data.plans = [plan, ...this.data.plans.filter((x) => x.id !== plan.id)]; this.write(); }
  getPlan(id: string, ownerId: string): BuildPlan | undefined { return this.data.plans.find((x) => x.id === id && x.ownerId === ownerId); }
  createJob(job: BuildJob): BuildJob {
    const existing = this.data.jobs.find((x) => x.ownerId === job.ownerId && x.idempotencyKey === job.idempotencyKey);
    if (existing) return existing;
    this.data.jobs.unshift(job); this.addEventInternal(job.id, 'QUEUED', 'Job queued'); this.write(); return job;
  }
  getJob(id: string, ownerId: string): BuildJob | undefined { return this.data.jobs.find((x) => x.id === id && x.ownerId === ownerId); }
  listJobs(ownerId: string): BuildJob[] { return this.data.jobs.filter((x) => x.ownerId === ownerId).map((x) => ({ ...x })); }
  transitionJob(id: string, to: BuildJob['status'], patch: Partial<BuildJob> = {}): BuildJob {
    const job = this.data.jobs.find((x) => x.id === id); if (!job) throw new Error('JOB_NOT_FOUND');
    assertTransition(job.status, to); Object.assign(job, patch, { status: to, updatedAt: new Date().toISOString() });
    this.addEventInternal(id, to, patch.safeErrorMessage || `Job state changed to ${to}`, patch.progress); this.write(); return { ...job };
  }
  retryJob(id: string, ownerId: string): BuildJob {
    const job = this.data.jobs.find((x) => x.id === id && x.ownerId === ownerId); if (!job) throw new Error('JOB_NOT_FOUND');
    if (job.status !== 'FAILED' && job.status !== 'ARTIFACT_VALIDATION_FAILED') throw new Error('INVALID_STATE');
    return this.transitionJob(id, 'QUEUED', { errorCode: undefined, safeErrorMessage: undefined, progress: undefined, queuedAt: new Date().toISOString(), finishedAt: undefined, startedAt: undefined, workerId: undefined });
  }
  addEvent(jobId: string, type: string, message: string, progress?: number): BuildEvent { const e = this.addEventInternal(jobId, type, message, progress); this.write(); return e; }
  private addEventInternal(jobId: string, type: string, message: string, progress?: number): BuildEvent { const sequence = this.data.events.filter((x) => x.jobId === jobId).length + 1; const event = { id: randomUUID(), jobId, sequence, type, timestamp: new Date().toISOString(), message: message.slice(0, 4000), ...(progress === undefined ? {} : { progress }) }; this.data.events.push(event); return event; }
  events(jobId: string): BuildEvent[] { return this.data.events.filter((x) => x.jobId === jobId).map((x) => ({ ...x })); }
  registerWorker(worker: WorkerRecord): WorkerRecord { this.data.workers = [worker, ...this.data.workers.filter((x) => x.id !== worker.id)]; this.write(); return { ...worker }; }
  heartbeat(id: string, status: WorkerRecord['status'], currentJobId?: string): void { const w = this.data.workers.find((x) => x.id === id); if (!w) throw new Error('WORKER_NOT_FOUND'); Object.assign(w, { status, currentJobId, lastHeartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); this.write(); }
  claimNext(workerId: string): BuildJob | undefined { const job = this.data.jobs.find((x) => x.status === 'QUEUED'); if (!job) return undefined; const now = new Date().toISOString(); assertTransition(job.status, 'RUNNING'); Object.assign(job, { status: 'RUNNING', workerId, startedAt: now, updatedAt: now }); this.addEventInternal(job.id, 'RUNNING', 'A registered worker started this job'); this.write(); return { ...job }; }
  addArtifact(artifact: ArtifactRecord): void { this.data.artifacts.push(artifact); this.write(); }
  artifacts(jobId: string): ArtifactRecord[] { return this.data.artifacts.filter((x) => x.jobId === jobId && x.validationStatus === 'VALIDATED').map((x) => ({ ...x })); }
}
