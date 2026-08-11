import gifsicle from 'https://esm.sh/gifsicle-wasm-browser';
import JSZip from 'https://esm.sh/jszip@3.10.1';

function formatSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

// ── Batch state ───────────────────────────────────────────
let batchFiles = [];
let batchCompressed = [];

// ── DOM ────────────────────────────────────────────────────
const batchToggle = document.getElementById('batch-toggle');
const batchSection = document.getElementById('batch-section');
const batchList = document.getElementById('batch-list');
const batchCount = document.getElementById('batch-count');
const batchProgressBar = document.getElementById('batch-progress-bar');
const batchProgressFill = document.getElementById('batch-progress-fill');
const batchProgressText = document.getElementById('batch-progress-text');
const batchCompressBtn = document.getElementById('batch-compress-btn');
const batchDownloadBtn = document.getElementById('batch-download-btn');
const batchClearBtn = document.getElementById('batch-clear-btn');
const fileInput = document.getElementById('file-input');

// ── Batch toggle ───────────────────────────────────────────
if (batchToggle) {
  batchToggle.addEventListener('click', () => {
    const active = batchToggle.classList.toggle('bg-accent');
    batchToggle.classList.toggle('text-white', active);
    batchToggle.classList.toggle('text-slate-500', !active);
    batchToggle.classList.toggle('bg-slate-100', !active);
    fileInput.multiple = active;
    batchSection.classList.toggle('hidden', !active);
    if (!active) { batchFiles = []; batchCompressed = []; renderBatchList(); }
  });
}

// ── File input override for batch ──────────────────────────
fileInput.addEventListener('change', (e) => {
  if (!fileInput.multiple) return;
  handleBatchFiles(e.target.files);
  fileInput.value = '';
});

// Override drop for batch
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('drop', (e) => {
  if (!fileInput.multiple || !e.dataTransfer.files.length) return;
  e.preventDefault();
  dropZone.classList.remove('border-accent', 'bg-accent/5');
  handleBatchFiles(e.dataTransfer.files);
});

// ── Handle batch files ─────────────────────────────────────
async function handleBatchFiles(fileList) {
  for (const file of fileList) {
    if (file.type !== 'image/gif' && !file.name.toLowerCase().endsWith('.gif')) continue;
    if (file.size > 100 * 1024 * 1024) continue;
    if (batchFiles.find(f => f.name === file.name && f.size === file.size)) continue;
    batchFiles.push({ file, compressed: null, status: 'ready' });
  }
  renderBatchList();
}

function updateBatchUI() {
  const total = batchFiles.length;
  batchCount.textContent = total + ' file' + (total !== 1 ? 's' : '');
  batchCompressBtn.disabled = total === 0;
}

// ── Render batch list ──────────────────────────────────────
function renderBatchList() {
  if (!batchList) return;
  batchList.innerHTML = batchFiles.map((f, i) => {
    const sizeStr = formatSize(f.file.size);
    const compStr = f.compressed ? formatSize(f.compressed.size) : '';
    const pct = f.compressed ? Math.round((1 - f.compressed.size / f.file.size) * 100) : null;
    const statusClass = f.status === 'error' ? 'text-red-400' : f.compressed ? 'text-accent' : 'text-slate-400';
    const statusText = f.status === 'loading' ? 'Compressing...' : f.status === 'error' ? 'Error' : f.compressed ? compStr + ' (-' + pct + '%)' : sizeStr;
    return '<div class="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">' +
      '<span class="text-[11px] text-slate-400 w-5 shrink-0 tabular-nums">' + (i + 1) + '</span>' +
      '<span class="flex-1 text-xs text-slate-700 truncate" title="' + f.file.name + '">' + f.file.name + '</span>' +
      '<span class="text-[11px] tabular-nums shrink-0 ' + statusClass + '">' + statusText + '</span>' +
      (f.compressed ? '<span class="w-2 h-2 rounded-full bg-green-400 shrink-0" title="Done"></span>' :
        f.status === 'loading' ? '<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>' :
        f.status === 'error' ? '<span class="w-2 h-2 rounded-full bg-red-400 shrink-0"></span>' : '') +
      '</div>';
  }).join('');
  updateBatchUI();
}

// ── Compress all ────────────────────────────────────────────
if (batchCompressBtn) {
  batchCompressBtn.addEventListener('click', async () => {
    const modeBtn = document.querySelector('.mode-btn.bg-accent');
    const mode = modeBtn ? modeBtn.dataset.mode : 'balanced';
    const level = parseInt(document.getElementById('level-slider').value);

    batchCompressBtn.disabled = true;
    batchProgressBar.classList.remove('hidden');

    const toCompress = batchFiles.filter(f => f.status !== 'error');
    for (let i = 0; i < toCompress.length; i++) {
      const item = toCompress[i];
      item.status = 'loading';
      renderBatchList();
      const pct = Math.round((i / toCompress.length) * 100);
      batchProgressFill.style.width = pct + '%';
      batchProgressText.textContent = 'Compressing ' + (i + 1) + '/' + toCompress.length + '...';

      try {
        let lossy = level * 2;
        let colors = 256 - Math.round(level * 1.3);
        if (mode === 'quality') { lossy = Math.min(lossy, 50); colors = Math.max(colors, 128); }
        if (mode === 'max') { lossy = Math.max(lossy, 60); colors = Math.min(colors, 64); }

        const cmd = `--lossy=${lossy} -O${mode === 'max' ? '2' : '1'} --colors ${colors}`;
        const [outFile] = await gifsicle.run({
          input: [{ file: item.file, name: 'input.gif' }],
          command: [`${cmd} input.gif -o /out/output.gif`],
        });
        item.compressed = outFile;
      } catch {
        item.status = 'error';
        item.compressed = null;
      }
      if (item.status !== 'error') item.status = 'compressed';
      renderBatchList();
    }

    batchProgressFill.style.width = '100%';
    batchProgressText.textContent = 'Done';
    batchCompressBtn.disabled = false;
    batchDownloadBtn.disabled = false;
    setTimeout(() => batchProgressBar.classList.add('hidden'), 1500);
  });
}

// ── Download zip ────────────────────────────────────────────
if (batchDownloadBtn) {
  batchDownloadBtn.addEventListener('click', async () => {
    const done = batchFiles.filter(f => f.compressed);
    if (!done.length) return;
    const zip = new JSZip();
    for (const item of done) {
      const base = item.file.name.replace(/\.gif$/i, '');
      zip.file(base + '-compressed.gif', await item.compressed.arrayBuffer());
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'compressed-gifs.zip';
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ── Clear batch ────────────────────────────────────────────
if (batchClearBtn) {
  batchClearBtn.addEventListener('click', () => {
    batchFiles = [];
    batchCompressed = [];
    renderBatchList();
    batchDownloadBtn.disabled = true;
    updateBatchUI();
  });
}
