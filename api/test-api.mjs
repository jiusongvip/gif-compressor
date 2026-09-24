// Local smoke test for the Netlify function handlers — imports the same code path
// Netlify runs and drives it with Web-standard Requests.
import fs from 'node:fs';
import { handle } from './lib/server.js';

const demo = fs.readFileSync('../site/public/demo/demo-original.gif');
const demoBytes = demo.buffer.slice(demo.byteOffset, demo.byteOffset + demo.byteLength);

function post(body, url, headers = {}) {
  return new Request(url, { method: 'POST', headers, body });
}

async function show(label, res) {
  const h = res.headers;
  let extra = '';
  if (res.status === 200 && h.get('Content-Type') === 'image/gif') {
    const buf = new Uint8Array(await res.arrayBuffer());
    extra = `| ${buf.length} B, re-decoded from body`;
  } else if (res.status !== 200 || !h.get('Content-Type')?.startsWith('image/')) {
    const text = await res.text();
    extra = `| ${text.slice(0, 120).replace(/\s+/g, ' ')}`;
  }
  console.log(
    `${label.padEnd(38)} ${res.status}`,
    h.get('X-Original-Bytes') ? `orig=${h.get('X-Original-Bytes')} out=${h.get('X-Compressed-Bytes')} red=${h.get('X-Reduction-Percent')}% targetMet=${h.get('X-Target-Met')}` : '',
    extra
  );
}

// 1. GET / metadata
await show('GET /', await handle(new Request('https://api.example.com/'), '/'));

// 2. raw body, default mode
await show('POST raw body (balanced)', await handle(
  post(demoBytes.slice(0), 'https://api.example.com/v1/compress', { 'Content-Type': 'application/octet-stream' }), '/v1/compress'));

// 3. raw body + query params
await show('POST raw + max_width=240', await handle(
  post(demoBytes.slice(0), 'https://api.example.com/v1/compress?mode=maximum&max_width=240', { 'Content-Type': 'application/octet-stream' }), '/v1/compress'));

// 4. multipart with target_kb
{
  const fd = new FormData();
  fd.append('file', new File([demoBytes.slice(0)], 'demo.gif', { type: 'image/gif' }));
  fd.append('mode', 'balanced');
  fd.append('target_kb', '30');
  await show('POST multipart target_kb=30', await handle(new Request('https://api.example.com/v1/compress', { method: 'POST', body: fd }), '/v1/compress'));
}

// 5. bad GIF → 422
await show('POST garbage bytes', await handle(
  post(new Uint8Array([1, 2, 3, 4, 5]), 'https://api.example.com/v1/compress', { 'Content-Type': 'application/octet-stream' }), '/v1/compress'));

// 6. empty body → 400
await show('POST empty body', await handle(
  post(new Uint8Array(0), 'https://api.example.com/v1/compress', { 'Content-Type': 'application/octet-stream' }), '/v1/compress'));

// 7. oversize → 413 (25MB+1 random)
await show('POST 25MB+1', await handle(
  post(new Uint8Array(25 * 1024 * 1024 + 1), 'https://api.example.com/v1/compress', { 'Content-Type': 'application/octet-stream' }), '/v1/compress'));

// 8. bad mode → 400
await show('POST mode=sideways', await handle(
  post(demoBytes.slice(0), 'https://api.example.com/v1/compress?mode=sideways', { 'Content-Type': 'application/octet-stream' }), '/v1/compress'));

// 9. OPTIONS preflight
await show('OPTIONS /v1/compress', await handle(new Request('https://api.example.com/v1/compress', { method: 'OPTIONS' }), '/v1/compress'));

// 10. unknown path
await show('GET /nope', await handle(new Request('https://api.example.com/nope'), '/nope'));

// 11. rate limit: same IP bucket already consumed by tests 2-8 above (7 compress
// requests + others). Fire 6 more to cross the 12/min threshold.
for (let i = 0; i < 6; i++) {
  var res = await handle(post(demoBytes.slice(0), 'https://api.example.com/v1/compress', { 'Content-Type': 'application/octet-stream' }), '/v1/compress');
}
await show('13th request same IP', res);
