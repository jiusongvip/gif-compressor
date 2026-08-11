import { parseGIF, decompressFrames } from 'https://esm.sh/gifuct-js@2.1.2';

const $ = (id) => document.getElementById(id);
let frames = [], gifWidth = 0, gifHeight = 0, originalFile = null;

function formatSize(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}

function renderFrameToCtx(ctx, frame) {
  const d = frame.dims, p = frame.patch, t = frame.colorTable;
  const oc = document.createElement('canvas');
  oc.width = d.width; oc.height = d.height;
  const octx = oc.getContext('2d');
  const id = octx.createImageData(d.width, d.height);
  for (let i = 0; i < p.length; i++) {
    const idx = p[i];
    if (idx < t.length) { id.data[i*4]=t[idx][0]; id.data[i*4+1]=t[idx][1]; id.data[i*4+2]=t[idx][2]; id.data[i*4+3]=255; }
  }
  octx.putImageData(id, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const s = Math.min(ctx.canvas.width / d.width, ctx.canvas.height / d.height);
  ctx.drawImage(oc, (ctx.canvas.width - d.width*s)/2, (ctx.canvas.height - d.height*s)/2, d.width*s, d.height*s);
}

async function loadFile(file) {
  if (file.size > 100*1024*1024) { showToast('Max 100MB', 3000); return; }
  originalFile = file;
  const buf = new Uint8Array(await file.arrayBuffer());
  $('mp4-preview-img').src = URL.createObjectURL(file);
  $('mp4-size-orig').textContent = formatSize(file.size);
  try {
    const parsed = parseGIF(buf);
    frames = decompressFrames(parsed, true);
    gifWidth = parsed.lsd.width;
    gifHeight = parsed.lsd.height;
    $('mp4-stat-frames').textContent = frames.length;
    $('mp4-stat-size').textContent = gifWidth + 'x' + gifHeight;
    $('mp4-drop-zone').classList.add('hidden');
    $('mp4-tool-panel').classList.remove('hidden');
    $('mp4-convert-btn').disabled = false;
  } catch(e) { showToast('Could not parse this GIF', 3000); }
}

function convert() {
  if (!frames.length) return;
  $('mp4-convert-btn').disabled = true;
  
  const fps = 24;
  const canvas = document.createElement('canvas');
  canvas.width = gifWidth;
  canvas.height = gifHeight;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(fps);
  const mt = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: 3000000 });
  
  const chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  
  let fi = 0, sf = 0;
  const delays = frames.map(f => Math.max(1, Math.round((f.delay || 10) * fps / 100)));
  
  $('mp4-progress').classList.remove('hidden');
  
  rec.start(200);
  const ext = mt.includes('mp4') ? 'mp4' : 'webm';
  
  function draw() {
    if (fi >= frames.length) {
      rec.stop();
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: mt });
        $('mp4-result-size').textContent = formatSize(blob.size);
        $('mp4-progress-fill').style.width = '100%';
        $('mp4-download-btn').disabled = false;
        const saved = Math.round((1 - blob.size / originalFile.size) * 100);
        $('mp4-savings').textContent = 'Saved ' + saved + '% vs original GIF';
        $('mp4-download-btn').onclick = () => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'converted.' + ext; a.click();
          URL.revokeObjectURL(url);
        };
      };
      return;
    }
    renderFrameToCtx(ctx, frames[fi]);
    sf++;
    if (sf >= delays[fi]) { fi++; sf = 0; }
    $('mp4-progress-fill').style.width = Math.round((fi / frames.length) * 100) + '%';
    requestAnimationFrame(draw);
  }
  draw();
}

function init() {
  const dz = $('mp4-drop-zone'), fi = $('mp4-file-input');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('border-accent','bg-accent/5'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('border-accent','bg-accent/5'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('border-accent','bg-accent/5'); if(e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  fi.addEventListener('change', e => { if(e.target.files[0]) loadFile(e.target.files[0]); });
  document.addEventListener('paste', e => {
    for (const item of e.clipboardData?.items || []) { if (item.type === 'image/gif') { loadFile(item.getAsFile()); break; } }
  });
  $('mp4-convert-btn')?.addEventListener('click', convert);
  $('mp4-reset-btn')?.addEventListener('click', () => {
    frames = []; originalFile = null;
    $('mp4-drop-zone').classList.remove('hidden');
    $('mp4-tool-panel').classList.add('hidden');
    $('mp4-download-btn').disabled = true;
    $('mp4-convert-btn').disabled = true;
    $('mp4-progress').classList.add('hidden');
    $('mp4-result-size').textContent = '';
    $('mp4-savings').textContent = '';
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
