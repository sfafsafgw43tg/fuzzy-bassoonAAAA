import * as path from 'node:path';
import { DurableBuildStore } from './store';
import { checkWorkerCapabilities, executeBuildJob, workerRecord } from './worker';

const store = new DurableBuildStore();
const root = process.env.OCTO_BUILD_WORK_ROOT || path.join(process.cwd(), '.android-build-work');
const artifacts = process.env.OCTO_BUILD_ARTIFACT_ROOT || path.join(process.cwd(), '.android-build-artifacts');
const workerId = process.env.OCTO_BUILD_WORKER_ID || `local-${process.pid}`;
let stopping = false;
process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
async function main(): Promise<void> {
  const report = await checkWorkerCapabilities(root); const registered = workerRecord(report); registered.id = workerId; store.registerWorker(registered);
  if (!report.available) { store.addEvent(`worker:${workerId}`, 'WORKER_UNAVAILABLE', `Worker unavailable: ${report.missing.join(', ')}`); console.error(JSON.stringify(report)); return; }
  console.log(JSON.stringify({ worker: registered.id, status: registered.status, capabilities: registered.capabilities }));
  while (!stopping) { const job = store.claimNext(workerId); if (job) { await executeBuildJob(store, job, root, artifacts); try { store.heartbeat(workerId, 'AVAILABLE'); } catch { /* worker may have been removed */ } } else await new Promise((resolve) => setTimeout(resolve, 2000)); }
  try { store.heartbeat(workerId, 'STALE'); } catch { /* shutdown is best effort */ }
}
void main().catch((error) => { console.error('Worker stopped:', error instanceof Error ? error.message : 'unknown error'); process.exitCode = 1; });
