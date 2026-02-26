/* nfctags.js — Generate GoToTags operation + log to ESS Current Lots (per‑lot tabs)
 * - Sends sheet=<LOT_ID> so each lot logs to its own tab
 * - Shows "🆕 Created tab <LOT_ID>" if server returns created_tab:true (optional)
 * - Strict logging: aborts download if logging fails (toggle STRICT_LOGGING to false for best‑effort)
 */

//////////////////////
// Configuration
//////////////////////
const TEMPLATE_URL       = 'encode_lot_template.gototags'; // alongside index.html
const SHEET_URL_BASE     = 'https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec';
const STRICT_LOGGING     = true;      // true: abort download if Sheets logging fails; false: warn but continue
const REQUEST_TIMEOUT_MS = 10000;     // 10s timeout for web requests

//////////////////////
// DOM helpers
//////////////////////
const $ = (s) => document.querySelector(s);
const statusEl = () => $('#status');
const logEl    = () => $('#log');
function setStatus(html, cls='') {
  const el = statusEl(); if (!el) return;
  el.className = cls; el.innerHTML = html;
}
function appendLog(line='') {
  const el = logEl(); if (!el) return;
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
  return b[0] === 0x50 && b[1] === 0x4B; // 'PK'
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

  // A) Template is a plain text operation file (not a zip)
  if (!(await isZipBlob(tpl))) {
    setStatus('Template is a text operation file. Repacking…','');
    const text = await tpl.text();
    const replaced = text
      .replaceAll('LOT_PLACEHOLDER', esc(lot))
      .replaceAll('QTY_PLACEHOLDER', esc(qty))
      .replaceAll('PRODUCT_PLACEHOLDER', esc(product));
    const zip = new JSZip();
    zip.file('file.gototags', replaced); // inner op file common name
    setStatus('Creating .gototags (zip)…','');
    return await zip.generateAsync({ type:'blob' });
  }

  // B) Template is a zipped .gototags
  setStatus('Unzipping template…','');
  const zip = await JSZip.loadAsync(tpl);
  let replacedCount = 0;

  // Replace placeholders in *.json
  for (const f of Object.values(zip.files)) {
    if (f.dir || !f.name.toLowerCase().endsWith('.json')) continue;
    const txt = await f.async('string');
    const rep = txt
      .replaceAll('LOT_PLACEHOLDER', esc(lot))
      .replaceAll('QTY_PLACEHOLDER', esc(qty))
      .replaceAll('PRODUCT_PLACEHOLDER', esc(product));
    if (rep !== txt) { zip.file(f.name, rep); replacedCount++; }
  }

  // Replace in any inner *text* .gototags (not a zip)
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

  setStatus(`Creating .gototags (zip)… <small>${replacedCount} file(s) updated</small>`,'');
  return await zip.generateAsync({ type:'blob' });
}

//////////////////////
// Sheets logging (per‑lot tab)
//////////////////////
// --- Sheets logging (PER‑LOT TAB) ---
async function logToEssSheet({ lot, product, qty }) {
  const base = 'https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec';
  const u = new URL(base);

  // Always send sheet=<LOT_ID> so the tab name equals the lot id
  u.searchParams.set('action',  'lot_seed');
  u.searchParams.set('lot_id',  lot);
  u.searchParams.set('product', product);
  u.searchParams.set('qty',     qty);
  u.searchParams.set('sheet',   lot);     // <<< key line

  // Status + visible target tab
  setStatus(`Logging to <b>ESS Current Lots</b> (tab: <b>${lot}</b>)…`, '');
  console.info('[Sheets] GET', u.toString());  // verify in DevTools → Network

  const res = await fetch(u.toString(), { method: 'GET', cache: 'no-store' });
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const body = ct.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const msg = typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200);
    throw new Error(`Sheets logging failed (${res.status}): ${msg}`);
  }

  // If you added created_tab on the server, surface it; otherwise show generic success
  if (typeof body === 'object' && body !== null) {
    if (body.ok === false) throw new Error(body.error || 'Sheets logging error');
    const tab = body.tab || lot;
    const row = body.identity_row ?? body.row ?? 2;
    if (body.created_tab === true) {
      setStatus(`🆕 Created tab <b>${tab}</b> and wrote identity row (row <b>${row}</b>). Creating .gototags…`, 'ok');
    } else {
      setStatus(`✅ Logged to <b>${tab}</b> (row <b>${row}</b>). Creating .gototags…`, 'ok');
    }
  } else {
    setStatus(`✅ Logged to <b>${lot}</b>. Creating .gototags…`, 'ok');
  }

  return body;
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

    // 1) Log to per‑lot tab
    try {
      await logToEssSheet({ lot, product, qty });
    } catch (e) {
      appendLog('Sheets logging error: ' + e.message);
      console.warn(e);
      if (STRICT_LOGGING) {
        setStatus('❌ Could not log to <b>ESS Current Lots</b>. Download aborted.','err');
        return;
      } else {
        setStatus('⚠️ Could not log to ESS (continuing). Creating .gototags…','warn');
      }
    }

    // 2) Build + download operation file
    const blob = await makeGototagsFromTemplate({ lot, qty, product });
    const safeLot = lot.replace(/[^A-Za-z0-9_-]/g,'_');
    const name = `encode_run_${nowStamp()}_${safeLot}.gototags`;

    setStatus('Downloading file…','');
    saveAs(blob, name);

    setStatus(
      `✅ Downloaded <b>${name}</b>${STRICT_LOGGING ? ' and logged to ESS.' : '.'} ` +
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
      btn.addEventListener('click', onGenerate, { once:false });
      setStatus('Page ready. Enter LOT / QTY / PRODUCT, then click <b>Generate Write File</b>.','');
      console.debug('[nfctags] bound click handler once');
    } else {
      console.warn('[nfctags] #btnGen not found');
    }
  });
} else {
  console.debug('[nfctags] skipped binding (already bound)');
}
