const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 4;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || p[0] === 0;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80:');
  }
  return true;
}

async function validateUrl(raw) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Seules les URL http/https sont autorisées.');
  if (u.username || u.password) throw new Error('Les URL contenant des identifiants sont refusées.');

  const allowed = String(process.env.LIVE_STATS_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.some(h => u.hostname.toLowerCase() === h || u.hostname.toLowerCase().endsWith(`.${h}`))) {
    throw new Error('Domaine non autorisé par LIVE_STATS_ALLOWED_HOSTS.');
  }

  if (net.isIP(u.hostname)) {
    if (isPrivateIp(u.hostname)) throw new Error('Adresse privée/non routable refusée.');
  } else {
    const addrs = await dns.lookup(u.hostname, { all: true, verbatim: true });
    if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('Le domaine résout vers une adresse privée/non routable.');
  }
  return u;
}

async function safeFetch(raw) {
  let current = await validateUrl(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'JL-Bourg-Live-Performance/2.0',
          'Accept': 'application/json,text/html,text/plain,*/*',
          'Cache-Control': 'no-cache'
        }
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirection sans destination.');
      current = await validateUrl(new URL(loc, current).href);
      continue;
    }

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new Error('Réponse trop volumineuse (> 2 Mo).');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('Réponse trop volumineuse (> 2 Mo).');
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: current.href,
      contentType: res.headers.get('content-type') || '',
      body: buf.toString('utf8')
    };
  }
  throw new Error('Trop de redirections.');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'GET uniquement.' }) };
  const raw = event.queryStringParameters?.url;
  if (!raw) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Paramètre url manquant.' }) };

  try {
    const data = await safeFetch(raw);
    return {
      statusCode: data.ok ? 200 : 502,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'access-control-allow-origin': '*'
      },
      body: JSON.stringify({ ok: data.ok, ...data, fetchedAt: new Date().toISOString() })
    };
  } catch (e) {
    const message = e?.name === 'AbortError' ? 'Timeout du fournisseur live.' : (e?.message || String(e));
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0' },
      body: JSON.stringify({ ok: false, error: message })
    };
  }
};
