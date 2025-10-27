import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ type: "*/*" }));

// Read secrets from environment (Render → Environment Variables)
const ADCOMBO_API_KEY = process.env.ADCOMBO_API_KEY || "";
const OFFER_ID = process.env.OFFER_ID || "";

/* -------- helpers -------- */

// get a note_attribute value by possible keys
function getNoteAttr(order, keys = []) {
  const arr = order?.note_attributes || [];
  const map = {};
  for (const it of arr) {
    const k = (it?.name || it?.key || "").toString().toLowerCase();
    const v = (it?.value || "").toString();
    if (k) map[k] = v;
  }
  for (const k of keys) {
    const v = map[k.toLowerCase()];
    if (v) return v;
  }
  return "";
}

// detect private/reserved IP ranges (must not be sent to AdCombo)
function isPrivateIP(ip) {
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|100\.(6[4-9]|[7-9]\d|1\d{2}|2([0-1]\d|2[0-7]))\.)/.test(ip);
}

/* -------- health -------- */

app.get("/", (_req, res) => {
  res.send("OK - Shopify → AdCombo Bridge");
});

/* -------- webhook -------- */

app.post("/shopify-to-adcombo", async (req, res) => {
  try {
    const o = req.body;

    const name = `${o?.shipping_address?.first_name || o?.customer?.first_name || ""} ${o?.shipping_address?.last_name || o?.customer?.last_name || ""}`.trim();
    const phone = o?.shipping_address?.phone || o?.billing_address?.phone || o?.customer?.phone || "";
    const country_code = (o?.shipping_address?.country_code || o?.billing_address?.country_code || "").toUpperCase();
    const price = String(o?.total_price || o?.subtotal_price || "0");

    // get client IP: prefer browser_ip, else note_attributes (many COD forms store it there)
    let ip = o?.client_details?.browser_ip || "";
    if (!ip || isPrivateIP(ip)) {
      ip = getNoteAttr(o, ["ip", "ip address", "ip_address", "client_ip"]);
    }
    if (isPrivateIP(ip)) ip = ""; // final guard

    const ext_in_id = String(o?.id || o?.name || "");
    const email = o?.email || o?.customer?.email || "";
    const quantity = String(o?.line_items?.[0]?.quantity || 1);
    const referrer = o?.referring_site || "";
    const base_url = o?.landing_site || "";

    // Build AdCombo GET params
    const params = new URLSearchParams({
      api_key: ADCOMBO_API_KEY,
      name,
      phone,
      offer_id: String(OFFER_ID),
      country_code,
      price,
      ip,
      ext_in_id,
      email,
      quantity,
      referrer,
      base_url
    });

    // drop empty params
    for (const [k, v] of [...params.entries()]) {
      if (!v) params.delete(k);
    }

    const url = `https://api.adcombo.com/api/v2/order/create?${params.toString()}`;
    const r = await fetch(url, { method: "GET" });
    const data = await r.json();

    console.log("AdCombo >", data);
    return res.status(200).json({ ok: true, adcombo: data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/* -------- start -------- */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bridge up on ${PORT}`));
