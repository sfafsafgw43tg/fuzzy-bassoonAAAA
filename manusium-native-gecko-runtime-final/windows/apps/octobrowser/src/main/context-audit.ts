export type FingerprintContextName = 'window' | 'dedicated-worker' | 'shared-worker' | 'service-worker';

export type ContextFingerprintSnapshot = {
  context: FingerprintContextName;
  userAgent?: string;
  platform?: string;
  language?: string;
  languages?: string[];
  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;
  uaPlatform?: string;
  uaPlatformVersion?: string;
  uaArchitecture?: string;
  webglVendor?: string;
  webglRenderer?: string;
};

export type ContextAuditStatus = 'match' | 'mismatch' | 'unavailable';

export type ContextAuditRow = {
  field: keyof Omit<ContextFingerprintSnapshot, 'context'>;
  status: ContextAuditStatus;
  reference: string;
  values: Record<FingerprintContextName, string>;
};

const CONTEXTS: FingerprintContextName[] = ['window', 'dedicated-worker', 'shared-worker', 'service-worker'];
const FIELDS: Array<keyof Omit<ContextFingerprintSnapshot, 'context'>> = [
  'userAgent', 'platform', 'language', 'languages', 'hardwareConcurrency', 'deviceMemory',
  'uaPlatform', 'uaPlatformVersion', 'uaArchitecture', 'webglVendor', 'webglRenderer',
];

function normalize(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join('|');
  return String(value).trim();
}

/**
 * Compare observations only. This function never changes browser-visible values
 * and must not be used as a stealth or bot-detection bypass mechanism.
 */
export function auditFingerprintContexts(snapshots: ContextFingerprintSnapshot[]): ContextAuditRow[] {
  const byContext = new Map(snapshots.map((snapshot) => [snapshot.context, snapshot]));
  return FIELDS.map((field) => {
    const values = Object.fromEntries(CONTEXTS.map((context) => [context, normalize(byContext.get(context)?.[field])])) as Record<FingerprintContextName, string>;
    const present = CONTEXTS.map((context) => values[context]).filter(Boolean);
    const reference = present[0] ?? '';
    const status: ContextAuditStatus = present.length === 0
      ? 'unavailable'
      : present.every((value) => value === reference) && present.length === snapshots.length
        ? 'match'
        : present.every((value) => value === reference) ? 'unavailable' : 'mismatch';
    return { field, status, reference, values };
  });
}
