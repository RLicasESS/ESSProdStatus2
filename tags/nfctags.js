/* tags.js  (Web NFC add-on for your existing ESS Tags page)
 *
 * What it does:
 * - Adds 3 buttons next to Tag ID: NFC Read / NFC Write / NFC Erase
 * - NFC Read: tap tag with Android Chrome -> fills Tag ID input with NDEF Text (lot/tag text)
 * - NFC Write: writes Lot ID input text to the NFC tag as NDEF Text
 * - NFC Erase: writes blank text to the NFC tag
 *
 * IMPORTANT:
 * - Web NFC works on Android Chrome over HTTPS (GitHub Pages is HTTPS ✅)
 * - Web NFC generally does NOT work on desktop Chrome/Edge/Safari on Windows/macOS
 */

(() => {
  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);

  function el(tag, props = {}, children = []) {
    const n = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "style") Object.assign(n.style, v);
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return n;
  }

  function showInlineStatus(msg, isError = false) {
    let s = $("nfcStatus");
    if (!s) {
      // Place status under the row
      const row = $("lookup")?.closest(".row");
      s = el("div", { id: "nfcStatus", class: "small", style: { marginTop: "8px" } }, []);
      row?.parentElement?.appendChild(s);
    }
    s.textContent = msg;
    s.style.color = isError ? "#b00020" : "#555";
  }

  function hasWebNfc() {
    return ("NDEFReader" in window);
  }

  function requireWebNfcOrExplain() {
    if (!hasWebNfc()) {
      throw new Error(
        "Web NFC not supported here. Use Android Chrome over HTTPS (GitHub Pages is OK). Desktop browsers usually won't work."
      );
    }
  }

  // ---------- Web NFC core ----------
  let ndef = null;
  let scanning = false;
  let abortCtrl = null;

  async function stopScan() {
    if (!scanning) return;
    try { abortCtrl?.abort(); } catch {}
    scanning = false;
  }

  function extractFirstTextRecord(message) {
    for (const rec of message.records) {
      if (rec.recordType === "text") {
        try {
          const decoder = new TextDecoder(rec.encoding || "utf-8");
          const bytes = new Uint8Array(rec.data.buffer, rec.data.byteOffset, rec.data.byteLength);
          return decoder.decode(bytes).trim();
        } catch {
          try {
            const decoder = new TextDecoder("utf-8");
            const bytes = new Uint8Array(rec.data.buffer, rec.data.byteOffset, rec.data.byteLength);
            return decoder.decode(bytes).trim();
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  async function nfcReadOnce() {
    requireWebNfcOrExplain();
    if (!ndef) ndef = new NDEFReader();

    await stopScan();
    abortCtrl = new AbortController();
    scanning = true;

    showInlineStatus("NFC READ: Tap and HOLD the tag near your phone…");

    await ndef.scan({ signal: abortCtrl.signal });

    return await new Promise((resolve, reject) => {
      const cleanup = () => {
        ndef.onreading = null;
        ndef.onreadingerror = null;
        stopScan().catch(() => {});
      };

      ndef.onreading = (event) => {
        try {
          const text = extractFirstTextRecord(event.message);
          cleanup();
          resolve({ text, serialNumber: event.serialNumber || "" });
        } catch (e) {
          cleanup();
          reject(e);
        }
      };

      ndef.onreadingerror = () => {
        cleanup();
        reject(new Error("NFC read error (try holding tag steadier)."));
      };

      // If user denies permission etc.
      abortCtrl.signal.addEventListener("abort", () => {
        cleanup();
        reject(new Error("NFC scan aborted."));
      }, { once: true });
    });
  }

  async function nfcWriteText(text) {
    requireWebNfcOrExplain();
    if (!ndef) ndef = new NDEFReader();

    showInlineStatus("*** KEEP TAG ON PHONE — writing now (do not move) ***");
    await ndef.write({
      records: [{ recordType: "text", data: String(text ?? ""), lang: "en" }]
    });
    showInlineStatus("*** OK — remove tag ***");
  }

  // ---------- UI injection into your existing page ----------
  function injectNfcButtons() {
    const row = $("lookup")?.closest(".row");
    if (!row) return;

    // Avoid duplicates if tags.js is reloaded
    if ($("btnNfcRead")) return;

    const btnRead = el("button", { id: "btnNfcRead", type: "button" }, ["NFC Read"]);
    const btnWrite = el("button", { id: "btnNfcWrite", type: "button" }, ["NFC Write"]);
    const btnErase = el("button", { id: "btnNfcErase", type: "button" }, ["NFC Erase"]);

    row.appendChild(btnRead);
    row.appendChild(btnWrite);
    row.appendChild(btnErase);

    // Friendly note if not supported
    if (!hasWebNfc()) {
      showInlineStatus("Web NFC not supported in this browser. Use Android Chrome.", true);
      btnRead.disabled = true;
      btnWrite.disabled = true;
      btnErase.disabled = true;
      return;
    } else {
      showInlineStatus("Web NFC ready (Android Chrome).");
    }

    // --- events ---
    btnRead.addEventListener("click", async () => {
      try {
        const { text, serialNumber } = await nfcReadOnce();
        if (serialNumber) showInlineStatus(`NFC READ OK (UID: ${serialNumber}).`);
        else showInlineStatus("NFC READ OK.");

        if (text == null) {
          showInlineStatus("Read OK, but no NDEF Text record found.", true);
          return;
        }
        if (text === "") {
          showInlineStatus("Read OK: (blank text).", false);
          return;
        }

        // Put text into Tag ID box by default (your workflow request)
        // If you'd rather fill LOT_ID instead, swap $("tag") -> $("lot")
        const tagInput = $("tag");
        if (tagInput) {
          tagInput.value = text;
          tagInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        showInlineStatus(`Read text: ${text}`);
      } catch (e) {
        showInlineStatus(`NFC READ failed: ${e.message}`, true);
      }
    });

    btnWrite.addEventListener("click", async () => {
      try {
        // Write from Lot ID field if present; otherwise from Tag ID field
        const lotVal = $("lot")?.value?.trim();
        const fallback = $("tag")?.value?.trim();
        const text = lotVal || fallback;

        if (!text) {
          showInlineStatus("Enter a LOT (Lot ID box) before NFC Write.", true);
          return;
        }

        await nfcWriteText(text);
      } catch (e) {
        showInlineStatus(`NFC WRITE failed: ${e.message}`, true);
      }
    });

    btnErase.addEventListener("click", async () => {
      try {
        // Web NFC doesn't guarantee a true "no NDEF TLV" wipe like PC/SC.
        // This writes a blank Text record, which effectively clears the visible content.
        await nfcWriteText("");
      } catch (e) {
        showInlineStatus(`NFC ERASE failed: ${e.message}`, true);
      }
    });
  }

  // Run after DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectNfcButtons);
  } else {
    injectNfcButtons();
  }
})();
