import * as os from 'node:os';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { buildCommands, redactWorkerMessage, type BuildJob, type WorkerRecord } from './core';
import { DurableBuildStore } from './store';
import { validateAndStoreArtifact } from './artifacts';

export interface WorkerRequirements { minDiskBytes: number; minMemoryBytes: number; requiredCommands: string[] }
export interface WorkerCapabilityReport { available: boolean; platform: string; architecture: string; freeDiskBytes: number; memoryBytes: number; missing: string[]; checkedAt: string }
export const defaultRequirements: WorkerRequirements = { minDiskBytes: 400 * 1024 ** 3, minMemoryBytes: 64 * 1024 ** 3, requiredCommands: ['git', 'repo', 'python3', 'java'] };
function commandExists(command: string): boolean { return Boolean(process.env.PATH?.split(path.delimiter).some((dir) => fs.existsSync(path.join(dir, command)))); }
export async function checkWorkerCapabilities(root = process.cwd(), requirements = defaultRequirements): Promise<WorkerCapabilityReport> {
  const stat = await fsp.statfs(root).catch(() => undefined); const freeDiskBytes = stat ? Number(stat.bavail) * Number(stat.bsize) : 0; const memoryBytes = os.totalmem();
  const missing: string[] = []; if (process.platform !== 'linux') missing.push('64-bit Linux'); if (process.arch !== 'x64') missing.push('x86_64 CPU'); if (freeDiskBytes < requirements.minDiskBytes) missing.push('approximately 400 GB free disk'); if (memoryBytes < requirements.minMemoryBytes) missing.push('approximately 64 GB RAM'); for (const command of requirements.requiredCommands) if (!commandExists(command)) missing.push(command);
  return { available: missing.length === 0, platform: process.platform, architecture: process.arch, freeDiskBytes, memoryBytes, missing, checkedAt: new Date().toISOString() };
}
export function workerRecord(report: WorkerCapabilityReport): WorkerRecord { const now = new Date().toISOString(); return { id: process.env.OCTO_BUILD_WORKER_ID || randomUUID(), name: process.env.OCTO_BUILD_WORKER_NAME || os.hostname(), status: report.available ? 'AVAILABLE' : 'UNAVAILABLE', platform: report.platform, architecture: report.architecture, capabilities: report.available ? ['AOSP', 'emu_img_zip', 'x86_64'] : report.missing, lastHeartbeatAt: now, registeredAt: now, updatedAt: now }; }
function run(command: string, args: string[], cwd: string, onOutput: (text: string) => void, signal?: AbortSignal): Promise<number> { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], signal }); child.stdout.on('data', (x) => onOutput(redactWorkerMessage(String(x)))); child.stderr.on('data', (x) => onOutput(redactWorkerMessage(String(x)))); child.on('error', reject); child.on('close', (code) => resolve(code ?? 1)); }); }
export async function executeBuildJob(store: DurableBuildStore, job: BuildJob, workRoot: string, artifactRoot: string, signal?: AbortSignal): Promise<void> {
  const report = await checkWorkerCapabilities(workRoot); if (!report.available) { store.transitionJob(job.id, 'FAILED', { errorCode: 'WORKER_UNAVAILABLE', safeErrorMessage: `Worker unavailable: ${report.missing.join(', ')}` }); return; }
  const checkout = path.join(workRoot, job.id); await fsp.mkdir(checkout, { recursive: true });
  try {
    for (const step of buildCommands(job)) { store.addEvent(job.id, 'LOG', `${step.command} ${step.args.join(' ')}`); const code = await run(step.command, step.args, checkout, (text) => store.addEvent(job.id, 'LOG', text), signal); if (code !== 0) { store.transitionJob(job.id, 'FAILED', { errorCode: 'BUILD_COMMAND_FAILED', safeErrorMessage: `AOSP command failed with exit code ${code}.` }); return; } }
    const artifactSource = path.join(checkout, 'out', 'target', 'product', job.target, 'emu_img_zip.zip');
    if (!fs.existsSync(artifactSource)) { store.transitionJob(job.id, 'FAILED', { errorCode: 'ARTIFACT_MISSING', safeErrorMessage: 'The worker did not produce the expected emulator image archive.' }); return; }
    let artifact; try { artifact = await validateAndStoreArtifact(store, job.id, artifactSource, 'emu_img_zip.zip', artifactRoot); } catch { store.transitionJob(job.id, 'ARTIFACT_VALIDATION_FAILED', { errorCode: 'ARTIFACT_VALIDATION_FAILED', safeErrorMessage: 'The produced emulator image failed validation.' }); return; }
    store.transitionJob(job.id, 'SUCCEEDED', { progress: 100, finishedAt: new Date().toISOString() }); store.addEvent(job.id, 'ARTIFACT_VALIDATED', 'A real emulator image was validated and stored.', 100); void artifact;
  } catch { if (signal?.aborted) { try { store.transitionJob(job.id, 'CANCELING'); store.transitionJob(job.id, 'CANCELED', { canceledAt: new Date().toISOString(), safeErrorMessage: 'The build was canceled.' }); } catch { /* stale cancellation is harmless */ } } else { try { store.transitionJob(job.id, 'FAILED', { errorCode: 'WORKER_FAILURE', safeErrorMessage: 'The worker failed while executing the build.' }); } catch { /* preserve original state */ } } }
}
