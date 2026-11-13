// Vercel serverless function — adds an email to the Shopify customer list.
// Server-to-server, so Shopify's CAPTCHA never applies.
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

  const STORE  = process.env.SHOPIFY_STORE;          // e6e874-2.myshopify.com
  const CID    = process.env.SHOPIFY_CLIENT_ID;
  const SECRET = process.env.SHOPIFY_CLIENT_SECRET;

  if (!STORE || !CID || !SECRET) {
    return res.status(500).json({ error: 'Missing server config' });
  }

  try {
    // 1) get an Admin API token (client-credentials grant, same-org custom app)
    const tokRes = await fetch(`https://${STORE}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CID,
        client_secret: SECRET,
        grant_type: 'client_credentials'
      })
    });
    const tok = await tokRes.json();
    if (!tok.access_token) {
      return res.status(502).json({ error: 'Auth failed', detail: tok });
    }

    // 2) create the customer, subscribed, tagged by source
    const cRes = await fetch(`https://${STORE}/admin/api/2025-10/customers.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': tok.access_token
      },
      body: JSON.stringify({
        customer: {
          email,
          tags: 'pocketmountz-splash',
          email_marketing_consent: { state: 'subscribed', opt_in_level: 'single_opt_in' }
        }
      })
    });
    const cData = await cRes.json();

    if (cRes.ok) return res.status(200).json({ ok: true });

    // already on the list → still a success for the visitor
    if (cRes.status === 422 && JSON.stringify(cData).toLowerCase().includes('taken')) {
      return res.status(200).json({ ok: true, existing: true });
    }
    return res.status(502).json({ error: 'Create failed', detail: cData });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
}
