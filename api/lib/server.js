// gifcompressors API — request handling shared by the Netlify function endpoints.
// POST /v1/compress with a GIF, get a compressed GIF back. Files are processed
// in memory and never written to disk or logs. Web-standard Request/Response,
// also usable verbatim behind the Cloudflare Worker in worker/.
import { compressGif } from './pipeline.js';

const MAX_BYTES = 25 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const buckets = new Map();

function clientIp(request) {
  return (
    request.headers.get('X-Nf-Client-Connection-Ip') ||
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    'unknown'
  );
}

function rateLimited(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.t0 > RATE_WINDOW_MS) b = { t0: now, n: 0 };
  b.n += 1;
  buckets.set(ip, b);
  if (buckets.size > 50_000) buckets.clear();
  return b.n > RATE_MAX;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra },
  });

export const META = {
  name: 'gifcompressors API',
  version: 'v1',
  docs: 'https://www.gifcompressors.com/api/',
  endpoints: { 'POST /v1/compress': 'multipart field "file" (or raw body) + mode|target_kb|max_width → compressed GIF', 'GET /openapi.json': 'OpenAPI 3.1 spec' },
  note: 'Files are processed in memory and never stored.',
};

export async function handleCompress(request) {
  const ip = clientIp(request);
  if (rateLimited(ip)) return json({ error: 'rate_limited', message: `Up to ${RATE_MAX} requests per minute per IP. The free browser tools at https://www.gifcompressors.com/compress-gif/ have no limits.` }, 429);

  let bytes = null;
  const params = {};
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (file instanceof File) bytes = new Uint8Array(await file.arrayBuffer());
    for (const k of ['mode', 'target_kb', 'max_width']) {
      const v = form.get(k);
      if (v != null) params[k] = v;
    }
  } else {
    bytes = new Uint8Array(await request.arrayBuffer());
    const u = new URL(request.url);
    for (const k of ['mode', 'target_kb', 'max_width']) {
      const v = u.searchParams.get(k);
      if (v != null) params[k] = v;
    }
  }
  if (!bytes || !bytes.length) return json({ error: 'no_file', message: 'Send the GIF as multipart field "file", or as the raw request body.' }, 400);
  if (bytes.length > MAX_BYTES) return json({ error: 'too_large', message: `Files up to ${MAX_BYTES / 1048576} MB per request are supported.` }, 413);

  const opts = { mode: 'balanced' };
  if (params.mode) opts.mode = String(params.mode);
  if (!['quality', 'balanced', 'maximum'].includes(opts.mode)) return json({ error: 'bad_mode', message: 'mode must be quality, balanced, or maximum.' }, 400);
  if (params.target_kb) opts.target_kb = Math.round(Number(params.target_kb));
  if (params.max_width) opts.max_width = Math.round(Number(params.max_width));

  let result;
  try {
    result = compressGif(bytes, opts);
  } catch (e) {
    return json({ error: 'compression_failed', message: String(e?.message || e) }, 422);
  }

  const targetMet = opts.target_kb ? result.bytes.length <= opts.target_kb * 1024 : undefined;
  return new Response(result.bytes, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store',
      'X-Original-Bytes': String(result.original),
      'X-Compressed-Bytes': String(result.bytes.length),
      'X-Reduction-Percent': String(Math.round((1 - result.bytes.length / result.original) * 100)),
      'X-Gif-Frames': String(result.frames),
      'X-Gif-Colors': String(result.colors),
      ...(targetMet !== undefined ? { 'X-Target-Met': String(targetMet) } : {}),
      ...CORS,
    },
  });
}

// pathOverride: Netlify rewrites /v1/compress → /.netlify/functions/compress, so the
// function tells us which public path to treat the request as.
export async function handle(request, pathOverride) {
  const { pathname } = new URL(request.url);
  const path = pathOverride || pathname;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method === 'GET' && path === '/') return json(META);
  if (request.method === 'POST' && path === '/v1/compress') return handleCompress(request);
  return json({ error: 'not_found' }, 404);
}
