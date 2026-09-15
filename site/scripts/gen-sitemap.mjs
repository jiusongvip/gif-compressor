// 构建后生成规范的 /sitemap.xml（扁平 <urlset>），把 dist 内所有 sitemap-<n>.xml 的 <url> 合并。
// @astrojs/sitemap 默认只产出 sitemap-index.xml + sitemap-0.xml，缺少搜索引擎/SEO 工具约定的 /sitemap.xml 文件。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const chunkFiles = fs
  .readdirSync(distDir)
  .filter((f) => /^sitemap-\d+\.xml$/.test(f))
  .sort();

if (chunkFiles.length === 0) {
  console.error('gen-sitemap: 未找到 sitemap-<n>.xml，跳过。');
  process.exit(1);
}

// 收集所有 <url>...</url> 块（含 <loc>/<lastmod>/<xhtml:link> 等子元素）
const urlBlocks = [];
for (const f of chunkFiles) {
  const xml = fs.readFileSync(path.join(distDir, f), 'utf8');
  for (const m of xml.matchAll(/<url>[\s\S]*?<\/url>/g)) urlBlocks.push(m[0]);
}

// 去重（按 <loc>）
const seen = new Set();
const unique = [];
for (const b of urlBlocks) {
  const loc = (b.match(/<loc>([^<]+)<\/loc>/) || [])[1];
  if (!loc || seen.has(loc)) continue;
  seen.add(loc);
  unique.push(b);
}

const out =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
  'xmlns:xhtml="http://www.w3.org/1999/xhtml">' +
  unique.join('') +
  '</urlset>';

fs.writeFileSync(path.join(distDir, 'sitemap.xml'), out, 'utf8');
console.log(`gen-sitemap: 生成 dist/sitemap.xml（${unique.length} 条 URL，来自 ${chunkFiles.join(', ')}）`);
