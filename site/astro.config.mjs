// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://www.gifcompressors.com',
  trailingSlash: 'always',
  build: {
    // 内联共享样式表，消除首屏阻塞的外部 CSS 请求（Tailwind 全局 CSS 直接进 <head>）
    inlineStylesheets: 'always',
  },
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()]
  }
});
