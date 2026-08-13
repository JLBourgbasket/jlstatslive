// JL Bourg — Live Performance
// GET /.netlify/functions/list-matches -> [{id,date,opponent,teamScore,oppScore,result,savedAt}, ...]

import { getStore } from '@netlify/blobs';

const HEAD = { 'content-type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };

export default async () => {
  try {
    const store = getStore('matches');
    const index = (await store.get('_index', { type: 'json' })) || [];
    return new Response(JSON.stringify(index), { headers: HEAD });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message || err) }), { status: 500, headers: HEAD });
  }
};
