/* nfctags.js — hardened single-run click logic */

const TEMPLATE_URL = 'encode_lot_template.gototags';

const $ = s => document.querySelector(s);
const statusEl = () => $('#status');
const logEl = () => $('#log');

function setStatus(html, cls='') {
  const el = statusEl();
  el.className = cls;
  el.innerHTML = html;
}
function appendLog(line='') {
  const el = logEl();
  el.hidden = false;
  el.textContent += line + '\n';
}

const esc = (s='') =>
  String(s)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n');

function nowStamp() {
  const d = new Date();
  const z = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

async function isZipBlob(blob) {
  const head = await blob.slice(0,2).arrayBuffer();
  const b = new Uint8Array(head);
  return b[0] === 0x50 && b[1] === 0x4B; // 'PK'
}
async function fetchTemplateBlob() {
  setStatus('Fetching template…', '');
  const res = await fetch(TEMPLATE_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch ${TEMPLATE_URL} (${res.status})`);
  setStatus('Template loaded. Preparing data…', '');
  return await res.blob();
}

async function makeGototagsFromTemplate({lot, qty, product}) {
  const tpl = await fetchTemplateBlob();

  // If template is a text op file, wrap into zip
  if (!(await isZipBlob(tpl))) {
    setStatus('Template is a text operation file. Repacking…', '');
    const text = await tpl.text();
    const replaced = text
      .replaceAll('LOT_PLACEHOLDER', esc(lot))
      .replaceAll('QTY_PLACEHOLDER', esc(qty))
      .replaceAll('PRODUCT_PLACEHOLDER', esc(product));

    const zip = new JSZip();
    zip.file('file.gototags', replaced);
    setStatus('Creating .gototags (zip)…', '');
    return await zip.generateAsync({ type:'blob' });
  }

  // Zip template
  setStatus('Unzipping template…', '');
  const zip = await JSZip.loadAsync(tpl);
  let replacedCount = 0;

  // Replace in *.json
  for (const f of Object.values(zip.files)) {
    if (f.dir || !f.name.toLowerCase().endsWith('.json')) continue;
    const txt = await f.async('string');
    const rep = txt
      .replaceAll('LOT_PLACEHOLDER', esc(lot))
      .replaceAll('QTY_PLACEHOLDER', esc(qty))
      .replaceAll('PRODUCT_PLACEHOLDER', esc(product));
    if (rep !== txt) { zip.file(f.name, rep); replacedCount++; }
  }

  // Replace in any inner *text* .gototags (nested, not zip)
  for (const f of Object.values(zip.files)) {
    if (f.dir || !f.name.toLowerCase().endsWith('.gototags')) continue;
    const raw = await zip.file(f.name).async('uint8array');
    const innerIsZip = raw[0] === 0x50 && raw[1] === 0x4B;
    if (!innerIsZip) {
      const txt = new TextDecoder().decode(raw);
      const rep = txt
        .replaceAll('LOT_PLACEHOLDER', esc(lot))
        .replaceAll('QTY_PLACEHOLDER', esc(qty))
        .replaceAll('PRODUCT_PLACEHOLDER', esc(product));
      if (rep !== txt) { zip.file(f.name, rep); replacedCount++; }
    }
  }

  setStatus(`Creating .gototags (zip)… <small>${replacedCount} file(s) updated</small>`, '');
  return await zip.generateAsync({ type:'blob' });
}

/* ---------------- Single-run click protection ------------------ */

/** Prevent multiple bindings if nfctags.js gets injected twice (themes, layouts, etc.) */
if (!window.__NFCTAGS_BOUND__) {
  window.__NFCTAGS_BOUND__ = true;

  window.addEventListener('DOMContentLoaded', () => {
    const btn = $('#btnGen');
    if (!btn) return;

    let generating = false;

    btn.addEventListener('click', async () => {
      if (generating) {
        console.debug('[nfctags] click ignored (already generating)');
        return;
      }
      generating = true;
      btn.disabled = true;
      btn.textContent = 'Generating…';

      try {
        setStatus('Validating inputs…', '');
        const lot = $('#lot').value.trim();
        const qty = $('#qty').value.trim();
        const product = $('#product').value.trim();
        if (!lot || !qty || !product) {
          setStatus('Please enter <b>Lot</b>, <b>Quantity</b>, and <b>Product</b>.', 'warn');
          return;
        }

        const blob = await makeGototagsFromTemplate({ lot, qty, product });
        const name = `encode_run_${nowStamp()}_${lot.replace(/[^A-Za-z0-9_-]/g,'_')}.gototags`;
        setStatus('Downloading file…', '');
        saveAs(blob, name);
        setStatus(`✅ Downloaded <b>${name}</b>. Double‑click it to open GoToTags → Start ▶ → write the tag.`, 'ok');
      } catch (err) {
        console.error(err);
        appendLog(String(err.stack || err));
        setStatus(`❌ Error: ${err.message}`, 'err');
      } finally {
        // Re-enable after a short cooldown to avoid double fires
        setTimeout(() => {
          generating = false;
          btn.disabled = false;
          btn.textContent = 'Generate Write File';
        }, 900);
      }
    });

    // Initial status
    setStatus('Page ready. Enter LOT / QTY / PRODUCT, then click <b>Generate Write File</b>.', '');
    console.debug('[nfctags] bound click handler once');
  });
} else {
  console.debug('[nfctags] skipped binding (already bound)');
}
