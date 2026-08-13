// JL Bourg — Live Performance
// GET /.netlify/functions/player-profiles -> { "Nom Joueur": { games, avg:{ts,efg,usg,ast,tov,orb,trb} } }
// Profils recalculés à chaque sauvegarde de match (voir save-match.mjs / delete-match.mjs).

import { getStore } from '@netlify/blobs';

const HEAD = { 'content-type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };

export default async () => {
  try {
    const store = getStore('profiles');
    const profiles = (await store.get('_profiles', { type: 'json' })) || {};
    return new Response(JSON.stringify(profiles), { headers: HEAD });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message || err) }), { status: 500, headers: HEAD });
  }
};
