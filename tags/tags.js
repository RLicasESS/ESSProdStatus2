// ==========================================
// ESS Tags → Seed ESS Current Lots (Option A)
// Backend: ESS Current Lots Apps Script Web App
// ==========================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec";

function $(id) { return document.getElementById(id); }

function showStatus(html, isError = false) {
  const el = $("status");
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
  el.style.display = "none";
  el.innerHTML = "";
}

async function apiGet(action, params = {}) {
  const u = new URL(API_URL);
  u.searchParams.set("action", action);

  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
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

async function seedTagAndIn() {
  hideStatus();

  const lot = $("lot").value.trim();
  const tag = $("tag").value.trim();
  const inRaw = $("in").value.trim();

  if (!lot) return showStatus("Missing Lot ID (tab name).", true);
  if (!tag) return showStatus("Missing Tag ID.", true);

  const inVal = cleanIntOrBlank(inRaw);
  if (inVal === null) return showStatus("IN must be a number (or blank).", true);

  showStatus("Sending…");

  // This requires Code.gs to support action=seed_tag
  const out = await apiGet("seed_tag", {
    sheet: lot,          // tab name
    lot_id: lot,         // same thing; Code.gs can use either
    tag_id: tag,         // keep leading zeros on server via setText_
    total_in: inVal === "" ? "" : String(inVal),
  });

  showStatus(
    `Done ✅<br><br>
     <b>Tab</b>: ${out.tab}<br>
     <b>TAG_ID</b>: ${out.tag_id}<br>
     <b>IN</b>: ${out.in_val === "" ? "(blank)" : out.in_val}`
  );
}

window.addEventListener("DOMContentLoaded", () => {
  // Optional: quick reachability check (won't break if version isn't implemented)
  apiGet("version")
    .then(v => showStatus("API OK ✅<br><br>" + JSON.stringify(v), false))
    .catch(() => hideStatus());

  $("seed").onclick = () => seedTagAndIn().catch(e => showStatus(e.message, true));

  // Press Enter in any field triggers submit
  for (const id of ["lot", "tag", "in"]) {
    $(id).addEventListener("keydown", ev => {
      if (ev.key === "Enter") seedTagAndIn().catch(e => showStatus(e.message, true));
    });
  }
});
