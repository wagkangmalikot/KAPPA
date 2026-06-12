/**
 * Generates icon-192.png and icon-512.png for the KAPPA PWA manifest.
 * Matches the SVG design: dark purple gradient bg, pink/indigo "K".
 * Pure Node.js — no external dependencies.
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// --- PNG encoder (RGB + alpha, color type 6) ----------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, pixels /* Uint8Array, RGBA rows */) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 6; // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // no interlace

  // Raw scanlines: each row prefixed with filter byte 0 (None)
  const raw = Buffer.allocUnsafe(height * (1 + width * 4));
  let pos = 0;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0; // filter None
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x++) {
      raw[pos++] = pixels[rowOff + x * 4];
      raw[pos++] = pixels[rowOff + x * 4 + 1];
      raw[pos++] = pixels[rowOff + x * 4 + 2];
      raw[pos++] = pixels[rowOff + x * 4 + 3];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Geometry helpers ---------------------------------------------------

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// --- Icon pixel logic ---------------------------------------------------

function getPixelRGBA(px, py, size) {
  const s = size / 512;

  // Rounded rectangle clip (rx ≈ 22% as in the SVG rx=112/512)
  const rx = 112 * s;
  const inCorner = (cx, cy) => (px - cx) ** 2 + (py - cy) ** 2 > rx * rx;
  if (px < rx  && py < rx  && inCorner(rx, rx))           return [0,0,0,0];
  if (px > size - rx && py < rx  && inCorner(size - rx, rx)) return [0,0,0,0];
  if (px < rx  && py > size - rx && inCorner(rx, size - rx)) return [0,0,0,0];
  if (px > size - rx && py > size - rx && inCorner(size - rx, size - rx)) return [0,0,0,0];

  // Background: vertical gradient #1a003e → #0a001a
  const t = py / (size - 1);
  const bgR = Math.round(26  * (1 - t) + 10 * t);
  const bgG = 0;
  const bgB = Math.round(62  * (1 - t) + 26 * t);

  // K letter shape (scaled from a 512×512 reference)
  const sw = 82 * s; // stroke width

  // Left vertical bar: x ∈ [104,186], y ∈ [64,448]
  const inBar = px >= 104*s && px <= 186*s && py >= 64*s && py <= 448*s;

  // Arms originate from (186, 256) — right edge of bar, vertical centre
  const cx = 186 * s, cy = 256 * s;
  const inUpper = distToSegment(px, py, cx, cy, 400*s, 64*s)  < sw / 2;
  const inLower = distToSegment(px, py, cx, cy, 400*s, 448*s) < sw / 2;

  if (inBar || inUpper || inLower) {
    // Letter: gradient #f0abfc (pink) → #818cf8 (indigo)
    const kt = py / (size - 1);
    const kr = Math.round(240 * (1 - kt) + 129 * kt);
    const kg = Math.round(171 * (1 - kt) + 140 * kt);
    const kb = Math.round(252 * (1 - kt) + 248 * kt);
    return [kr, kg, kb, 255];
  }

  return [bgR, bgG, bgB, 255];
}

// --- Generate and write -------------------------------------------------

function generateIcon(size, outPath) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = getPixelRGBA(x, y, size);
      const off = (y * size + x) * 4;
      pixels[off]     = r;
      pixels[off + 1] = g;
      pixels[off + 2] = b;
      pixels[off + 3] = a;
    }
  }
  const buf = encodePNG(size, size, pixels);
  fs.writeFileSync(outPath, buf);
  console.log(`  wrote ${outPath} (${(buf.length / 1024).toFixed(1)} KB)`);
}

const iconsDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

console.log('Generating KAPPA icons...');
generateIcon(192, path.join(iconsDir, 'icon-192.png'));
generateIcon(512, path.join(iconsDir, 'icon-512.png'));
console.log('Done.');
