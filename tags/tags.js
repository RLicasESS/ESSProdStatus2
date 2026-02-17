// ==========================================
// TAG SEED UI (writes TAG_ID + IN to ESS Current Lots)
// Backend: ESS Current Lots Apps Script WebApp
// ==========================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec";

function $(id) { return document.getElementById(id); }

function show(el, on = true) { el.style.display = on ? "" : "none"; }

function setStatus(msg, isError = false) {
  const box = $("status");
  box.textContent = msg;
  box.style.color = isError ? "#b00020" : "#111";
  show(box, true);
}

async function apiGet(action, params = {}) {
  const u = new URL(API_URL);
  u.searchParams.set("action", action);

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.searchParams.set(k, String(v));
  }

  let res;
  try {
    res = await fetch(u.toString(), { redirect: "follow", cache: "no-store" });
  } catch (e) {
    throw new Error("Fetch failed (network/CORS): " + (e?.message || e));
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Non-JSON response: " + text.slice(0, 160));
  }

  if (!json.ok) throw new Error(json.error || "API error");
  return json;
}

function normTag(tag) {
  // Keep as text (leading zeros preserved). Just trim.
  return String(tag || "").trim();
}

function normLot(lot) {
  // Lot tab name == lot id in your system (e.g. TGWFS0XW86)
  return String(lot || "").trim();
}

function normIn(v) {
  const t = String(v || "").replace(/,/g, "").trim();
  if (!t) return "";
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  return n;
}

async function submitSeed() {
  const lot = normLot($("lot").value);
  const tag = normTag($("tag").value);
  const inVal = normIn($("in").value);

  if (!lot) return setStatus("Missing LOT ID.", true);
  if (!tag) return setStatus("Missing TAG ID.", true);
  if (inVal === null) return setStatus("IN must be a number (commas ok).", true);

  setStatus("Sending…");

  // action=tag_seed is added in Code.gs (see below)
  const out = await apiGet("tag_seed", {
    sheet: lot,       // lot tab name
    lot_id: lot,      // for consistency / debug
    tag_id: tag,      // text (leading zeros kept)
    total_in: inVal   // number (or blank)
  });

  setStatus(
    `OK ✅  lot=${out.tab}  row=${out.row}  TAG_ID=${out.tag_id}  IN=${out.in || ""}`
  );
}

window.addEventListener("DOMContentLoaded", () => {
  show($("status"), false);

  $("seed").onclick = () => submitSeed().catch(e => setStatus(e.message, true));

  for (const id of ["lot", "tag", "in"]) {
    $(id).addEventListener("keydown", ev => {
      if (ev.key === "Enter") submitSeed().catch(e => setStatus(e.message, true));
    });
  }

  // Optional: quick health check (will fail unless you add action=version in Code.gs)
  // If you don't have version, remove this.
  // apiGet("version").then(() => setStatus("API OK ✅")).catch(() => {});
});
