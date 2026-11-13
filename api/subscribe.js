// Vercel serverless function — adds an email to the Shopify customer list.
// Server-to-server (no CAPTCHA). Token via client-credentials (form-encoded).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let email = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    email = String(body.email || '').trim();
  } catch (_) { email = ''; }
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const STORE  = process.env.SHOPIFY_STORE;
  const CID    = process.env.SHOPIFY_CLIENT_ID;
  const SECRET = process.env.SHOPIFY_CLIENT_SECRET;
  if (!STORE || !CID || !SECRET) {
    return res.status(500).json({ error: 'Missing server config' });
  }

  // read any response safely — return raw text if it isn't JSON
  async function readResp(r) {
    const t = await r.text();
    try { return { ok: r.ok, status: r.status, data: JSON.parse(t) }; }
    catch (_) { return { ok: r.ok, status: r.status, data: null, raw: t.slice(0, 300) }; }
  }

  try {
    // 1) token — MUST be form-encoded for Shopify
    const form = new URLSearchParams();
    form.set('grant_type', 'client_credentials');
    form.set('client_id', CID);
    form.set('client_secret', SECRET);

    const tokRes = await fetch(`https://${STORE}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: form.toString()
    });
    const tok = await readResp(tokRes);
    if (!tok.ok || !tok.data || !tok.data.access_token) {
      return res.status(502).json({ error: 'Auth failed', status: tok.status, detail: tok.data || tok.raw });
    }
    const token = tok.data.access_token;

    // 2) create customer, subscribed, tagged
    const cRes = await fetch(`https://${STORE}/admin/api/2025-10/customers.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        customer: {
          email,
          tags: 'pocketmountz-splash',
          email_marketing_consent: { state: 'subscribed', opt_in_level: 'single_opt_in' }
        }
      })
    });
    const cust = await readResp(cRes);
    if (cust.ok) return res.status(200).json({ ok: true });
    if (cust.status === 422 && JSON.stringify(cust.data || '').toLowerCase().includes('taken')) {
      return res.status(200).json({ ok: true, existing: true });
    }
    return res.status(502).json({ error: 'Create failed', status: cust.status, detail: cust.data || cust.raw });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
}
