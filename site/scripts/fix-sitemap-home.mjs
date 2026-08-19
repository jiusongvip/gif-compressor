// 构建后处理：sitemap 首页根域名去掉尾斜杠（规范：首页 canonical/sitemap 均不带尾斜杠）
// @astrojs/sitemap 的 serialize 钩子无法去除根路径尾斜杠，需构建后替换
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

let fixed = 0;
for (const file of fs.readdirSync(distDir)) {
  if (!/^sitemap-\d+\.xml$/.test(file)) continue;
  const p = path.join(distDir, file);
  let xml = fs.readFileSync(p, 'utf8');
  // 仅首页根路径：<loc>https://www.xxx.com/</loc> → <loc>https://www.xxx.com</loc>
  const newXml = xml.replace(/(<loc>(https?:\/\/[^/]+)\/<\/loc>)/g, (_m, _full, domain) => {
    fixed++;
    return `<loc>${domain}</loc>`;
  });
  if (newXml !== xml) {
    fs.writeFileSync(p, newXml);
    console.log(`fix-sitemap-home: ${file} — 首页根路径去尾斜杠 ×${fixed}`);
  }
}
if (fixed === 0) console.log('fix-sitemap-home: 未发现首页根路径 URL（或已处理）');
