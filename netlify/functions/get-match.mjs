// JL Bourg — Live Performance
// GET /.netlify/functions/get-match?id=<id> -> match record complet

import { getStore } from '@netlify/blobs';

const HEAD = { 'content-type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!id) return new Response(JSON.stringify({ error: 'id manquant' }), { status: 400, headers: HEAD });
  try {
    const store = getStore('matches');
    const rec = await store.get(id, { type: 'json' });
    if (!rec) return new Response(JSON.stringify({ error: 'introuvable' }), { status: 404, headers: HEAD });
    return new Response(JSON.stringify(rec), { headers: HEAD });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message || err) }), { status: 500, headers: HEAD });
  }
};
