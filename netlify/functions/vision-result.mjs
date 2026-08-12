// JL Bourg — Live Performance
// Relit le résultat déposé par vision-read-background.
// GET /.netlify/functions/vision-result?id=<jobId>
//   -> { done: true, players, totals, quarters, ... }  |  { status: "pending" }  |  { error }

import { getStore } from '@netlify/blobs';

const HEAD = { 'content-type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };

export default async (req) => {
  const id = (new URL(req.url).searchParams.get('id') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 60);
  if (!id) return new Response(JSON.stringify({ error: 'id manquant' }), { status: 400, headers: HEAD });

  try {
    const store = getStore('vision-jobs');
    const data = await store.get(id, { type: 'json' });
    if (!data) return new Response(JSON.stringify({ status: 'pending' }), { headers: HEAD });
    // le job est consommé une fois lu
    try { await store.delete(id); } catch {}
    return new Response(JSON.stringify(data), { headers: HEAD });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message || err) }), { status: 500, headers: HEAD });
  }
};
