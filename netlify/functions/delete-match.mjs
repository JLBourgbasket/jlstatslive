// JL Bourg — Live Performance
// POST /.netlify/functions/delete-match { id } -> supprime le match, met à jour l'index et les profils joueurs

import { getStore } from '@netlify/blobs';

const HEAD = { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const MIN_MINUTES = 4;

async function recomputeProfiles(matchesStore, index) {
  const sums = {};
  for (const entry of index) {
    let rec;
    try { rec = await matchesStore.get(entry.id, { type: 'json' }); } catch { rec = null; }
    if (!rec || !rec.advanced) continue;
    for (const [name, adv] of Object.entries(rec.advanced)) {
      if (!adv || !(adv.minutes >= MIN_MINUTES)) continue;
      if (!sums[name]) sums[name] = { games: 0, sum: {} };
      sums[name].games++;
      for (const k of ['ts', 'efg', 'usg', 'ast', 'tov', 'orb', 'trb']) {
        if (Number.isFinite(adv[k])) sums[name].sum[k] = (sums[name].sum[k] || 0) + adv[k];
      }
    }
  }
  const profiles = {};
  for (const [name, s] of Object.entries(sums)) {
    const avg = {};
    for (const k of Object.keys(s.sum)) avg[k] = s.sum[k] / s.games;
    profiles[name] = { games: s.games, avg };
  }
  return profiles;
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: HEAD });
  let payload;
  try { payload = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON invalide' }), { status: 400, headers: HEAD }); }
  const id = String(payload.id || '');
  if (!id) return new Response(JSON.stringify({ error: 'id manquant' }), { status: 400, headers: HEAD });

  try {
    const matchesStore = getStore('matches');
    const profilesStore = getStore('profiles');
    await matchesStore.delete(id);
    let index = (await matchesStore.get('_index', { type: 'json' })) || [];
    index = index.filter(e => e.id !== id);
    await matchesStore.setJSON('_index', index);
    const profiles = await recomputeProfiles(matchesStore, index);
    await profilesStore.setJSON('_profiles', profiles);
    return new Response(JSON.stringify({ ok: true, profiles }), { headers: HEAD });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message || err) }), { status: 500, headers: HEAD });
  }
};
