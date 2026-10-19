import type { CustomAndroidBuildConfig, CustomAndroidBuildTarget, CustomAndroidBuildVariant } from '../../../apps/octobrowser/src/main/android-custom-build';

export const BUILD_RELEASE = 'android-latest-release' as const;
export const BUILD_ARCHITECTURE = 'x86_64' as const;
export const BUILD_TARGETS: readonly CustomAndroidBuildTarget[] = [
  'aosp_cf_x86_64_only_phone-aosp_current-userdebug',
  'sdk_phone_x86_64',
];
export type BuildJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELING' | 'CANCELED' | 'ARTIFACT_VALIDATION_FAILED' | 'EXPIRED';
export type BuildCapabilityState = 'CONFIGURATION_ONLY' | 'READY_FOR_SUBMISSION' | BuildJobStatus;
export interface BuildPlan extends CustomAndroidBuildConfig { ownerId: string; schemaVersion: 1 }
export interface BuildJob {
  id: string; ownerId: string; buildPlanId: string; idempotencyKey: string; status: BuildJobStatus;
  release: typeof BUILD_RELEASE; architecture: typeof BUILD_ARCHITECTURE; target: CustomAndroidBuildTarget; variant: CustomAndroidBuildVariant;
  sourceRevision: string; requestedAt: string; queuedAt?: string; startedAt?: string; finishedAt?: string; canceledAt?: string;
  progress?: number; errorCode?: string; safeErrorMessage?: string; workerId?: string; createdAt: string; updatedAt: string;
}
export interface BuildEvent { id: string; jobId: string; sequence: number; type: string; timestamp: string; message: string; progress?: number; publicMetadata?: Record<string, string | number | boolean> }
export interface WorkerRecord { id: string; name: string; status: 'AVAILABLE' | 'BUSY' | 'UNAVAILABLE' | 'STALE'; platform: string; architecture: string; capabilities: string[]; lastHeartbeatAt: string; currentJobId?: string; registeredAt: string; updatedAt: string }
export interface ArtifactRecord { id: string; jobId: string; kind: string; filename: string; size: number; sha256: string; validationStatus: 'VALIDATED' | 'REJECTED'; storageKey: string; createdAt: string; expiresAt: string }
export interface BuildStoreData { schemaVersion: 1; plans: BuildPlan[]; jobs: BuildJob[]; events: BuildEvent[]; workers: WorkerRecord[]; artifacts: ArtifactRecord[] }

export function variantsForTarget(target: CustomAndroidBuildTarget): CustomAndroidBuildVariant[] {
  return target === 'aosp_cf_x86_64_only_phone-aosp_current-userdebug' ? ['userdebug'] : ['user', 'userdebug', 'eng'];
}
export function validateBuildRequest(input: unknown): { ok: true; value: Pick<BuildJob, 'release' | 'architecture' | 'target' | 'variant' | 'sourceRevision'> } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== 'object') return { ok: false, code: 'INVALID_REQUEST', message: 'Build request must be an object.' };
  const value = input as Record<string, unknown>;
  if (value.release !== BUILD_RELEASE) return { ok: false, code: 'UNSUPPORTED_RELEASE', message: 'The requested AOSP release is not supported.' };
  if (value.architecture !== BUILD_ARCHITECTURE) return { ok: false, code: 'UNSUPPORTED_ARCHITECTURE', message: 'The requested architecture is not supported.' };
  if (typeof value.target !== 'string' || !BUILD_TARGETS.includes(value.target as CustomAndroidBuildTarget)) return { ok: false, code: 'UNSUPPORTED_TARGET', message: 'The requested AOSP target is not supported.' };
  const target = value.target as CustomAndroidBuildTarget;
  if (typeof value.variant !== 'string' || !variantsForTarget(target).includes(value.variant as CustomAndroidBuildVariant)) return { ok: false, code: 'UNSUPPORTED_VARIANT', message: 'The requested build variant is not supported for this target.' };
  const sourceRevision = typeof value.sourceRevision === 'string' ? value.sourceRevision.trim() : '';
  if (!/^[0-9a-f]{7,64}$/i.test(sourceRevision) && sourceRevision !== 'android-latest-release') return { ok: false, code: 'INVALID_SOURCE_REVISION', message: 'A pinned source revision or the supported release marker is required.' };
  return { ok: true, value: { release: BUILD_RELEASE, architecture: BUILD_ARCHITECTURE, target, variant: value.variant as CustomAndroidBuildVariant, sourceRevision } };
}
const transitions: Record<BuildJobStatus, readonly BuildJobStatus[]> = {
  QUEUED: ['RUNNING', 'CANCELED'], RUNNING: ['SUCCEEDED', 'FAILED', 'CANCELING', 'ARTIFACT_VALIDATION_FAILED'], CANCELING: ['CANCELED', 'FAILED'], SUCCEEDED: ['EXPIRED'],
  FAILED: ['QUEUED'], CANCELED: [], ARTIFACT_VALIDATION_FAILED: ['QUEUED'], EXPIRED: [],
};
export function canTransition(from: BuildJobStatus, to: BuildJobStatus): boolean { return transitions[from].includes(to); }
export function assertTransition(from: BuildJobStatus, to: BuildJobStatus): void { if (!canTransition(from, to)) throw new Error(`Invalid build state transition: ${from} -> ${to}`); }
export function redactWorkerMessage(input: string): string {
  return input.replace(/(?:bearer\s+|token[=:]\s*|password[=:]\s*|secret[=:]\s*)[^\s]+/gi, '$1[REDACTED]').replace(/[A-Za-z]:\\[^\r\n ]+/g, '[PATH]').slice(0, 4000);
}
export function buildCommands(job: Pick<BuildJob, 'target' | 'variant'>): Array<{ command: string; args: string[] }> {
  const lunch = job.target === 'sdk_phone_x86_64' ? `sdk_phone_x86_64-${job.variant}` : job.target;
  return [
    { command: 'repo', args: ['init', '-u', 'https://android.googlesource.com/platform/manifest', '-b', BUILD_RELEASE] },
    { command: 'repo', args: ['sync', '-j24'] },
    { command: 'bash', args: ['-lc', 'source build/envsetup.sh && lunch "$1" && m -j32 && m emu_img_zip', '--', lunch] },
  ];
}
