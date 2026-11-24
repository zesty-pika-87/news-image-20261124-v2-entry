// The day in pictures — Tuesday 24 November 2026, 35 stories, 7 regions.
// A front page where the pictures lead: 13 hand-drawn scenes, headlines as
// captions underneath them, and a fit-check that measures every text block
// against its cell before a single pixel of it is drawn, so nothing ever
// overflows or gets clipped. Node 22, standard library only, no network.
// Writes /output/entry.png (1024x1024), deterministic, under 1 MiB.
//
// Run locally: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
const CREAM: RGB = [247, 242, 231];
const PAPER: RGB = [250, 246, 238];
const INK: RGB = [26, 26, 26];
const INK_SOFT: RGB = [74, 74, 74];
const RED: RGB = [178, 32, 44];
const RED_DARK: RGB = [140, 22, 34];
const NAVY: RGB = [24, 48, 84];
const GOLD: RGB = [198, 148, 44];
const RULE: RGB = [26, 26, 26];
const WHITE: RGB = [255, 255, 255];

type RGB = [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Deterministic pseudo-random: same seed, same grain, every run.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------- PNG
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc);
  return out;
}

// Per-row filter pick (None/Sub/Up/Average/Paeth) by smallest absolute sum.
function encodePNG(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const stride = w * 3;
  const raw = new Uint8Array(h * (stride + 1));
  const prev = new Uint8Array(stride);
  const cand: Uint8Array[] = [];
  for (let f = 0; f < 5; f++) cand.push(new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 3 ? row[x - 3] : 0;
        const b = prev[x];
        const c = x >= 3 ? prev[x - 3] : 0;
        let v: number;
        if (f === 0) v = row[x];
        else if (f === 1) v = row[x] - a;
        else if (f === 2) v = row[x] - b;
        else if (f === 3) v = row[x] - ((a + b) >> 1);
        else {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = row[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        const s = v & 0xff;
        out[x] = s;
        score += s < 128 ? s : 256 - s;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    raw.set(cand[best], y * (stride + 1) + 1);
    prev.set(row);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const idat = deflateSync(raw, { level: 9 });
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', new Uint8Array(idat)),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return png;
}

// ---------------------------------------------------------------- canvas
class Canvas {
  buf: Uint8Array;
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.buf = new Uint8Array(w * h * 3);
  }
  fill(c: RGB): void {
    for (let i = 0; i < this.w * this.h; i++) {
      this.buf[i * 3] = c[0];
      this.buf[i * 3 + 1] = c[1];
      this.buf[i * 3 + 2] = c[2];
    }
  }
  // Blend one pixel with coverage alpha 0..1.
  px(x: number, y: number, c: RGB, a = 1): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 3;
    if (a >= 1) {
      this.buf[i] = c[0];
      this.buf[i + 1] = c[1];
      this.buf[i + 2] = c[2];
    } else {
      this.buf[i] = Math.round(this.buf[i] * (1 - a) + c[0] * a);
      this.buf[i + 1] = Math.round(this.buf[i + 1] * (1 - a) + c[1] * a);
      this.buf[i + 2] = Math.round(this.buf[i + 2] * (1 - a) + c[2] * a);
    }
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) this.px(xx, yy, c, a);
    }
  }
  // Vertical gradient rectangle.
  vgrad(x: number, y: number, w: number, h: number, top: RGB, bottom: RGB): void {
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      const t = h <= 1 ? 0 : (yy - y) / h;
      this.rect(x, yy, w, 1, mix(top, bottom, Math.max(0, Math.min(1, t))));
    }
  }
  hgrad(x: number, y: number, w: number, h: number, left: RGB, right: RGB): void {
    const x0 = Math.max(0, Math.floor(x));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    for (let xx = x0; xx < x1; xx++) {
      const t = w <= 1 ? 0 : (xx - x) / w;
      this.rect(xx, y, 1, h, mix(left, right, Math.max(0, Math.min(1, t))));
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const d = Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy);
        if (d <= r) {
          const edge = Math.max(0, Math.min(1, r - d + 0.5));
          this.px(xx, yy, c, a * edge);
        }
      }
    }
  }
  ring(cx: number, cy: number, r: number, thick: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.floor(cx - r - thick));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r + thick));
    const y0 = Math.max(0, Math.floor(cy - r - thick));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r + thick));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const d = Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy);
        if (Math.abs(d - r) <= thick / 2) this.px(xx, yy, c, a);
      }
    }
  }
  // Thick segment drawn as a chain of discs.
  line(x0: number, y0: number, x1: number, y1: number, thick: number, c: RGB, a = 1): void {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, thick / 3)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thick / 2, c, a);
    }
  }
  // Scanline-filled polygon, points as [x, y] pairs.
  poly(pts: [number, number][], c: RGB, a = 1): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let yy = Math.max(0, Math.floor(minY)); yy <= Math.min(this.h - 1, Math.ceil(maxY)); yy++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= yy + 0.5 && y1 > yy + 0.5) || (y1 <= yy + 0.5 && y0 > yy + 0.5)) {
          xs.push(x0 + ((yy + 0.5 - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let xx = Math.max(0, Math.ceil(xs[k])); xx <= Math.min(this.w - 1, Math.floor(xs[k + 1])); xx++) {
          this.px(xx, yy, c, a);
        }
      }
    }
  }
  // Sparse deterministic grain inside a rectangle: tiny dark/light specks.
  grain(x: number, y: number, w: number, h: number, rnd: () => number, density = 0.006): void {
    const n = Math.floor(w * h * density);
    for (let i = 0; i < n; i++) {
      const xx = Math.floor(x + rnd() * w);
      const yy = Math.floor(y + rnd() * h);
      const dark = rnd() < 0.55;
      this.px(xx, yy, dark ? [60, 50, 40] : [255, 252, 244], 0.16 + rnd() * 0.14);
    }
  }
}

// ------------------------------------------- hand-drawn proportional font
// Every glyph is drawn by hand on an 11-row grid: rows 0-8 cap zone,
// rows 3-8 x-height, rows 9-10 descenders. '#' is ink, '.' is empty.
// Widths are proportional: narrow letters (i, l, t) are 3-4 cells wide,
// wide ones (m, w) 7. Rendered with 3x supersampling, so edges stay
// smooth instead of blocky at 300px.
const GLYPHS: Record<string, string[]> = {
  A: ['..###..', '.#...#.', '.#...#.', '.#...#.', '.#####.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.......', '.......'],
  B: ['.####..', '.#...#.', '.#...#.', '.####..', '.#...#.', '.#...#.', '.#...#.', '.####..', '.......', '.......', '.......'],
  C: ['..####.', '.#....#', '.#.....', '.#.....', '.#.....', '.#.....', '.#....#', '..####.', '.......', '.......', '.......'],
  D: ['.####..', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.####..', '.......', '.......', '.......'],
  E: ['.#####.', '.#.....', '.#.....', '.####..', '.#.....', '.#.....', '.#.....', '.#####.', '.......', '.......', '.......'],
  F: ['.#####.', '.#.....', '.#.....', '.####..', '.#.....', '.#.....', '.#.....', '.#.....', '.......', '.......', '.......'],
  G: ['..####.', '.#....#', '.#.....', '.#..###', '.#...#.', '.#...#.', '.#...#.', '..###..', '.......', '.......', '.......'],
  H: ['.#...#.', '.#...#.', '.#...#.', '.#####.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.......', '.......', '.......'],
  I: ['..###..', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...', '..###..', '.......', '.......', '.......'],
  J: ['....##.', '.....#.', '.....#.', '.....#.', '.....#.', '.#...#.', '.#...#.', '..###..', '.......', '.......', '.......'],
  K: ['.#...#.', '.#..#..', '.#.#...', '.##....', '.#.#...', '.#..#..', '.#...#.', '.#...#.', '.......', '.......', '.......'],
  L: ['.#.....', '.#.....', '.#.....', '.#.....', '.#.....', '.#.....', '.#.....', '.#####.', '.......', '.......', '.......'],
  M: ['.#...#.', '.##.##.', '.#.#.#.', '.#.#.#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.......', '.......', '.......'],
  N: ['.#...#.', '.##..#.', '.##..#.', '.#.#.#.', '.#..##.', '.#..##.', '.#...#.', '.#...#.', '.......', '.......', '.......'],
  O: ['..###..', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '..###..', '.......', '.......', '.......'],
  P: ['.####..', '.#...#.', '.#...#.', '.####..', '.#.....', '.#.....', '.#.....', '.#.....', '.......', '.......', '.......'],
  Q: ['..###..', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#.#.#.', '.#..#..', '..##.#.', '.......', '.......', '.......'],
  R: ['.####..', '.#...#.', '.#...#.', '.####..', '.#.#...', '.#..#..', '.#...#.', '.#...#.', '.......', '.......', '.......'],
  S: ['..####.', '.#....#', '.#.....', '..###..', '....#..', '....#..', '.#...#.', '..###..', '.......', '.......', '.......'],
  T: ['.#####.', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...', '.......', '.......', '.......'],
  U: ['.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '..###..', '.......', '.......', '.......'],
  V: ['.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '..#.#..', '..#.#..', '...#...', '.......', '.......', '.......'],
  W: ['.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#.#.#.', '.#.#.#.', '.##.##.', '.#...#.', '.......', '.......', '.......'],
  X: ['.#...#.', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '.#...#.', '.#...#.', '.......', '.......', '.......'],
  Y: ['.#...#.', '.#...#.', '.#...#.', '..#.#..', '...#...', '...#...', '...#...', '...#...', '.......', '.......', '.......'],
  Z: ['.#####.', '....#..', '...#...', '..#....', '.#.....', '.#.....', '.#.....', '.#####.', '.......', '.......', '.......'],
  a: ['.......', '.......', '.......', '.####..', '....#..', '.####..', '#...#..', '#...#..', '.####..', '.......', '.......'],
  b: ['.#.....', '.#.....', '.#.....', '.####..', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.####..', '.......', '.......'],
  c: ['.......', '.......', '.......', '..####.', '.#.....', '.#.....', '.#.....', '.#.....', '..####.', '.......', '.......'],
  d: ['.....#.', '.....#.', '.....#.', '..####.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '..####.', '.......', '.......'],
  e: ['.......', '.......', '.......', '..###..', '.#...#.', '.#####.', '.#.....', '.#...#.', '..###..', '.......', '.......'],
  f: ['...##..', '..#....', '..#....', '.####..', '..#....', '..#....', '..#....', '..#....', '..#....', '.......', '.......'],
  g: ['.......', '.......', '.......', '..####.', '.#...#.', '.#...#.', '.#...#.', '..####.', '....#..', '.#.#...', '..##...'],
  h: ['.#.....', '.#.....', '.#.....', '.####..', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.......', '.......'],
  i: ['.......', '.......', '...#...', '.......', '..##...', '...#...', '...#...', '...#...', '..###..', '.......', '.......'],
  j: ['.......', '.......', '....#..', '.......', '...##..', '....#..', '....#..', '....#..', '....#..', '.#..#..', '..##...'],
  k: ['.#.....', '.#.....', '.#.....', '.#..#..', '.#.#...', '.##....', '.#.#...', '.#..#..', '.#...#.', '.......', '.......'],
  l: ['..##...', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...', '..###..', '.......', '.......'],
  m: ['.......', '.......', '.......', '.##.##.', '.#.#.#.', '.#.#.#.', '.#.#.#.', '.#.#.#.', '.#.#.#.', '.......', '.......'],
  n: ['.......', '.......', '.......', '.####..', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.......', '.......'],
  o: ['.......', '.......', '.......', '..###..', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '..###..', '.......', '.......'],
  p: ['.......', '.......', '.......', '.####..', '.#...#.', '.#...#.', '.#...#.', '.####..', '.#.....', '.#.....', '.#.....'],
  q: ['.......', '.......', '.......', '..####.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '..####.', '....#..', '....#..'],
  r: ['.......', '.......', '.......', '.#.##..', '.##..#.', '.#.....', '.#.....', '.#.....', '.#.....', '.......', '.......'],
  s: ['.......', '.......', '.......', '..####.', '.#.....', '..##...', '....#..', '....#..', '.####..', '.......', '.......'],
  t: ['...#...', '...#...', '...#...', '.####..', '...#...', '...#...', '...#...', '...#...', '...##..', '.......', '.......'],
  u: ['.......', '.......', '.......', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '..###..', '.......', '.......'],
  v: ['.......', '.......', '.......', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '..#.#..', '...#...', '.......', '.......'],
  w: ['.......', '.......', '.......', '.#...#.', '.#...#.', '.#.#.#.', '.#.#.#.', '.#.#.#.', '..#.#..', '.......', '.......'],
  x: ['.......', '.......', '.......', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '.#...#.', '.......', '.......'],
  y: ['.......', '.......', '.......', '.#...#.', '.#...#.', '.#...#.', '..#.#..', '...#...', '...#...', '...#...', '..##...'],
  z: ['.......', '.......', '.......', '.#####.', '....#..', '...#...', '..#....', '.#.....', '.#####.', '.......', '.......'],
  '0': ['..###..', '.#...#.', '.#..##.', '.#.#.#.', '.##..#.', '.#...#.', '.#...#.', '..###..', '.......', '.......', '.......'],
  '1': ['...#...', '..##...', '...#...', '...#...', '...#...', '...#...', '...#...', '..###..', '.......', '.......', '.......'],
  '2': ['..###..', '.#...#.', '....#..', '...#...', '..#....', '.#.....', '.#.....', '.#####.', '.......', '.......', '.......'],
  '3': ['..###..', '.#...#.', '....#..', '..##...', '....#..', '....#..', '.#...#.', '..###..', '.......', '.......', '.......'],
  '4': ['...#...', '..##...', '.#.#...', '.#.#...', '.#####.', '...#...', '...#...', '...#...', '.......', '.......', '.......'],
  '5': ['.#####.', '.#.....', '.#.....', '.####..', '....#..', '....#..', '.#...#.', '..###..', '.......', '.......', '.......'],
  '6': ['..###..', '.#.....', '.#.....', '.####..', '.#...#.', '.#...#.', '.#...#.', '..###..', '.......', '.......', '.......'],
  '7': ['.#####.', '....#..', '...#...', '...#...', '..#....', '..#....', '..#....', '..#....', '.......', '.......', '.......'],
  '8': ['..###..', '.#...#.', '.#...#.', '..###..', '.#...#.', '.#...#.', '.#...#.', '..###..', '.......', '.......', '.......'],
  '9': ['..###..', '.#...#.', '.#...#.', '.#...#.', '..####.', '....#..', '....#..', '..###..', '.......', '.......', '.......'],
  '.': ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '..##...', '..##...', '.......', '.......'],
  ',': ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '..##...', '..##...', '..#....', '.#.....'],
  ':': ['.......', '.......', '..##...', '..##...', '.......', '..##...', '..##...', '.......', '.......', '.......', '.......'],
  ';': ['.......', '.......', '..##...', '..##...', '.......', '..##...', '..##...', '..#....', '.#.....', '.......', '.......'],
  '!': ['..##...', '..##...', '..##...', '..##...', '..##...', '..##...', '.......', '..##...', '.......', '.......', '.......'],
  '?': ['..###..', '.#...#.', '....#..', '...#...', '..#....', '.......', '..#....', '.......', '.......', '.......', '.......'],
  "'": ['..#....', '..#....', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'],
  '"': ['.#.#...', '.#.#...', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'],
  '(': ['....#..', '...#...', '..#....', '..#....', '..#....', '..#....', '..#....', '...#...', '....#..', '.......', '.......'],
  ')': ['..#....', '...#...', '....#..', '....#..', '....#..', '....#..', '....#..', '...#...', '..#....', '.......', '.......'],
  '-': ['.......', '.......', '.......', '.......', '.......', '.####..', '.......', '.......', '.......', '.......', '.......'],
  '–': ['.......', '.......', '.......', '.......', '.......', '.#####.', '.......', '.......', '.......', '.......', '.......'],
  '—': ['.......', '.......', '.......', '.......', '.......', '#######', '.......', '.......', '.......', '.......', '.......'],
  '%': ['.##..#.', '.##.#..', '...#...', '..#....', '..#....', '.#..##.', '.#..##.', '#...##.', '.......', '.......', '.......'],
  $: ['...#...', '..####.', '.#.#.#.', '.#.#...', '..###..', '...#.#.', '.#.#.#.', '..####.', '...#...', '.......', '.......'],
  '&': ['..###..', '.#...#.', '.#...#.', '..##...', '.#.#.#.', '.#...#.', '.#...#.', '..##.#.', '.......', '.......', '.......'],
  '+': ['.......', '.......', '...#...', '...#...', '.#####.', '...#...', '...#...', '.......', '.......', '.......', '.......'],
  '/': ['.....#.', '.....#.', '....#..', '...#...', '..#....', '.#.....', '.#.....', '#......', '.......', '.......', '.......'],
  '=': ['.......', '.......', '.......', '.#####.', '.......', '.#####.', '.......', '.......', '.......', '.......', '.......'],
  '*': ['.......', '...#...', '.#.#.#.', '..###..', '.#.#.#.', '.......', '.......', '.......', '.......', '.......', '.......'],
  '#': ['..#.#..', '..#.#..', '.#####.', '..#.#..', '..#.#..', '.#####.', '..#.#..', '..#.#..', '.......', '.......', '.......'],
  '·': ['.......', '.......', '.......', '.......', '.......', '..##...', '.......', '.......', '.......', '.......', '.......'],
  '•': ['.......', '.......', '.......', '.......', '..###..', '..###..', '..###..', '.......', '.......', '.......', '.......'],
  _: ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.#####.', '.......'],
};

function glyphCols(ch: string): number {
  const g = GLYPHS[ch];
  if (!g) return 4;
  let w = 0;
  for (const row of g) {
    const t = row.replace(/\.+$/, '').length;
    if (t > w) w = t;
  }
  return w;
}

function glyphHasInk(ch: string): boolean {
  const g = GLYPHS[ch];
  if (!g) return false;
  return g.some((row) => row.includes('#'));
}

// ------------------------------------------------------------ text engine
// Fit-check is the new technique of this build: every text block is
// measured against its cell BEFORE it is drawn. The font shrinks step by
// step until the block fits; a block that cannot fit even at its minimum
// size is recorded as an overflow (the build must report zero of those).

interface FitRecord {
  id: string;
  startEm: number;
  em: number;
  lines: number;
  maxLines: number;
  widest: number;
  maxW: number;
  margin: number;
  overflow: boolean;
}
const FIT: FitRecord[] = [];

const SS = 3; // supersampling factor for glyph edges
const glyphCache = new Map<string, { w: number; h: number; a: Float32Array }>();

function cellOf(em: number): number {
  return em / 11;
}

function advanceOf(ch: string, em: number, bold: boolean): number {
  const cell = cellOf(em);
  if (ch === ' ') return 3.0 * cell;
  return (glyphCols(ch) + 0.7) * cell + (bold ? 0.5 * cell : 0);
}

function measure(text: string, em: number, bold = false): number {
  let w = 0;
  for (const ch of text) w += advanceOf(ch, em, bold);
  return w;
}

function rasterGlyph(ch: string, em: number, bold: boolean): { w: number; h: number; a: Float32Array } {
  const key = `${ch}|${em}|${bold}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const cell = cellOf(em);
  const cols = glyphCols(ch);
  const w = Math.max(1, Math.ceil((cols + (bold ? 0.5 : 0)) * cell));
  const h = Math.max(1, Math.ceil(11 * cell));
  const sw = w * SS;
  const sh = h * SS;
  const hi = new Uint8Array(sw * sh);
  const g = GLYPHS[ch];
  const shifts = bold ? [0, cell * 0.3] : [0];
  if (g) {
    for (const dx of shifts) {
      for (let r = 0; r < 11; r++) {
        const row = g[r];
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== '#') continue;
          const x0 = Math.floor((c * cell + dx) * SS);
          const x1 = Math.min(sw, Math.ceil(((c + 1) * cell + dx) * SS));
          const y0 = Math.floor(r * cell * SS);
          const y1 = Math.min(sh, Math.ceil((r + 1) * cell * SS));
          for (let yy = y0; yy < y1; yy++) {
            for (let xx = x0; xx < x1; xx++) hi[yy * sw + xx] = 1;
          }
        }
      }
    }
  }
  const a = new Float32Array(w * h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      let s = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) s += hi[(yy * SS + dy) * sw + (xx * SS + dx)];
      }
      a[yy * w + xx] = s / (SS * SS);
    }
  }
  const out = { w, h, a };
  glyphCache.set(key, out);
  return out;
}

function drawText(
  cv: Canvas,
  x: number,
  y: number,
  text: string,
  em: number,
  color: RGB,
  opts: { bold?: boolean; align?: 'left' | 'center' | 'right' } = {},
): number {
  const bold = opts.bold ?? false;
  const total = measure(text, em, bold);
  let cx = x;
  if (opts.align === 'center') cx = x - total / 2;
  else if (opts.align === 'right') cx = x - total;
  const top = Math.round(y);
  for (const ch of text) {
    if (ch !== ' ' && glyphHasInk(ch)) {
      const g = rasterGlyph(ch, em, bold);
      const gx = Math.round(cx);
      for (let yy = 0; yy < g.h; yy++) {
        for (let xx = 0; xx < g.w; xx++) {
          const alpha = g.a[yy * g.w + xx];
          if (alpha > 0) cv.px(gx + xx, top + yy, color, alpha);
        }
      }
    }
    cx += advanceOf(ch, em, bold);
  }
  return total;
}

function wrapText(text: string, em: number, maxW: number, bold = false): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const trial = cur ? `${cur} ${word}` : word;
    if (measure(trial, em, bold) <= maxW + 0.5) {
      cur = trial;
    } else {
      if (cur) lines.push(cur);
      // A single word wider than the cell: hard-split it by characters.
      if (measure(word, em, bold) > maxW + 0.5) {
        let part = '';
        for (const ch of word) {
          if (measure(part + ch, em, bold) <= maxW + 0.5) part += ch;
          else {
            if (part) lines.push(part);
            part = ch;
          }
        }
        cur = part;
      } else {
        cur = word;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Measure first, shrink until it fits, record the margin. Never draws.
function fitBlock(
  id: string,
  text: string,
  maxW: number,
  maxLines: number,
  startEm: number,
  minEm: number,
  bold = false,
): { em: number; lines: string[]; overflow: boolean } {
  let em = startEm;
  let lines: string[] = [];
  let overflow = false;
  while (true) {
    lines = wrapText(text, em, maxW, bold);
    const widest = lines.reduce((m, l) => Math.max(m, measure(l, em, bold)), 0);
    if ((lines.length <= maxLines && widest <= maxW + 0.1) || em <= minEm + 0.001) {
      if (lines.length > maxLines || widest > maxW + 0.1) overflow = true;
      FIT.push({
        id,
        startEm,
        em: Math.round(em * 10) / 10,
        lines: lines.length,
        maxLines,
        widest: Math.round(widest * 10) / 10,
        maxW: Math.round(maxW * 10) / 10,
        margin: Math.round((maxW - widest) * 10) / 10,
        overflow,
      });
      return { em, lines, overflow };
    }
    em = Math.round((em - 0.5) * 10) / 10;
  }
}

// Draw a block that fitBlock already approved, top-aligned.
function drawBlock(
  cv: Canvas,
  x: number,
  y: number,
  lines: string[],
  em: number,
  color: RGB,
  opts: { bold?: boolean; align?: 'left' | 'center' | 'right'; lineH?: number } = {},
): number {
  const lh = opts.lineH ?? em * 1.18;
  lines.forEach((line, i) => {
    drawText(cv, x, y + i * lh, line, em, color, opts);
  });
  return y + lines.length * lh;
}

function drawChip(
  cv: Canvas,
  x: number,
  y: number,
  text: string,
  em: number,
  bg: RGB,
  fg: RGB,
): number {
  const padX = Math.max(4, em * 0.45);
  const padY = Math.max(2, em * 0.3);
  const tw = measure(text, em, true);
  const w = tw + padX * 2;
  const h = em + padY * 2;
  cv.rect(x, y, w, h, bg);
  drawText(cv, x + padX, y + padY, text, em, fg, { bold: true });
  return w;
}

function hrule(cv: Canvas, x: number, y: number, w: number, thick = 2, color: RGB = RULE): void {
  cv.rect(x, y, w, thick, color);
}

// ------------------------------------------------------------ scene helpers
type SceneFn = (cv: Canvas, x: number, y: number, w: number, h: number, rnd: () => number) => void;

function sky(cv: Canvas, x: number, y: number, w: number, h: number, top: RGB, bot: RGB): void {
  cv.vgrad(x, y, w, h, top, bot);
}
function sunDisc(cv: Canvas, x: number, y: number, r: number, c: RGB): void {
  cv.circle(x, y, r + 3, mix(c, WHITE, 0.35), 0.5);
  cv.circle(x, y, r, c);
}
function sea(cv: Canvas, x: number, y: number, w: number, h: number, c: RGB): void {
  cv.vgrad(x, y, w, h, c, mix(c, [10, 20, 40], 0.55));
  cv.rect(x, y, w, 2, mix(c, WHITE, 0.45));
}
function person(cv: Canvas, x: number, y: number, s: number, c: RGB): void {
  cv.circle(x, y - s * 0.62, s * 0.2, c);
  cv.poly(
    [
      [x - s * 0.3, y],
      [x + s * 0.3, y],
      [x + s * 0.16, y - s * 0.45],
      [x - s * 0.16, y - s * 0.45],
    ],
    c,
  );
}
function pineTree(cv: Canvas, x: number, y: number, s: number, c: RGB): void {
  cv.rect(x - s * 0.06, y - s * 0.25, s * 0.12, s * 0.25, [90, 60, 30]);
  cv.poly(
    [
      [x, y - s],
      [x + s * 0.32, y - s * 0.28],
      [x - s * 0.32, y - s * 0.28],
    ],
    c,
  );
}

// ------------------------------------------------------------------- heroes
const sceneH1: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [8, 38, 22], [16, 74, 42]);
  for (let i = 1; i < 5; i++) cv.rect(x, y + (h * i) / 5, w, 1, [255, 255, 255], 0.12);
  for (let i = 1; i < 8; i++) cv.rect(x + (w * i) / 8, y, 1, h, [255, 255, 255], 0.08);
  // Chip HQ block bottom-left.
  cv.rect(x + w * 0.06, y + h * 0.62, w * 0.2, h * 0.26, [24, 24, 24]);
  cv.rect(x + w * 0.06, y + h * 0.62, w * 0.2, 3, [118, 200, 80]);
  for (let i = 0; i < 4; i++) {
    cv.rect(x + w * 0.09 + i * w * 0.045, y + h * 0.7, w * 0.03, h * 0.12, [118, 200, 80]);
  }
  // Rising bars then a steep green arrow line.
  const bx = x + w * 0.34;
  const bw = w * 0.09;
  const heights = [0.18, 0.3, 0.24, 0.42, 0.55, 0.72];
  heights.forEach((hh, i) => {
    cv.rect(bx + i * (bw + 4), y + h * 0.86 - h * hh, bw, h * hh, i % 2 ? [46, 160, 90] : [118, 200, 80]);
  });
  cv.line(x + w * 0.05, y + h * 0.8, x + w * 0.92, y + h * 0.18, 5, [140, 230, 120]);
  cv.poly(
    [
      [x + w * 0.92, y + h * 0.18],
      [x + w * 0.8, y + h * 0.16],
      [x + w * 0.86, y + h * 0.3],
    ],
    [140, 230, 120],
  );
  cv.grain(x, y, w, h, rnd, 0.004);
};

const sceneH2: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [146, 190, 224], [214, 228, 238]);
  sunDisc(cv, x + w * 0.86, y + h * 0.22, h * 0.11, [250, 220, 130]);
  cv.circle(x + w * 0.14, y + h * 0.2, h * 0.09, WHITE, 0.9);
  cv.circle(x + w * 0.2, y + h * 0.24, h * 0.07, WHITE, 0.9);
  sea(cv, x, y + h * 0.68, w, h * 0.32, [38, 92, 140]);
  // Ulleung island.
  cv.poly(
    [
      [x + w * 0.6, y + h * 0.68],
      [x + w * 0.72, y + h * 0.42],
      [x + w * 0.84, y + h * 0.68],
    ],
    [46, 110, 66],
  );
  pineTree(cv, x + w * 0.72, y + h * 0.5, h * 0.22, [30, 84, 48]);
  // Jet silhouette crossing the sky.
  const jx = x + w * 0.38;
  const jy = y + h * 0.34;
  cv.poly(
    [
      [jx - w * 0.16, jy],
      [jx + w * 0.14, jy - h * 0.05],
      [jx + w * 0.2, jy],
      [jx + w * 0.14, jy + h * 0.05],
      [jx - w * 0.16, jy + h * 0.02],
    ],
    [52, 58, 66],
  );
  cv.poly(
    [
      [jx - w * 0.02, jy - h * 0.02],
      [jx + w * 0.06, jy - h * 0.16],
      [jx + w * 0.1, jy - h * 0.02],
    ],
    [52, 58, 66],
  );
  cv.ring(jx, jy, h * 0.26, 3, RED);
  cv.grain(x, y, w, h, rnd, 0.004);
};

const sceneH3: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [214, 196, 160], [168, 140, 104]);
  // Tall windows at the back.
  for (let i = 0; i < 4; i++) {
    cv.rect(x + w * (0.08 + i * 0.23), y + h * 0.06, w * 0.15, h * 0.5, [238, 228, 200], 0.85);
  }
  // Row of small flags above the table.
  const flagCols: RGB[] = [[178, 32, 44], [24, 48, 84], [198, 148, 44], [46, 110, 66], [124, 63, 152], [217, 79, 4]];
  flagCols.forEach((c, i) => {
    const fx = x + w * (0.1 + i * 0.15);
    cv.rect(fx, y + h * 0.52, 2, h * 0.14, [80, 60, 40]);
    cv.rect(fx + 2, y + h * 0.52, w * 0.09, h * 0.09, c);
  });
  // Long empty negotiation table + empty chairs.
  cv.rect(x + w * 0.04, y + h * 0.66, w * 0.92, h * 0.12, [96, 66, 38]);
  cv.rect(x + w * 0.04, y + h * 0.66, w * 0.92, 3, [140, 100, 60]);
  for (let i = 0; i < 5; i++) {
    const cxp = x + w * (0.12 + i * 0.18);
    cv.rect(cxp, y + h * 0.8, w * 0.1, h * 0.16, [70, 48, 28]);
    cv.rect(cxp, y + h * 0.78, w * 0.1, 3, [120, 88, 50]);
  }
  // One lone paper on the table: no deal.
  cv.rect(x + w * 0.46, y + h * 0.62, w * 0.08, h * 0.05, WHITE, 0.95);
  cv.grain(x, y, w, h, rnd, 0.004);
};

// ------------------------------------------------------------------- middle
const sceneM1: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [252, 196, 130], [250, 222, 180]);
  // Taipei-style skyline.
  const bw = w / 7;
  [0.5, 0.72, 0.42, 0.9, 0.6, 0.48, 0.66].forEach((hh, i) => {
    cv.rect(x + i * bw + 2, y + h - h * hh * 0.62, bw - 4, h * hh * 0.62, i === 3 ? [70, 60, 90] : [120, 100, 110]);
  });
  cv.poly(
    [
      [x + w * 0.47, y + h * 0.08],
      [x + w * 0.52, y + h * 0.3],
      [x + w * 0.42, y + h * 0.3],
    ],
    [70, 60, 90],
  );
  // Rising red arrow over the skyline.
  cv.line(x + w * 0.06, y + h * 0.72, x + w * 0.9, y + h * 0.2, 4, RED);
  cv.poly(
    [
      [x + w * 0.9, y + h * 0.2],
      [x + w * 0.78, y + h * 0.18],
      [x + w * 0.84, y + h * 0.32],
    ],
    RED,
  );
  cv.grain(x, y, w, h, rnd, 0.005);
};

const sceneM2: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [180, 205, 225], [232, 236, 238]);
  // Factory hall + two chimneys with smoke.
  cv.rect(x + w * 0.08, y + h * 0.48, w * 0.6, h * 0.4, [150, 140, 125]);
  cv.poly(
    [
      [x + w * 0.08, y + h * 0.48],
      [x + w * 0.38, y + h * 0.48],
      [x + w * 0.23, y + h * 0.3],
    ],
    [110, 100, 88],
  );
  cv.rect(x + w * 0.72, y + h * 0.2, w * 0.08, h * 0.68, [120, 110, 100]);
  cv.rect(x + w * 0.84, y + h * 0.32, w * 0.07, h * 0.56, [120, 110, 100]);
  cv.circle(x + w * 0.76, y + h * 0.14, h * 0.09, [240, 240, 235], 0.85);
  cv.circle(x + w * 0.82, y + h * 0.08, h * 0.07, [240, 240, 235], 0.7);
  // Gauge dial.
  cv.circle(x + w * 0.38, y + h * 0.66, h * 0.16, WHITE);
  cv.ring(x + w * 0.38, y + h * 0.66, h * 0.16, 2, INK);
  cv.line(x + w * 0.38, y + h * 0.66, x + w * 0.48, y + h * 0.56, 2, RED);
  cv.grain(x, y, w, h, rnd, 0.005);
};

const sceneM3: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [52, 42, 28], [28, 22, 14]);
  // Stack of gold bars.
  const bar = (bx: number, by: number, bw2: number, bh: number) => {
    cv.poly(
      [
        [bx, by],
        [bx + bw2, by],
        [bx + bw2 - bw2 * 0.12, by + bh],
        [bx + bw2 * 0.12, by + bh],
      ],
      [232, 178, 60],
    );
    cv.rect(bx + bw2 * 0.12, by, bw2 * 0.76, 2, [255, 220, 120]);
  };
  bar(x + w * 0.3, y + h * 0.62, w * 0.4, h * 0.2);
  bar(x + w * 0.36, y + h * 0.4, w * 0.28, h * 0.18);
  bar(x + w * 0.42, y + h * 0.2, w * 0.16, h * 0.16);
  // Coins.
  cv.circle(x + w * 0.16, y + h * 0.72, h * 0.13, [240, 196, 80]);
  cv.circle(x + w * 0.16, y + h * 0.72, h * 0.08, [200, 150, 40]);
  cv.circle(x + w * 0.84, y + h * 0.76, h * 0.1, [240, 196, 80]);
  // Sparkles.
  cv.line(x + w * 0.66, y + h * 0.16, x + w * 0.66, y + h * 0.3, 2, [255, 230, 140]);
  cv.line(x + w * 0.62, y + h * 0.23, x + w * 0.7, y + h * 0.23, 2, [255, 230, 140]);
  cv.grain(x, y, w, h, rnd, 0.005);
};

const sceneM4: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [120, 130, 140], [190, 195, 200]);
  sea(cv, x, y + h * 0.55, w, h * 0.45, [30, 70, 105]);
  // Listing warship, bow up, stern under.
  cv.poly(
    [
      [x + w * 0.12, y + h * 0.62],
      [x + w * 0.55, y + h * 0.42],
      [x + w * 0.78, y + h * 0.5],
      [x + w * 0.7, y + h * 0.66],
      [x + w * 0.2, y + h * 0.74],
    ],
    [70, 76, 84],
  );
  cv.rect(x + w * 0.42, y + h * 0.3, w * 0.1, h * 0.16, [52, 58, 66]);
  cv.line(x + w * 0.47, y + h * 0.3, x + w * 0.47, y + h * 0.14, 2, [52, 58, 66]);
  // Smoke + fire at the stern.
  cv.circle(x + w * 0.72, y + h * 0.4, h * 0.12, [90, 90, 90], 0.8);
  cv.circle(x + w * 0.78, y + h * 0.3, h * 0.09, [60, 60, 60], 0.7);
  cv.poly(
    [
      [x + w * 0.7, y + h * 0.52],
      [x + w * 0.78, y + h * 0.38],
      [x + w * 0.86, y + h * 0.52],
    ],
    [230, 120, 40],
  );
  // Two small drones above.
  cv.circle(x + w * 0.24, y + h * 0.18, h * 0.05, INK);
  cv.circle(x + w * 0.34, y + h * 0.1, h * 0.05, INK);
  cv.grain(x, y, w, h, rnd, 0.005);
};

const sceneM5: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [240, 200, 140], [250, 230, 190]);
  sunDisc(cv, x + w * 0.82, y + h * 0.2, h * 0.11, [240, 160, 60]);
  sea(cv, x, y + h * 0.58, w, h * 0.42, [36, 88, 128]);
  // Grey warship left, dark tanker right, facing off.
  cv.rect(x + w * 0.06, y + h * 0.44, w * 0.36, h * 0.16, [90, 96, 104]);
  cv.poly(
    [
      [x + w * 0.06, y + h * 0.6],
      [x + w * 0.42, y + h * 0.6],
      [x + w * 0.38, y + h * 0.5],
      [x + w * 0.1, y + h * 0.5],
    ],
    [70, 76, 84],
  );
  cv.rect(x + w * 0.16, y + h * 0.3, w * 0.08, h * 0.15, [70, 76, 84]);
  cv.rect(x + w * 0.58, y + h * 0.5, w * 0.36, h * 0.14, [60, 40, 30]);
  cv.rect(x + w * 0.58, y + h * 0.5, w * 0.36, 3, [178, 32, 44]);
  cv.rect(x + w * 0.88, y + h * 0.36, w * 0.06, h * 0.15, [60, 40, 30]);
  // Warning triangle between them.
  cv.poly(
    [
      [x + w * 0.5, y + h * 0.12],
      [x + w * 0.56, y + h * 0.26],
      [x + w * 0.44, y + h * 0.26],
    ],
    [220, 170, 30],
  );
  cv.rect(x + w * 0.495, y + h * 0.16, 2, h * 0.05, INK);
  cv.grain(x, y, w, h, rnd, 0.005);
};

const sceneM6: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [150, 190, 220], [215, 228, 238]);
  // Green land below, radar sweep arcs.
  cv.rect(x, y + h * 0.62, w, h * 0.38, [90, 140, 80]);
  cv.rect(x, y + h * 0.62, w, 2, [60, 110, 55]);
  cv.ring(x + w * 0.5, y + h * 0.78, h * 0.3, 1, WHITE, 0.6);
  cv.ring(x + w * 0.5, y + h * 0.78, h * 0.18, 1, WHITE, 0.6);
  // AWACS: fuselage + big radar dome.
  cv.poly(
    [
      [x + w * 0.14, y + h * 0.38],
      [x + w * 0.82, y + h * 0.34],
      [x + w * 0.9, y + h * 0.4],
      [x + w * 0.82, y + h * 0.46],
      [x + w * 0.14, y + h * 0.46],
    ],
    [200, 205, 210],
  );
  cv.circle(x + w * 0.5, y + h * 0.26, h * 0.13, [150, 155, 160]);
  cv.rect(x + w * 0.48, y + h * 0.32, w * 0.04, h * 0.06, [120, 125, 130]);
  cv.poly(
    [
      [x + w * 0.2, y + h * 0.38],
      [x + w * 0.28, y + h * 0.18],
      [x + w * 0.32, y + h * 0.38],
    ],
    [170, 175, 180],
  );
  // Red pins on the land.
  cv.circle(x + w * 0.24, y + h * 0.74, h * 0.06, RED);
  cv.circle(x + w * 0.72, y + h * 0.8, h * 0.06, RED);
  cv.grain(x, y, w, h, rnd, 0.005);
};

const sceneM7: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [30, 32, 48], [70, 70, 95]);
  // Night street.
  cv.rect(x, y + h * 0.68, w, h * 0.32, [40, 40, 48]);
  cv.rect(x, y + h * 0.68, w, 2, [200, 200, 200], 0.3);
  // Police car with light bar.
  cv.rect(x + w * 0.1, y + h * 0.5, w * 0.5, h * 0.2, [20, 30, 60]);
  cv.poly(
    [
      [x + w * 0.18, y + h * 0.5],
      [x + w * 0.3, y + h * 0.36],
      [x + w * 0.46, y + h * 0.36],
      [x + w * 0.54, y + h * 0.5],
    ],
    [25, 38, 70],
  );
  cv.circle(x + w * 0.2, y + h * 0.7, h * 0.08, INK);
  cv.circle(x + w * 0.5, y + h * 0.7, h * 0.08, INK);
  cv.rect(x + w * 0.26, y + h * 0.3, w * 0.12, h * 0.07, RED);
  cv.rect(x + w * 0.4, y + h * 0.3, w * 0.12, h * 0.07, [40, 110, 230]);
  cv.circle(x + w * 0.32, y + h * 0.22, h * 0.09, RED, 0.55);
  cv.circle(x + w * 0.46, y + h * 0.22, h * 0.09, [40, 110, 230], 0.55);
  // Handcuffs, right side.
  cv.ring(x + w * 0.74, y + h * 0.4, h * 0.13, 3, [200, 200, 205]);
  cv.ring(x + w * 0.88, y + h * 0.52, h * 0.13, 3, [200, 200, 205]);
  cv.line(x + w * 0.78, y + h * 0.46, x + w * 0.84, y + h * 0.48, 2, [200, 200, 205]);
  cv.grain(x, y, w, h, rnd, 0.005);
};

const sceneM8: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [200, 170, 130], [120, 110, 100]);
  // Damaged building silhouettes.
  cv.rect(x + w * 0.06, y + h * 0.34, w * 0.24, h * 0.54, [70, 62, 54]);
  cv.poly(
    [
      [x + w * 0.06, y + h * 0.34],
      [x + w * 0.18, y + h * 0.22],
      [x + w * 0.3, y + h * 0.34],
    ],
    [70, 62, 54],
  );
  cv.rect(x + w * 0.4, y + h * 0.44, w * 0.22, h * 0.44, [90, 80, 70]);
  cv.rect(x + w * 0.7, y + h * 0.28, w * 0.24, h * 0.6, [58, 52, 46]);
  for (let i = 0; i < 3; i++) {
    cv.rect(x + w * (0.12 + i * 0.3), y + h * 0.52, w * 0.05, h * 0.08, [250, 220, 150], 0.8);
  }
  // Smoke columns + fire glow at the base.
  cv.circle(x + w * 0.2, y + h * 0.16, h * 0.12, [110, 105, 100], 0.85);
  cv.circle(x + w * 0.78, y + h * 0.12, h * 0.14, [100, 95, 90], 0.85);
  cv.circle(x + w * 0.3, y + h * 0.06, h * 0.09, [120, 115, 110], 0.7);
  cv.poly(
    [
      [x + w * 0.42, y + h * 0.88],
      [x + w * 0.5, y + h * 0.66],
      [x + w * 0.58, y + h * 0.88],
    ],
    [230, 120, 40],
  );
  cv.grain(x, y, w, h, rnd, 0.005);
};

const sceneM9: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [24, 48, 84], [52, 88, 140]);
  // Network nodes.
  const nodes: [number, number][] = [
    [0.16, 0.3],
    [0.38, 0.18],
    [0.62, 0.3],
    [0.84, 0.2],
    [0.28, 0.68],
    [0.72, 0.66],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [1, 4],
    [2, 5],
    [4, 5],
  ];
  for (const [a, b] of edges) {
    cv.line(x + w * nodes[a][0], y + h * nodes[a][1], x + w * nodes[b][0], y + h * nodes[b][1], 1, [140, 180, 220], 0.7);
  }
  for (const [nx, ny] of nodes) cv.circle(x + w * nx, y + h * ny, h * 0.05, [170, 205, 235]);
  // Shield with a check in the middle.
  cv.poly(
    [
      [x + w * 0.5, y + h * 0.3],
      [x + w * 0.66, y + h * 0.36],
      [x + w * 0.66, y + h * 0.58],
      [x + w * 0.5, y + h * 0.78],
      [x + w * 0.34, y + h * 0.58],
      [x + w * 0.34, y + h * 0.36],
    ],
    [250, 250, 250],
  );
  cv.line(x + w * 0.42, y + h * 0.56, x + w * 0.48, y + h * 0.64, 4, [30, 140, 80]);
  cv.line(x + w * 0.48, y + h * 0.64, x + w * 0.6, y + h * 0.44, 4, [30, 140, 80]);
  cv.grain(x, y, w, h, rnd, 0.005);
};

const sceneM10: SceneFn = (cv, x, y, w, h, rnd) => {
  sky(cv, x, y, w, h, [230, 200, 150], [250, 232, 200]);
  sunDisc(cv, x + w * 0.84, y + h * 0.2, h * 0.1, [240, 170, 70]);
  // Oil derrick silhouette.
  cv.poly(
    [
      [x + w * 0.2, y + h * 0.88],
      [x + w * 0.3, y + h * 0.18],
      [x + w * 0.38, y + h * 0.18],
      [x + w * 0.48, y + h * 0.88],
    ],
    [70, 60, 50],
  );
  cv.line(x + w * 0.24, y + h * 0.7, x + w * 0.44, y + h * 0.3, 2, [250, 232, 200]);
  cv.line(x + w * 0.44, y + h * 0.7, x + w * 0.24, y + h * 0.3, 2, [250, 232, 200]);
  cv.rect(x + w * 0.28, y + h * 0.12, w * 0.14, h * 0.07, [70, 60, 50]);
  // Barrel + falling red arrow.
  cv.rect(x + w * 0.6, y + h * 0.62, w * 0.2, h * 0.26, [40, 60, 90]);
  cv.rect(x + w * 0.6, y + h * 0.68, w * 0.2, 2, [90, 120, 150]);
  cv.rect(x + w * 0.6, y + h * 0.8, w * 0.2, 2, [90, 120, 150]);
  cv.line(x + w * 0.86, y + h * 0.2, x + w * 0.86, y + h * 0.72, 4, RED);
  cv.poly(
    [
      [x + w * 0.86, y + h * 0.78],
      [x + w * 0.78, y + h * 0.64],
      [x + w * 0.94, y + h * 0.64],
    ],
    RED,
  );
  cv.grain(x, y, w, h, rnd, 0.005);
};

// -------------------------------------------------------------------- data
// Numbers band: six numbers from six DIFFERENT stories. None of these six
// figures appears anywhere else on the page (M1 drops its +9%, M2 its
// 53.7, M3 its $3,645, M10 its $89.72, index 23 its 24).
const NUMBERS: { label: string; value: string }[] = [
  { label: 'NVIDIA', value: '+31%' },
  { label: 'TAIEX', value: '+9%' },
  { label: 'GOLD', value: '$3,645' },
  { label: 'JAPAN PMI', value: '53.7' },
  { label: 'BRENT', value: '$89.72' },
  { label: 'INDONESIA', value: '24 KILLED' },
];

const REGION_COLOR: Record<string, RGB> = {
  'NORTH AMERICA': [36, 86, 166],
  EUROPE: [124, 63, 152],
  'ASIA-PACIFIC': [217, 79, 4],
  'MIDDLE EAST': [14, 122, 95],
  AFRICA: [61, 139, 0],
  'LATIN AMERICA': [194, 24, 91],
  OCEANIA: [0, 119, 163],
};

interface Featured {
  n: number;
  region: string;
  headline: string;
  deck: string;
  source: string;
  scene: SceneFn;
}

const HEROES: Featured[] = [
  {
    n: 1,
    region: 'NORTH AMERICA',
    headline: 'Huang back; Wall St roars',
    deck: 'Nvidia reinstates Huang as CEO; shares jump.',
    source: 'NEW YORK — REUTERS',
    scene: sceneH1,
  },
  {
    n: 2,
    region: 'ASIA-PACIFIC',
    headline: 'Russian jet over Korea',
    deck: 'Seoul warns Ulleung after entry.',
    source: 'SEOUL — REUTERS',
    scene: sceneH2,
  },
  {
    n: 3,
    region: 'OCEANIA',
    headline: 'COP31 ends with no deal',
    deck: 'Blame game begins; EU rejects draft.',
    source: 'ANTALYA — AAP',
    scene: sceneH3,
  },
];

const MIDDLES: Featured[] = [
  { n: 4, region: 'ASIA-PACIFIC', headline: 'Asia rallies', deck: 'Taiex, Kospi lead', source: 'TAIPEI — REUTERS', scene: sceneM1 },
  { n: 5, region: 'ASIA-PACIFIC', headline: 'Factories grow', deck: 'Services cool', source: 'TOKYO — REUTERS', scene: sceneM2 },
  { n: 6, region: 'NORTH AMERICA', headline: 'Gold steadies', deck: 'after 14-month low', source: 'REUTERS', scene: sceneM3 },
  { n: 7, region: 'AFRICA', headline: 'Warship sunk off Libya', deck: 'Drones strike again', source: 'KYIV — REUTERS', scene: sceneM4 },
  { n: 8, region: 'MIDDLE EAST', headline: 'Iran vows to fight back', deck: 'as US blockade looms', source: 'TEHRAN — REUTERS', scene: sceneM5 },
  { n: 9, region: 'EUROPE', headline: 'NATO sends AWACS', deck: 'after missile landings', source: 'WARSAW — REUTERS', scene: sceneM6 },
  { n: 10, region: 'LATIN AMERICA', headline: 'Mexico nabs cartel boss', deck: "'Chapo Isidro' held", source: 'MEXICO CITY — REUTERS', scene: sceneM7 },
  { n: 11, region: 'MIDDLE EAST', headline: 'Gaza strikes kill three', deck: 'UNRWA worker dead', source: 'GAZA — REUTERS', scene: sceneM8 },
  { n: 12, region: 'NORTH AMERICA', headline: 'CrowdStrike buys Zscaler', deck: '$44bn cyber deal', source: 'REUTERS', scene: sceneM9 },
  { n: 13, region: 'NORTH AMERICA', headline: 'Brent slips below $90', deck: 'Iran-war gains fade', source: 'LONDON — REUTERS', scene: sceneM10 },
];

const INDEX: { n: number; region: string; headline: string }[] = [
  { n: 14, region: 'NORTH AMERICA', headline: 'FBI deputy to retire' },
  { n: 15, region: 'EUROPE', headline: 'Murmansk governor held' },
  { n: 16, region: 'ASIA-PACIFIC', headline: 'China spy sentenced' },
  { n: 17, region: 'ASIA-PACIFIC', headline: 'Education chief quits' },
  { n: 18, region: 'ASIA-PACIFIC', headline: 'Seoul set to lift rates' },
  { n: 19, region: 'EUROPE', headline: 'Berlin adopts Delta tool' },
  { n: 20, region: 'NORTH AMERICA', headline: 'Trump pauses detonation' },
  { n: 21, region: 'MIDDLE EAST', headline: 'US to train Syrian troops' },
  { n: 22, region: 'MIDDLE EAST', headline: 'Iran flogs singer, crew' },
  { n: 23, region: 'ASIA-PACIFIC', headline: 'Indonesia factory blaze' },
  { n: 24, region: 'EUROPE', headline: 'Concert cleared in scare' },
  { n: 25, region: 'NORTH AMERICA', headline: 'Houston tops AP Top 25' },
  { n: 26, region: 'NORTH AMERICA', headline: '49ers waive Aiyuk' },
  { n: 27, region: 'NORTH AMERICA', headline: 'Miley Cyrus weds' },
  { n: 28, region: 'NORTH AMERICA', headline: 'Probes pile up on Nvidia' },
  { n: 29, region: 'LATIN AMERICA', headline: 'Cobre talks resume' },
  { n: 30, region: 'OCEANIA', headline: 'Pacific goes it alone' },
  { n: 31, region: 'ASIA-PACIFIC', headline: 'China eases visas' },
  { n: 32, region: 'EUROPE', headline: 'Latvia shuns Russia ties' },
  { n: 33, region: 'AFRICA', headline: 'UN warns over Libya' },
  { n: 34, region: 'ASIA-PACIFIC', headline: 'Bangladesh pay rejected' },
  { n: 35, region: 'NORTH AMERICA', headline: 'UN urges AI pact' },
];

// Numbered pins for the 13 featured stories, in map-local coordinates.
const PINS: Record<number, [number, number]> = {
  1: [48, 26],
  2: [196, 30],
  3: [222, 100],
  4: [200, 26],
  5: [216, 22],
  6: [58, 28],
  7: [148, 64],
  8: [172, 44],
  9: [140, 26],
  10: [70, 80],
  11: [168, 52],
  12: [38, 40],
  13: [70, 44],
};

// ------------------------------------------------------------------- layout
function drawMap(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, NAVY);
  const land: RGB = [232, 222, 198];
  const continents: [number, number][][] = [
    [[18, 18], [60, 10], [88, 22], [80, 40], [55, 48], [40, 38], [22, 34]],
    [[92, 8], [102, 6], [104, 14], [94, 16]],
    [[58, 62], [78, 58], [86, 78], [74, 104], [62, 92]],
    [[128, 16], [148, 12], [156, 26], [140, 38], [128, 32]],
    [[130, 48], [158, 44], [166, 66], [152, 96], [138, 78]],
    [[158, 14], [225, 10], [240, 28], [220, 52], [190, 50], [168, 36]],
    [[205, 92], [232, 88], [238, 102], [214, 110]],
  ];
  for (const polyPts of continents) {
    const sx = w / 250;
    const sy = h / 128;
    cv.poly(
      polyPts.map(([px, py]) => [x + px * sx, y + py * sy] as [number, number]),
      land,
    );
  }
  // Dots for index stories 14-35, jittered deterministically by region.
  const rnd = mulberry32(20261124);
  const spots: Record<string, [number, number, number, number]> = {
    'NORTH AMERICA': [28, 80, 14, 46],
    EUROPE: [126, 156, 12, 40],
    'ASIA-PACIFIC': [160, 240, 12, 50],
    'MIDDLE EAST': [160, 180, 40, 56],
    AFRICA: [130, 165, 50, 95],
    'LATIN AMERICA': [55, 85, 60, 105],
    OCEANIA: [200, 240, 85, 112],
  };
  for (const item of INDEX) {
    const [x0, x1, y0, y1] = spots[item.region];
    const px = x + (x0 + rnd() * (x1 - x0)) * (w / 250);
    const py = y + (y0 + rnd() * (y1 - y0)) * (h / 128);
    cv.circle(px, py, 2, RED);
  }
  // Numbered pins for the 13 featured stories.
  for (const story of [...HEROES, ...MIDDLES]) {
    const [lx, ly] = PINS[story.n];
    const px = x + lx * (w / 250);
    const py = y + ly * (h / 128);
    cv.circle(px, py, 6.5, RED);
    cv.ring(px, py, 6.5, 1, WHITE, 0.9);
    drawText(cv, px, py - 3.5, String(story.n), 7, WHITE, { bold: true, align: 'center' });
  }
  drawText(cv, x + 6, y + h - 12, 'WHERE IT HAPPENED', 9, [200, 210, 225], { bold: true });
}

function main(): void {
  const total = HEROES.length + MIDDLES.length + INDEX.length;
  if (total !== 35) throw new Error(`story count ${total}, expected 35`);
  const regions = new Set([...HEROES, ...MIDDLES, ...INDEX].map((s) => s.region));
  if (regions.size !== 7) throw new Error(`region count ${regions.size}, expected 7`);

  const cv = new Canvas(W, H);
  cv.fill(CREAM);
  const MX = 28;
  const CW = W - MX * 2;
  const rnd = mulberry32(20261124);

  // Masthead: the date, giant, serif-bold, full width.
  const mast = fitBlock('masthead', 'Tuesday 24 November 2026', CW, 1, 66, 66, true);
  drawBlock(cv, MX, 10, mast.lines, mast.em, INK, { bold: true, align: 'center', lineH: 76 });
  const mastDeck = fitBlock(
    'masthead-deck',
    'Huang returns to Nvidia and Wall Street roars; a Russian jet rattles South Korea; COP31 ends with no deal.',
    CW,
    1,
    16,
    14,
  );
  drawBlock(cv, MX, 88, mastDeck.lines, mastDeck.em, INK_SOFT, { align: 'center', lineH: 20 });
  hrule(cv, MX, 110, CW, 2);

  // Numbers band: six numbers, six different stories.
  const cellW = CW / 6;
  NUMBERS.forEach((item, i) => {
    const cx = MX + i * cellW;
    if (i > 0) cv.rect(cx, 118, 1, 34, [180, 170, 150]);
    drawText(cv, cx + cellW / 2, 116, item.label, 12.5, INK_SOFT, { bold: true, align: 'center' });
    drawText(cv, cx + cellW / 2, 130, item.value, 27, RED_DARK, { bold: true, align: 'center' });
  });
  hrule(cv, MX, 160, CW, 2);

  // Heroes: tall scenes, headline as a caption BELOW the picture.
  const heroW = (CW - 32) / 3;
  const heroY = 168;
  const sceneH = 130;
  HEROES.forEach((story, i) => {
    const x = MX + i * (heroW + 16);
    const sceneRnd = mulberry32(20261124 + story.n * 7919);
    story.scene(cv, x, heroY, heroW, sceneH, sceneRnd);
    cv.rect(x, heroY, heroW, 2, INK, 0.6);
    cv.rect(x, heroY + sceneH - 2, heroW, 2, INK, 0.6);
    cv.rect(x, heroY, 2, sceneH, INK, 0.6);
    cv.rect(x + heroW - 2, heroY, 2, sceneH, INK, 0.6);
    drawChip(cv, x, heroY, `${story.n} · ${story.region}`, 11, RED, WHITE);
    const head = fitBlock(`hero-${story.n}-headline`, story.headline, heroW, 2, 36, 36, true);
    let yy = drawBlock(cv, x, heroY + sceneH + 8, head.lines, head.em, INK, { bold: true, lineH: 42 });
    const deck = fitBlock(`hero-${story.n}-deck`, story.deck, heroW, 2, 17, 14);
    yy = drawBlock(cv, x, yy + 4, deck.lines, deck.em, INK_SOFT, { lineH: 20 });
    drawText(cv, x, yy + 4, story.source, 12, REGION_COLOR[story.region], { bold: true });
  });
  hrule(cv, MX, 456, CW, 2);

  // Middle grid: 2 rows x 5 columns of square-ish scenes, captions below.
  const midW = (CW - 4 * 12) / 5;
  const midSceneH = 76;
  const rowY = [466, 644];
  MIDDLES.forEach((story, i) => {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const x = MX + col * (midW + 12);
    const y = rowY[row];
    const sceneRnd = mulberry32(20261124 + story.n * 7919);
    story.scene(cv, x, y, midW, midSceneH, sceneRnd);
    cv.rect(x, y, midW, 2, INK, 0.6);
    cv.rect(x, y + midSceneH - 2, midW, 2, INK, 0.6);
    cv.rect(x, y, 2, midSceneH, INK, 0.6);
    cv.rect(x + midW - 2, y, 2, midSceneH, INK, 0.6);
    drawChip(cv, x, y, story.region, 10, REGION_COLOR[story.region], WHITE);
    const head = fitBlock(`mid-${story.n}-headline`, story.headline, midW, 2, 23, 23, true);
    let yy = drawBlock(cv, x, y + midSceneH + 6, head.lines, head.em, INK, { bold: true, lineH: 27 });
    const deck = fitBlock(`mid-${story.n}-deck`, story.deck, midW, 1, 15, 12);
    yy = drawBlock(cv, x, yy + 3, deck.lines, deck.em, INK_SOFT, { lineH: 18 });
    drawText(cv, x, yy + 2, story.source, 11.5, REGION_COLOR[story.region], { bold: true });
  });
  hrule(cv, MX, 828, CW, 2);

  // Bottom band: numbered world map + the full 22-item index in 3 columns.
  drawText(cv, MX, 836, 'WHERE IT HAPPENED — ALL 35 STORIES, NUMBERED', 13, INK, { bold: true });
  drawMap(cv, MX, 856, 250, 120);
  const idxX = MX + 264;
  const idxW = (W - MX - idxX) / 3;
  const perCol = Math.ceil(INDEX.length / 3);
  INDEX.forEach((item, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const x = idxX + col * idxW;
    const y = 856 + row * 16;
    const head = fitBlock(`idx-${item.n}`, item.headline, idxW - 24, 1, 15, 14.5);
    drawText(cv, x, y, String(item.n), 14.5, RED, { bold: true });
    drawBlock(cv, x + 22, y, head.lines, head.em, INK, { lineH: 16 });
  });

  // Footer: one-line date check with LEFT OUT, then the sources.
  const check = fitBlock(
    'date-check',
    'DATE CHECK: All 35 stories are from Tuesday, 24 November 2026. LEFT OUT: weekend sport, Monday\'s market close.',
    CW,
    1,
    13.5,
    12,
    true,
  );
  drawBlock(cv, MX, 986, check.lines, check.em, INK, { bold: true, align: 'center', lineH: 16 });
  drawText(cv, MX + CW / 2, 1006, 'Sources: Reuters · AAP · Greenpeace · MarketIndex · TBS', 10.5, INK_SOFT, { align: 'center' });

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const png = encodePNG(W, H, cv.buf);
  writeFileSync(join(outDir, 'entry.png'), png);

  const overflows = FIT.filter((f) => f.overflow);
  console.log(
    'FIT-REPORT ' +
      JSON.stringify({
        stories: total,
        scenes: HEROES.length + MIDDLES.length,
        regions: [...regions].sort(),
        blocks: FIT.length,
        overflows: overflows.map((f) => f.id),
        overflowCount: overflows.length,
        pngBytes: png.length,
        records: FIT,
      }),
  );
}

main();
