import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function replaceActiveSource(tempPath, activePath) {
  const prepared = await fs.readFile(tempPath);
  await fs.writeFile(activePath, prepared);
}

test('replaces active image contents without changing the active path', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'octo-live-image-'));
  const temp = path.join(dir, 'prepared.jpg');
  const active = path.join(dir, 'active.jpg');
  await fs.writeFile(active, Buffer.from('old-image'));
  await fs.writeFile(temp, Buffer.from('new-image-pixels'));
  await replaceActiveSource(temp, active);
  assert.equal(await fs.readFile(active, 'utf8'), 'new-image-pixels');
  assert.equal(path.basename(active), 'active.jpg');
  await fs.rm(dir, { recursive: true, force: true });
});

test('fails when the prepared source does not exist', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'octo-live-image-'));
  const active = path.join(dir, 'active.jpg');
  await assert.rejects(() => replaceActiveSource(path.join(dir, 'missing.jpg'), active));
  await fs.rm(dir, { recursive: true, force: true });
});
