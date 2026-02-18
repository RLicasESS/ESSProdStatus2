// ==========================================
// Tags UI → ESS Current Lots (UI VER34)
// Fixes:
// 1) Heading switches between Registering vs Editing
// 2) After Save/Register, hide the form box
// 3) Deregister uses SHEET name (tab) so it actually clears row2 TAG_ID,
//    then refreshes table so the lot disappears immediately.
// ==========================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec";

function $(id) { return document.getElementById(id); }

// ---------- Status helpers ----------
function showStatus(html, isError = false, opts = {}) {
  const el = $("status");
  if (!el) return;

  const { busy = false, blink = false } = opts;

  el.style.display = "";
  el.style.padding = "14px 16px";
  el.style.borderRadius = "10px";
  el.style.border = isError ? "2px solid #b00020" : "2px solid #0a6b0a";
  el.style.background = isError ? "#ffe6ea" : "#eaffea";
  el.style.color = isError ? "#b00020" : "#0a6b0a";

  // BIG + loud
  el.style.fontSize = "20px";
  el.style.fontWeight = "900";
  el.style.letterSpacing = "0.2px";
  el.style.lineHeight = "1.25";

  // Strong emphasis shadow so it pops
  el.style.boxShadow = isError
    ? "0 0 0 3px rgba(176,0,32,0.18)"
    : "0 0 0 3px rgba(10,107,10,0.18)";

  // Optional “busy” look
  el.style.opacity = "1";
  el.style.transform = "scale(1)";
  el.style.transition = "opacity 120ms ease, transform 120ms ease";

  // Blink support (CSS injected once)
  ensureStatusBlinkCss_();
  el.classList.toggle("status-blink", !!blink);
  el.classList.toggle("status-busy", !!busy);

  el.innerHTML = html;
}

function hideStatus() {
  const el = $("status");
  if (!el) return;
  el.classList.remove("status-blink", "status-busy");
  el.style.display = "none";
  el.innerHTML = "";
}

// Inject animation CSS once
function ensureStatusBlinkCss_() {
  if (document.getElementById("statusBlinkCss")) return;

  const css = `
    @keyframes statusBlink {
      0%   { opacity: 1;   transform: scale(1); }
      50%  { opacity: 0.35; transform: scale(1.01); }
      100% { opacity: 1;   transform: scale(1); }
    }
    .status-blink {
      animation: statusBlink 0.85s ease-in-out infinite;
    }
    .status-busy {
      filter: saturate(1.35) contrast(1.15);
    }
  `;

  const style = document.createElement("style");
  style.id = "statusBlinkCss";
  style.textContent = css;
  document.head.appendChild(style);
}


// ---------- API ----------
async function apiGet(action, params = {}) {
  const u = new URL(API_URL);
  u.searchParams.set("action", action);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v == null ? "" : String(v));
  }

  const res = await fetch(u.toString(), { redirect: "follow", cache: "no-store" });
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Non-JSON response (auth / blocked / HTML): " + text.slice(0, 180));
  }
  if (!json.ok) throw new Error(json.error || "API error");
  return json;
}

function cleanIntOrNull(s) {
  const t = String(s || "").replace(/,/g, "").trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? Math.trunc(v) : NaN;
}

function normTag(s) {
  // keep leading zeros; exact match
  return String(s || "").trim();
}

// -------------------------------
// In-memory cached tags table
// -------------------------------
let TAGS_TABLE = []; // [{TAG_ID, LOT_ID, LOT_QTY, PRODUCT_NAME, SHEET}, ...]
let TAGS_TABLE_TS = 0;

// -------------------------------
// UI state
// -------------------------------
let CURRENT_HIT = null;  // row from TAGS_TABLE when FOUND
let FOUND_MODE = false;  // found existing registration
let EDIT_MODE = false;   // inputs editable when true

// -------------------------------
// Register box heading control
// -------------------------------
function setFormHeading_(text) {
  const box = $("registerBox");
  if (!box) return;

  // Your index.html has the first bold div inside registerBox as the heading:
  // <div style="font-weight:700;margin-bottom:8px">Registering new lot?</div>
  const divs = box.querySelectorAll("div");
  for (const d of divs) {
    const st = (d.getAttribute("style") || "").toLowerCase();
    if (st.includes("font-weight:700") && st.includes("margin-bottom")) {
      d.textContent = text;
      return;
    }
  }
  // Fallback: do nothing if we can't find it
}

// -------------------------------
// DOM helpers
// -------------------------------
function ensureDeregisterButton_() {
  const box = $("registerBox");
  if (!box) return null;

  const row = box.querySelector("button#register")?.parentElement;
  if (!row) return null;

  let btn = $("deregister");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "deregister";
    btn.textContent = "Deregister Tag";
    btn.style.marginLeft = "10px";
    row.appendChild(btn);
  }
  return btn;
}

function setInputsEditable_(editable) {
  for (const id of ["lot", "qty", "product"]) {
    const el = $(id);
    if (!el) continue;
    el.disabled = !editable;
  }
}

function clearForm_() {
  if ($("lot")) $("lot").value = "";
  if ($("qty")) $("qty").value = "";
  if ($("product")) $("product").value = "";
  CURRENT_HIT = null;
  FOUND_MODE = false;
  EDIT_MODE = false;
}

function showRegisterBox_() {
  if ($("registerBox")) $("registerBox").style.display = "";
}

function hideRegisterBox_() {
  if ($("registerBox")) $("registerBox").style.display = "none";
}

function setRegisterUIForNotFound_() {
  FOUND_MODE = false;
  EDIT_MODE = true; // new registration: editable
  setInputsEditable_(true);

  setFormHeading_("Registering new lot?");

  const regBtn = $("register");
  if (regBtn) regBtn.textContent = "Register";

  const deregBtn = ensureDeregisterButton_();
  if (deregBtn) deregBtn.style.display = "none";

  if ($("cancelRegister")) $("cancelRegister").style.display = "";
}

function setRegisterUIForFoundView_() {
  FOUND_MODE = true;
  EDIT_MODE = false; // view-only until Edit clicked
  setInputsEditable_(false);

  setFormHeading_("Editing current lot?");

  const regBtn = $("register");
  if (regBtn) regBtn.textContent = "Edit Data";

  const deregBtn = ensureDeregisterButton_();
  if (deregBtn) deregBtn.style.display = "";

  if ($("cancelRegister")) $("cancelRegister").style.display = "";
}

function setRegisterUIForFoundEdit_() {
  FOUND_MODE = true;
  EDIT_MODE = true; // editable
  setInputsEditable_(true);

  setFormHeading_("Editing current lot?");

  const regBtn = $("register");
  if (regBtn) regBtn.textContent = "Save";

  const deregBtn = ensureDeregisterButton_();
  if (deregBtn) deregBtn.style.display = "";

  if ($("cancelRegister")) $("cancelRegister").style.display = "";
}

// -------------------------------
// Table rendering
// -------------------------------
function renderTable(rows) {
  const table = $("table");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" style="padding:10px;color:#555">No rows.</td>`;
    tbody.appendChild(tr);
    return;
  }

  const esc = (x) =>
    String(x ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.TAG_ID)}</td>
      <td>${esc(r.LOT_ID)}</td>
      <td>${esc(r.LOT_QTY)}</td>
      <td>${esc(r.PRODUCT_NAME)}</td>
    `;
    tbody.appendChild(tr);
  }
}

// -------------------------------
// VIEW TAGS TABLE
// -------------------------------
async function viewTagsTable() {
  // Always do a fresh pull (don’t trust cache)
  if ($("tableBox")) $("tableBox").style.display = "";
  if ($("tableStatus")) $("tableStatus").textContent = "Loading tags table…";

  TAGS_TABLE = [];
  TAGS_TABLE_TS = 0;
  renderTable([]); // clear UI immediately

  const out = await apiGet("tags_table");
  TAGS_TABLE = Array.isArray(out.rows) ? out.rows : [];
  TAGS_TABLE_TS = Date.now();

  renderTable(TAGS_TABLE);

  const msg = `Loaded ✅ (${TAGS_TABLE.length} rows)`;
  if ($("tableStatus")) $("tableStatus").textContent = msg + (out.updated ? ` — ${out.updated}` : "");
  showStatus(msg, false);
}

// -------------------------------
// LOOKUP (uses cached table)
// -------------------------------
function lookupTag() {
  hideStatus();

  const tag = normTag($("tag")?.value);
  if (!tag) return showStatus("Missing Tag ID.", true);

  if (!TAGS_TABLE || TAGS_TABLE.length === 0) {
    return showStatus("Table is empty. Click VIEW TAGS TABLE first.", true);
  }

  const hit = TAGS_TABLE.find(r => normTag(r.TAG_ID) === tag);
  CURRENT_HIT = hit || null;

  showRegisterBox_();

  if (!hit) {
    if ($("lot")) $("lot").value = "";
    if ($("qty")) $("qty").value = "";
    if ($("product")) $("product").value = "";

    setRegisterUIForNotFound_();
    return showStatus("Not found. Enter Lot ID / Lot Qty / Product then click Register.");
  }

  // FOUND → show edit/deregister UI (NOT register UI)
  if ($("lot")) $("lot").value = hit.LOT_ID || "";
  if ($("qty")) $("qty").value = hit.LOT_QTY || "";
  if ($("product")) $("product").value = hit.PRODUCT_NAME || "";

  setRegisterUIForFoundView_();
  return showStatus("Found ✅ Loaded Lot/Qty/Product into the form.");
}

// -------------------------------
// REGISTER / EDIT / SAVE (single button)
// -------------------------------
async function registerEditSaveClicked() {
  hideStatus();

  const tag = normTag($("tag")?.value);
  if (!tag) return showStatus("Missing Tag ID.", true);

  // If FOUND and currently view-only: first click enters edit mode (no API call)
  if (FOUND_MODE && !EDIT_MODE) {
    setRegisterUIForFoundEdit_();
    return showStatus("Edit mode ✅ Update fields, then click Save.");
  }

  const lot = $("lot")?.value.trim();
  const qtyRaw = $("qty")?.value.trim();
  const product = $("product")?.value.trim();

  if (!lot) return showStatus("Missing Lot ID.", true);
  if (!product) return showStatus("Missing Product Name.", true);

  const qtyVal = cleanIntOrNull(qtyRaw);
  if (qtyVal === null) return showStatus("Lot Qty cannot be blank.", true);
  if (Number.isNaN(qtyVal)) return showStatus("Lot Qty must be a number.", true);

  // IMPORTANT:
  // - If editing a FOUND row, write to the original SHEET tab name (hit.SHEET),
  //   even if user changes LOT_ID field (we still update row2 LOT_ID cell).
  // - If registering new, sheet == lot (tab name).
  const sheetNameForWrite = (CURRENT_HIT && CURRENT_HIT.SHEET) ? String(CURRENT_HIT.SHEET).trim() : lot;

  showStatus(FOUND_MODE ? "Saving…" : "Registering…");

  const out = await apiGet("tag_seed", {
    sheet: sheetNameForWrite,
    lot_id: lot,
    tag_id: tag,
    product: product,
    qty: String(qtyVal)
  });

  // Refresh table after write
  try { await viewTagsTable(); } catch { /* ignore */ }

  // Hide the form after successful save/register (per your request)
  hideRegisterBox_();
  EDIT_MODE = false;

  showStatus(
    `Done ✅<br><br>
     <b>Sheet</b>: ${out.tab || sheetNameForWrite}<br>
     <b>LOT_ID</b>: ${out.lot_id || lot}<br>
     <b>TAG_ID</b>: ${out.tag_id || tag}<br>
     <b>PRODUCT</b>: ${out.product || product}<br>
     <b>LOT_QTY (IN)</b>: ${out.in_qty ?? qtyVal}`
  );
}

// -------------------------------
// DEREGISTER
// -------------------------------
async function deregisterClicked() {
  hideStatus();

  const tag = normTag($("tag")?.value);
  if (!tag) return showStatus("Missing Tag ID.", true);

  if (!CURRENT_HIT) {
    return showStatus("No current FOUND record selected. Lookup the tag first.", true);
  }

  // CRITICAL FIX: use SHEET (tab name), not LOT_ID
  const sheetName = String(CURRENT_HIT.SHEET || "").trim();
  const lotIdCell = String($("lot")?.value.trim() || CURRENT_HIT.LOT_ID || "").trim();

  if (!sheetName) return showStatus("Missing SHEET name for this record.", true);

  const ok = window.confirm(
    `Deregister Tag ${tag}?\n\nThis clears TAG_ID in row 2 of sheet "${sheetName}".`
  );
  if (!ok) return;

  showStatus("Deregistering…");

  await apiGet("tag_deregister", { sheet: sheetName, lot_id: lotIdCell });

  // Force refresh table (clears cache first)
  try { await viewTagsTable(); } catch { /* ignore */ }

  // Clear UI and hide form
  clearForm_();
  hideRegisterBox_();

  showStatus(`Deregistered ✅ (sheet "${sheetName}")`);
}

// -------------------------------
// Cancel / Close table
// -------------------------------
function cancelRegister() {
  hideStatus();
  hideRegisterBox_();
  clearForm_();
}

function closeTable() {
  if ($("tableBox")) $("tableBox").style.display = "none";
}

// -------------------------------
// Wire up
// -------------------------------
window.addEventListener("DOMContentLoaded", () => {
  hideRegisterBox_();

  if ($("viewTable")) $("viewTable").onclick = () => viewTagsTable().catch(e => showStatus(e.message, true));
  if ($("lookup")) $("lookup").onclick = () => { try { lookupTag(); } catch (e) { showStatus(String(e), true); } };

  if ($("register")) $("register").onclick = () => registerEditSaveClicked().catch(e => showStatus(e.message, true));
  if ($("cancelRegister")) $("cancelRegister").onclick = () => cancelRegister();

  const deregBtn = ensureDeregisterButton_();
  if (deregBtn) deregBtn.onclick = () => deregisterClicked().catch(e => showStatus(e.message, true));

  if ($("closeTable")) $("closeTable").onclick = () => closeTable();

  if ($("tag")) $("tag").addEventListener("keydown", ev => {
    if (ev.key === "Enter") lookupTag();
  });

  for (const id of ["lot", "qty", "product"]) {
    if (!$(id)) continue;
    $(id).addEventListener("keydown", ev => {
      if (ev.key === "Enter") registerEditSaveClicked().catch(e => showStatus(e.message, true));
    });
  }
});
