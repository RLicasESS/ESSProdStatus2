// ==========================================
// Tags UI → ESS Current Lots (VER25)
// Matches your index.html IDs exactly:
// - Lookup: uses cached table (loads it first if needed)
// - View Tags Table: calls action=tags_table and fills <table><tbody>
// - Register: calls action=tag_seed (creates tab if needed + seeds row2)
// ==========================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec";

function $(id) { return document.getElementById(id); }

// -------------------------------
// Simple UI helpers
// -------------------------------
function showBox(id, on = true) {
  const el = $(id);
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function setHTML(id, html) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = html;
}

function esc(x) {
  return String(x ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanIntOrNull(s) {
  const t = String(s || "").replace(/,/g, "").trim();
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return NaN;
  return Math.trunc(v);
}

function normTag(s) {
  // keep leading zeros; exact match
  return String(s || "").trim();
}

// -------------------------------
// API
// -------------------------------
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
let TAGS_TABLE = [];
let TAGS_TABLE_TS = 0;

// -------------------------------
// Render table into your existing <table id="table"><tbody>...
// -------------------------------
function renderTable(rows) {
  const tbl = $("table");
  const tbody = tbl ? tbl.querySelector("tbody") : null;

  if (!tbl || !tbody) {
    setHTML("tableStatus", "<span class='danger'>Table element missing.</span>");
    return;
  }

  tbody.innerHTML = "";

  if (!rows || rows.length === 0) {
    setHTML("tableStatus", "<span class='danger'>No rows returned.</span>");
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

  setHTML("tableStatus", `Loaded ${rows.length} rows.`);
}

// -------------------------------
// Load tags table from server
// -------------------------------
async function loadTagsTable() {
  const out = await apiGet("tags_table");
  const rows = Array.isArray(out.rows) ? out.rows : [];

  // Optional: drop rows that are basically unseeded (like ABCD123456 with blank identity)
  const cleaned = rows.filter(r => {
    const hasAny =
      String(r.TAG_ID || "").trim() ||
      String(r.LOT_ID || "").trim() ||
      String(r.LOT_QTY || "").trim() ||
      String(r.PRODUCT_NAME || "").trim();
    return !!hasAny;
  });

  TAGS_TABLE = cleaned;
  TAGS_TABLE_TS = Date.now();

  return { rows: TAGS_TABLE, meta: out };
}

// -------------------------------
// VIEW TAGS TABLE
// -------------------------------
async function viewTagsTable() {
  showBox("result", false);
  showBox("registerBox", false);
  showBox("tableBox", true);
  setHTML("tableStatus", "Loading…");

  const { rows, meta } = await loadTagsTable();
  renderTable(rows);

  if (meta && meta.updated) {
    setHTML("tableStatus", `${esc($("tableStatus").textContent)} <span class="small">(${esc(meta.updated)})</span>`);
  }
}

// -------------------------------
// LOOKUP
// -------------------------------
async function lookupTag() {
  showBox("result", false);
  showBox("registerBox", false);

  const tag = normTag($("tag")?.value);
  if (!tag) {
    showBox("result", true);
    setHTML("result", `<span class="danger">Missing Tag ID.</span>`);
    return;
  }

  // If table not loaded, load it silently first
  if (!TAGS_TABLE || TAGS_TABLE.length === 0) {
    try {
      await loadTagsTable();
    } catch (e) {
      showBox("result", true);
      setHTML("result", `<span class="danger">${esc(e.message)}</span>`);
      return;
    }
  }

  const hit = TAGS_TABLE.find(r => normTag(r.TAG_ID) === tag);

  if (!hit) {
    // Not found => show register UI, but keep Tag filled
    $("lot").value = "";
    $("qty").value = "";
    $("product").value = "";
    showBox("registerBox", true);

    showBox("result", true);
    setHTML("result", `Not found. Enter Lot ID / Lot Qty / Product and click <b>Register</b>.`);
    return;
  }

  // Found => show info and populate fields (non-destructive)
  $("lot").value = hit.LOT_ID || "";
  $("qty").value = hit.LOT_QTY || "";
  $("product").value = hit.PRODUCT_NAME || "";

  showBox("result", true);
  setHTML(
    "result",
    `Found ✅<br><br>
     <span class="k">TAG_ID</span> ${esc(hit.TAG_ID)}<br>
     <span class="k">LOT_ID</span> ${esc(hit.LOT_ID)}<br>
     <span class="k">LOT_QTY</span> ${esc(hit.LOT_QTY)}<br>
     <span class="k">PRODUCT</span> ${esc(hit.PRODUCT_NAME)}`
  );
}

// -------------------------------
// REGISTER (tag_seed)
// -------------------------------
async function registerTag() {
  showBox("result", true);
  setHTML("result", "Registering…");

  const tag = normTag($("tag")?.value);
  const lot = String($("lot")?.value || "").trim();
  const qtyRaw = String($("qty")?.value || "").trim();
  const product = String($("product")?.value || "").trim();

  if (!tag) return setHTML("result", `<span class="danger">Missing Tag ID.</span>`);
  if (!lot) return setHTML("result", `<span class="danger">Missing Lot ID.</span>`);
  if (!product) return setHTML("result", `<span class="danger">Missing Product Name.</span>`);

  const qty = cleanIntOrNull(qtyRaw);
  if (qty === null) return setHTML("result", `<span class="danger">Lot Qty is required.</span>`);
  if (Number.isNaN(qty)) return setHTML("result", `<span class="danger">Lot Qty must be a number.</span>`);

  const out = await apiGet("tag_seed", {
    sheet: lot,        // tab name
    lot_id: lot,
    tag_id: tag,
    product: product,
    qty: String(qty)
  });

  setHTML(
    "result",
    `Registered ✅<br><br>
     <span class="k">TAB</span> ${esc(out.tab || lot)}<br>
     <span class="k">LOT_ID</span> ${esc(out.lot_id || lot)}<br>
     <span class="k">TAG_ID</span> ${esc(out.tag_id || tag)}<br>
     <span class="k">PRODUCT</span> ${esc(out.product || product)}<br>
     <span class="k">LOT_QTY</span> ${esc(out.in_qty ?? qty)}`
  );

  // Hide register UI and refresh cache
  showBox("registerBox", false);
  await loadTagsTable().catch(() => {});
}

// -------------------------------
// Wire up buttons
// -------------------------------
window.addEventListener("DOMContentLoaded", () => {
  if ($("lookup")) $("lookup").onclick = () => lookupTag().catch(e => setHTML("result", `<span class="danger">${esc(e.message)}</span>`));
  if ($("viewTable")) $("viewTable").onclick = () => viewTagsTable().catch(e => { showBox("tableBox", true); setHTML("tableStatus", `<span class="danger">${esc(e.message)}</span>`); });
  if ($("closeTable")) $("closeTable").onclick = () => showBox("tableBox", false);

  if ($("register")) $("register").onclick = () => registerTag().catch(e => setHTML("result", `<span class="danger">${esc(e.message)}</span>`));
  if ($("cancelRegister")) $("cancelRegister").onclick = () => showBox("registerBox", false);

  // Enter key: TAG => lookup, others => register
  if ($("tag")) $("tag").addEventListener("keydown", ev => { if (ev.key === "Enter") lookupTag(); });
  for (const id of ["lot", "qty", "product"]) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("keydown", ev => { if (ev.key === "Enter") registerTag(); });
  }
});
