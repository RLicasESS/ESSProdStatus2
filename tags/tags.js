// ==========================================
// Tags UI → ESS Current Lots (matches index.html you posted)
// - VIEW TAGS TABLE: action=tags_table
// - LOOKUP: uses cached table; if found shows Found card + EDIT/DEREGISTER
// - REGISTER/SAVE: action=tag_seed
// - DEREGISTER: action=tag_deregister (clears TAG_ID in row 2)
// ==========================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec";

function $(id) { return document.getElementById(id); }

function show(el) { if (el) el.style.display = ""; }
function hide(el) { if (el) el.style.display = "none"; }

function setHTML(el, html) { if (el) el.innerHTML = html; }

function escapeHtml(x) {
  return String(x ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
    throw new Error("Non-JSON response (auth/blocked/HTML): " + text.slice(0, 180));
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

// -------------------------------
// Cached tags table
// -------------------------------
let TAGS_TABLE = [];
let TAGS_TABLE_TS = 0;

async function loadTagsTable(force = false) {
  const maxAgeMs = 30 * 1000;
  if (!force && TAGS_TABLE.length && (Date.now() - TAGS_TABLE_TS) < maxAgeMs) return TAGS_TABLE;

  const out = await apiGet("tags_table");
  TAGS_TABLE = Array.isArray(out.rows) ? out.rows : [];
  TAGS_TABLE_TS = Date.now();
  return TAGS_TABLE;
}

// -------------------------------
// UI panels
// -------------------------------
function resetPanels() {
  hide($("result"));
  hide($("registerBox"));
  hide($("tableBox"));
}

function showMessageCard(html, isError = false) {
  const el = $("result");
  if (!el) return;
  el.classList.remove("danger");
  el.style.border = "1px solid #ccc";
  el.style.background = isError ? "#fff2f2" : "#f3fff3";
  el.style.color = isError ? "#b00020" : "#0a6b0a";
  setHTML(el, html);
  show(el);
}

function openRegisterBox(mode, preset = {}) {
  // mode: "new" | "edit"
  resetPanels();
  const box = $("registerBox");
  if (!box) return;

  // Fill fields
  if ($("lot")) $("lot").value = preset.lot || "";
  if ($("qty")) $("qty").value = preset.qty || "";
  if ($("product")) $("product").value = preset.product || "";

  // Button label
  if ($("register")) $("register").textContent = (mode === "edit") ? "Save" : "Register";

  // Stash edit context (which sheet we’re editing)
  box.dataset.mode = mode;
  box.dataset.sheet = preset.sheet || preset.lot || ""; // the tab name to write to

  show(box);
}

function showFoundCard(hit) {
  resetPanels();

  const tag = hit.TAG_ID || "";
  const lot = hit.LOT_ID || "";
  const qty = hit.LOT_QTY || "";
  const product = hit.PRODUCT_NAME || "";
  const sheet = hit.SHEET || lot; // server may return SHEET name

  const html = `
    <div style="font-weight:700;margin-bottom:8px">Found ✅</div>
    <div><span class="k">TAG_ID</span> ${escapeHtml(tag)}</div>
    <div><span class="k">LOT_ID</span> ${escapeHtml(lot)}</div>
    <div><span class="k">LOT_QTY</span> ${escapeHtml(qty)}</div>
    <div><span class="k">PRODUCT</span> ${escapeHtml(product)}</div>

    <div class="row" style="margin-top:12px">
      <button id="editBtn">Edit Data</button>
      <button id="deregBtn" style="background:#fff2f2;border:1px solid #f0b0b0">Deregister Tag</button>
    </div>

    <div class="small" style="margin-top:8px;color:#555">
      Deregister clears TAG_ID on row 2 of the lot tab, so it disappears from Tags Table.
    </div>
  `;

  const el = $("result");
  if (!el) return;
  el.style.background = "#f3fff3";
  el.style.color = "#0a6b0a";
  setHTML(el, html);
  show(el);

  // Wire buttons
  const editBtn = $("editBtn");
  const deregBtn = $("deregBtn");

  if (editBtn) {
    editBtn.onclick = () => openRegisterBox("edit", {
      lot: lot,
      qty: qty,
      product: product,
      sheet: sheet
    });
  }

  if (deregBtn) {
    deregBtn.onclick = async () => {
      const ok = window.confirm(`Deregister TAG ${tag} from LOT ${lot}?\n\nThis will clear TAG_ID in row 2 of sheet "${sheet}".`);
      if (!ok) return;

      showMessageCard("Deregistering…");

      // Requires Code.gs to implement action=tag_deregister
      const out = await apiGet("tag_deregister", { sheet: sheet });

      showMessageCard(`Deregistered ✅<br><small>${escapeHtml(out.note || "")}</small>`);

      // Refresh table cache
      try { await loadTagsTable(true); } catch {}
    };
  }
}

// -------------------------------
// Table rendering (tableBox)
// -------------------------------
function renderTable(rows, updatedText = "") {
  const box = $("tableBox");
  const status = $("tableStatus");
  const table = $("table");
  if (!box || !table) {
    showMessageCard("Missing table UI elements (tableBox/table).", true);
    return;
  }

  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    if (status) status.textContent = "No rows.";
    show(box);
    return;
  }

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.TAG_ID)}</td>
      <td>${escapeHtml(r.LOT_ID)}</td>
      <td>${escapeHtml(r.LOT_QTY)}</td>
      <td>${escapeHtml(r.PRODUCT_NAME)}</td>
    `;
    tbody.appendChild(tr);
  }

  if (status) status.textContent = `Loaded ${rows.length} rows. ${updatedText || ""}`.trim();
  show(box);
}

async function viewTagsTable() {
  resetPanels();
  showMessageCard("Loading tags table…");

  const out = await apiGet("tags_table");
  TAGS_TABLE = Array.isArray(out.rows) ? out.rows : [];
  TAGS_TABLE_TS = Date.now();

  hide($("result"));
  renderTable(TAGS_TABLE, out.updated || "");
}

// -------------------------------
// LOOKUP
// -------------------------------
async function lookupTag() {
  resetPanels();

  const tag = normTag($("tag")?.value);
  if (!tag) return showMessageCard("Missing Tag ID.", true);

  // Ensure cache exists
  if (!TAGS_TABLE.length) {
    try { await loadTagsTable(true); } catch (e) {
      return showMessageCard(`Could not load tags table: ${escapeHtml(e.message)}`, true);
    }
  }

  const hit = TAGS_TABLE.find(r => normTag(r.TAG_ID) === tag);

  if (!hit) {
    // Not found -> open registration, keep lot/qty/product blank
    showMessageCard("Not found. Registering new lot? Fill Lot/Qty/Product then click Register.");
    openRegisterBox("new", { lot: "", qty: "", product: "" });
    return;
  }

  // Found -> show found card with EDIT/DEREGISTER
  showFoundCard(hit);
}

// -------------------------------
// REGISTER / SAVE (tag_seed)
// -------------------------------
async function registerOrSave() {
  const tag = normTag($("tag")?.value);
  const lot = String($("lot")?.value || "").trim();
  const qtyRaw = String($("qty")?.value || "").trim();
  const product = String($("product")?.value || "").trim();

  if (!tag) return showMessageCard("Missing Tag ID.", true);
  if (!lot) return showMessageCard("Missing Lot ID.", true);
  if (!product) return showMessageCard("Missing Product Name.", true);

  const qtyVal = cleanIntOrBlank(qtyRaw);
  if (qtyVal === null) return showMessageCard("Lot Qty must be a number.", true);
  if (qtyVal === "") return showMessageCard("Lot Qty cannot be blank.", true);

  showMessageCard("Saving…");

  // tag_seed writes row 2 identity for that sheet
  const out = await apiGet("tag_seed", {
    sheet: lot,
    lot_id: lot,
    tag_id: tag,
    product: product,
    qty: String(qtyVal)
  });

  showMessageCard(
    `Saved ✅<br><br>
     <div><span class="k">Tab</span> ${escapeHtml(out.tab || lot)}</div>
     <div><span class="k">LOT_ID</span> ${escapeHtml(out.lot_id || lot)}</div>
     <div><span class="k">TAG_ID</span> ${escapeHtml(out.tag_id || tag)}</div>
     <div><span class="k">PRODUCT</span> ${escapeHtml(out.product || product)}</div>
     <div><span class="k">LOT_QTY</span> ${escapeHtml(out.in_qty ?? qtyVal)}</div>`
  );

  // refresh cache so lookup sees it immediately
  try { await loadTagsTable(true); } catch {}
}

// -------------------------------
// Wire up
// -------------------------------
window.addEventListener("DOMContentLoaded", () => {
  if ($("lookup")) $("lookup").onclick = () => lookupTag().catch(e => showMessageCard(e.message, true));
  if ($("viewTable")) $("viewTable").onclick = () => viewTagsTable().catch(e => showMessageCard(e.message, true));
  if ($("closeTable")) $("closeTable").onclick = () => resetPanels();

  if ($("register")) $("register").onclick = () => registerOrSave().catch(e => showMessageCard(e.message, true));
  if ($("cancelRegister")) $("cancelRegister").onclick = () => resetPanels();

  // Enter behaviors
  if ($("tag")) $("tag").addEventListener("keydown", ev => {
    if (ev.key === "Enter") lookupTag().catch(e => showMessageCard(e.message, true));
  });

  for (const id of ["lot", "qty", "product"]) {
    if (!$(id)) continue;
    $(id).addEventListener("keydown", ev => {
      if (ev.key === "Enter") registerOrSave().catch(e => showMessageCard(e.message, true));
    });
  }

  // Optional: preload table silently so first lookup is instant
  loadTagsTable(false).catch(() => {});
});
