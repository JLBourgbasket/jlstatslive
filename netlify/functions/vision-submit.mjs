// JL Bourg — Live Performance
// Dépose l'image d'un boxscore dans le store Blobs avant lecture en arrière-plan.
// Les fonctions Netlify au suffixe "-background" utilisent l'invocation Lambda
// asynchrone, plafonnée à 256 Ko de requête — bien trop petit pour une photo.
// On envoie donc l'image ici (fonction normale, limite ~6 Mo), puis
// vision-read-background ne reçoit plus qu'un jobId et relit l'image déposée.
//
// POST { jobId, image, mediaType } -> { ok: true }

import { getStore } from '@netlify/blobs';

const HEAD = { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' };

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: HEAD });
  let payload;
  try { payload = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON invalide' }), { status: 400, headers: HEAD }); }

  const jobId = String(payload.jobId || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 60);
  if (!jobId) return new Response(JSON.stringify({ error: 'jobId manquant' }), { status: 400, headers: HEAD });
  const image = String(payload.image || '');
  if (!image) return new Response(JSON.stringify({ error: 'image manquante' }), { status: 400, headers: HEAD });

  try {
    const store = getStore('vision-jobs');
    await store.setJSON(jobId + '-img', { image, mediaType: String(payload.mediaType || 'image/jpeg') });
    return new Response(JSON.stringify({ ok: true }), { headers: HEAD });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message || err) }), { status: 500, headers: HEAD });
  }
};
