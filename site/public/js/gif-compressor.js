// ── Lazy GIF engine ───────────────────────────────────────
// gifsicle(WASM) 与 gifuct 仅在用户真正加载/压缩 GIF 时才动态拉取，
// 避免页面加载期就下载 ~200KB 引擎脚本与 LCP 图片争抢带宽。
let _enginePromise = null;
function loadEngine() {
  if (!_enginePromise) {
    _enginePromise = Promise.all([
      import('https://esm.sh/gifsicle-wasm-browser'),
      import('https://esm.sh/gifuct-js@2.1.2'),
    ]).then(([gs, gu]) => ({
      gifsicle: gs.default,
      parseGIF: gu.parseGIF,
      decompressFrames: gu.decompressFrames,
    }));
  }
  return _enginePromise;
}

// ── DOM refs ──────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const dropZone = $('drop-zone');
const toolPanel = $('tool-panel');
const fileInput = $('file-input');
const selectBtn = $('select-btn');
const urlInput = $('url-input');
const urlLoadBtn = $('url-load-btn');
// previewComp is the hero result image; comparisonOrig/Comp are the small
// before/after slider's two layers.
const previewComp = $('preview-comp');
const comparisonOrig = $('comparison-orig');
const comparisonComp = $('comparison-comp');
const compareHandle = $('compare-handle');
const levelSlider = $('level-slider');
const levelVal = $('level-val');
const downloadBtn = $('download-btn');
const resetBtn = $('reset-btn');
const origSizeEl = $('orig-size');
const compSizeEl = $('comp-size');
const progressBar = $('progress-bar');
const progressFill = $('progress-fill');
const progressText = $('progress-text');
// Result card — the prominent size summary at the top of the tool panel
const resultCard = $('result-card');
const resultOrigEl = $('result-orig');
const resultCompEl = $('result-comp');
const resultSavedEl = $('result-saved');
const resultNoteEl = $('result-note');
// Sticky result bar — keeps the number and the download button on screen while
// the user is down at the Mode / Level / Target size controls
const stickyBar = $('sticky-result');
const stickyOrigEl = $('sticky-orig');
const stickyCompEl = $('sticky-comp');
const stickySavedEl = $('sticky-saved');
const stickyDownloadBtn = $('sticky-download');
// Lightbox — full-size quality comparison
const lightbox = $('lightbox');
const lightboxOrig = $('lightbox-orig');
const lightboxComp = $('lightbox-comp');
const lightboxOrigSize = $('lightbox-orig-size');
const lightboxCompSize = $('lightbox-comp-size');

// ── Platform presets ──────────────────────────────────────
const PRESETS = [
  { id: 'discord', label: 'Discord', maxSize: 8 * 1024 * 1024, desc: '< 8MB' },
  { id: 'twitter', label: 'Twitter', maxSize: 5 * 1024 * 1024, desc: '< 5MB' },
  { id: 'email', label: 'Email', maxSize: 1 * 1024 * 1024, desc: '< 1MB' },
  { id: 'web', label: 'Web', maxSize: 500 * 1024, desc: '< 500KB' },
];

// ── State ─────────────────────────────────────────────────
let mode = 'balanced';
let originalFile = null;
let originalBytes = null;
let gifWidth = 0, gifHeight = 0;
// Measured once per file, then reused by the Analysis panel's "in" column.
let gifFrames = 0, gifColors = 0;
let compressedBlob = null;
let activePreset = null;

// ── Utilities ─────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function setProgress(pct, text) {
  progressBar.classList.toggle('hidden', pct < 0);
  if (pct >= 0) progressFill.style.width = pct + '%';
  progressText.textContent = text || '';
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden', 'opacity-0');
  setTimeout(() => { toast.classList.add('opacity-0'); setTimeout(() => toast.classList.add('hidden'), 300); }, 2500);
}

// ── Result card ───────────────────────────────────────────
// The size summary sits at the very top of the tool panel, so the number the
// user came for (and the download button) is visible without scrolling.
function setResult(origBytes, compBytes, note, savedPct) {
  const pct = savedPct === undefined
    ? (origBytes > 0 ? Math.round((1 - compBytes / origBytes) * 100) : 0)
    : savedPct;
  const label = pct > 0 ? 'save ' + pct + '%' : 'no change';

  if (resultOrigEl) resultOrigEl.textContent = formatSize(origBytes);
  if (resultCompEl) resultCompEl.textContent = formatSize(compBytes);
  if (resultSavedEl) {
    resultSavedEl.textContent = label;
    resultSavedEl.className = pct > 0
      ? 'text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md'
      : 'text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-md';
  }
  if (resultNoteEl) resultNoteEl.textContent = note || '';

  // Mirror into the sticky bar, so the same number stays readable from the
  // Mode / Level / Target size controls further down the page.
  if (stickyOrigEl) stickyOrigEl.textContent = formatSize(origBytes);
  if (stickyCompEl) stickyCompEl.textContent = formatSize(compBytes);
  if (stickySavedEl) stickySavedEl.textContent = label;

  syncSticky();
}

// ── Sticky result bar ─────────────────────────────────────
// Changing Mode / Level / Target size re-runs the compression, so the new size
// has to be readable from where the click happened — otherwise the control and
// its effect sit a screen apart and the controls feel like they do nothing.
// Pinned just under the sticky nav while the main result card is out of view.
function navOffset() {
  const nav = document.querySelector('nav.sticky');
  return (nav ? nav.getBoundingClientRect().height : 0) + 8;
}

let stickyShown = false;
function syncSticky() {
  if (!stickyBar || !resultCard) return;
  const nav = navOffset();
  // Visible from the moment the result card slides under the nav until the whole
  // tool is scrolled past — it should not follow the user into the FAQ.
  const cardGone = resultCard.getBoundingClientRect().bottom < nav;
  const toolStillHere = toolPanel ? toolPanel.getBoundingClientRect().bottom > nav : false;
  const shouldShow = !!compressedBlob && cardGone && toolStillHere;
  if (shouldShow === stickyShown) return;
  stickyShown = shouldShow;
  stickyBar.style.display = shouldShow ? 'block' : 'none';
  stickyBar.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
}

function initStickyResult() {
  if (!stickyBar || !resultCard) return;
  const place = () => { stickyBar.style.top = navOffset() + 'px'; };
  place();
  window.addEventListener('resize', () => { place(); syncSticky(); }, { passive: true });
  let raf = 0;
  window.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; syncSticky(); });
  }, { passive: true });
}

// ── Lightbox ──────────────────────────────────────────────
// Opened from the two small thumbnails or the "Click to enlarge" button.
// Deliberately NOT bound to the comparison area itself: the range input that
// drives the drag-slider covers that area, so a click handler there would also
// fire at the end of every drag.
function openLightbox() {
  if (!lightbox || !originalFile) return;
  lightboxOrig.src = comparisonOrig.src;
  lightboxComp.src = comparisonComp.src;
  if (lightboxOrigSize) lightboxOrigSize.textContent = origSizeEl ? origSizeEl.textContent : '';
  if (lightboxCompSize) lightboxCompSize.textContent = compSizeEl ? compSizeEl.textContent : '';
  lightbox.style.display = 'block';
}

function closeLightbox() {
  if (!lightbox) return;
  lightbox.style.display = 'none';
}

// ── Comparison slider ─────────────────────────────────────
function initComparisonSlider() {
  const line = document.getElementById('compare-line');
  function update() {
    const pct = compareHandle.value;
    comparisonComp.style.clipPath = 'inset(0 0 0 ' + pct + '%)';
    if (line) line.style.left = pct + '%';
  }
  compareHandle.addEventListener('input', update);
  update();
}

// ── Mode → gifsicle flags ─────────────────────────────────
function getCompressFlags(mode, level) {
  const lossy = clamp(Math.round(level * 2), 5, 200);
  switch (mode) {
    case 'quality':
      return `--lossy=${clamp(lossy, 5, 50)} -O1 --colors ${clamp(256 - Math.round(level * 0.8), 128, 240)}`;
    case 'max':
      return `--lossy=${clamp(lossy, 60, 200)} -O2 --colors ${clamp(256 - Math.round(level * 2), 16, 128)}`;
    default: // balanced
      return `--lossy=${clamp(lossy, 20, 120)} -O2 --colors ${clamp(256 - Math.round(level * 1.3), 32, 192)}`;
  }
}

// ── Analysis / Applied / Fits panel ───────────────────────
// Rule for this panel: every row is either a value we measured or a question the
// user actually has. The previous version broke that rule four times — a
// hardcoded "Best method" that always read "gifsicle", a "Color reduction" row
// that printed the engine name, a "Frame optimization" row that printed the
// overall reduction, and an "LZW encoding" row that echoed the slider back.

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

// Output geometry, derived from the same rule that builds the command:
// --resize-fit only actually shrinks anything above 800px wide.
function outputDims() {
  if (gifWidth > 800) {
    const w = clamp(gifWidth, 400, 800);
    return { w, h: Math.round(gifHeight * w / gifWidth) };
  }
  return { w: gifWidth, h: gifHeight };
}

// Read back what we actually handed to gifsicle, so the panel can show it.
function parseFlags(flags) {
  const lossy = /--lossy=(\d+)/.exec(flags);
  const colors = /--colors\s+(\d+)/.exec(flags);
  return { lossy: lossy ? lossy[1] : '', colors: colors ? colors[1] : '' };
}

function fillAnalysisIn() {
  setText('an-size-in', originalFile ? formatSize(originalFile.size) : '-');
  setText('an-dims-in', gifWidth ? gifWidth + '\u00d7' + gifHeight : '-');
  setText('an-frames-in', gifFrames || '-');
  setText('an-colors-in', gifColors || 'N/A');
  ['size', 'dims', 'frames', 'colors'].forEach((k) => setText('an-' + k + '-out', '-'));
  renderFitChips(0);
}

// `colorsCap` is the --colors value we sent, so the output is guaranteed to be at
// or below it. Shown as "<=" rather than as a measured count we never took.
function fillAnalysisOut(outBytes, colorsCap) {
  setText('an-size-out', formatSize(outBytes));
  const dims = outputDims();
  setText('an-dims-out', dims.w + '\u00d7' + dims.h);
  setText('an-frames-out', gifFrames || '-');
  setText('an-colors-out', colorsCap ? '\u2264' + colorsCap : '-');
  // "≤" needs explaining, otherwise it reads like a measurement we did not take.
  const colorsEl = $('an-colors-out');
  if (colorsEl) {
    colorsEl.title = colorsCap
      ? 'gifsicle caps the output palette at ' + colorsCap + ' colours, so the result is at or below this'
      : '';
  }
}

// When gifsicle cannot beat the original we hand the original bytes back, so the
// output column has to describe the ORIGINAL file, not the resize we asked for.
// Reporting the attempted 800x600 here would be exactly the kind of lie the old
// "Best method" row told — the panel would claim a change that never reached the user.
function fillAnalysisUnchanged(outBytes) {
  setText('an-size-out', formatSize(outBytes));
  setText('an-dims-out', gifWidth ? gifWidth + '\u00d7' + gifHeight : '-');
  setText('an-frames-out', gifFrames || '-');
  setText('an-colors-out', gifColors || 'N/A');
}

function setApplied(modeName, level, flags, notApplied) {
  const names = { quality: 'Quality', balanced: 'Balanced', max: 'Max' };
  const base = (names[modeName] || modeName) + ' \u00b7 level ' + level;
  setText('ap-setting', notApplied ? base + ' \u2014 not applied' : base);
  setText('ap-flags', flags || '-');
}

// "Fits where" — driven from the same PRESETS table as the buttons above, so the
// chips and the buttons can never disagree about what the platform limit is.
function renderFitChips(outBytes) {
  const box = $('fit-chips');
  if (!box) return;
  box.textContent = '';
  PRESETS.forEach((p) => {
    const fits = outBytes > 0 && outBytes <= p.maxSize;
    const chip = document.createElement('span');
    chip.className = fits
      ? 'text-[10px] font-medium px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100'
      : 'text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-50 text-slate-400 border border-slate-100';
    chip.textContent = (fits ? '\u2713 ' : '') + p.label + ' ' + p.desc;
    chip.title = (fits ? 'Fits ' : 'Too big for ') + p.label + ' (' + p.desc + ')';
    box.appendChild(chip);
  });
}

// ── Apply compression via gifsicle ─────────────────────────
// ── Usage counter ──────────────────────────────────────────
// The homepage used to ship a hardcoded "0 GIFs compressed", which reads as
// "nobody uses this" — a trust negative, not the social proof the element is for.
// There is no backend, so the only number we can state honestly is what THIS
// browser has actually done. It stays hidden until there is something to show.
const USAGE_KEY = 'gifc-usage-count';
let usageCounted = false;

function readUsageCount() {
  try {
    return parseInt(localStorage.getItem(USAGE_KEY) || '0', 10) || 0;
  } catch {
    return 0; // storage disabled (private mode) — the counter is decorative
  }
}

function renderUsageCounter() {
  const el = $('usage-counter');
  if (!el) return;
  const n = readUsageCount();
  if (n <= 0) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = n + (n === 1 ? ' GIF compressed' : ' GIFs compressed') + ' in your browser';
}

// Called once per loaded file, from the branch that actually produced a smaller
// file — a slider tweak re-runs applyCompression and must not inflate the count.
function countUsageOnce() {
  if (usageCounted) return;
  usageCounted = true;
  try {
    localStorage.setItem(USAGE_KEY, String(readUsageCount() + 1));
  } catch {
    /* storage disabled — nothing to persist, still show what we can */
  }
  renderUsageCounter();
}

async function applyCompression() {
  if (!originalBytes || !originalFile) return;

  const level = parseInt(levelSlider.value);
  setProgress(10, 'Compressing with gifsicle...');
  downloadBtn.disabled = true;

  const startTime = performance.now();

  try {
    const { gifsicle } = await loadEngine();
    let cmd = getCompressFlags(mode, level);
    // Scale down very large GIFs. `scaledTo` is tracked so the result card can be
    // honest that part of the saving comes from shrinking, not only re-encoding.
    let scaledTo = 0;
    if (gifWidth > 800) {
      scaledTo = clamp(gifWidth, 400, 800);
      cmd += ` --resize-fit ${scaledTo}x_`;
    } else if (gifWidth > 600) {
      cmd += ` --resize-fit ${gifWidth}x_`;
    }

    // Read back the numbers we actually sent, so the panel reports the real
    // command rather than a hand-written summary of it.
    const applied = parseFlags(cmd);

    const [outFile] = await gifsicle.run({
      input: [{ file: originalFile, name: 'input.gif' }],
      command: [`${cmd} input.gif -o /out/output.gif`],
    });

    // If compressed is larger, use original and notify
    const origSize = originalFile.size;
    if (outFile.size >= origSize) {
      compressedBlob = new Blob([originalBytes], { type: 'image/gif' });
      const compUrl = URL.createObjectURL(compressedBlob);
      previewComp.src = compUrl;
      comparisonComp.src = compUrl;
      compSizeEl.textContent = formatSize(origSize) + ' (no change)';
      setApplied(mode, level, cmd, true);
      fillAnalysisUnchanged(origSize);
      renderFitChips(origSize);
      setResult(origSize, origSize,
        'Already optimized — gifsicle could not make this file any smaller. Try Max mode, or convert to WebP or MP4 below.',
        0);
      downloadBtn.disabled = false;
      const speedBadge = document.getElementById('speed-badge');
      if (speedBadge) { speedBadge.textContent = 'Already optimized'; speedBadge.classList.remove('hidden'); }
      setProgress(-1);
      return;
    }

    compressedBlob = outFile;
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

    // Show compressed preview
    const compUrl = URL.createObjectURL(compressedBlob);
    previewComp.src = compUrl;
    comparisonComp.src = compUrl;
    compSizeEl.textContent = formatSize(compressedBlob.size);

    // Result card — the number the user came for, plus an honest note about how it
    // was achieved (part of the saving may come from scaling, not just re-encoding).
    setResult(origSize, compressedBlob.size,
      scaledTo
        ? `Also scaled to ${scaledTo}px wide to reach this size.`
        : 'Dimensions unchanged — this is pure re-encoding.');
    setApplied(mode, level, cmd);
    fillAnalysisOut(compressedBlob.size, applied.colors);
    renderFitChips(compressedBlob.size);

    // Speed badge
    const speedBadge = document.getElementById('speed-badge');
    if (speedBadge) {
      speedBadge.textContent = 'Compressed in ' + elapsed + 's';
      speedBadge.classList.remove('hidden');
    }

    // Only here: we actually produced a smaller file. The "already optimized"
    // branch above returns early and must not count.
    countUsageOnce();

    downloadBtn.disabled = false;

    // Post-compression funnel
    const funnel = document.getElementById('post-compress-funnel');
    if (funnel) funnel.classList.remove('hidden');

    setProgress(100, 'Done');
    setTimeout(() => setProgress(-1), 600);
  } catch (e) {
    console.error('Compression failed:', e);
    setProgress(-1);
    showToast('Compression failed. Try a smaller GIF or lower compression level.');
    downloadBtn.disabled = true;
  }
}

// ── UI mode buttons ───────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach((b) => {
      b.classList.toggle('bg-accent', b.dataset.mode === mode);
      b.classList.toggle('text-white', b.dataset.mode === mode);
      b.classList.toggle('text-slate-500', b.dataset.mode !== mode);
    });
    activePreset = null;
    document.querySelectorAll('.preset-btn').forEach(b => {
      b.classList.remove('border-accent', 'bg-accent/5', 'text-accent');
      b.classList.add('border-slate-200', 'text-slate-500');
    });
    applyCompression();
  });
});

// ── Level slider (debounced) ──────────────────────────────
let compressTimer = null;
levelSlider.addEventListener('input', () => {
  levelVal.textContent = levelSlider.value;
  activePreset = null;
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.classList.remove('border-accent', 'bg-accent/5', 'text-accent');
    b.classList.add('border-slate-200', 'text-slate-500');
  });
  if (compressTimer) clearTimeout(compressTimer);
  compressTimer = setTimeout(applyCompression, 600);
});

// ── Platform presets: an actual search, not a ratio guess ──
// The old handler derived a slider position from maxSize/origSize and never looked
// at the result. Two consequences the user hit immediately: a file already under the
// limit returned silently (button felt dead), and a tighter target could come back
// LARGER than the previous output. It also never reported a miss.

const MAX_PROBES = 8;            // 1 reachability probe + 7 binary steps over 0-100
const SEARCH_BUDGET_MS = 20000;  // a 5MB GIF costs ~10s per probe; never freeze the tab

async function probeLevel(level, modeName) {
  let cmd = getCompressFlags(modeName, level);
  if (gifWidth > 800) cmd += ` --resize-fit ${clamp(gifWidth, 400, 800)}x_`;
  else if (gifWidth > 600) cmd += ` --resize-fit ${gifWidth}x_`;
  const { gifsicle } = await loadEngine();
  const [out] = await gifsicle.run({
    input: [{ file: originalFile, name: 'input.gif' }],
    command: [`${cmd} input.gif -o /out/output.gif`],
  });
  return out.size;
}

// Find a level that meets the target. Returns the LIGHTEST such level, so quality
// stays as high as the limit allows. Level -> size is non-increasing on balanced but
// NOT on max (measured reversals at 65->70 and 80->85), so the caller re-checks the
// real output after applying rather than trusting this number.
async function findLevelForTarget(targetBytes, modeName) {
  const sizes = new Map();
  const started = performance.now();
  let probes = 0;

  const measure = async (lv) => {
    const size = await probeLevel(lv, modeName);
    sizes.set(lv, size);
    probes++;
    setProgress(Math.min(92, 18 + probes * 8), 'Trying level ' + lv + ' of 100\u2026');
    return size;
  };
  const floor = () => (sizes.size ? Math.min(...sizes.values()) : 0);

  // Probe the heaviest setting first. If even that cannot reach the target, the
  // target is unreachable and we learn it in ONE compression instead of ten.
  if (await measure(100) > targetBytes) {
    return { level: null, minSize: floor(), probes };
  }

  // Level 100 fits, so search downward for the lightest level that still fits.
  let lo = 0, hi = 100, best = 100;
  while (lo <= hi && probes < MAX_PROBES && performance.now() - started < SEARCH_BUDGET_MS) {
    const mid = (lo + hi) >> 1;
    if (await measure(mid) <= targetBytes) { best = mid; hi = mid - 1; } else { lo = mid + 1; }
  }
  return { level: best, minSize: floor(), probes };
}

function clearPresetHighlight() {
  document.querySelectorAll('.preset-btn').forEach((b) => {
    b.classList.remove('border-accent', 'bg-accent/5', 'text-accent');
    b.classList.add('border-slate-200', 'text-slate-500');
  });
}

// Buttons whose limit the file already meets are dimmed and explained, so they do
// not look broken when clicked.
function refreshPresetStates() {
  if (!originalFile) return;
  document.querySelectorAll('.preset-btn').forEach((b) => {
    const p = PRESETS.find((x) => x.id === b.dataset.preset);
    if (!p) return;
    const already = originalFile.size <= p.maxSize;
    b.classList.toggle('opacity-40', already);
    b.title = already
      ? p.label + ' \u2014 already under ' + p.desc + ', nothing to compress'
      : 'Compress to fit ' + p.label + ' (' + p.desc + ')';
  });
}

function initPresets() {
  const container = $('preset-buttons');
  if (!container) return;
  PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn px-2.5 py-1 text-[10px] font-medium rounded-md border border-slate-200 text-slate-500 hover:border-accent/50 hover:text-slate-700 transition-colors whitespace-nowrap';
    btn.textContent = p.desc;
    btn.dataset.preset = p.id;
    btn.addEventListener('click', async () => {
      if (!originalBytes || !originalFile) return;
      const origSize = originalFile.size;

      clearPresetHighlight();
      btn.classList.remove('border-slate-200', 'text-slate-500');
      btn.classList.add('border-accent', 'bg-accent/5', 'text-accent');
      activePreset = p.id;

      // Already fits — say so rather than returning silently.
      if (origSize <= p.maxSize) {
        setResult(origSize, origSize,
          'Already under ' + p.desc + ' \u2014 nothing to compress for ' + p.label + '.', 0);
        return;
      }

      btn.disabled = true;
      setProgress(12, 'Searching for ' + p.desc + '\u2026');
      try {
        const found = await findLevelForTarget(p.maxSize, mode);
        levelSlider.value = found.level === null ? 100 : found.level;
        levelVal.textContent = levelSlider.value;
        await applyCompression();

        // Judge success from the file we actually produced, not from what the search
        // claimed. The level -> size curve is not monotone on every mode, so the real
        // output is the only trustworthy answer.
        const got = compressedBlob ? compressedBlob.size : origSize;
        if (got <= p.maxSize) {
          const caveat = got < p.maxSize / 4
            ? ' This GIF\u2019s compression range is narrow, so it lands well under the limit.'
            : '';
          setResult(origSize, got,
            'Fits ' + p.label + ' (' + p.desc + ') at level ' + levelSlider.value + '.' + caveat);
        } else {
          setResult(origSize, got,
            'Cannot reach ' + p.desc + ' in ' + mode + ' mode \u2014 the smallest this tool can '
            + 'make this GIF is ' + formatSize(got) + '. Try Max mode, or convert to WebP or MP4 below.');
        }
      } catch (err) {
        console.error('Target-size search failed:', err);
        showToast('Target-size search failed. Try a different mode.');
      } finally {
        btn.disabled = false;
        setProgress(-1);
      }
    });
    container.appendChild(btn);
  });
}

// ── Drop zone & file input ────────────────────────────────
selectBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); });

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-accent', 'bg-accent/5');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('border-accent', 'bg-accent/5');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-accent', 'bg-accent/5');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (items) {
    for (const item of items) {
      if (item.type === 'image/gif') {
        loadFile(item.getAsFile());
        break;
      }
    }
  }
});

// ── URL input ─────────────────────────────────────────────
if (urlLoadBtn) {
  urlLoadBtn.addEventListener('click', async () => {
    const url = (urlInput.value || '').trim();
    if (!url) return;
    setProgress(10, 'Fetching from URL...');
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const file = new File([blob], url.split('/').pop() || 'remote.gif', { type: 'image/gif' });
      urlInput.value = '';
      loadFile(file);
    } catch (err) {
      setProgress(-1);
      showToast('Could not load GIF from URL. Try downloading first.');
    }
  });
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') urlLoadBtn.click();
  });
}

// ── Download ──────────────────────────────────────────────
// Shared by the big button in the result card and the one in the sticky bar.
function downloadResult() {
  if (!compressedBlob) return;
  const url = URL.createObjectURL(compressedBlob);
  const a = document.createElement('a');
  a.href = url;
  const origName = originalFile?.name || 'image.gif';
  const base = origName.replace(/\.gif$/i, '');
  a.download = base + '-compressed.gif';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

downloadBtn.addEventListener('click', downloadResult);
if (stickyDownloadBtn) stickyDownloadBtn.addEventListener('click', downloadResult);

// ── Reset ─────────────────────────────────────────────────
// Putting the drop zone back is not enough. The tool panel is much taller than
// the drop zone, so hiding it shrinks the document while the browser keeps the
// old scroll offset — the user ends up looking at whatever now sits at that
// offset instead of the upload box they just asked for. Scroll there explicitly.
function scrollToolIntoView() {
  const tool = document.getElementById('gif-tool');
  if (!tool) return;
  // The nav is sticky, so align to just below it rather than to y=0.
  const nav = document.querySelector('nav.sticky');
  const offset = nav ? nav.getBoundingClientRect().height + 8 : 0;
  const top = window.scrollY + tool.getBoundingClientRect().top - offset;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
}

resetBtn.addEventListener('click', () => {
  cleanup();
  dropZone.classList.remove('hidden');
  toolPanel.classList.add('hidden');
  syncSticky();          // compressedBlob is now null → bar hides immediately
  scrollToolIntoView();
});

function cleanup() {
  if (compressedBlob && previewComp.src) URL.revokeObjectURL(previewComp.src);
  if (comparisonComp.src) URL.revokeObjectURL(comparisonComp.src);
  if (comparisonOrig.src) URL.revokeObjectURL(comparisonOrig.src);
  compressedBlob = null;
  originalFile = null;
  originalBytes = null;
  activePreset = null;
  gifWidth = 0; gifHeight = 0;
  gifFrames = 0; gifColors = 0;
  usageCounted = false;
  previewComp.src = '';
  comparisonOrig.src = '';
  comparisonComp.src = '';
}

// ── Main: Load file ───────────────────────────────────────
async function loadFile(file) {
  if (file.size > 100 * 1024 * 1024) {
    showToast('File too large. Maximum 100MB.');
    return;
  }
  cleanup();
  setProgress(10, 'Reading file...');
  originalBytes = new Uint8Array(await file.arrayBuffer());
  originalFile = file;

  // Show original preview
  const origUrl = URL.createObjectURL(file);
  comparisonOrig.src = origUrl;
  origSizeEl.textContent = formatSize(file.size);
  // Result card starts in a pending state so the top of the panel is never blank
  if (resultOrigEl) resultOrigEl.textContent = formatSize(file.size);
  if (resultCompEl) resultCompEl.textContent = '...';
  if (resultSavedEl) {
    resultSavedEl.textContent = 'working';
    resultSavedEl.className = 'text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-md';
  }
  if (resultNoteEl) resultNoteEl.textContent = '';

  // Parse for analysis display
  setProgress(30, 'Analyzing...');
  try {
    const { parseGIF, decompressFrames } = await loadEngine();
    const gifData = parseGIF(originalBytes);
    const frames = decompressFrames(gifData, true);
    gifWidth = gifData.lsd?.width || frames[0]?.dims?.width || 400;
    gifHeight = gifData.lsd?.height || frames[0]?.dims?.height || 400;

    // Frame count and palette size are the two facts worth keeping: they drive the
    // Analysis panel, and "Frames: 1" already says "static" more plainly than a
    // separate Type row did.
    gifFrames = frames.length;
    gifColors = frames[0]?.colorTable?.length || 0;
    fillAnalysisIn();
    refreshPresetStates();
  } catch {
    // Analysis is optional; proceed even if parsing fails
  }

  dropZone.classList.add('hidden');
  toolPanel.classList.remove('hidden');
  compareHandle.value = 50;
  initComparisonSlider();
  setProgress(-1);

  applyCompression();
}

// ── Lightbox & URL row wiring ─────────────────────────────
function initLightbox() {
  const openBtn = $('open-lightbox');
  if (openBtn) openBtn.addEventListener('click', openLightbox);
  const closeBtn = $('lightbox-close');
  if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
  if (lightbox) lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
}

function initUrlToggle() {
  const toggle = $('url-toggle');
  const row = $('url-row');
  if (!toggle || !row) return;
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = row.style.display !== 'flex';
    row.style.display = willOpen ? 'flex' : 'none';
    if (willOpen && urlInput) urlInput.focus();
  });
}

// ── Init ───────────────────────────────────────────────────
function init() {
  renderUsageCounter();
  initPresets();
  initComparisonSlider();
  initLightbox();
  initUrlToggle();
  initStickyResult();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { formatSize, setProgress, loadFile, applyCompression, cleanup };
