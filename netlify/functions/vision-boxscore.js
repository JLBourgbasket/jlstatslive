// JL Bourg — Live Performance
// Lecture d'une photo / capture de boxscore par modèle de vision.
// POST { image: "<base64 sans préfixe>", mediaType: "image/jpeg", side: "team"|"opp" }
// -> { players: [...], totals: {...} }  (colonnes LNB brutes, converties côté app)
//
// Variable d'environnement requise : ANTHROPIC_API_KEY
// Variable optionnelle : VISION_MODEL (défaut : claude-sonnet-4-5)

const MODEL = process.env.VISION_MODEL || 'claude-sonnet-4-5';
const MAX_BYTES = 6 * 1024 * 1024; // 6 Mo de base64 ~ 4,5 Mo d'image

const SCHEMA = `{
  "team": "nom de l'équipe si visible, sinon null",
  "players": [
    {
      "name": "PRENOM NOM",
      "min": "mm:ss ou minutes décimales",
      "pts": 0, "twoM": 0, "twoA": 0, "threeM": 0, "threeA": 0,
      "ftm": 0, "fta": 0, "orb": 0, "drb": 0,
      "ast": 0, "stl": 0, "blk": 0, "to": 0, "pf": 0, "pm": 0
    }
  ],
  "totals": { "min": "200:00", "pts": 0, "twoM": 0, "twoA": 0, "threeM": 0, "threeA": 0, "ftm": 0, "fta": 0, "orb": 0, "drb": 0, "ast": 0, "stl": 0, "blk": 0, "to": 0, "pf": 0 }
}`;

const PROMPT = `Tu lis une feuille de statistiques de basket au format LNB (Betclic Élite / EuroCup), photographiée ou capturée à l'écran.

Correspondance des colonnes LNB :
MIN=minutes, PTS=points, 2TR=2pts réussis, 2TT=2pts tentés, 3R=3pts réussis, 3T=3pts tentés,
LFR=lancers réussis, LFT=lancers tentés, RO=rebonds offensifs, RD=rebonds défensifs,
PD=passes décisives, INT=interceptions, CT=contres, BP=ballons perdus, FTE=fautes, +/-=différentiel.
Ignore les colonnes de pourcentage (2P%, 3P%, LF%), REB, CS et EVAL.

Règles :
- une entrée par joueur, dans l'ordre du tableau ;
- retire les marqueurs de titularisation (*) et de capitaine (C) des noms ;
- inclus la ligne TOTAL dans "totals" ; ignore la ligne EQUIPE/ENTRAÎNEUR ;
- si une cellule est illisible, mets null (n'invente aucun chiffre) ;
- réponds UNIQUEMENT avec cet objet JSON, sans texte autour, sans bloc de code :

${SCHEMA}`;

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST requis' }) };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY absente des variables Netlify' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON invalide' }) }; }

  const image = String(payload.image || '').replace(/^data:[^;]+;base64,/, '');
  const mediaType = String(payload.mediaType || 'image/jpeg');
  if (!image) return { statusCode: 400, headers, body: JSON.stringify({ error: 'image manquante' }) };
  if (image.length > MAX_BYTES) return { statusCode: 413, headers, body: JSON.stringify({ error: 'image trop lourde (max ~4,5 Mo)' }) };
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
    return { statusCode: 415, headers, body: JSON.stringify({ error: 'format non supporté' }) };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
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
            { type: 'text', text: PROMPT }
          ]
        }]
      })
    });

    const raw = await res.text();
    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: 'API vision : ' + raw.slice(0, 400) }) };
    }

    const api = JSON.parse(raw);
    const text = (api.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start < 0 || end < 0) {
      return { statusCode: 422, headers, body: JSON.stringify({ error: 'réponse illisible', raw: text.slice(0, 400) }) };
    }

    const data = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(data.players) || !data.players.length) {
      return { statusCode: 422, headers, body: JSON.stringify({ error: 'aucun joueur détecté' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        team: data.team || null,
        players: data.players,
        totals: data.totals || null,
        usage: api.usage || null,
        model: MODEL
      })
    };
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'délai dépassé (55 s)' : String(err.message || err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
  } finally {
    clearTimeout(timer);
  }
};
