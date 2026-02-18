// ==========================================
// ESS Tags UI → ESS Current Lots (VER25)
// HTML IDs match index.html you pasted:
// tag, lookup, viewTable, result, registerBox,
// lot, qty, product, register, cancelRegister,
// tableBox, table (tbody), closeTable, tableStatus
// ==========================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec";

function $(id) { return document.getElementById(id); }

// -------------------------------
// Result / status box
// -------------------------------
function showResult(html, isError = false) {
  const el = $("result");
  if (!el) return;
  el.style.display = "";
  el.style.border = "1px solid #ccc";
  el.style.background = isError ? "#fff2f2" : "#f3fff3";
  el.style.color = isError ? "#b00020" : "#0a6b0a";
  el.innerHTML = html;
}
function hideResult() {
  const el = $("result");
  if (!el) return;
  el.style.display = "none";
  el.innerHTML = "";
}

// -------------------------------
// Register box show/hide
// -------------------------------
function showRegisterBox(show) {
  const box = $("registerBox");
  if (!box) return;
  box.style.display = show ? "" : "none";
}

function clearRegisterFields() {
  if ($("lot")) $("lot").value = "";
  if ($("qty")) $("qty").value = "";
  if ($("product")) $("product").value = "";
}

// -------------------------------
// Simple helpers
// -------------------------------
function normTag(s) {
  return String(s || "").trim(); // keep leading zeros
}

function cleanIntOrBlank(s) {
  const t = String(s || "").replace(/,/g, "").trim();
  if (!t) return "";
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return Math.trunc(v);
}

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

// -------------------------------
// Cached tags table
// -------------------------------
let TAGS_TABLE = []; // [{TAG_ID, LOT_ID, LOT_QTY, PRODUCT_NAME, SHEET}, ...]
let TAGS_TABLE_TS = 0;

async function loadTagsTableIntoCache() {
  const out = await apiGet("tags_table");
  TAGS_TABLE = Array.isArray(out.rows) ? out.rows : [];
  TAGS_TABLE_TS = Date.now();
  return out;
}

// -------------------------------
// Table UI
// -------------------------------
function showTableBox(show) {
  const box = $("tableBox");
  if (!box) return;
  box.style.display = show ? "" : "none";
}

function setTableStatus(text) {
  const el = $("tableStatus");
  if (!el) return;
  el.textContent = text || "";
}

function renderTable(rows) {
  const table = $("table");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || rows.length === 0) {
    setTableStatus("No rows.");
    return;
  }

  for (const r of rows) {
    const tr = document.createElement("tr");

    const tdTag = document.createElement("td");
    tdTag.textContent = r.TAG_ID ?? "";
    tr.appendChild(tdTag);

    const tdLot = document.createElement("td");
    tdLot.textContent = r.LOT_ID ?? "";
    tr.appendChild(tdLot);

    const tdQty = document.createElement("td");
    tdQty.textContent = r.LOT_QTY ?? "";
    tr.appendChild(tdQty);

    const tdProd = document.createElement("td");
    tdProd.textContent = r.PRODUCT_NAME ?? "";
    tr.appendChild(tdProd);

    tbody.appendChild(tr);
  }

  setTableStatus(`Loaded ${rows.length} rows.`);
}

// -------------------------------
// VIEW TAGS TABLE button
// -------------------------------
async function viewTagsTable() {
  hideResult();
  setTableStatus("Loading…");
  showTableBox(true);

  const out = await loadTagsTableIntoCache();
  renderTable(TAGS_TABLE);

  if (out.updated) setTableStatus(`Loaded ${TAGS_TABLE.length} rows. Updated: ${out.updated}`);
}

// -------------------------------
// LOOKUP button
// Requirements:
// - If found: show registerBox with fields filled
// - If not found: show registerBox blank so user can register
// -------------------------------
async function lookupTag() {
  hideResult();

  const tag = normTag($("tag")?.value);
  if (!tag) {
    showRegisterBox(false);
    return showResult("Missing Tag ID.", true);
  }

  // Ensure cache exists
  if (!TAGS_TABLE || TAGS_TABLE.length === 0) {
    showResult("Loading table…");
    await loadTagsTableIntoCache();
    hideResult();
  }

  const hit = TAGS_TABLE.find(r => normTag(r.TAG_ID) === tag);

  // Always show the register box (your requested UI)
  showRegisterBox(true);

  if (!hit) {
    clearRegisterFields();
    showResult("Not found. Enter Lot ID / Lot Qty / Product Name, then click Register.", false);
    return;
  }

  // Fill fields
  if ($("lot")) $("lot").value = hit.LOT_ID || "";
  if ($("qty")) $("qty").value = hit.LOT_QTY || "";
  if ($("product")) $("product").value = hit.PRODUCT_NAME || "";

  showResult("Found ✅ Loaded Lot/Qty/Product into the form.", false);
}

// -------------------------------
// REGISTER button (calls tag_seed)
// -------------------------------
async function registerTag() {
  hideResult();

  const tag = normTag($("tag")?.value);
  const lot = String($("lot")?.value || "").trim();
  const qtyRaw = String($("qty")?.value || "").trim();
  const product = String($("product")?.value || "").trim();

  if (!tag) return showResult("Missing Tag ID.", true);
  if (!lot) return showResult("Missing Lot ID (this will be the tab name).", true);
  if (!product) return showResult("Missing Product Name.", true);

  const qtyVal = cleanIntOrBlank(qtyRaw);
  if (qtyVal === null) return showResult("Lot Qty must be a number.", true);
  if (qtyVal === "") return showResult("Lot Qty cannot be blank for Register.", true);

  showResult("Registering…");

  // tag_seed creates tab if needed + seeds row2 identity row
  const out = await apiGet("tag_seed", {
    sheet: lot,
    lot_id: lot,
    tag_id: tag,
    product: product,
    qty: String(qtyVal)
  });

  showResult(
    `Registered ✅<br><br>
     <b>Tab</b>: ${out.tab || lot}<br>
     <b>LOT_ID</b>: ${out.lot_id || lot}<br>
     <b>TAG_ID</b>: ${out.tag_id || tag}<br>
     <b>PRODUCT</b>: ${out.product || product}<br>
     <b>LOT_QTY (IN)</b>: ${out.in_qty ?? qtyVal}`
  );

  // Refresh cache so lookup/table sees it immediately
  try { await loadTagsTableIntoCache(); } catch {}
}

// -------------------------------
// Wire up buttons + Enter behavior
// -------------------------------
window.addEventListener("DOMContentLoaded", () => {
  // Start hidden
  showRegisterBox(false);
  showTableBox(false);
  hideResult();

  if ($("lookup")) $("lookup").onclick = () => lookupTag().catch(e => showResult(e.message, true));
  if ($("viewTable")) $("viewTable").onclick = () => viewTagsTable().catch(e => showResult(e.message, true));
  if ($("register")) $("register").onclick = () => registerTag().catch(e => showResult(e.message, true));

  if ($("cancelRegister")) {
    $("cancelRegister").onclick = () => {
      showRegisterBox(false);
      hideResult();
    };
  }

  if ($("closeTable")) {
    $("closeTable").onclick = () => showTableBox(false);
  }

  // Enter key: on Tag -> lookup; on Lot/Qty/Product -> register
  if ($("tag")) $("tag").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") lookupTag().catch(e => showResult(e.message, true));
  });

  for (const id of ["lot", "qty", "product"]) {
    if (!$(id)) continue;
    $(id).addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") registerTag().catch(e => showResult(e.message, true));
    });
  }
});
