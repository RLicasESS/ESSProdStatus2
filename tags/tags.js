// ==========================================
// Tags UI → ESS Current Lots (VER33 UI)
// - VIEW TAGS TABLE: calls action=tags_table (server scans lot tabs)
// - LOOKUP: searches cached table
//   - NOT FOUND  -> show Register UI (Register button)
//   - FOUND      -> show Found UI (Edit + Deregister buttons)
// - REGISTER: calls action=tag_seed
// - EDIT: (toggle edit mode) then Save -> calls action=tag_seed (overwrite row2 identity fields)
// - DEREGISTER: calls action=tag_deregister (clears TAG_ID in row2; removed from table)
// ==========================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec";

function $(id) { return document.getElementById(id); }

// ---------- Status helpers ----------
function showStatus(html, isError = false) {
  const el = $("status") || $("tableStatus") || $("result");
  if (!el) return;
  el.style.display = "";
  el.style.padding = "10px";
  el.style.borderRadius = "8px";
  el.style.border = "1px solid #ccc";
  el.style.background = isError ? "#fff2f2" : "#f3fff3";
  el.style.color = isError ? "#b00020" : "#0a6b0a";
  el.innerHTML = html;
}
function hideStatus() {
  const el = $("status") || $("tableStatus") || $("result");
  if (!el) return;
  el.style.display = "none";
  el.innerHTML = "";
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

function cleanIntOrBlank(s) {
  const t = String(s || "").replace(/,/g, "").trim();
  if (!t) return "";
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return Math.trunc(v);
}

function normTag(s) {
  return String(s || "").trim(); // keep leading zeros; exact match
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
// DOM helpers for this page
// index.html has: tag, lookup, viewTable, registerBox, lot, qty, product,
// register, cancelRegister, tableBox, closeTable, table, result
// -------------------------------
function ensureDeregisterButton_() {
  // Create a Deregister button dynamically (so you don't have to edit index.html)
  // Put it next to "Register" and "Cancel" inside the registerBox.
  const box = $("registerBox");
  if (!box) return null;

  // Find the row that contains register/cancel (your last button row)
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
  EDIT_MODE = true; // allow typing for new registration
  setInputsEditable_(true);

  const regBtn = $("register");
  if (regBtn) regBtn.textContent = "Register";

  const deregBtn = ensureDeregisterButton_();
  if (deregBtn) deregBtn.style.display = "none";

  // Cancel shows and just hides the box / clears
  if ($("cancelRegister")) $("cancelRegister").style.display = "";
}

function setRegisterUIForFoundView_() {
  FOUND_MODE = true;
  EDIT_MODE = false; // view-only until user clicks Edit
  setInputsEditable_(false);

  const regBtn = $("register");
  if (regBtn) regBtn.textContent = "Edit Data";

  const deregBtn = ensureDeregisterButton_();
  if (deregBtn) deregBtn.style.display = "";

  if ($("cancelRegister")) $("cancelRegister").style.display = "";
}

function setRegisterUIForFoundEdit_() {
  FOUND_MODE = true;
  EDIT_MODE = true;
  setInputsEditable_(true);

  const regBtn = $("register");
  if (regBtn) regBtn.textContent = "Save";

  const deregBtn = ensureDeregisterButton_();
  if (deregBtn) deregBtn.style.display = "";

  if ($("cancelRegister")) $("cancelRegister").style.display = "";
}

// -------------------------------
// Render tags table into <table id="table"><tbody>...
// -------------------------------
function renderTable(rows) {
  const table = $("table");
  if (!table) {
    showStatus("Loaded table, but #table not found.", true);
    return;
  }
  const tbody = table.querySelector("tbody");
  if (!tbody) {
    showStatus("Loaded table, but <tbody> not found.", true);
    return;
  }

  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    // keep header, show empty row
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
  hideStatus();

  // Optional: show table box
  if ($("tableBox")) $("tableBox").style.display = "";

  if ($("tableStatus")) $("tableStatus").textContent = "Loading tags table…";

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
    // NOT FOUND -> show register mode (blank fields)
    if ($("lot")) $("lot").value = "";
    if ($("qty")) $("qty").value = "";
    if ($("product")) $("product").value = "";

    setRegisterUIForNotFound_();
    return showStatus("Not found. Enter Lot ID / Lot Qty / Product then click Register.");
  }

  // FOUND -> show fields populated, but as view-only; buttons are Edit + Deregister
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

  // If FOUND and currently view-only, first click should enter edit mode (no API call)
  if (FOUND_MODE && !EDIT_MODE) {
    setRegisterUIForFoundEdit_();
    return showStatus("Edit mode ✅ Update fields, then click Save.");
  }

  // Otherwise we are registering new, or saving edits.
  const lot = $("lot")?.value.trim();
  const qtyRaw = $("qty")?.value.trim();
  const product = $("product")?.value.trim();

  if (!lot) return showStatus("Missing Lot ID (this will be the tab name).", true);
  if (!product) return showStatus("Missing Product Name.", true);

  const qtyVal = cleanIntOrBlank(qtyRaw);
  if (qtyVal === null) return showStatus("Lot Qty must be a number.", true);
  if (qtyVal === "") return showStatus("Lot Qty cannot be blank.", true);

  const verb = FOUND_MODE ? "Saving…" : "Registering…";
  showStatus(verb);

  const out = await apiGet("tag_seed", {
    sheet: lot,
    lot_id: lot,
    tag_id: tag,
    product: product,
    qty: String(qtyVal)
  });

  // After success, refresh table, then switch to found-view mode.
  try { await viewTagsTable(); } catch { /* ignore */ }

  // Update CURRENT_HIT from new table if possible
  const newHit = TAGS_TABLE.find(r => normTag(r.TAG_ID) === tag) || null;
  CURRENT_HIT = newHit;

  setRegisterUIForFoundView_();
  showStatus(
    `Done ✅<br><br>
     <b>Tab</b>: ${out.tab || lot}<br>
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

  const lot = $("lot")?.value.trim() || (CURRENT_HIT ? CURRENT_HIT.LOT_ID : "");
  if (!lot) return showStatus("Missing Lot ID to deregister.", true);

  // Optional confirm
  const ok = window.confirm(`Deregister Tag ${tag} from Lot ${lot}?\n\nThis will clear TAG_ID in row 2 of that lot tab.`);
  if (!ok) return;

  showStatus("Deregistering…");

  const out = await apiGet("tag_deregister", { sheet: lot, lot_id: lot });

  // Refresh table; this tag should disappear
  try { await viewTagsTable(); } catch { /* ignore */ }

  // Clear UI back to "not found" mode with blank fields
  clearForm_();
  showRegisterBox_();
  setRegisterUIForNotFound_();

  showStatus(`Deregistered ✅<br><small>${out.note || ""}</small>`);
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
  // Ensure register box starts hidden
  hideRegisterBox_();

  // Buttons
  if ($("viewTable")) $("viewTable").onclick = () => viewTagsTable().catch(e => showStatus(e.message, true));
  if ($("lookup")) $("lookup").onclick = () => { try { lookupTag(); } catch (e) { showStatus(String(e), true); } };

  if ($("register")) $("register").onclick = () => registerEditSaveClicked().catch(e => showStatus(e.message, true));
  if ($("cancelRegister")) $("cancelRegister").onclick = () => cancelRegister();

  const deregBtn = ensureDeregisterButton_();
  if (deregBtn) deregBtn.onclick = () => deregisterClicked().catch(e => showStatus(e.message, true));

  if ($("closeTable")) $("closeTable").onclick = () => closeTable();

  // Enter key behavior:
  // - Enter on TAG triggers lookup
  // - Enter on LOT/QTY/PRODUCT triggers register/edit/save (depending on mode)
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
