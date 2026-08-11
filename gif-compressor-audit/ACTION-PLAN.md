<!--
  GIF Compress — Prioritized SEO Action Plan
  Date: 2026-08-11
  Target: Pre-launch fixes to get from SEO Health Score 41 → 85+
-->

# GIF Compress — SEO Action Plan

## Phase 1: Critical Fixes (Before Launch — Day 1)

**Goal:** Fix everything that would actively harm rankings or prevent indexing.

### 1.1 Fix Canonical URLs
**Effort:** 2 minutes · **Impact:** Fixes all 17 pages

Set `site` in `astro.config.mjs`. This feeds `Astro.url.href`, which drives every canonical URL on the site.

```js
// astro.config.mjs
export default defineConfig({
  site: 'https://gifcompressor.com',  // ← add your production domain
  vite: { plugins: [tailwindcss()] }
});
```

### 1.2 Add robots.txt
**Effort:** 5 minutes · **Impact:** Crawl directives

Place in `public/` so Astro copies it to `dist/`:

```
User-agent: *
Allow: /
Sitemap: https://gifcompressor.com/sitemap-index.xml
```

### 1.3 Install and Configure @astrojs/sitemap
**Effort:** 10 minutes · **Impact:** Google Discovery

```bash
npx astro add sitemap
```

Then add to `astro.config.mjs`:

```js
import sitemap from '@astrojs/sitemap';
export default defineConfig({
  site: 'https://gifcompressor.com',
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] }
});
```

### 1.4 Add WebApplication Schema to Homepage
**Effort:** 15 minutes · **Impact:** Tool categorization, rich results eligibility

Add JSON-LD to `src/pages/index.astro` (pass as `schema` prop or inline):

```json
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "GIF Compress",
  "url": "https://gifcompressor.com",
  "description": "Free online GIF compressor — reduce animated GIF file size by up to 70% without quality loss. Works in your browser, no upload needed.",
  "applicationCategory": "Multimedia",
  "operatingSystem": "Any",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "featureList": ["100% private", "No upload", "Instant preview", "Batch processing"]
}
```

Also add `Organization` schema on the homepage for brand entity signals:

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "GIF Compress",
  "url": "https://gifcompressor.com",
  "description": "Free online GIF compression tool — reduce animated GIF file size without quality loss."
}
```

### 1.5 Generate OG Default Image
**Effort:** 10 minutes · **Impact:** Social sharing, all 17 pages

Create a 1200x630 PNG with the brand logo/tool name. Drop it at `public/og-default.png`. Options:
- Use the `seo-image-gen` skill to generate one
- Design in Figma/Canva: blue (#2563EB) background, white "GIF Compress" text, "Free Online GIF Compressor" subtitle

### 1.6 Fix Title Separator Encoding
**Effort:** 5 minutes · **Impact:** SERP display on 8 pages

Replace raw unicode em dash (`\u2014`) with `&mdash;` in all page frontmatter titles. The affected pages are:
- `gif-optimizer.astro`
- `reduce-gif-size.astro`
- `faq.astro`
- All 5 blog posts

### 1.7 Fix Empty Image src Attributes
**Effort:** 15 minutes · **Impact:** Removes wasted browser requests on 8 pages

In `GifTool.astro` and other tool components, change `<img src="" alt="Original GIF">` to `<img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" alt="Original GIF">` (1x1 transparent GIF placeholder) or use CSS `background` instead.

---

## Phase 2: High-Impact Improvements (Week 1)

**Goal:** Significant ranking and visibility gains.

### 2.1 Add WebApplication Schema to All Tool Pages
**Effort:** 20 minutes · **Impact:** 8 tool pages get rich result eligibility

Each tool page should add `WebApplication` JSON-LD unique to that tool:

| Page | schema name | schema description |
|------|------------|-------------------|
| `/compress-gif/` | GIF Compressor | Reduce animated GIF file size online free |
| `/gif-optimizer/` | GIF Optimizer | Advanced GIF compression with per-parameter control |
| `/reduce-gif-size/` | GIF Size Reducer | Shrink GIF file size for Discord, Twitter, email |
| `/gif-to-mp4/` | GIF to MP4 Converter | Convert animated GIF to MP4 video online free |
| `/gif-to-webp/` | GIF to WebP Converter | Convert animated GIF to WebP format, 60-90% smaller |
| `/resize-gif/` | GIF Resizer | Change GIF dimensions online free |
| `/crop-gif/` | GIF Cropper | Trim and crop animated GIFs online free |

### 2.2 Add Article Schema to Blog Posts
**Effort:** 15 minutes · **Impact:** 5 blog posts become eligible for article carousels

In the blog layout template, add:
```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "{{title}}",
  "datePublished": "{{date}}",
  "dateModified": "{{date}}",
  "author": { "@type": "Organization", "name": "GIF Compress" }
}
```

### 2.3 Add HowTo Schema on "How to Compress a GIF" Sections
**Effort:** 15 minutes · **Impact:** HowTo rich results on compress-gif page

The "How to Compress a GIF" section on `/compress-gif/` is a textbook HowTo rich result candidate. Add `HowTo` + `HowToStep` JSON-LD.

### 2.4 Fix Footer Heading Hierarchy
**Effort:** 10 minutes · **Impact:** Fixes broken document outline on all 17 pages

In `Footer.astro`, change `<h4>` to `<span>` with the same CSS styling:
```astro
<!-- Before -->
<h4 class="text-sm font-semibold text-slate-950">Tools</h4>

<!-- After -->
<span class="text-sm font-semibold text-slate-950">Tools</span>
```

### 2.5 Bulge Thin Content Pages
**Effort:** 1-2 hours · **Impact:** 4 pages move from "thin content" to adequate

| Page | Current | Target | What to Add |
|------|---------|--------|-------------|
| Terms of Service | 265 words | 600+ words | Service description, user obligations, intellectual property, disclaimers, governing law, contact info |
| Privacy Policy | 358 words | 800+ words | Data collection (none), cookies, third parties, children's privacy, GDPR/CCPA rights, retention, changes |
| Blog Index | 287 words | 500+ words | Add an intro paragraph (~150 words) describing the blog's purpose, key topics covered, and audience |
| GIF to MP4 | 297 words | 600+ words | Add "When NOT to use MP4" section, technical comparison table (GIF vs MP4 file sizes, quality, browser support) |

---

## Phase 3: Content & Authority (Weeks 2-3)

**Goal:** Build topical authority and target long-tail keywords.

### 3.1 Complete and Ship the 6 Landing Pages
**Effort:** Half-day each · **Impact:** 6 new pages targeting high-intent queries

These pages in `src/pages/` are in progress but not in `dist/`:

| Page | Target Query | Monthly Search Volume (est.) |
|------|-------------|------------------------------|
| compress-gif-for-discord | "compress GIF for discord" | ~8,000 |
| compress-gif-for-twitter | "compress GIF for twitter" | ~3,000 |
| compress-gif-for-email | "compress GIF for email" | ~5,000 |
| compress-gif-to-256kb | "compress GIF to 256kb" | ~2,500 |
| compress-gif-under-1mb | "compress GIF under 1mb" | ~4,000 |
| compress-gif-under-8mb | "compress GIF under 8mb" | ~1,500 |

These target the same tool functionality but with query-specific URL slugs — a strong programmatic SEO play.

### 3.2 Publish "Optimize GIFs for Core Web Vitals" Blog Post
**Effort:** 30 minutes · **Impact:** 1 additional high-quality blog post

The markdown file exists at `src/content/blog/optimize-gifs-core-web-vitals.md`. It just needs to be included in the build. This targets the intersection of web performance and GIF optimization — a strong topical linkage.

### 3.3 Add Internal Linking Between Tool Pages
**Effort:** 30 minutes · **Impact:** Better crawl discovery, stronger topical clusters

Currently, tool pages don't cross-reference each other beyond the footer. Add contextual links:
- Compress GIF → "Need more control? Try our [GIF Optimizer](/gif-optimizer/)"
- GIF to MP4 → "Or convert to [WebP](/gif-to-webp/) for 60-90% size reduction with animation support"
- Reduce GIF Size → "For specific platforms, see our [Discord](/compress-gif-for-discord/) and [Twitter](/compress-gif-for-twitter/) guides"

### 3.4 Create llms.txt
**Effort:** 10 minutes · **Impact:** AI citation rates

Place at `public/llms.txt`:

```
# GIF Compress
> Free online GIF compression tools — processed in your browser, nothing uploaded.

## Tools
- GIF Compressor: https://gifcompressor.com/compress-gif/ — Reduce GIF size online
- GIF Optimizer: https://gifcompressor.com/gif-optimizer/ — Advanced compression parameters
- GIF to MP4: https://gifcompressor.com/gif-to-mp4/ — Convert GIF to video
- GIF to WebP: https://gifcompressor.com/gif-to-webp/ — Convert to modern format
- Resize GIF: https://gifcompressor.com/resize-gif/ — Change dimensions
- Crop GIF: https://gifcompressor.com/crop-gif/ — Trim edges

## Guides
- How GIF Compression Works: https://gifcompressor.com/blog/how-gif-compression-works/
...
```

---

## Phase 4: Monitoring & Iteration (Ongoing)

### 4.1 Set Up Google Search Console
Verify domain ownership and submit the sitemap immediately after deployment. Monitor:
- Index coverage (watch for localhost URLs in the index — validate the canonical fix worked)
- Search performance (impressions, clicks, CTR by query)
- Core Web Vitals report

### 4.2 Set Up Bing Webmaster Tools
Submit via IndexNow for instant Bing indexing. Microsoft Copilot citations feed from the Bing index.

### 4.3 Performance Monitoring
After deployment, run:
- Lighthouse CI on every deploy to catch CWV regressions
- Real-user monitoring (RUM) for LCP/INP/CLS field data
- Monitor third-party script impact (Google Fonts is currently the only external dependency)

### 4.4 Content Refresh Cadence
- Blog: publish 1-2 new posts per month targeting adjacent GIF keywords
- Tool pages: refresh content quarterly based on SERP feature changes
- FAQ: expand based on GSC "People also ask" data

---

## Quick Reference: File Changes

| File | Action |
|------|--------|
| `astro.config.mjs` | Add `site` and `@astrojs/sitemap` integration |
| `public/robots.txt` | NEW — create with Allow + Sitemap directive |
| `public/og-default.png` | NEW — 1200x630 PNG for social sharing |
| `public/llms.txt` | NEW — AI crawler content map |
| `src/pages/index.astro` | Add WebApplication + Organization schema |
| `src/components/Footer.astro` | Change `<h4>` to `<span>` |
| `src/components/GifTool.astro` | Fix empty `src=""` on placeholder images |
| `src/components/Nav.astro` | Consider adding breadcrumbs (optional, Medium priority) |
| `src/layouts/Base.astro` | Add BlogPosting schema logic for blog routes |
| `src/pages/compress-gif.astro` | Add HowTo schema |
| `src/pages/gif-optimizer.astro` | Fix title em dash, add WebApplication schema |
| `src/pages/reduce-gif-size.astro` | Fix title em dash, add WebApplication schema |
| `src/pages/gif-to-mp4.astro` | Expand content, add WebApplication schema |
| `src/pages/gif-to-webp.astro` | Add WebApplication schema |
| `src/pages/resize-gif.astro` | Expand content, add WebApplication schema |
| `src/pages/crop-gif.astro` | Add WebApplication schema |
| `src/pages/faq.astro` | Fix title em dash |
| `src/pages/blog/[...slug].astro` | Add BlogPosting schema |
| `src/pages/terms.astro` | Expand content to 600+ words |
| `src/pages/privacy.astro` | Expand content to 800+ words |
| `src/pages/blog.astro` | Add intro paragraph, fix blog post schema |
| 5 blog .md files | Fix title em dashes to `&mdash;` |
| 6 WIP landing pages | Complete and include in build |

---

## Estimated Time Investment

| Phase | Time | SEO Score Gain |
|-------|------|---------------|
| Phase 1: Critical Fixes | 1-2 hours | 41 → 58 |
| Phase 2: High-Impact Improvements | 4-6 hours | 58 → 72 |
| Phase 3: Content & Authority | 2-3 days | 72 → 82 |
| Phase 4: Monitoring | Ongoing | 82 → 85+ |

---

*Action Plan generated 2026-08-11*
