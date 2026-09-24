import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { copyFileSync, statSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

// Optional argv[2]: server entry to test (e.g. ../site/public/mcp/gifcompressors-mcp.mjs).
const serverEntry = path.resolve(process.argv[2] || 'index.js');

const tmp = path.resolve('test-tmp.gif');
copyFileSync('../site/public/demo/demo-original.gif', tmp);

const client = new Client({ name: 'smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...getDefaultEnvironment(), ...(process.env.GIFSICLE_PATH ? { GIFSICLE_PATH: process.env.GIFSICLE_PATH } : {}) },
});
await client.connect(transport);

console.log('server info:', JSON.stringify(client.getServerVersion()));

const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));

const call = async (name, args) => {
  try {
    const r = await client.callTool({ name, arguments: args });
    console.log(`\n[${name}]${r.isError ? ' ERROR' : ''} ${r.content[0].text.slice(0, 300)}`);
    return r;
  } catch (e) {
    console.log(`\n[${name}] THREW: ${e.message.slice(0, 200)}`);
  }
};

await call('get_recommendations', { file_path: tmp });
await call('compress_gif', { file_path: tmp, mode: 'balanced' });
const outC = tmp.replace('.gif', '-compressed.gif');
console.log('compressed size:', existsSync(outC) ? statSync(outC).size : 'N/A', 'bytes');
await call('compress_gif', { file_path: tmp, mode: 'quality', target_kb: 30 });
console.log('target 30KB run:', existsSync(outC) ? statSync(outC).size : 'N/A', 'bytes');
await call('resize_gif', { file_path: tmp, width_px: 240 });
await call('resize_gif', { file_path: tmp, scale_pct: 50 });
await call('convert_gif', { file_path: tmp, format: 'mp4' });
await call('convert_gif', { file_path: tmp, format: 'webp' });
await call('compress_gif', { file_path: 'C:/nope.gif' });

client.close();
rmSync(tmp, { force: true });
for (const s of ['-compressed.gif', '-resized.gif', '.mp4', '.webp']) rmSync(tmp.replace('.gif', s), { force: true });
console.log('\nsmoke test done');
