import * as path from 'node:path';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(): { date: number; time: number } {
  const now = new Date();
  return {
    date: ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2),
  };
}

/** Creates a standards-compliant, uncompressed ZIP containing one payload. */
export function zipSingleFile(name: string, data: Buffer): Buffer {
  const safeName = name.replace(/\\/g, '/');
  if (!safeName || safeName.startsWith('/') || safeName.includes('..') || path.isAbsolute(safeName)) throw new Error('Unsafe ZIP entry name');
  const filename = Buffer.from(safeName, 'utf8');
  const crc = crc32(data);
  const { date, time } = dosDateTime();
  const local = Buffer.alloc(30 + filename.length);
  local.writeUInt32LE(LOCAL, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26); local.writeUInt16LE(0, 28); filename.copy(local, 30);
  const central = Buffer.alloc(46 + filename.length);
  central.writeUInt32LE(CENTRAL, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(0, 42); filename.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + data.length, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([local, data, central, end]);
}

/** Extracts the single encrypted Octo payload from a store-only ZIP. */
export function unzipSingleFile(archive: Buffer, expectedName: string): Buffer {
  const minEnd = 22;
  const start = Math.max(0, archive.length - 65557);
  let eocd = -1;
  for (let i = archive.length - minEnd; i >= start; i--) if (archive.readUInt32LE(i) === END) { eocd = i; break; }
  if (eocd < 0 || archive.readUInt16LE(eocd + 8) !== 1) throw new Error('Invalid portable profile ZIP');
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (centralOffset + 46 > archive.length || archive.readUInt32LE(centralOffset) !== CENTRAL) throw new Error('Invalid portable profile ZIP');
  const nameLen = archive.readUInt16LE(centralOffset + 28);
  const extraLen = archive.readUInt16LE(centralOffset + 30);
  const commentLen = archive.readUInt16LE(centralOffset + 32);
  const name = archive.subarray(centralOffset + 46, centralOffset + 46 + nameLen).toString('utf8');
  if (name !== expectedName || name.includes('..') || name.startsWith('/') || path.isAbsolute(name)) throw new Error('Unsupported portable profile ZIP entry');
  if (archive.readUInt16LE(centralOffset + 10) !== 0) throw new Error('Compressed portable profile ZIPs are not supported');
  const localOffset = archive.readUInt32LE(centralOffset + 42);
  if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== LOCAL) throw new Error('Invalid portable profile ZIP entry');
  const localNameLen = archive.readUInt16LE(localOffset + 26);
  const localExtraLen = archive.readUInt16LE(localOffset + 28);
  const size = archive.readUInt32LE(centralOffset + 24);
  const dataStart = localOffset + 30 + localNameLen + localExtraLen;
  const dataEnd = dataStart + size;
  if (dataEnd > archive.length || dataEnd > centralOffset || centralOffset + 46 + nameLen + extraLen + commentLen > archive.length) throw new Error('Invalid portable profile ZIP bounds');
  const data = archive.subarray(dataStart, dataEnd);
  if (crc32(data) !== archive.readUInt32LE(centralOffset + 16)) throw new Error('Corrupt portable profile ZIP');
  return Buffer.from(data);
}
