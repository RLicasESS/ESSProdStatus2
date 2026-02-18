// ==========================================
// tags.js (VER25 UI) — works with your index.html exactly
// - Lookup: searches cached table (loads table first if needed)
// - View Tags Table: calls action=tags_table and fills <tbody>
// - Register: calls action=tag_seed (creates tab if needed + seeds row 2)
// ==========================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec";

function $(id) { return document.getElementById(id); }

function esc(x) {
  return String(x ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showResult(html, isError = false) {
  const el = $("result");
  if (!el) return;
  el.style.display = "";
  el.style.borderColor = isError ? "#f2b8b5" : "#c9e7c9";
  el.style.background = isError ? "#fff2f2" : "#f3fff3";
  el.innerHTML = html;
}

function hideResult() {
  const el = $("result");
  if (!el) return;
  el.style.display = "none";
  el.innerHTML = "";
}

function showRegisterBox(show) {
  const el = $("registerBox");
  if (!el) return;
  el.style.display = show ? "" : "none";
}

function showTableBox(show) {
  const el = $("tableBox");
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

function cleanIntOrNull(s) {
  const t = String(s || "").replace(/,/g, "").trim();
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return NaN;
  return Math.trunc(v);
}

// -------------------------------
// Cache
// -------------------------------
let TAGS_TABLE = []; // [{TAG_ID, LOT_ID, LOT_QTY, PRODUCT_NAME, SHEET}, ...]
let TAGS_TABLE_TS = 0;

function normTag(s) {
  // keep leading zeros; exact match
  return String(s || "").trim();
}

// -------------------------------
// Fill existing <tbody>
// -------------------------------
function renderTable(rows) {
  const table = $("table");
  if (!table) {
    showResult("Table element not found (id=table).", true);
    return;
  }
  const tbody = table.querySelector("tbody");
  if (!tbody) {
    showResult("Table tbody not found.", true);
    return;
  }

  tbody.innerHTML = "";

  if (!rows || rows.length === 0) {
    // leave empty, status will say 0
    return;
  }

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
  hideResult();
  showRegisterBox(false);

  showResult("Loading tags table…");

  const out = await apiGet("tags_table");

  TAGS_TABLE = Array.isArray(out.rows) ? out.rows : [];
  TAGS_TABLE_TS = Date.now();

  renderTable(TAGS_TABLE);

  const st = $("tableStatus");
  if (st) {
    st.textContent = `Loaded ${TAGS_TABLE.length} rows. ${out.updated || ""}`;
  }

  showTableBox(true);

  if (TAGS_TABLE.length === 0) {
    showResult(
      `Loaded ✅ but table is empty.<br><br>
       This means the server returned <b>rows: []</b>.<br>
       Most common cause: your lot tabs don’t have the identity row filled (row 2: LOT_ID, TAG_ID, PRODUCT_NAME, IN).`,
      true
    );
  } else {
    showResult(`Loaded ✅ (${TAGS_TABLE.length} rows)`);
  }
}

// -------------------------------
// LOOKUP (auto-load table if empty)
// -------------------------------
async function lookupTag() {
  hideResult();
  showRegisterBox(false);

  const tag = normTag($("tag")?.value);
  if (!tag) return showResult("Missing Tag ID.", true);

  // If cache empty, auto-load once (so user doesn't have to click View)
  if (!TAGS_TABLE || TAGS_TABLE.length === 0) {
    try {
      await viewTagsTable();
    } catch (e) {
      return showResult(e.message || String(e), true);
    }
  }

  if (!TAGS_TABLE || TAGS_TABLE.length === 0) {
    return showResult("Tags table is empty. Register a tag first (or fix identity rows).", true);
  }

  const hit = TAGS_TABLE.find(r => normTag(r.TAG_ID) === tag);

  if (!hit) {
    // Not found -> show register box, clear fields but keep tag
    if ($("lot")) $("lot").value = "";
    if ($("qty")) $("qty").value = "";
    if ($("product")) $("product").value = "";

    showRegisterBox(true);
    return showResult("Not found. Fill Lot ID / Lot Qty / Product Name then click Register.");
  }

  // Found -> populate fields (optional)
  if ($("lot")) $("lot").value = hit.LOT_ID || "";
  if ($("qty")) $("qty").value = hit.LOT_QTY || "";
  if ($("product")) $("product").value = hit.PRODUCT_NAME || "";

  showRegisterBox(false);

  showResult(
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
  hideResult();

  const tag = $("tag")?.value.trim();
  const lot = $("lot")?.value.trim();
  const qtyRaw = $("qty")?.value.trim();
  const product = $("product")?.value.trim();

  if (!tag) return showResult("Missing Tag ID.", true);
  if (!lot) return showResult("Missing Lot ID (this will be the tab name).", true);
  if (!product) return showResult("Missing Product Name.", true);

  const qty = cleanIntOrNull(qtyRaw);
  if (qty === null) return showResult("Lot Qty cannot be blank.", true);
  if (Number.isNaN(qty)) return showResult("Lot Qty must be a number.", true);

  showResult("Registering / seeding…");

  const out = await apiGet("tag_seed", {
    sheet: lot,        // tab name
    lot_id: lot,
    tag_id: tag,
    product: product,
    qty: String(qty)
  });

  showRegisterBox(false);

  showResult(
    `Registered ✅<br><br>
     <span class="k">Tab</span> ${esc(out.tab || lot)}<br>
     <span class="k">LOT_ID</span> ${esc(out.lot_id || lot)}<br>
     <span class="k">TAG_ID</span> ${esc(out.tag_id || tag)}<br>
     <span class="k">PRODUCT</span> ${esc(out.product || product)}<br>
     <span class="k">IN</span> ${esc(out.in_qty ?? qty)}`
  );

  // Refresh table view so it appears immediately
  try {
    await viewTagsTable();
  } catch {
    // ignore
  }
}

// -------------------------------
// Wire up buttons
// -------------------------------
window.addEventListener("DOMContentLoaded", () => {
  // initial UI
  hideResult();
  showRegisterBox(false);
  showTableBox(false);

  if ($("lookup")) $("lookup").onclick = () => lookupTag().catch(e => showResult(e.message, true));
  if ($("viewTable")) $("viewTable").onclick = () => viewTagsTable().catch(e => showResult(e.message, true));

  if ($("register")) $("register").onclick = () => registerTag().catch(e => showResult(e.message, true));
  if ($("cancelRegister")) $("cancelRegister").onclick = () => { showRegisterBox(false); hideResult(); };

  if ($("closeTable")) $("closeTable").onclick = () => showTableBox(false);

  // Enter behavior
  if ($("tag")) $("tag").addEventListener("keydown", ev => {
    if (ev.key === "Enter") lookupTag().catch(e => showResult(e.message, true));
  });
  for (const id of ["lot", "qty", "product"]) {
    if (!$(id)) continue;
    $(id).addEventListener("keydown", ev => {
      if (ev.key === "Enter") registerTag().catch(e => showResult(e.message, true));
    });
  }
});
