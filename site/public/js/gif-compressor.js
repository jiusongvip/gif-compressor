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
const previewOrig = $('preview-orig');
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

// ── Apply compression via gifsicle ─────────────────────────
async function applyCompression() {
  if (!originalBytes || !originalFile) return;

  const level = parseInt(levelSlider.value);
  setProgress(10, 'Compressing with gifsicle...');
  downloadBtn.disabled = true;

  const startTime = performance.now();

  try {
    const { gifsicle } = await loadEngine();
    let cmd = getCompressFlags(mode, level);
    // Scale down large GIFs, always apply some resize for files > 600px
    if (gifWidth > 800) cmd += ` --resize-fit ${clamp(gifWidth, 400, 800)}x_`;
    else if (gifWidth > 600) cmd += ` --resize-fit ${gifWidth}x_`;

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
      $('bd-color').textContent = 'already optimized';
      $('bd-frames').textContent = '0%';
      $('bd-lzw').textContent = level;
      $('bd-total').textContent = '0%';
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

    // Update breakdown
    const reduction = Math.round((1 - compressedBlob.size / origSize) * 100);
    $('bd-color').textContent = reduction > 0 ? 'gifsicle' : '-';
    $('bd-frames').textContent = reduction > 0 ? '-' + reduction + '%' : '0%';
    $('bd-lzw').textContent = level;
    $('bd-total').textContent = reduction > 0 ? '-' + reduction + '%' : '0%';

    // Speed badge
    const speedBadge = document.getElementById('speed-badge');
    if (speedBadge) {
      speedBadge.textContent = 'Compressed in ' + elapsed + 's';
      speedBadge.classList.remove('hidden');
    }

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

// ── Platform presets ──────────────────────────────────────
function initPresets() {
  const container = $('preset-buttons');
  if (!container) return;
  PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn px-2.5 py-1 text-[10px] font-medium rounded-md border border-slate-200 text-slate-500 hover:border-accent/50 hover:text-slate-700 transition-colors whitespace-nowrap';
    btn.textContent = p.desc;
    btn.title = p.label + ' — ' + p.desc;
    btn.addEventListener('click', () => {
      if (!originalBytes) return;
      const origSize = originalFile.size;
      if (origSize <= p.maxSize) return;
      const targetRatio = p.maxSize / origSize;
      const level = clamp(Math.round((1 - targetRatio) * 100), 1, 100);
      levelSlider.value = level;
      levelVal.textContent = level;
      activePreset = p.id;
      document.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.remove('border-accent', 'bg-accent/5', 'text-accent');
        b.classList.add('border-slate-200', 'text-slate-500');
      });
      btn.classList.remove('border-slate-200', 'text-slate-500');
      btn.classList.add('border-accent', 'bg-accent/5', 'text-accent');
      applyCompression();
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
downloadBtn.addEventListener('click', () => {
  if (!compressedBlob) return;
  const url = URL.createObjectURL(compressedBlob);
  const a = document.createElement('a');
  a.href = url;
  const origName = originalFile?.name || 'image.gif';
  const base = origName.replace(/\.gif$/i, '');
  a.download = base + '-compressed.gif';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ── Reset ─────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  cleanup();
  dropZone.classList.remove('hidden');
  toolPanel.classList.add('hidden');
});

function cleanup() {
  if (compressedBlob && previewComp.src) URL.revokeObjectURL(previewComp.src);
  if (previewOrig.src) URL.revokeObjectURL(previewOrig.src);
  if (comparisonComp.src) URL.revokeObjectURL(comparisonComp.src);
  if (comparisonOrig.src) URL.revokeObjectURL(comparisonOrig.src);
  compressedBlob = null;
  originalFile = null;
  originalBytes = null;
  activePreset = null;
  gifWidth = 0; gifHeight = 0;
  previewOrig.src = '';
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
  previewOrig.src = origUrl;
  comparisonOrig.src = origUrl;
  origSizeEl.textContent = formatSize(file.size);

  // Parse for analysis display
  setProgress(30, 'Analyzing...');
  try {
    const { parseGIF, decompressFrames } = await loadEngine();
    const gifData = parseGIF(originalBytes);
    const frames = decompressFrames(gifData, true);
    gifWidth = gifData.lsd?.width || frames[0]?.dims?.width || 400;
    gifHeight = gifData.lsd?.height || frames[0]?.dims?.height || 400;

    const totalColors = frames[0]?.colorTable?.length || 0;
    const frameCount = frames.length;
    let contentType = 'Static';
    if (frameCount > 20) contentType = 'Long animation';
    else if (frameCount > 2) contentType = 'Animated';

    $('stat-frames').textContent = frameCount;
    $('stat-colors').textContent = totalColors || 'N/A';
    $('stat-type').textContent = contentType;
    $('stat-method').textContent = 'gifsicle';
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

// ── Init ───────────────────────────────────────────────────
function init() {
  initPresets();
  initComparisonSlider();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { formatSize, setProgress, loadFile, applyCompression, cleanup };
