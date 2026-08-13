// JL Bourg — Live Performance
// Lecture d'un tableau de boxscore par modèle de vision, en ARRIÈRE-PLAN.
//
// Les fonctions Netlify synchrones sont coupées à 10 s (26 s sur certains plans),
// ce qui ne suffit pas pour lire une feuille de statistiques. Une fonction dont le
// nom finit par "-background" répond 202 immédiatement et dispose de 15 minutes.
// Le résultat est déposé dans un store Blobs, que l'application relit via
// vision-result.
//
// Les fonctions "-background" utilisent l'invocation Lambda asynchrone d'AWS,
// plafonnée à 256 Ko de requête : trop petit pour transporter une image. L'image
// est donc déposée au préalable par vision-submit ; ici on ne reçoit qu'un jobId
// et on relit l'image dans le store.
//
// POST { jobId, table, part, size, quarters }
//   -> 202 (aucun corps utile)
//   puis GET /.netlify/functions/vision-result?id=<jobId>
//
// Variables Netlify : ANTHROPIC_API_KEY (requis), VISION_MODEL (optionnel)

import { getStore } from '@netlify/blobs';

const MODEL = process.env.VISION_MODEL || 'claude-haiku-4-5';
const MAX_BYTES = 6 * 1024 * 1024;

const prompt = (table, quarters, from, to) => `Tu lis une feuille de statistiques de basket, photographiée ou capturée à l'écran. Elle peut contenir plusieurs tableaux, un par équipe.

Ne lis QUE le tableau d'équipe numéro ${table} (dans l'ordre d'apparition, de haut en bas). Ignore complètement les autres tableaux de joueurs. S'il n'existe pas de tableau numéro ${table}, renvoie {"players": []}.

Dans ce tableau, ne renvoie QUE les joueurs de la ligne ${from} à la ligne ${to} incluses (en comptant les lignes de joueurs à partir de 1, dans l'ordre d'affichage). S'il y a moins de ${from} joueurs, renvoie {"players": []}. Renvoie la ligne TOTAL dans "totals" seulement si elle est visible.

Correspondance des colonnes, format LNB :
MIN=minutes, PTS=points, 2TR=2pts réussis, 2TT=2pts tentés, 3R=3pts réussis, 3T=3pts tentés,
LFR=lancers réussis, LFT=lancers tentés, RO=rebonds offensifs, RD=rebonds défensifs,
PD=passes décisives, INT=interceptions, CT=contres, BP=ballons perdus, FTE=fautes, +/-=différentiel.

Autres nomenclatures fréquentes, même signification :
2PM/2PA, 3PM/3PA, FTM/FTA, ORB/DRB, AST, STL, TO ou TOV, BLK, PF.

Format EuroCup / Betclic Élite / FIBA (colonnes groupées avec sous-en-têtes) :
Min, PTS, puis un groupe "2FG" avec deux sous-colonnes "M/A" (ex. "4/8" = 4 réussis sur 8 tentés → twoM=4, twoA=8) et "%" (à ignorer),
un groupe "3FG" pareil → threeM/threeA, un groupe "FT" pareil → ftm/fta,
un groupe "Rebounds" avec sous-colonnes O, D, T → orb, drb (ignore T, c'est la somme),
AST, STL, TO,
un groupe "Blocks" avec sous-colonnes F et A → blk = la colonne "F" uniquement (ignore "A"),
un groupe "Fouls" avec sous-colonnes C et D → pf = la colonne "C" uniquement (ignore "D"),
PIR (ou EVAL) : ignore, recalculé, +/- = pm.
Une ligne "Team" sans nom de joueur (rebonds d'équipe) doit être ignorée. La ligne "Total" va dans "totals".

Ignore toujours les colonnes de pourcentage (2P%, 3P%, LF%, FT%), REB/T et EVAL/PIR : recalculés.

Règles :
- une entrée par joueur, dans l'ordre du tableau ;
- retire les marqueurs de titularisation (*) et de capitaine (C) des noms ;
- ignore la ligne EQUIPE/ENTRAÎNEUR ;
- si une cellule est illisible, mets null (n'invente aucun chiffre) ;
- pour chaque type de tir (2pts, 3pts, lancers francs), le nombre réussi ne peut JAMAIS dépasser le nombre tenté. Avant de répondre, vérifie CHAQUE paire (réussis, tenté) une par une : si réussis > tenté, tu as très probablement inversé les deux colonnes (une confusion fréquente entre "3R/3T" ou "2TR/2TT" par exemple) — inverse-les pour corriger, ne renvoie jamais une paire où réussis > tenté ;
- lis les colonnes strictement dans l'ordre où elles apparaissent dans la ligne d'en-tête, de gauche à droite, sans supposer qu'un groupe de colonnes suit le même ordre qu'un autre groupe voisin ;${quarters ? `
- la feuille comporte peut-être un petit tableau de score par quart-temps (Q1 Q2 Q3 Q4) : remplis "quarters" avec les points par période, "team" pour la première équipe listée et "opp" pour la seconde ; sinon mets "quarters" à null ;` : ''}
- réponds UNIQUEMENT avec cet objet JSON, sans texte autour, sans bloc de code :

{
  "team": "nom de l'équipe écrit au-dessus du tableau, sinon null",${quarters ? `
  "quarters": { "team": [23, 19, 24, 22], "opp": [18, 21, 19, 21] },` : ''}
  "players": [
    { "name": "PRENOM NOM", "min": "mm:ss ou minutes décimales", "pts": 0,
      "twoM": 0, "twoA": 0, "threeM": 0, "threeA": 0, "ftm": 0, "fta": 0,
      "orb": 0, "drb": 0, "ast": 0, "stl": 0, "blk": 0, "to": 0, "pf": 0, "pm": 0 }
  ],
  "totals": { "min": "200:00", "pts": 0, "twoM": 0, "twoA": 0, "threeM": 0, "threeA": 0,
    "ftm": 0, "fta": 0, "orb": 0, "drb": 0, "ast": 0, "stl": 0, "blk": 0, "to": 0, "pf": 0 }
}`;

export default async (req) => {
  let payload = {};
  try { payload = await req.json(); } catch {}

  const jobId = String(payload.jobId || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 60);
  if (!jobId) return new Response('jobId manquant', { status: 400 });

  const store = getStore('vision-jobs');
  const done = (obj) => store.setJSON(jobId, Object.assign({ done: true, at: Date.now() }, obj));

  try {
    const dropped = await store.get(jobId + '-img', { type: 'json' });
    if (!dropped) { await done({ error: 'image introuvable (dépôt vision-submit manquant ou expiré)' }); return new Response('', { status: 202 }); }
    try { await store.delete(jobId + '-img'); } catch {}
    const image = String(dropped.image || '').replace(/^data:[^;]+;base64,/, '');
    const mediaType = String(dropped.mediaType || 'image/jpeg');
    const table = Number(payload.table) === 2 ? 2 : 1;
    const size = Math.min(20, Math.max(2, Number(payload.size) || 6));
    const part = Math.min(8, Math.max(1, Number(payload.part) || 1));
    const from = (part - 1) * size + 1, to = part * size;
    const quarters = payload.quarters !== false;

    if (!process.env.ANTHROPIC_API_KEY) { await done({ error: 'ANTHROPIC_API_KEY absente des variables Netlify' }); return new Response('', { status: 202 }); }
    if (!image) { await done({ error: 'image manquante' }); return new Response('', { status: 202 }); }
    if (image.length > MAX_BYTES) { await done({ error: 'image trop lourde (max ~4,5 Mo)' }); return new Response('', { status: 202 }); }
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) { await done({ error: 'format non supporté' }); return new Response('', { status: 202 }); }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: prompt(table, quarters, from, to) }
          ]
        }]
      })
    });

    const raw = await res.text();
    if (!res.ok) { await done({ error: 'API vision (' + res.status + ') : ' + raw.slice(0, 300) }); return new Response('', { status: 202 }); }

    const api = JSON.parse(raw);
    const text = (api.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b < 0) { await done({ error: 'réponse illisible : ' + text.slice(0, 200) }); return new Response('', { status: 202 }); }

    const data = JSON.parse(text.slice(a, b + 1));
    await done({
      team: data.team || null,
      players: Array.isArray(data.players) ? data.players : [],
      totals: data.totals || null,
      quarters: data.quarters && data.quarters.team && data.quarters.opp ? data.quarters : null,
      model: MODEL,
      usage: api.usage || null
    });
  } catch (err) {
    try { await done({ error: String(err && err.message || err) }); } catch {}
  }

  return new Response('', { status: 202 });
};
