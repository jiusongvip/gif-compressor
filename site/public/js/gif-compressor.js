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
// No #select-btn: the whole drop zone is the picker (see the dropZone click handler
// below), so a separate button was a second affordance for the same action.
const fileInput = $('file-input');
const urlInput = $('url-input');
const urlLoadBtn = $('url-load-btn');
// The main view shows the pair side by side: sideOrig on the left, previewComp on
// the right. comparisonOrig/Comp are the lightbox slider's two layers.
const sideOrig = $('side-orig');
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
const lightboxOrigSize = $('lightbox-orig-size');
const lightboxCompSize = $('lightbox-comp-size');

// ── Platform presets ──────────────────────────────────────
// Target-size presets. `desc` is the limit itself; `why` is the reason it exists, so
// the number is not just a number.
//
// Values re-checked against the platforms' published limits on 2026-09-24. Two had
// drifted: Discord raised its free per-attachment cap from 10MB to 20MB in Aug 2026,
// and X's 15MB applies to GIFs (its 5MB cap is for still images). Email and Web are
// deliberately NOT platform caps — they are budgets, and the tooltip says so.
const PRESETS = [
  { id: 'discord', label: 'Discord', maxSize: 20 * 1024 * 1024, desc: '< 20MB',
    why: 'Discord\u2019s free upload limit is 20MB per attachment.' },
  { id: 'twitter', label: 'Twitter', maxSize: 15 * 1024 * 1024, desc: '< 15MB',
    why: 'X (Twitter) accepts GIFs up to 15MB. Its 5MB cap is for still images.' },
  { id: 'email', label: 'Email', maxSize: 1 * 1024 * 1024, desc: '< 1MB',
    why: 'Not a hard cap \u2014 1MB keeps attachments quick to send and safe across providers.' },
  { id: 'web', label: 'Web', maxSize: 500 * 1024, desc: '< 500KB',
    why: 'Not a platform cap \u2014 a page-weight budget, because large GIFs hurt Core Web Vitals.' },
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

  // The result pill sits under the compressed preview. It is green only when the
  // file actually got smaller: a green "1.2 MB" beside a 1.2 MB original would be a
  // lie told in colour, so the no-change case gets the neutral pill.
  if (compSizeEl) {
    compSizeEl.textContent = formatSize(compBytes);
    compSizeEl.className = pct > 0
      ? 'rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 tabular-nums'
      : 'rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-500 tabular-nums';
  }

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
  // The slider inside the lightbox already holds both layers, so there is nothing to
  // copy in — only the two size captions need to be current.
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

// These render as pills under each preview, so every value has to be readable on its
// own. A bare "48" in a pill says nothing — the same complaint the old
// "Frames 48 → 48" table earned — so the unit travels with the number.
// The size is NOT set here: it lives in the result pill, which setResult() owns
// because it is also the only place that knows whether the number deserves to be green.
function fillAnalysisIn() {
  setText('an-dims-in', gifWidth ? gifWidth + '\u00d7' + gifHeight : '-');
  setText('an-frames-in', gifFrames ? gifFrames + ' frames' : '-');
  setText('an-colors-in', gifColors ? gifColors + ' colors' : 'N/A');
  ['dims', 'frames', 'colors'].forEach((k) => setText('an-' + k + '-out', '-'));
  renderFitState(0);
}

// `colorsCap` is the --colors value we sent, so the output is guaranteed to be at
// or below it. Shown as "<=" rather than as a measured count we never took.
function fillAnalysisOut(_outBytes, colorsCap) {
  const dims = outputDims();
  setText('an-dims-out', dims.w + '\u00d7' + dims.h);
  setText('an-frames-out', gifFrames ? gifFrames + ' frames' : '-');
  setText('an-colors-out', colorsCap ? '\u2264' + colorsCap + ' colors' : '-');
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
function fillAnalysisUnchanged(_outBytes) {
  setText('an-dims-out', gifWidth ? gifWidth + '\u00d7' + gifHeight : '-');
  setText('an-frames-out', gifFrames ? gifFrames + ' frames' : '-');
  setText('an-colors-out', gifColors ? gifColors + ' colors' : 'N/A');
}

function setApplied(modeName, level, flags, notApplied) {
  const names = { quality: 'Quality', balanced: 'Balanced', max: 'Max' };
  const base = (names[modeName] || modeName) + ' \u00b7 level ' + level;
  setText('ap-setting', notApplied ? base + ' \u2014 not applied' : base);
  setText('ap-flags', flags || '-');
}

// "Fits where" is shown ON the Target size buttons rather than as a second row of
// chips: it is the same four platforms, so a separate row only repeated them. The
// tick and the buttons both read the same PRESETS table, so they cannot disagree.
function renderFitState(outBytes) {
  document.querySelectorAll('.preset-btn').forEach((b) => {
    const p = PRESETS.find((x) => x.id === b.dataset.preset);
    if (!p) return;
    const tick = b.querySelector('.fit-tick');
    if (!tick) return;
    const fits = outBytes > 0 && outBytes <= p.maxSize;
    tick.classList.toggle('hidden', !fits);
    b.dataset.fits = fits ? '1' : '0';
    b.title = (fits ? 'Your result fits ' : 'Compress to fit ') + p.label + ' (' + p.desc + ')';
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
      renderFitState(origSize);
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
    renderFitState(compressedBlob.size);

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

// ── The search itself, shared by the presets and the custom target box ──
// They differ only in where the number comes from, so they share one path: the
// search, the success test and the wording must stay identical, or the same file
// would get two different explanations depending on which control was used.
async function fitToTarget(maxBytes, label, desc, btn) {
  if (!originalBytes || !originalFile) return;
  const origSize = originalFile.size;

  // Already fits — say so rather than returning silently. A control that looks like
  // it did something but did not is worse than one that explains why it will not.
  if (origSize <= maxBytes) {
    setResult(origSize, origSize,
      'Already under ' + desc + ' \u2014 nothing to compress for ' + label + '.', 0);
    return;
  }

  if (btn) btn.disabled = true;
  setProgress(12, 'Searching for ' + desc + '\u2026');
  try {
    const found = await findLevelForTarget(maxBytes, mode);
    levelSlider.value = found.level === null ? 100 : found.level;
    levelVal.textContent = levelSlider.value;
    await applyCompression();

    // Judge success from the file we actually produced, not from what the search
    // claimed. The level -> size curve is not monotone on every mode, so the real
    // output is the only trustworthy answer.
    const got = compressedBlob ? compressedBlob.size : origSize;
    if (got <= maxBytes) {
      const caveat = got < maxBytes / 4
        ? ' This GIF\u2019s compression range is narrow, so it lands well under the limit.'
        : '';
      setResult(origSize, got,
        'Fits ' + label + ' (' + desc + ') at level ' + levelSlider.value + '.' + caveat);
    } else {
      setResult(origSize, got,
        'Cannot reach ' + desc + ' in ' + mode + ' mode \u2014 the smallest this tool can '
        + 'make this GIF is ' + formatSize(got) + '. Try Max mode, or convert to WebP or MP4 below.');
    }
  } catch (err) {
    console.error('Target-size search failed:', err);
    showToast('Target-size search failed. Try a different mode.');
  } finally {
    if (btn) btn.disabled = false;
    setProgress(-1);
  }
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
    btn.className = 'preset-btn inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border border-slate-200 text-slate-500 hover:border-accent/50 hover:text-slate-700 transition-colors whitespace-nowrap';
    btn.dataset.preset = p.id;
    // The platform name belongs on the button, not only in the tooltip: it is what the
    // user is choosing between, and it is what the fit tick refers to.
    const tick = document.createElement('span');
    tick.className = 'fit-tick hidden text-emerald-600 font-bold';
    tick.textContent = '\u2713';
    const label = document.createElement('span');
    label.textContent = p.label + ' ' + p.desc;
    btn.append(tick, label);
    btn.addEventListener('click', async () => {
      if (!originalBytes || !originalFile) return;

      clearPresetHighlight();
      btn.classList.remove('border-slate-200', 'text-slate-500');
      btn.classList.add('border-accent', 'bg-accent/5', 'text-accent');
      activePreset = p.id;

      await fitToTarget(p.maxSize, p.label, p.desc, btn);
    });
    container.appendChild(btn);
  });
}

// ── Custom target size ────────────────────────────────────
// The four presets are platform caps. This is for every other number people actually
// search for — 8MB, 10MB, 2MB, 512KB — which until now had no control at all, and
// which is the one intent pattern that has ever produced a click on this site
// ("compress gif to 256kb for discord"). It runs the same search as a preset.
function initCustomTarget() {
  const input = $('target-size');
  const unit = $('target-unit');
  const go = $('target-apply');
  if (!input || !unit || !go) return;

  const submit = async () => {
    if (!originalBytes || !originalFile) {
      showToast('Add a GIF first.');
      return;
    }
    const n = parseFloat(input.value);
    if (!isFinite(n) || n <= 0) {
      showToast('Type a target size first, for example 8.');
      input.focus();
      return;
    }
    const bytes = Math.round(n * (unit.value === 'MB' ? 1048576 : 1024));
    // Below 1KB there is no GIF left to make; above 200MB the search would only burn
    // the probe budget to tell us what we already know.
    if (bytes < 1024 || bytes > 200 * 1048576) {
      showToast('Pick a target between 1KB and 200MB.');
      input.focus();
      return;
    }

    clearPresetHighlight();
    activePreset = null;
    await fitToTarget(bytes, 'your target', '\u2264 ' + n + ' ' + unit.value, go);
  };

  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });

  // The quick chips are one click, not two: fill the box, then run the same search.
  // The sizes this site has whole pages about should not need typing to reach.
  document.querySelectorAll('.size-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.size;
      unit.value = chip.dataset.unit;
      submit();
    });
  });
}

// ── Drop zone & file input ────────────────────────────────
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
  // Pasting INTO the URL box must not also be caught here, or one Ctrl+V would kick off
  // two fetches: the box's own Enter/click path and this document-level handler.
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

  const items = e.clipboardData?.items;
  if (items) {
    for (const item of items) {
      if (item.type === 'image/gif') {
        loadFile(item.getAsFile());
        return;
      }
    }
  }

  // A pasted URL is the other thing "paste a GIF" can mean, and until now it did
  // nothing at all — no load, no error, no hint. The drop zone invites Ctrl+V and the
  // tool has a URL loader, so a user who copied a link rather than the file got silence
  // and reasonably reported that loading by link did not work. Handing it to the same
  // loader the URL box uses keeps one code path for both.
  const text = (e.clipboardData?.getData('text/plain') || '').trim();
  if (/^https?:\/\/\S+$/i.test(text)) {
    e.preventDefault();
    loadFromUrl(text);
  }
});

// ── GIF from URL ──────────────────────────────────────────
// One path, two entry points: the "paste a GIF URL" box and a URL pasted straight onto
// the page. They must share it, or the same URL would behave differently depending on
// where the user typed it — the same reason the presets and the custom target box share
// fitToTarget().
async function loadFromUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) return;
  setProgress(10, 'Fetching from URL...');
  try {
    // referrerPolicy: 'no-referrer' is load-bearing here, not hygiene. A large share of
    // image hosts run hotlink protection that answers 403 to any request carrying a
    // Referer from another site — and a browser fetch always sends one, so the feature
    // failed on exactly the sites people most often copy GIF URLs from. Verified
    // 2026-09-24 against c-ssl.dtstatic.com (a duitang CDN): same URL, same page, 403
    // with the default policy and 200 with this one. curl showed Referer is the only
    // trigger (no-Referer and Origin-only both return 200), and that a Referer from the
    // host's own domain also passes. On hosts with no such rule it costs nothing — the
    // header is simply absent.
    const resp = await fetch(url, { referrerPolicy: 'no-referrer' });
    if (!resp.ok) {
      setProgress(-1);
      // Name the failure. "Could not load" for both a 404 and a hotlink block sends the
      // user back to retry the same dead URL instead of to another source.
      showToast(resp.status === 401 || resp.status === 403
        ? 'That site blocks hotlinking (HTTP ' + resp.status + '). Download the GIF and drop it here instead.'
        : 'Could not fetch that URL (HTTP ' + resp.status + ').');
      return;
    }
    const blob = await resp.blob();
    // A URL can answer 200 with an HTML page — a login wall, a consent page, an error
    // page. Catching it on the magic bytes here gives a true reason, instead of the
    // confusing "not a valid GIF" that surfaces much later from the parser.
    const head = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
    if (!(head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46)) {
      setProgress(-1);
      showToast('That URL is not a GIF file.');
      return;
    }
    const file = new File([blob], url.split('/').pop() || 'remote.gif', { type: 'image/gif' });
    if (urlInput) urlInput.value = '';
    loadFile(file);
  } catch (err) {
    // Reaching here means the request never produced a readable response: the host sends
    // no CORS header, or there is no network. Both mean "you will have to get the file
    // yourself", so both get the same actionable sentence rather than the bare TypeError
    // ("Failed to fetch") the browser raises.
    setProgress(-1);
    showToast('Could not read that URL. The site may block outside access \u2014 download the GIF and drop it here.');
  }
}

if (urlLoadBtn) {
  urlLoadBtn.addEventListener('click', () => loadFromUrl(urlInput.value));
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
  sideOrig.src = '';
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
  sideOrig.src = origUrl;
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
  initCustomTarget();
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
