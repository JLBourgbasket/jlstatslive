# JL Bourg — Live Performance (V3)

Tableau de bord de statistiques avancées en cours de match. Application statique, sans build ni `npm install`.

## Contenu du dossier

```
index.html                            application complète (autonome, aucune dépendance externe)
manifest.webmanifest / sw.js          installation PWA + cache tablette
assets/                               logo et icônes JL Bourg
sample-match.json                     flux de test (format natif de l'app)
sample-boxscore.csv                   exemple d'import CSV joueurs
netlify.toml                          configuration Netlify
netlify/functions/live-stats.js       proxy serverless pour les flux live bloqués par CORS
netlify/functions/vision-boxscore.js  lecture d'une photo de boxscore par modèle de vision
```

## Déploiement

```bash
netlify deploy --prod --dir=. --functions=netlify/functions
```

Ou en connectant le dossier à un dépôt Git relié à Netlify (`netlify.toml` déclare déjà le répertoire des fonctions). Le Drag & Drop publie l'interface mais pas forcément les fonctions.

---

## Intégrer vision-boxscore.js — procédure

La fonction est déjà dans le ZIP. Il reste trois choses à faire.

### 1. Obtenir une clé API

Créez un compte sur console.anthropic.com, ajoutez du crédit, puis générez une clé dans **API Keys**. Elle commence par `sk-ant-`.

### 2. Déclarer la clé dans Netlify

Interface Netlify : **Site configuration → Environment variables → Add a variable**

| Clé | Valeur | Portée |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` | toutes (Production incluse) |
| `VISION_MODEL` *(optionnel)* | `claude-sonnet-4-5` | toutes |

En ligne de commande :

```bash
netlify env:set ANTHROPIC_API_KEY sk-ant-xxxxx
```

La clé reste côté serveur : elle n'apparaît jamais dans `index.html` ni dans le navigateur.

### 3. Redéployer avec les fonctions

```bash
netlify deploy --prod --dir=. --functions=netlify/functions
```

Vérification :

```bash
curl -X POST https://VOTRE-SITE.netlify.app/.netlify/functions/vision-boxscore \
  -H "content-type: application/json" -d '{}'
```

Réponse attendue : `{"error":"image manquante"}` — la fonction est en ligne et la clé est lue.
Si la réponse est `{"error":"ANTHROPIC_API_KEY absente…"}`, la variable n'est pas déclarée sur l'environnement déployé.
Si c'est une page 404, les fonctions n'ont pas été publiées (utilisez la commande CLI ci-dessus, pas le Drag & Drop).

### Utilisation en match

Onglet **DATA** → bloc **CAPTURE** :

1. **Choisir un fichier** ouvre directement l'appareil photo sur iPhone et iPad. Cadrez le tableau bien à plat, tableau entier, en-têtes de colonnes visibles.
2. **LIRE LA PHOTO** — la lecture prend 5 à 15 secondes.
3. La liste des joueurs détectés s'affiche : minutes, points, tirs, rebonds, passes, fautes. Les noms hors effectif 2026-27 sont en gris.
4. **INJECTER** applique les lignes reconnues ; **ANNULER** jette la lecture. Rien n'est calculé avant votre validation.

Seuls les joueurs de l'effectif 2026-27 sont injectés ; les autres noms sont listés comme ignorés. Une cellule illisible revient à `null` et n'écrase rien par un chiffre inventé.

### Coût et limites

Une photo de boxscore consomme environ 1 500 à 3 000 tokens d'entrée, soit de l'ordre de 1 à 2 centimes par lecture. Quatre lectures par match (une par quart-temps) restent négligeables.

Limites : image de 4,5 Mo maximum, délai de 55 secondes, formats JPEG / PNG / WebP / GIF. Une photo prise de biais ou un tableau coupé produisent des erreurs de colonnes — d'où l'écran de validation obligatoire.

**Plus fiable que la photo quand le tableau est à l'écran :** sélectionnez-le, copiez, et collez dans **Import boxscore LNB** (même onglet). Aucune reconnaissance, aucune erreur possible, aucune clé API.

---

## Test immédiat après déploiement

Onglet **DATA** → LIVE SOURCE → URL : `/sample-match.json` → **CONNECTER**.
Le badge du bandeau passe en `EN DIRECT` et les jauges se recalculent.

Sans flux disponible, **SIMULER UN MATCH** (bandeau) fait avancer un match fictif toutes les 2 secondes : utile pour vérifier couleurs, momentum et alertes joueurs.

## Les cinq écrans

- **LIVE** — score, fautes d'équipe, momentum par tranche de 5 minutes, quatre cadrans ATTACK / DEFENSE / POSSESSION / NET, les 5 écarts prioritaires, pouls collectif.
- **TEAM** — duels JL Bourg / adversaire et les 12 jauges collectives contre la baseline V0.
- **PLAYERS** — une carte par joueur : 7 jauges avec sa zone cible individuelle, statut, charge minutes, fautes, +/-. Clic sur une carte pour la référence historique et le delta live. Tri par priorité, minutes ou nom.
- **DÉBRIEF** — feuille A4 imprimable du match : chiffres clés, bascules par tranche de 5 minutes, écarts collectifs, tableau des onze joueurs (Δ TS contre baseline, DNP inclus) et analyse textuelle générée depuis les données. Bouton IMPRIMER / PDF ; à l'impression, seule la feuille sort.
- **DATA** — import boxscore LNB, LIVE SOURCE, saisie manuelle équipe et joueurs, JSON, CSV, capture photo.

À faire après chaque match : onglet DÉBRIEF → IMPRIMER / PDF pour la feuille du staff, et onglet DATA → JSON → EXPORTER pour archiver le match (l'archive permettra de recalculer les baselines en fin de saison).

Langue : français par défaut, bascule EN dans le bandeau. Le match en cours est conservé dans le navigateur (localStorage).

## Import boxscore LNB

Copiez le tableau LNB (sélection de la page ou HTML) et collez-le dans **Import boxscore LNB**. Colonnes lues : MIN (mm:ss), PTS, 2TR/2TT et 3R/3T (→ FGM/FGA et 3PM/3PA), LFR/LFT, RO, RD, PD, INT, CT, BP, FTE, +/-, EVAL. Les pourcentages, REB et CS sont ignorés (recalculés). La ligne TOTAL alimente les stats collectives et les minutes totales donnent le temps joué.

`AUTO` détecte quelle table est celle de la JL grâce aux noms du roster ; sinon forcez JL BOURG ou ADVERSAIRE.

## Code couleur

Le rouge JL Bourg est réservé à l'identité (bandeau, soulignements, trois carrés). Les états de performance utilisent une échelle distincte, toujours doublée d'un pictogramme :

| | |
|---|---|
| ● vert | dans la zone cible |
| ▲ orange | écart à surveiller |
| ■ bordeaux | écart critique |
| – gris | échantillon insuffisant |

Les cellules restent grises tant que l'échantillon est trop faible (moins de 4 minutes jouées, moins de 3 tirs pour TS% / eFG%).

## Connecteur live

`fetch` direct, puis repli sur `/.netlify/functions/live-stats?url=…`. Formats reconnus : JSON natif de l'application (`meta`, `team`, `opp`, `players`), JSON encapsulé (`data`), et pages HTML contenant un tableau au format LNB.

Variables optionnelles : `LIVE_STATS_ALLOWED_HOSTS` pour restreindre les domaines interrogeables.

**À faire** : si la page live du fournisseur construit son tableau en JavaScript, le HTML brut arrive vide — il faut alors l'endpoint JSON sous-jacent (onglet Réseau du navigateur pendant un match). Si l'URL exige une authentification, la fonction doit transmettre un jeton via une variable d'environnement.

## Statistiques

Les indicateurs individuels calculés depuis un boxscore sont des estimations (USG%, AST%, ORB%, TRB% dépendent des minutes équipe). Objectif : détecter des écarts en cours de match, pas remplacer la feuille officielle.
