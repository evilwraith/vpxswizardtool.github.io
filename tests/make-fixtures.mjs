// Builds the one large test fixture that is too big to commit.
//
// Only pup-zip64.zip needs this: it carries 70,000 entries purely to push the
// entry count past the 65,535 that a classic End Of Central Directory record
// can express, which is what forces a reader down the ZIP64 path. The file is
// ~9 MB of almost nothing, so it is generated rather than stored in git.
//
// Everything ELSE in fixtures/generated/ is now committed (changed 2026-09-05).
// Those fourteen archives were built by hand in WinRAR and 7-Zip on 2026-08-27
// and this script does not produce them - nothing does. They are the evidence
// behind the archive routing, encryption and solid-RAR claims, and while they
// were gitignored a fresh clone had none of them and none of those claims could
// be re-verified. ~12 MB, and worth it.
//
// The small fixtures (pup-normal.zip, pup-comment.zip, pup-rar5.rar) ARE
// committed, in fixtures/ — they are a few hundred bytes each and having them
// in git means the suite still runs if this generator ever breaks.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, '..', 'fixtures', 'generated');
const OUT = path.join(OUT_DIR, 'pup-zip64.zip');

const ENTRY_COUNT = 70000;          // > 65535, so ZIP64 is mandatory
const PAYLOAD = Buffer.from('y');   // one byte per entry

// ── crc32 ──────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

const CRC = crc32(PAYLOAD);
const DOS_TIME = 0;
const DOS_DATE = 0x2821;   // 2020-01-01, fixed so output is byte-identical every run

const chunks = [];
const central = [];
let offset = 0;

for (let i = 0; i < ENTRY_COUNT; i++) {
  const name = Buffer.from('Deep/Pack/Level' + (i % 5) + '/file' + i + '.bin', 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);       // local file header signature
  local.writeUInt16LE(20, 4);               // version needed
  local.writeUInt16LE(0, 6);                // flags
  local.writeUInt16LE(0, 8);                // method: stored
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(CRC, 14);
  local.writeUInt32LE(PAYLOAD.length, 18);  // compressed size
  local.writeUInt32LE(PAYLOAD.length, 22);  // uncompressed size
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);               // extra length
  chunks.push(local, name, PAYLOAD);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);          // central directory signature
  cd.writeUInt16LE(45, 4);                  // version made by
  cd.writeUInt16LE(20, 6);                  // version needed
  cd.writeUInt16LE(0, 8);
  cd.writeUInt16LE(0, 10);
  cd.writeUInt16LE(DOS_TIME, 12);
  cd.writeUInt16LE(DOS_DATE, 14);
  cd.writeUInt32LE(CRC, 16);
  cd.writeUInt32LE(PAYLOAD.length, 20);
  cd.writeUInt32LE(PAYLOAD.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt16LE(0, 30);                  // extra
  cd.writeUInt16LE(0, 32);                  // comment
  cd.writeUInt16LE(0, 34);                  // disk start
  cd.writeUInt16LE(0, 36);                  // internal attrs
  cd.writeUInt32LE(0, 38);                  // external attrs
  cd.writeUInt32LE(offset, 42);             // local header offset
  central.push(cd, name);

  offset += local.length + name.length + PAYLOAD.length;
}

const cdOffset = offset;
const cdBuf = Buffer.concat(central);
const cdSize = cdBuf.length;

// ZIP64 end of central directory record
const z64 = Buffer.alloc(56);
z64.writeUInt32LE(0x06064b50, 0);
z64.writeBigUInt64LE(44n, 4);               // size of this record minus 12
z64.writeUInt16LE(45, 12);                  // version made by
z64.writeUInt16LE(45, 14);                  // version needed
z64.writeUInt32LE(0, 16);                   // this disk
z64.writeUInt32LE(0, 20);                   // disk with CD
z64.writeBigUInt64LE(BigInt(ENTRY_COUNT), 24);
z64.writeBigUInt64LE(BigInt(ENTRY_COUNT), 32);
z64.writeBigUInt64LE(BigInt(cdSize), 40);
z64.writeBigUInt64LE(BigInt(cdOffset), 48);

// ZIP64 end of central directory locator
const loc = Buffer.alloc(20);
loc.writeUInt32LE(0x07064b50, 0);
loc.writeUInt32LE(0, 4);                    // disk holding the ZIP64 EOCD
loc.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
loc.writeUInt32LE(1, 16);                   // total disks

// Classic EOCD, with the counts saturated so a reader must consult ZIP64
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(0xFFFF, 8);              // entries on this disk (saturated)
eocd.writeUInt16LE(0xFFFF, 10);             // total entries (saturated)
eocd.writeUInt32LE(cdSize, 12);
eocd.writeUInt32LE(cdOffset, 16);
eocd.writeUInt16LE(0, 20);                  // comment length

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([...chunks, cdBuf, z64, loc, eocd]));

console.log('pup-zip64.zip  ' + ENTRY_COUNT + ' entries  ' +
            (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB');
