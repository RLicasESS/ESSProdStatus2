/* nfctags.js — Generate GoToTags operation file + log to ESS Current Lots
 *
 * - Builds a .gototags (zip) in-browser from your template
 * - Logs each run to Google Sheets via your Apps Script Web App
 * - Clear UI status + console logs for debugging
 * - Single-click guard (no duplicate downloads)
 */

///////////////////////////
// Configuration
///////////////////////////

const TEMPLATE_URL   = 'encode_lot_template.gototags'; // must exist alongside index.html
const STRICT_LOGGING = true; // true = abort download if Sheets logging fails; false = best effort

///////////////////////////
// DOM helpers
///////////////////////////

const $ = (s) => document.querySelector(s);
const statusEl = () => $('#status');
const logEl    = () => $('#log');

function setStatus(html, cls = '') {
  const el = statusEl();
  if (!el) return;
  el.className = cls;
  el.innerHTML = html;
}
function appendLog(line = '') {
  const el = logEl();
  if (!el) return;
  el.hidden = false;
  el.textContent += line + '\n';
}

///////////////////////////
// Utilities
///////////////////////////

const esc = (s = '') =>
  String(s)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n');

function nowStamp() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

async function isZipBlob(blob) {
  const head = await blob.slice(0, 2).arrayBuffer();
  const b = new Uint8Array(head);
  return b[0] === 0x50 && b[1] === 0x4B; // 'PK'
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(resource, { signal: controller.signal, ...rest });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function fetchTemplateBlob() {
  setStatus('Fetching template…', '');
  const res = await fetch(TEMPLATE_URL, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${TEMPLATE_URL} (${res.status})`);
  }
  setStatus('Template loaded. Preparing data…', '');
  return await res.blob();
}

///////////////////////////
// Build .gototags from template
///////////////////////////

async function makeGototagsFromTemplate({ lot, qty, product }) {
  const tpl = await fetchTemplateBlob();

  // Case A: the template itself is a text operation file (not a zip)
  if (!(await isZipBlob(tpl))) {
    setStatus('Template is a text operation file. Repacking…', '');
    const text = await tpl.text();
    const replaced = text
      .replaceAll('LOT_PLACEHOLDER', esc(lot))
      .replaceAll('QTY_PLACEHOLDER', esc(qty))
      .replaceAll('PRODUCT_PLACEHOLDER', esc(product));

    const zip = new JSZip();
    // The inner text op file name used by GoToTags bundles (commonly file.gototags)
    zip.file('file.gototags', replaced);
    setStatus('Creating .gototags (zip)…', '');
    return await zip.generateAsync({ type: 'blob' });
  }

  // Case B: template is a zip .gototags
  setStatus('Unzipping template…', '');
  const zip = await JSZip.loadAsync(tpl);
  let replacedCount = 0;

  // Replace placeholders in any *.json entries
  for (const f of Object.values(zip.files)) {
    if (f.dir || !f.name.toLowerCase().endsWith('.json')) continue;
    const txt = await f.async('string');
    const rep = txt
      .replaceAll('LOT_PLACEHOLDER', esc(lot))
      .replaceAll('QTY_PLACEHOLDER', esc(qty))
      .replaceAll('PRODUCT_PLACEHOLDER', esc(product));
    if (rep !== txt) {
      zip.file(f.name, rep);
      replacedCount++;
    }
  }

  // Replace in any inner *text* .gototags (nested, not zip)
  for (const f of Object.values(zip.files)) {
    if (f.dir || !f.name.toLowerCase().endsWith('.gototags')) continue;
    const raw = await zip.file(f.name).async('uint8array');
    const innerIsZip = raw[0] === 0x50 && raw[1] === 0x4B; // 'PK'
    if (!innerIsZip) {
      const txt = new TextDecoder().decode(raw);
      const rep = txt
        .replaceAll('LOT_PLACEHOLDER', esc(lot))
        .replaceAll('QTY_PLACEHOLDER', esc(qty))
        .replaceAll('PRODUCT_PLACEHOLDER', esc(product));
      if (rep !== txt) {
        zip.file(f.name, rep);
        replacedCount++;
      }
    }
  }

  setStatus(`Creating .gototags (zip)… <small>${replacedCount} file(s) updated</small>`, '');
  return await zip.generateAsync({ type: 'blob' });
}

///////////////////////////
// Google Sheets logging (Apps Script Web App)
///////////////////////////

async function logToEssSheet({ lot, product, qty }) {
  // Your provided endpoint:
  // https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec?action=lot_seed&lot_id=<LOT>&product=<PRODUCT>&qty=<QTY>
  const base = 'https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec';
  const url = new URL(base);
  url.searchParams.set('action',  'lot_seed');
  url.searchParams.set('lot_id',  lot);
  url.searchParams.set('product', product);
  url.searchParams.set('qty',     qty);

  setStatus('Logging to <b>ESS Current Lots → Lot Number</b>…', '');
  console.debug('[Sheets] GET', url.toString());

  // 8s timeout; adjust as needed
  const res = await fetchWithTimeout(url.toString(), { method: 'GET', timeout: 8000 });

  // Try to parse as JSON; fall back to text
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  let body;
  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }

  if (!res.ok) {
    const msg = typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200);
    throw new Error(`Sheets logging failed (${res.status}): ${msg}`);
  }

  console.debug('[Sheets] Response:', body);
  setStatus('✅ Logged to <b>ESS Current Lots</b>. Creating .gototags…', 'ok');
  return body;
}

///////////////////////////
// Click handler (single-run; prevents duplicates)
///////////////////////////

let generating = false;

async function onGenerate() {
  if (generating) {
    console.debug('[nfctags] click ignored (already generating)');
    return;
  }
  generating = true;

  const btn = $('#btnGen');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generating…';
  }

  try {
    setStatus('Validating inputs…', '');
    const lot     = $('#lot')?.value.trim()     || '';
    const qty     = $('#qty')?.value.trim()     || '';
    const product = $('#product')?.value.trim() || '';

    if (!lot || !qty || !product) {
      setStatus('Please enter <b>Lot</b>, <b>Quantity</b>, and <b>Product</b>.', 'warn');
      return;
    }

    // 1) Log to Google Sheets (strict or best-effort)
    try {
      await logToEssSheet({ lot, product, qty });
    } catch (e) {
      console.warn('[Sheets] logging error:', e);
      appendLog('Sheets logging error: ' + e.message);
      const warn = '⚠️ Could not log to <b>ESS Current Lots</b>.';
      if (STRICT_LOGGING) {
        setStatus(`${warn} Download aborted.`, 'err');
        return; // Stop here if logging is required
      } else {
        setStatus(`${warn} Continuing to create .gototags…`, 'warn');
      }
    }

    // 2) Create and download the .gototags
    const blob = await makeGototagsFromTemplate({ lot, qty, product });
    const safeLot = lot.replace(/[^A-Za-z0-9_-]/g, '_');
    const name = `encode_run_${nowStamp()}_${safeLot}.gototags`;

    setStatus('Downloading file…', '');
    saveAs(blob, name);

    // 3) Final message
    setStatus(
      `✅ Downloaded <b>${name}</b>${STRICT_LOGGING ? ' and logged to ESS.' : '.'} ` +
      `Double‑click it to open GoToTags → press <b>Start ▶</b> → write the tag.`,
      'ok'
    );
  } catch (err) {
    console.error(err);
    appendLog(String(err.stack || err));
    setStatus(`❌ Error: ${err.message}`, 'err');
  } finally {
    setTimeout(() => {
      generating = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Generate Write File';
      }
    }, 900);
  }
}

///////////////////////////
// Bind once
///////////////////////////

if (!window.__NFCTAGS_BOUND__) {
  window.__NFCTAGS_BOUND__ = true;
  window.addEventListener('DOMContentLoaded', () => {
    const btn = $('#btnGen');
    if (btn) {
      btn.addEventListener('click', onGenerate, { once: false });
      setStatus('Page ready. Enter LOT / QTY / PRODUCT, then click <b>Generate Write File</b>.', '');
      console.debug('[nfctags] bound click handler once');
    } else {
      console.warn('[nfctags] #btnGen not found');
    }
  });
} else {
  console.debug('[nfctags] skipped binding (already bound)');
}
