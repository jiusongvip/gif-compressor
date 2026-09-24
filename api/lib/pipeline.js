// Pure-JS animated GIF compression pipeline (same code as worker/src/pipeline.js,
// which targets a future Cloudflare Workers paid deploy — keep both in sync if the
// Worker path is ever activated).
// Decode (omggif) → composite full frames incl. disposal → optional resize →
// re-encode (gifenc) with per-frame quantized palettes and transparent-pixel
// frame differencing. No native binaries, runs entirely in the function runtime.
import { GifReader } from 'omggif';
import { GIFEncoder, quantize, applyPalette } from 'gifenc/dist/gifenc.esm.js';

const MODE_COLORS = { quality: 128, balanced: 64, maximum: 32 };

function composeFrames(reader) {
  const W = reader.width;
  const H = reader.height;
  const canvas = new Uint8ClampedArray(W * H * 4);
  const out = [];
  for (let i = 0; i < reader.numFrames(); i++) {
    const info = reader.frameInfo(i);
    const before = info.disposal === 3 ? canvas.slice() : null;
    reader.decodeAndBlitFrameRGBA(i, canvas);
    out.push({ rgba: canvas.slice(), delay: info.delay * 10 });
    if (info.disposal === 2) {
      for (let y = info.y; y < info.y + info.height; y++) {
        canvas.fill(0, (y * W + info.x) * 4, (y * W + info.x + info.width) * 4);
      }
    } else if (info.disposal === 3) {
      canvas.set(before);
    }
  }
  return out;
}

function nearestResize(rgba, w, h, nw, nh) {
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / nh));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / nw));
      out.set(rgba.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * nw + x) * 4);
    }
  }
  return out;
}

function encode(frames, W, H, maxColors) {
  const enc = GIFEncoder();
  let prev = null;
  for (let i = 0; i < frames.length; i++) {
    const cur = frames[i].rgba;
    // Bounding box of pixels that differ from the previously displayed frame.
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    if (prev) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = (y * W + x) * 4;
          if (cur[p] !== prev[p] || cur[p + 1] !== prev[p + 1] || cur[p + 2] !== prev[p + 2] || cur[p + 3] !== prev[p + 3]) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < x0) { x0 = y0 = 0; x1 = W - 1; y1 = H - 1; } // identical frame: rewrite all, it diffs to full transparency cheaply
    } else {
      x0 = y0 = 0; x1 = W - 1; y1 = H - 1;
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;

    // Quantize the bbox region; reserve the final palette slot for transparency.
    const sub = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) {
      sub.set(cur.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + bw) * 4), y * bw * 4);
    }
    const colors = Math.min(maxColors, 255);
    const palette = quantize(sub, colors).map(([r, g, b]) => [r, g, b]);
    const transIndex = palette.length; // next slot is the transparent swatch
    palette.push([0, 0, 0, 0]);
    const index = applyPalette(sub, palette);
    if (prev) {
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const q = (y * bw + x) * 4;
          const gp = ((y0 + y) * W + (x0 + x)) * 4;
          const unchanged = cur[gp] === prev[gp] && cur[gp + 1] === prev[gp + 1] && cur[gp + 2] === prev[gp + 2] && cur[gp + 3] === prev[gp + 3];
          if (unchanged || sub[q + 3] === 0) index[y * bw + x] = transIndex;
        }
      }
    } else {
      for (let k = 0; k < sub.length; k += 4) if (sub[k + 3] === 0) index[k / 4] = transIndex;
    }
    enc.writeFrame(index, bw, bh, {
      palette, x: x0, y: y0,
      delay: frames[i].delay,
      transparent: true, transparentIndex: transIndex,
      dispose: i === 0 ? 1 : 1,
      colorDepth: 8, first: i === 0, repeat: 0,
    });
    prev = cur;
  }
  enc.finish();
  return enc.bytes();
}

export function compressGif(bytes, { mode = 'balanced', target_kb, max_width } = {}) {
  const reader = new GifReader(bytes);
  let W = reader.width;
  let H = reader.height;
  const totalPixels = W * H * reader.numFrames();
  if (!W || !H) throw new Error('Not a readable GIF.');
  if (totalPixels > 60_000_000) throw new Error(`Animation too large for processing (${totalPixels} pixel-frames; cap 60M). Try resizing below ${max_width || W}px width or fewer frames.`);

  let frames = composeFrames(reader);
  if (max_width && max_width < W) {
    const nw = Math.max(2, Math.round(max_width));
    const nh = Math.max(2, Math.round((H * nw) / W));
    frames = frames.map((f) => ({ ...f, rgba: nearestResize(f.rgba, W, H, nw, nh) }));
    W = nw; H = nh;
  }

  let maxColors = MODE_COLORS[mode] || MODE_COLORS.balanced;
  let out = encode(frames, W, H, maxColors);
  const meta = { frames: frames.length, width: W, height: H, colors: maxColors };
  if (target_kb) {
    let budget = target_kb * 1024;
    for (let i = 0; i < 5 && out.length > budget && maxColors > 8; i++) {
      maxColors = Math.max(8, Math.floor(maxColors / 2));
      meta.colors = maxColors;
      out = encode(frames, W, H, maxColors);
    }
  }
  return { bytes: out, original: bytes.length, ...meta };
}
