// JL Bourg — Live Performance
// Lecture d'un tableau de boxscore (photo ou capture) par modèle de vision.
//
// Fonction Netlify v2 à réponse en flux : un octet est émis immédiatement puis
// toutes les 2 secondes, ce qui évite la coupure à 10 s des fonctions synchrones.
// Le corps final est du JSON (les espaces de tête sont ignorés par JSON.parse).
//
// POST { image: "<base64>", mediaType: "image/jpeg", table: 1, part: 1, size: 6, quarters: true }
//   table    : quel tableau d'équipe lire (1 = premier de la feuille, 2 = deuxième)
//   part     : quel groupe de lignes (1 = joueurs 1 à size, 2 = suivants…)
//   size     : nombre de joueurs par groupe (défaut 6) — garde chaque appel court
//   quarters : demander aussi le tableau de score par quart-temps
// -> { team, players, totals, quarters }  |  { error }
//
// Variables Netlify : ANTHROPIC_API_KEY (requis), VISION_MODEL (optionnel)

const MODEL = process.env.VISION_MODEL || 'claude-haiku-4-5';
const MAX_BYTES = 6 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store'
};

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
- mets la ligne TOTAL dans "totals" ; ignore la ligne EQUIPE/ENTRAÎNEUR ;
- si une cellule est illisible, mets null (n'invente aucun chiffre) ;${quarters ? `
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

async function read(image, mediaType, table, quarters, from, to) {
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
  if (!res.ok) return { error: 'API vision (' + res.status + ') : ' + raw.slice(0, 300) };

  const api = JSON.parse(raw);
  const text = (api.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) return { error: 'réponse illisible : ' + text.slice(0, 200) };

  const data = JSON.parse(text.slice(a, b + 1));
  return {
    team: data.team || null,
    players: Array.isArray(data.players) ? data.players : [],
    totals: data.totals || null,
    quarters: data.quarters && data.quarters.team && data.quarters.opp ? data.quarters : null,
    model: MODEL,
    usage: api.usage || null
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST requis' }), { status: 405, headers: { ...CORS, 'content-type': 'application/json' } });
  }

  let payload;
  try { payload = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'JSON invalide' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } }); }

  const image = String(payload.image || '').replace(/^data:[^;]+;base64,/, '');
  const mediaType = String(payload.mediaType || 'image/jpeg');
  const table = Number(payload.table) === 2 ? 2 : 1;
  const size = Math.min(20, Math.max(2, Number(payload.size) || 6));
  const part = Math.min(6, Math.max(1, Number(payload.part) || 1));
  const from = (part - 1) * size + 1;
  const to = part * size;
  const quarters = payload.quarters !== false;

  const fail = (msg, status) => new Response(JSON.stringify({ error: msg }), { status: status || 400, headers: { ...CORS, 'content-type': 'application/json' } });

  if (!process.env.ANTHROPIC_API_KEY) return fail('ANTHROPIC_API_KEY absente des variables Netlify', 500);
  if (!image) return fail('image manquante');
  if (image.length > MAX_BYTES) return fail('image trop lourde (max ~4,5 Mo)', 413);
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) return fail('format non supporté', 415);

  // Flux : premier octet immédiat, puis un espace toutes les 2 s pendant la lecture.
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode(' '));
      const beat = setInterval(() => { try { controller.enqueue(enc.encode(' ')); } catch {} }, 2000);
      try {
        const out = await read(image, mediaType, table, quarters, from, to);
        controller.enqueue(enc.encode(JSON.stringify(out)));
      } catch (err) {
        controller.enqueue(enc.encode(JSON.stringify({ error: String(err && err.message || err) })));
      } finally {
        clearInterval(beat);
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: { ...CORS, 'content-type': 'application/json' } });
};
