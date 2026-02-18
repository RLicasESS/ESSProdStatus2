// ==========================================
// Tags UI → ESS Current Lots (VER25)
// Matches your HTML IDs:
// - Tag input: tag
// - Buttons: lookup, viewTable, register, cancelRegister, closeTable
// - Inputs: lot, qty, product
// - Containers: result, registerBox, tableBox, tableStatus, table (with tbody)
// ==========================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec";

function $(id) { return document.getElementById(id); }

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

function setTableStatus(msg) {
  const el = $("tableStatus");
  if (!el) return;
  el.textContent = msg || "";
}

function showBox(id, show) {
  const el = $(id);
  if (!el) return;
  el.style.display = show ? "" : "none";
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

function cleanIntOrBlank(s) {
  const t = String(s || "").replace(/,/g, "").trim();
  if (!t) return "";
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return Math.trunc(v);
}

function normTag(s) {
  return String(s || "").trim(); // keep leading zeros
}

// Cached table
let TAGS_TABLE = []; // [{TAG_ID, LOT_ID, LOT_QTY, PRODUCT_NAME, SHEET}, ...]
let TAGS_TABLE_TS = 0;

// Render into existing <tbody>
function renderTable(rows) {
  const tbl = $("table");
  if (!tbl) return;
  const tbody = tbl.querySelector("tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" style="padding:8px">No rows.</td>`;
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

// VIEW TAGS TABLE
async function viewTagsTable() {
  hideResult();
  setTableStatus("Loading…");
  showBox("tableBox", true);

  const out = await apiGet("tags_table");

  TAGS_TABLE = Array.isArray(out.rows) ? out.rows : [];
  TAGS_TABLE_TS = Date.now();

  renderTable(TAGS_TABLE);
  setTableStatus(`Loaded ${TAGS_TABLE.length} rows. ${out.updated || ""}`);
  showResult(`Loaded tags table ✅ (${TAGS_TABLE.length} rows)`);
}

// LOOKUP
function lookupTag() {
  hideResult();
  showBox("registerBox", false);

  const tag = normTag($("tag")?.value);
  if (!tag) return showResult("Missing Tag ID.", true);

  if (!TAGS_TABLE || TAGS_TABLE.length === 0) {
    // Encourage user to load table first (or we could auto-load)
    showResult("Table is empty. Click View Tags Table first.", true);
    return;
  }

  const hit = TAGS_TABLE.find(r => normTag(r.TAG_ID) === tag);

  if (!hit) {
    // Not found => show register box for user input
    if ($("lot")) $("lot").value = "";
    if ($("qty")) $("qty").value = "";
    if ($("product")) $("product").value = "";
    showBox("registerBox", true);
    return showResult("Not found. Enter Lot ID / Lot Qty / Product Name, then click Register.");
  }

  // Found => fill fields (and hide register box)
  if ($("lot")) $("lot").value = hit.LOT_ID || "";
  if ($("qty")) $("qty").value = hit.LOT_QTY || "";
  if ($("product")) $("product").value = hit.PRODUCT_NAME || "";

  showResult("Found ✅ Loaded Lot/Qty/Product.");
}

// REGISTER (tag_seed)
async function registerTag() {
  hideResult();

  const tag = $("tag")?.value.trim();
  const lot = $("lot")?.value.trim();
  const qtyRaw = $("qty")?.value.trim();
  const product = $("product")?.value.trim();

  if (!tag) return showResult("Missing Tag ID.", true);
  if (!lot) return showResult("Missing Lot ID (tab name).", true);
  if (!product) return showResult("Missing Product Name.", true);

  const qtyVal = cleanIntOrBlank(qtyRaw);
  if (qtyVal === null) return showResult("Lot Qty must be a number.", true);
  if (qtyVal === "") return showResult("Lot Qty cannot be blank.", true);

  showResult("Registering…");

  const out = await apiGet("tag_seed", {
    sheet: lot,
    lot_id: lot,
    tag_id: tag,
    product: product,
    qty: String(qtyVal)
  });

  showBox("registerBox", false);

  showResult(
    `Registered ✅<br><br>
     <b>Tab</b>: ${out.tab || out.created_or_used_tab || lot}<br>
     <b>LOT_ID</b>: ${out.lot_id || lot}<br>
     <b>TAG_ID</b>: ${out.tag_id || tag}<br>
     <b>PRODUCT</b>: ${out.product || product}<br>
     <b>LOT_QTY (IN)</b>: ${out.in_qty ?? qtyVal}`
  );

  // Refresh table
  try { await viewTagsTable(); } catch {}
}

window.addEventListener("DOMContentLoaded", () => {
  // Buttons
  $("lookup")?.addEventListener("click", () => { try { lookupTag(); } catch (e) { showResult(String(e), true); } });
  $("viewTable")?.addEventListener("click", () => viewTagsTable().catch(e => showResult(e.message, true)));
  $("register")?.addEventListener("click", () => registerTag().catch(e => showResult(e.message, true)));

  $("cancelRegister")?.addEventListener("click", () => {
    showBox("registerBox", false);
    hideResult();
  });

  $("closeTable")?.addEventListener("click", () => {
    showBox("tableBox", false);
    setTableStatus("");
  });

  // Enter key behavior
  $("tag")?.addEventListener("keydown", ev => {
    if (ev.key === "Enter") lookupTag();
  });

  for (const id of ["lot", "qty", "product"]) {
    $(id)?.addEventListener("keydown", ev => {
      if (ev.key === "Enter") registerTag().catch(e => showResult(e.message, true));
    });
  }
});
