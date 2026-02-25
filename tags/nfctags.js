async function logToEssSheet({ lot, product, qty }) {
  // Build the exact URL the Apps Script expects. Use encodeURIComponent for safety.
  const base = 'https://script.google.com/macros/s/AKfycbx-xOKyk83MF-wnpOdNiNiw7ltbFG9Atdjv5Hy4yp0bqTXKUzLlY15TgaOFX-CeJPa-3A/exec';
  const u = new URL(base);
  u.searchParams.set('action', 'lot_seed');
  u.searchParams.set('lot_id', lot);
  u.searchParams.set('product', product);
  u.searchParams.set('qty', qty);

  // Fire a GET request. Most Apps Script web apps return JSON or text.
  // If your deployment is set to “Anyone” (even anonymous), CORS usually allows GET.
  const res = await fetch(u.toString(), {
    method: 'GET',
    // If your script enforces CORS, you may need mode:'cors'.
    // mode: 'cors',
    // credentials: 'omit',
  });

  // Try to parse JSON; if not JSON, read as text.
  let body;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }

  if (!res.ok) {
    throw new Error(`Sheets logging failed (${res.status}): ${JSON.stringify(body).slice(0,200)}`);
  }
  return body;
}
