const crypto = require('node:crypto');

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'application/pdf'];

/** The real file type, read from the first bytes. The file name and the type the browser claims are never trusted. */
function sniffType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** JPEG: drop EXIF/XMP (APP1), Photoshop (APP13) and comment segments, which can hold GPS location. */
function stripJpeg(buf) {
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xda) {
      out.push(buf.subarray(i)); // start of scan: the picture data follows to the end
      return Buffer.concat(out);
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    const segment = buf.subarray(i, i + 2 + length);
    if (!(marker === 0xe1 || marker === 0xed || marker === 0xfe)) out.push(segment);
    i += 2 + length;
  }
  out.push(buf.subarray(i));
  return Buffer.concat(out);
}

/** PNG: drop the chunks that carry text and EXIF metadata. */
function stripPng(buf) {
  const drop = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);
  const out = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + length;
    if (!drop.has(type)) out.push(buf.subarray(i, end));
    i = end;
  }
  return Buffer.concat(out);
}

/** Removes location and other hidden metadata from photos. PDFs are stored as they are. */
function stripMetadata(buf, mime) {
  if (mime === 'image/jpeg') return stripJpeg(buf);
  if (mime === 'image/png') return stripPng(buf);
  return buf;
}

module.exports = { MAX_BYTES, ALLOWED, sniffType, sha256, stripMetadata };
