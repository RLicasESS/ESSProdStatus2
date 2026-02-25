/* nfctags.js
 * Browser-side generator for GoToTags operation files (.gototags) + Web NFC read-back.
 * Requirements:
 *   - JSZip (window.JSZip)
 *   - FileSaver (window.saveAs)
 *
 * Background:
 *   - GoToTags "operation files" saved by the Desktop App use the .gototags extension.
 *   - A .gototags file is a ZIP bundle that contains JSON for the operation. We fetch
 *     the template, replace placeholders, and re-zip entirely in the browser.  (Ref) gototags op file
 *     format & behavior.  [3](https://gototags.com/desktop-app/operations/operation-file)
 *   - Web NFC read-back runs on Chrome for Android (HTTPS, user gesture). [1](https://developer.chrome.com/docs/capabilities/nfc)[2](https://developer.mozilla.org/en-US/docs/Web/API/Web_NFC_API)
 */

const TEMPLATE_URL = 'encode_lot_template.gototags'; // place your template here
const statusEl = () => document.getElementById('status');
const logEl = () => document.getElementById('log');

// --- small helpers ---
const esc = (s='') =>
  String(s)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n'); // JSON-safe newline

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

async function fetchTemplateBlob() {
  const res = await fetch(TEMPLATE_URL, {cache: 'no-store'});
  if (!res.ok) throw new Error(`Failed to fetch template: ${res.status} ${res.statusText}`);
  return await res.blob();
}

function nowStamp() {
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Detect if bytes look like ZIP ('PK')
async function isZipBlob(blob) {
  const head = await blob.slice(0,2).arrayBuffer();
  const b = new Uint8Array(head);
  return b[0] === 0x50 && b[1] === 0x4B;
}

// Replace in all JSON and all non‑zip .gototags entries
async function makeGototagsFromTemplate({lot, qty, product}) {
  const tpl = await fetchTemplateBlob();

  // If the template itself is a text .gototags (not a zip), treat as single file
  if (!(await isZipBlob(tpl))) {
    const text = await tpl.text();
    const replaced = text
      .replaceAll('LOT_PLACEHOLDER', esc(lot))
      .replaceAll('QTY_PLACEHOLDER', esc(qty))
      .replaceAll('PRODUCT_PLACEHOLDER', esc(product));

    // Repackage as a .gototags ZIP with a single inner text op file
    const zip = new JSZip();
    zip.file('file.gototags', replaced); // inner text op file name
    return await zip.generateAsync({type:'blob'});
  }

  // Template is a zip (.gototags). Load with JSZip.
  const zip = await JSZip.loadAsync(tpl);

  // Replace in *.json
  const jsonFiles = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.json'));
  for (const f of jsonFiles) {
    const txt = await f.async('string');
    const rep = txt
      .replaceAll('LOT_PLACEHOLDER', esc(lot))
      .replaceAll('QTY_PLACEHOLDER', esc(qty))
      .replaceAll('PRODUCT_PLACEHOLDER', esc(product));
    zip.file(f.name, rep);
  }

  // Replace in any inner text .gototags (nested, not zip)
  const innerOps = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.gototags'));
  for (const f of innerOps) {
    const raw = await zip.file(f.name).async('uint8array');
    // Check if inner is ZIP; if not, treat as text
    const isInnerZip = raw[0] === 0x50 && raw[1] === 0x4B;
    if (!isInnerZip) {
      const txt = new TextDecoder().decode(raw);
      const rep = txt
        .replaceAll('LOT_PLACEHOLDER', esc(lot))
        .replaceAll('QTY_PLACEHOLDER', esc(qty))
        .replaceAll('PRODUCT_PLACEHOLDER', esc(product));
      zip.file(f.name, rep); // overwrite with new text
    }
  }

  return await zip.generateAsync({type:'blob'});
}

async function onGenerate() {
  const lot = document.getElementById('lot').value.trim();
  const qty = document.getElementById('qty').value.trim();
  const product = document.getElementById('product').value.trim();

  if (!lot || !qty || !product) {
    setStatus('Please enter <b>Lot</b>, <b>Quantity</b>, and <b>Product</b>.', 'warn');
    return;
  }

  setStatus('Generating <code>.gototags</code>…', '');

  try {
    const blob = await makeGototagsFromTemplate({lot, qty, product});
    const name = `encode_run_${nowStamp()}_${lot.replace(/[^A-Za-z0-9_-]/g,'_')}.gototags`;
    saveAs(blob, name); // FileSaver.js
    setStatus(`Downloaded <b>${name}</b>. <br/>Double‑click it to open GoToTags, press <b>Start ▶</b>, and write a tag.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(`Error generating file: ${err.message}`, 'err');
  }
}

// ---------------- Web NFC read-back (Chrome/Android) ----------------
// Ref: Web NFC launched in Chrome 89 for Android; NDEFReader API. [1](https://developer.chrome.com/docs/capabilities/nfc)[2](https://developer.mozilla.org/en-US/docs/Web/API/Web_NFC_API)
async function onReadBack() {
  // Feature detection (API presence ≠ hardware presence)
  if (!('NDEFReader' in window)) {
    setStatus('This browser does not support Web NFC. Try Chrome on Android over HTTPS.', 'warn');
    return;
  }

  const lot = document.getElementById('lot').value.trim();
  const qty = document.getElementById('qty').value.trim();
  const product = document.getElementById('product').value.trim();

  const ndef = new NDEFReader();
  try {
    await ndef.scan(); // triggers permission prompt (must be in response to a user gesture)
    setStatus('Hold tag near the device…', '');

    ndef.onreading = (event) => {
      const {message, serialNumber} = event;
      let texts = [];
      let uris  = [];

      for (const record of message.records) {
        try {
          if (record.recordType === 'text') {
            const lang = record.lang || 'en';
            const dec  = new TextDecoder(record.encoding || 'utf-8');
            texts.push(dec.decode(record.data));
          } else if (record.recordType === 'url' || record.recordType === 'uri') {
            const dec = new TextDecoder('utf-8');
            uris.push(dec.decode(record.data));
          } else {
            // Fallback: try to decode as UTF‑8 text
            const dec = new TextDecoder('utf-8');
            const maybe = dec.decode(record.data);
            if (maybe) texts.push(maybe);
          }
        } catch {}
      }

      appendLog(`Serial: ${serialNumber || '(n/a)'}\nTEXT: ${JSON.stringify(texts)}\nURIs: ${JSON.stringify(uris)}\n`);

      // Simple match check against current inputs. Adjust if your template’s record order differs.
      const lotOK = texts.some(t => t === lot);
      const qtyOK = texts.some(t => t === qty) || uris.some(u => u === `tel:${qty}` || u.endsWith(`tel:${qty}`));
      const prodOK= texts.some(t => t === product);

      if (lotOK && qtyOK && prodOK) {
        setStatus('✅ Read-back success: tag content matches LOT / QTY / PRODUCT.', 'ok');
      } else {
        setStatus('⚠️ Read-back mismatch. See log below for records we saw.', 'warn');
      }
    };

    ndef.onreadingerror = () => {
      setStatus('Could not read data from the tag. Move closer and try again.', 'err');
    };
  } catch (err) {
    setStatus(`Web NFC error: ${err.message}`, 'err');
  }
}

// Wire up buttons
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnGen').addEventListener('click', onGenerate);
  document.getElementById('btnRead').addEventListener('click', onReadBack);
});
