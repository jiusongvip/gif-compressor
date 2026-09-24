import fs from 'node:fs';
import { compressGif } from './src/pipeline.js';
import { GifReader } from 'omggif';

const input = fs.readFileSync('../site/public/demo/demo-original.gif');
console.log(`input: ${input.length} bytes`);

for (const opt of [{}, { mode: 'quality' }, { mode: 'maximum' }, { target_kb: 30 }, { max_width: 240 }, { target_kb: 10 }]) {
  const t0 = Date.now();
  const r = compressGif(new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)), opt);
  // validate output decodes back
  const chk = new GifReader(r.bytes);
  console.log(JSON.stringify(opt), `→ ${r.original} → ${r.bytes.length} B (${Math.round((1 - r.bytes.length / r.original) * 100)}% smaller)`,
    `| ${r.frames}f ${r.width}x${r.height} colors=${r.colors} | ${Date.now() - t0}ms | re-decode ok: ${chk.numFrames()}f ${chk.width}x${chk.height}`);
  fs.writeFileSync(`out-${JSON.stringify(opt).replace(/[{}":, ]/g, '') || 'default'}.gif`, r.bytes);
}
