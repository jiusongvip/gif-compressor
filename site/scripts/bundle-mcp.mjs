// Build-time task: bundle the MCP server into one dependency-free ESM file and
// host it at /mcp/gifcompressors-mcp.mjs so agents can install without npm.
// Run from site/ as part of `npm run build`.
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';

const version = JSON.parse(readFileSync('../mcp-server/package.json', 'utf8')).version;

mkdirSync('public/mcp', { recursive: true });
await build({
  entryPoints: ['../mcp-server/index.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  // The gifsicle npm package resolves a platform binary at install time and must
  // stay a runtime-optional dynamic import, never inlined.
  external: ['gifsicle'],
  legalComments: 'none',
  outfile: 'public/mcp/gifcompressors-mcp.mjs',
  banner: {
    js: `// gifcompressors MCP server v${version} — single-file build, Node >= 18.\n// Engine: gifsicle (npm package if installed, otherwise a gifsicle on PATH or GIFSICLE_PATH env).\n// Install guide: https://www.gifcompressors.com/mcp/\n// Source: https://github.com/jiusongvip/gif-compressor/tree/master/mcp-server`,
  },
});
console.log('bundle-mcp: public/mcp/gifcompressors-mcp.mjs written');
