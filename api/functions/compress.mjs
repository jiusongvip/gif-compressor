import { handle } from '../lib/server.js';

// Netlify Web-standard handler. Reachable as POST /v1/compress via the
// pretty-URL rewrite in netlify.toml, or directly at
// /.netlify/functions/compress for smoke tests.
export default (req) => handle(req, '/v1/compress');
