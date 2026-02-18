// ==========================================
// Tags UI → ESS Current Lots (VER25)
// - VIEW TAGS TABLE: calls action=tags_table (server scans lot tabs)
// - LOOKUP: searches cached table
// - CREATE/SEED: calls action=tag_seed (creates tab if needed + seeds row2)
// ==========================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec";

function $(id) { return document.getElementById(id); }

function showStatus(html, isError = false) {
  const el = $("status");
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
  const el = $("status");
  if (!el) return;
  el.style.display = "none";
  el.innerHTML = "";
}

async function apiGet(action, params = {}) {
  const u = new URL(API_URL);
  u.searchParams.set("action", action);

  for (const [k, v] of Object.entries(params)) {
    // allow blank values to still be sent (server can decide)
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

// -------------------------------
// In-memory cached tags table
// -------------------------------
let TAGS_TABLE = []; // [{TAG_ID, LOT_ID, LOT_QTY, PRODUCT_NAME, SHEET}, ...]
let TAGS_TABLE_TS = 0;

function normTag(s) {
  return String(s || "").trim(); // keep leading zeros; exact match
}

// -------------------------------
// Render table (simple)
// -------------------------------
function renderTable(rows) {
  const wrap = $("tableWrap") || $("table") || $("tagsTableWrap");
  if (!wrap) {
    showStatus("Loaded table, but no table container found (tableWrap/table).", true);
    return;
  }

  if (!rows || !rows.length) {
    wrap.innerHTML = "<div style='padding:8px'>No rows.</div>";
    return;
  }

  const esc = (x) =>
    String(x ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const head = `
    <table style="border-collapse:collapse;width:100%">
      <thead>
        <tr>
          <th style="border:1px solid #ccc;padding:6px;text-align:left">TAG_ID</th>
          <th style="border:1px solid #ccc;padding:6px;text-align:left">LOT_ID</th>
          <th style="border:1px solid #ccc;padding:6px;text-align:left">LOT_QTY (IN)</th>
          <th style="border:1px solid #ccc;padding:6px;text-align:left">PRODUCT_NAME</th>
        </tr>
      </thead>
      <tbody>
  `;

  const body = rows.map(r => `
    <tr>
      <td style="border:1px solid #ccc;padding:6px">${esc(r.TAG_ID)}</td>
      <td style="border:1px solid #ccc;padding:6px">${esc(r.LOT_ID)}</td>
      <td style="border:1px solid #ccc;padding:6px">${esc(r.LOT_QTY)}</td>
      <td style="border:1px solid #ccc;padding:6px">${esc(r.PRODUCT_NAME)}</td>
    </tr>
  `).join("");

  wrap.innerHTML = head + body + "</tbody></table>";
}

// -------------------------------
// VIEW TAGS TABLE
// -------------------------------
async function viewTagsTable() {
  hideStatus();
  showStatus("Loading tags table…");

  // Requires Code.gs action=tags_table (the server-side scan)
  const out = await apiGet("tags_table");

  TAGS_TABLE = Array.isArray(out.rows) ? out.rows : [];
  TAGS_TABLE_TS = Date.now();

  renderTable(TAGS_TABLE);

  showStatus(`Loaded ✅ (${TAGS_TABLE.length} rows)<br><small>${out.updated || ""}</small>`);
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

  if (!hit) {
    // not found: blank fields for user entry
    if ($("lot")) $("lot").value = "";
    if ($("in")) $("in").value = "";
    if ($("product")) $("product").value = "";

    return showStatus("Not found. Enter Lot ID / IN / Product then click SEED (create tab).");
  }

  // found: populate fields (non-destructive)
  if ($("lot")) $("lot").value = hit.LOT_ID || "";
  if ($("in")) $("in").value = hit.LOT_QTY || "";
  if ($("product")) $("product").value = hit.PRODUCT_NAME || "";

  showStatus("Found ✅ Loaded fields from table.");
}

// -------------------------------
// SEED / CREATE TAB (tag_seed)
// -------------------------------
async function seedTagAndIn() {
  hideStatus();

  const lot = $("lot")?.value.trim();
  const tag = $("tag")?.value.trim();
  const inRaw = $("in")?.value.trim();
  const product = $("product")?.value.trim();

  if (!tag) return showStatus("Missing Tag ID.", true);
  if (!lot) return showStatus("Missing Lot ID (this will be the tab name).", true);
  if (!product) return showStatus("Missing Product Name.", true);

  const inVal = cleanIntOrBlank(inRaw);
  if (inVal === null) return showStatus("IN must be a number.", true);
  if (inVal === "") return showStatus("IN cannot be blank for seeding.", true);

  showStatus("Seeding…");

  // Your Code.gs action name is tag_seed (NOT seed_tag)
  const out = await apiGet("tag_seed", {
    // Let server default sheet=lot_id if not supplied, but we can pass both safely:
    sheet: lot,
    lot_id: lot,
    tag_id: tag,
    product: product,
    qty: String(inVal) // server reads qty / total_in / in
  });

  showStatus(
    `Done ✅<br><br>
     <b>Tab</b>: ${out.tab || lot}<br>
     <b>LOT_ID</b>: ${out.lot_id || lot}<br>
     <b>TAG_ID</b>: ${out.tag_id || tag}<br>
     <b>PRODUCT</b>: ${out.product || product}<br>
     <b>IN</b>: ${out.in_qty ?? inVal}`
  );

  // Refresh table cache so LOOKUP sees it right away
  try {
    await viewTagsTable();
  } catch {
    // ignore refresh failure
  }
}

// -------------------------------
// Wire up buttons
// -------------------------------
window.addEventListener("DOMContentLoaded", () => {
  // Buttons (if present)
  if ($("viewTable")) $("viewTable").onclick = () => viewTagsTable().catch(e => showStatus(e.message, true));
  if ($("lookup")) $("lookup").onclick = () => { try { lookupTag(); } catch (e) { showStatus(String(e), true); } };
  if ($("seed")) $("seed").onclick = () => seedTagAndIn().catch(e => showStatus(e.message, true));

  // Enter key behavior: Enter on TAG triggers lookup; Enter on LOT/IN/PRODUCT triggers seed
  if ($("tag")) $("tag").addEventListener("keydown", ev => {
    if (ev.key === "Enter") lookupTag();
  });

  for (const id of ["lot", "in", "product"]) {
    if (!$(id)) continue;
    $(id).addEventListener("keydown", ev => {
      if (ev.key === "Enter") seedTagAndIn().catch(e => showStatus(e.message, true));
    });
  }
});
