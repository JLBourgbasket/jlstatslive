// JL Bourg — Live Performance
// Sauvegarde un match (boxscore + débrief) dans un store Blobs persistant,
// met à jour l'index des matchs et recalcule les profils joueurs cumulés.
//
// POST { id?, meta, team, opp, players, advanced, history }
//   advanced: { "Nom Joueur": { minutes, ts, efg, usg, ast, tov, orb, trb } }
//   -> { ok: true, id, profiles }

import { getStore } from '@netlify/blobs';

const HEAD = { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const MIN_MINUTES = 4; // même seuil que l'app pour ignorer les échantillons trop faibles

async function recomputeProfiles(matchesStore, index) {
  const sums = {}; // name -> {games, sum:{k:total}}
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

  try {
    const matchesStore = getStore('matches');
    const profilesStore = getStore('profiles');

    const now = Date.now();
    const date = payload.meta?.date || new Date(now).toISOString().slice(0, 10);
    const opponent = String(payload.meta?.oppName || 'ADVERSAIRE').trim();
    const id = payload.id || (date + '_' + opponent.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '_' + now.toString(36));

    const teamPts = Number(payload.team?.pts) || 0, oppPts = Number(payload.opp?.pts) || 0;
    const result = teamPts === oppPts ? 'N' : (teamPts > oppPts ? 'W' : 'L');

    const record = {
      id, savedAt: now, date, opponent,
      meta: payload.meta || {}, team: payload.team || {}, opp: payload.opp || {},
      players: payload.players || {}, advanced: payload.advanced || {}, history: payload.history || [],
      teamScore: teamPts, oppScore: oppPts, result
    };
    await matchesStore.setJSON(id, record);

    let index = (await matchesStore.get('_index', { type: 'json' })) || [];
    index = index.filter(e => e.id !== id);
    index.push({ id, date, opponent, teamScore: teamPts, oppScore: oppPts, result, savedAt: now });
    index.sort((a, b) => b.savedAt - a.savedAt);
    await matchesStore.setJSON('_index', index);

    const profiles = await recomputeProfiles(matchesStore, index);
    await profilesStore.setJSON('_profiles', profiles);

    return new Response(JSON.stringify({ ok: true, id, profiles }), { headers: HEAD });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message || err) }), { status: 500, headers: HEAD });
  }
};
