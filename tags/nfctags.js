/* nfctags_dev.js — DEV version of nfctags.js
 * Same file generation logic as nfctags.js
 * SHEET_URL_BASE points to the dev/same Apps Script endpoint
 */

//////////////////////
// Configuration
//////////////////////
const TEMPLATE_URL       = 'encode_lot_template.gototags';
const SHEET_URL_BASE     = 'https://script.google.com/macros/s/AKfycbyK0g8lpoicoNxZcwWEVHbGsKrb5MYpo2u6-IH2qoKuD5SMIbeGb4lqoIVSHSYEz7Zjvg/exec';
const STRICT_LOGGING     = true;
const REQUEST_TIMEOUT_MS = 10000;

//////////////////////
// DOM helpers
//////////////////////
const $ = (s) => document.querySelector(s);
function setStatus(html, cls='') {
  const el = $('#status'); if (!el) return;
  el.className = cls; el.innerHTML = html;
}
function appendLog(line='') {
  const el = $('#log'); if (!el) return;
  el.hidden = false; el.textContent += line + '\n';
}

//////////////////////
// Utilities
//////////////////////
const esc = (s='') =>
  String(s)
    .replaceAll('\\','\\\\')
    .replaceAll('"','\\"')
    .replaceAll('\r\n','\n')
    .replaceAll('\r','\n');

function nowStamp() {
  const d = new Date(); const z = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}
async function isZipBlob(blob) {
  const head = await blob.slice(0,2).arrayBuffer();
  const b = new Uint8Array(head);
  return b[0] === 0x50 && b[1] === 0x4B;
}
async function fetchWithTimeout(resource, options={}) {
  const { timeout = REQUEST_TIMEOUT_MS, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(resource, { signal: controller.signal, ...rest }); }
  finally { clearTimeout(id); }
}
async function fetchTemplateBlob() {
  setStatus('Fetching template…','');
  const res = await fetch(TEMPLATE_URL, { cache:'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch ${TEMPLATE_URL} (${res.status})`);
  setStatus('Template loaded. Preparing data…','');
  return await res.blob();
}

//////////////////////
// Build .gototags
//////////////////////
async function makeGototagsFromTemplate({ lot, qty, product }) {
  const tpl = await fetchTemplateBlob();

  if (!(await isZipBlob(tpl))) {
    setStatus('Template is a text operation file. Repacking…','');
    const text = await tpl.text();
    const mpc      = $('#mpc')?.value.trim()         || '';
    const pkgType  = $('#packagetype')?.value.trim() || '';
    const dateCode = $('#datecode')?.value.trim()    || '';

    const replaced = text
      .replaceAll('LOT_PLACEHOLDER',      esc(lot))
      .replaceAll('QTY_PLACEHOLDER',      esc(qty))
      .replaceAll('PRODUCT_PLACEHOLDER',  esc(product))
      .replaceAll('MPC_PLACEHOLDER',      esc(mpc))
      .replaceAll('PKG_PLACEHOLDER',      esc(pkgType))
      .replaceAll('DATECODE_PLACEHOLDER', esc(dateCode));
    const zip = new JSZip();
    zip.file('file.gototags', replaced);
    setStatus('Creating .gototags (zip)…','');
    return await zip.generateAsync({ type:'blob' });
  }

  setStatus('Unzipping template…','');
  const zip = await JSZip.loadAsync(tpl);
  let replacedCount = 0;

  for (const f of Object.values(zip.files)) {
    if (f.dir || !f.name.toLowerCase().endsWith('.json')) continue;
    const txt = await f.async('string');
    const rep = txt
      .replaceAll('LOT_PLACEHOLDER', esc(lot))
      .replaceAll('QTY_PLACEHOLDER', esc(qty))
      .replaceAll('PRODUCT_PLACEHOLDER',  esc(product))
      .replaceAll('MPC_PLACEHOLDER',      esc($('#mpc')?.value.trim() || ''))
      .replaceAll('PKG_PLACEHOLDER',      esc($('#packagetype')?.value.trim() || ''))
      .replaceAll('DATECODE_PLACEHOLDER', esc($('#datecode')?.value.trim() || ''));
    if (rep !== txt) { zip.file(f.name, rep); replacedCount++; }
  }

  for (const f of Object.values(zip.files)) {
    if (f.dir || !f.name.toLowerCase().endsWith('.gototags')) continue;
    const raw = await zip.file(f.name).async('uint8array');
    const innerIsZip = raw[0] === 0x50 && raw[1] === 0x4B;
    if (!innerIsZip) {
      const txt = new TextDecoder().decode(raw);
      const rep = txt
        .replaceAll('LOT_PLACEHOLDER', esc(lot))
        .replaceAll('QTY_PLACEHOLDER', esc(qty))
        .replaceAll('PRODUCT_PLACEHOLDER',  esc(product))
        .replaceAll('MPC_PLACEHOLDER',      esc($('#mpc')?.value.trim() || ''))
        .replaceAll('PKG_PLACEHOLDER',      esc($('#packagetype')?.value.trim() || ''))
        .replaceAll('DATECODE_PLACEHOLDER', esc($('#datecode')?.value.trim() || ''));
      if (rep !== txt) { zip.file(f.name, rep); replacedCount++; }
    }
  }

  setStatus(`Creating .gototags (zip)… <small>${replacedCount} file(s) updated</small>`,'');
  return await zip.generateAsync({ type:'blob' });
}

//////////////////////
// Click handler
//////////////////////
let generating = false;

async function onGenerate() {
  if (generating) return;
  generating = true;

  const btn = $('#btnGen');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  try {
    setStatus('Validating inputs…','');
    const lot     = $('#lot')?.value.trim()     || '';
    const qty     = $('#qty')?.value.trim()     || '';
    const product = $('#product')?.value.trim() || '';

    if (!lot || !qty || !product) {
      setStatus('Please enter <b>Lot</b>, <b>Quantity</b>, and <b>Product</b>.','warn');
      return;
    }
    if (!/^\d+$/.test(qty)) {
      setStatus('Quantity must be a whole number.','warn');
      return;
    }

    // Build + download — sheet writes already handled by blur events
    const blob = await makeGototagsFromTemplate({ lot, qty, product });
    const safeLot = lot.replace(/[^A-Za-z0-9_\-]/g,'_');
    const name = `encode_run_${nowStamp()}_${safeLot}.gototags`;

    setStatus('Downloading file…','');
    saveAs(blob, name);

    setStatus(
      `✅ Downloaded <b>${name}</b>. ` +
      `Double‑click to open GoToTags → press <b>Start ▶</b> → write the tag.`,
      'ok'
    );
  } catch (err) {
    console.error(err);
    appendLog(String(err.stack || err));
    setStatus(`❌ Error: ${err.message}`,'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Write File'; }
    generating = false;
  }
}

//////////////////////
// Bind once
//////////////////////
if (!window.__NFCTAGS_BOUND__) {
  window.__NFCTAGS_BOUND__ = true;
  window.addEventListener('DOMContentLoaded', () => {
    const btn = $('#btnGen');
    if (btn) {
      btn.addEventListener('click', onGenerate, { once: false });
      setStatus('Page ready. Enter LOT / QTY / PRODUCT, then click <b>Generate Write File</b>.','');
      console.debug('[nfctags_dev] bound click handler');
    } else {
      console.warn('[nfctags_dev] #btnGen not found');
    }
  });
} else {
  console.debug('[nfctags_dev] skipped binding (already bound)');
}
