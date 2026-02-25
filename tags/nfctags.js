/* nfctags.js */
const TEMPLATE_URL = 'encode_lot_template.gototags'; // must exist in SAME folder as index.html

const statusEl = () => document.getElementById('status');
const logEl = () => document.getElementById('log');

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
  const pad = (n)=> String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
async function isZipBlob(blob) {
  const head = await blob.slice(0,2).arrayBuffer();
  const b = new Uint8Array(head);
  return b[0] === 0x50 && b[1] === 0x4B; // 'PK'
}
async function fetchTemplateBlob() {
  setStatus('Fetching template…', '');
  const res = await fetch(TEMPLATE_URL, {cache: 'no-store'});
  if (!res.ok) throw new Error(`Failed to fetch ${TEMPLATE_URL} (${res.status})`);
  setStatus('Template loaded. Preparing data…', '');
  return await res.blob();
}

async function makeGototagsFromTemplate({lot, qty, product}) {
  const tpl = await fetchTemplateBlob();

  // Text operation file case (not a zip): wrap into a zip with file.gototags
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
    return await zip.generateAsync({type:'blob'});
  }

  // Zip template
  setStatus('Unzipping template…', '');
  const zip = await JSZip.loadAsync(tpl);

  // Replace in *.json
  let replacedCount = 0;
  const jsonFiles = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.json'));
  for (const f of jsonFiles) {
    const txt = await f.async('string');
    const rep = txt
      .replaceAll('LOT_PLACEHOLDER', esc(lot))
      .replaceAll('QTY_PLACEHOLDER', esc(qty))
      .replaceAll('PRODUCT_PLACEHOLDER', esc(product));
    if (rep !== txt) { zip.file(f.name, rep); replacedCount++; }
  }

  // Replace in any inner *text* .gototags (not zip)
  const innerOps = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.gototags'));
  for (const f of innerOps) {
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
  return await zip.generateAsync({type:'blob'});
}

async function onGenerate() {
  try {
    setStatus('JavaScript OK. Validating inputs…', '');
    const lot = document.getElementById('lot').value.trim();
    const qty = document.getElementById('qty').value.trim();
    const product = document.getElementById('product').value.trim();
    if (!lot || !qty || !product) {
      setStatus('Please enter <b>Lot</b>, <b>Quantity</b>, and <b>Product</b>.', 'warn');
      return;
    }

    const blob = await makeGototagsFromTemplate({lot, qty, product});
    const name = `encode_run_${nowStamp()}_${lot.replace(/[^A-Za-z0-9_-]/g,'_')}.gototags`;
    setStatus('Downloading file…', '');
    saveAs(blob, name);
    setStatus(`✅ Downloaded <b>${name}</b>.<br>1) <b>Double‑click</b> it to open GoToTags, 2) press <b>Start ▶</b>, 3) write a tag, 4) click “Read Back”.`, 'ok');
  } catch (err) {
    console.error(err);
    appendLog(String(err.stack || err));
    setStatus(`❌ Error: ${err.message}.<br>Check that <code>${TEMPLATE_URL}</code> exists in the same folder and is accessible.`, 'err');
  }
}

// -------- Web NFC read-back (Chrome/Android, HTTPS) --------
async function onReadBack() {
  if (!('NDEFReader' in window)) {
    setStatus('This browser does not support Web NFC. Use Chrome on Android over HTTPS.', 'warn');
    return;
  }

  const lot = document.getElementById('lot').value.trim();
  const qty = document.getElementById('qty').value.trim();
  const product = document.getElementById('product').value.trim();

  const ndef = new NDEFReader();
  try {
    await ndef.scan(); // must be triggered by a user gesture
    setStatus('Hold the tag near your device…', '');
    ndef.onreading = (ev) => {
      const {message, serialNumber} = ev;
      let texts = [], uris = [];
      for (const rec of message.records) {
        try {
          const dec = new TextDecoder(rec.encoding || 'utf-8');
          const data = dec.decode(rec.data);
          if (rec.recordType === 'text') texts.push(data);
          else if (rec.recordType === 'url' || rec.recordType === 'uri') uris.push(data);
          else texts.push(data);
        } catch {}
      }
      appendLog(`Serial: ${serialNumber||'(n/a)'}\nTEXT: ${JSON.stringify(texts)}\nURI: ${JSON.stringify(uris)}`);

      const lotOK = texts.includes(lot);
      const qtyOK = texts.includes(qty) || uris.some(u => u === `tel:${qty}` || u.endsWith(`tel:${qty}`));
      const prodOK= texts.includes(product);

      setStatus(
        lotOK && qtyOK && prodOK
          ? '✅ Read‑back success: tag matches LOT / QTY / PRODUCT.'
          : '⚠️ Read‑back mismatch. See log below.',
        lotOK && qtyOK && prodOK ? 'ok' : 'warn'
      );
    };
    ndef.onreadingerror = () => setStatus('Could not read the tag. Move closer and try again.', 'err');
  } catch (err) {
    console.error(err); appendLog(String(err.stack || err));
    setStatus(`Web NFC error: ${err.message}`, 'err');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setStatus('Page ready. Enter LOT / QTY / PRODUCT, then click <b>Generate Write File</b>.', '');
  document.getElementById('btnGen').addEventListener('click', onGenerate);
});
``
