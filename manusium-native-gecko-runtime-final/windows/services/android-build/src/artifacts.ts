import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import yauzl from 'yauzl';
import type { ArtifactRecord } from './core';
import { DurableBuildStore } from './store';

const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024 * 1024;
function safeEntry(name: string): boolean { const normalized = name.replaceAll('\\', '/'); return !normalized.startsWith('/') && !normalized.split('/').includes('..') && !/[\0\r\n]/.test(name); }
function inspectZip(filename: string): Promise<{ ok: boolean; entries: number; hasSystemImage: boolean; reason?: string }> {
  return new Promise((resolve) => yauzl.open(filename, { lazyEntries: true }, (error, zip) => {
    if (error || !zip) return resolve({ ok: false, entries: 0, hasSystemImage: false, reason: 'The artifact is not a readable ZIP archive.' });
    let entries = 0; let hasSystemImage = false; let failed = false;
    zip.readEntry();
    zip.on('entry', (entry: yauzl.Entry) => {
      entries += 1;
      if (!safeEntry(entry.fileName)) { failed = true; zip.close(); return resolve({ ok: false, entries, hasSystemImage, reason: 'The artifact contains an unsafe archive path.' }); }
      const base = path.posix.basename(entry.fileName).toLowerCase();
      if (base === 'system.img' || base === 'system-qemu.img' || base === 'system.raw.img') hasSystemImage = true;
      zip.readEntry();
    });
    zip.on('end', () => resolve(failed ? { ok: false, entries, hasSystemImage, reason: 'The artifact archive could not be validated.' } : { ok: entries > 0, entries, hasSystemImage, reason: entries ? undefined : 'The artifact archive is empty.' }));
    zip.on('error', () => resolve({ ok: false, entries, hasSystemImage, reason: 'The artifact archive could not be read.' }));
  }));
}
export async function validateAndStoreArtifact(store: DurableBuildStore, jobId: string, source: string, filename: string, storageRoot: string): Promise<ArtifactRecord> {
  const stat = await fsp.stat(source); if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARTIFACT_BYTES) throw new Error('ARTIFACT_SIZE_INVALID');
  const zip = await inspectZip(source); if (!zip.ok || !zip.hasSystemImage) throw new Error(zip.reason || 'ARTIFACT_CONTENT_INVALID');
  const hash = createHash('sha256'); await new Promise<void>((resolve, reject) => { const stream = fs.createReadStream(source); stream.on('data', (chunk) => hash.update(chunk)); stream.on('end', resolve); stream.on('error', reject); });
  const id = randomUUID(); const safeFilename = path.basename(filename).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'android-emulator-image.zip';
  const storageKey = `${jobId}/${id}/${safeFilename}`; const destination = path.join(storageRoot, storageKey); await fsp.mkdir(path.dirname(destination), { recursive: true }); await fsp.copyFile(source, destination);
  const now = new Date(); const artifact: ArtifactRecord = { id, jobId, kind: 'AOSP_EMULATOR_IMAGE', filename: safeFilename, size: stat.size, sha256: hash.digest('hex'), validationStatus: 'VALIDATED', storageKey, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString() }; store.addArtifact(artifact); return artifact;
}
export async function streamArtifact(storageRoot: string, artifact: ArtifactRecord): Promise<fs.ReadStream> { const filename = path.join(storageRoot, artifact.storageKey); await fsp.access(filename, fs.constants.R_OK); return fs.createReadStream(filename); }
