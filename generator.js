const fs = require('fs');
const https = require('https');
const zlib = require('zlib');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("ERREUR : GEMINI_API_KEY est absente des Secrets GitHub !");
  process.exit(1);
}

const BATCHES = 3;

const TIERS = [
  { id: 1, name: 'tier1_facile', diff: 'Niveau Débutant (Niv 1-10) : Objets simples du quotidien, nature évidente, animaux, actions familières.' },
  { id: 2, name: 'tier2_moyen', diff: 'Niveau Intermédiaire (Niv 11-30) : Métiers, sciences, sports, géographie, cuisine, culture.' },
  { id: 3, name: 'tier3_difficile', diff: 'Niveau Avancé (Niv 31-60) : Concepts abstraits, physique, histoire, processus complexes.' },
  { id: 4, name: 'tier4_expert', diff: 'Niveau Expert / Maître (Niv 61-100+) : Littérature, mythologie, vocabulaire noble, alchimie, philosophie.' }
];

const THEMES = [
  "Sciences & Espace", "Nature & Animaux", "Histoire & Civilisations",
  "Cuisine & Terroir", "Arts & Musique", "Sports & Aventure",
  "Objets & Outils", "Sensations & Émotions"
];

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    });

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return reject(new Error("API Gemini Error: " + JSON.stringify(parsed.error)));
          }
          let text = parsed.candidates[0].content.parts[0].text;
          text = text.replace(/```json/g, '').replace(/```/g, '').trim();
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error("Réponse brute invalide : " + data.substring(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  fs.mkdirSync('vault_packs', { recursive: true });
  let globalId = 1;

  for (const tier of TIERS) {
    console.log(`\n=== Génération IA pour ${tier.name} ===`);
    const pool = [];
    const seenCombos = new Set();

    for (let b = 0; b < BATCHES; b++) {
      const theme = THEMES[b % THEMES.length];
      console.log(`[Palier ${tier.id}] Lot ${b + 1}/${BATCHES} (${theme})...`);

      const prompt = `Tu es le concepteur en chef du jeu "2Mots".
Réponds UNIQUEMENT par un tableau JSON brut contenant 25 énigmes sémantiques 100% FRANÇAISES, HAUTEMENT LOGIQUES et INGÉNIEUSES.

Difficulté requise : ${tier.diff}
Thématique : ${theme}

RÈGLES ABSOLUES :
1. LE LIEN SÉMANTIQUE DOIT ÊTRE ÉVIDENT OU ASTUCIEUX : word1 + word2 mènent à answer (ex: SOLEIL + PLUIE -> ARC-EN-CIEL, VOLANT + PLUME -> BADMINTON, VOLCAN + LAVE -> EXPLOSER).
2. ZÉRO ASSOCIATION ALÉATOIRE INCOMPRÉHENSIBLE.
3. NATURE GRAMMATICALE IDENTIQUE : answer, distractor1 et distractor2 DOIVENT avoir STRICTEMENT la même nature (3 verbes, ou 3 noms, ou 3 adjectifs).
4. INDICE PRÉCIS ET CONTEXTUEL : L'indice "clue" décrit la passerelle avec élégance sans révéler le mot.

Format JSON attendu :
[
  {
    "word1": "VOLANT",
    "word2": "PLUME",
    "answer": "BADMINTON",
    "clue": "Sport de raquette rapide et aérien",
    "difficulty": ${tier.id === 1 ? 1 : tier.id === 2 ? 4 : tier.id === 3 ? 7 : 9},
    "type": "nom",
    "distractor1": "TENNIS",
    "distractor2": "SQUASH"
  }
]`;

      try {
        const enigmas = await callGemini(prompt);
        if (Array.isArray(enigmas)) {
          for (const item of enigmas) {
            if (!item.word1 || !item.word2 || !item.answer) continue;
            const w1 = String(item.word1).toUpperCase().trim();
            const w2 = String(item.word2).toUpperCase().trim();
            const ans = String(item.answer).toUpperCase().trim();
            const key = `${w1}#${w2}#${ans}`;
            if (seenCombos.has(key)) continue;
            seenCombos.add(key);

            const d1 = String(item.distractor1 || 'CHOIX A').toUpperCase().trim();
            const d2 = String(item.distractor2 || 'CHOIX B').toUpperCase().trim();

            pool.push([
              globalId++,
              w1,
              w2,
              ans,
              item.clue || "Point commun sémantique",
              item.difficulty || (tier.id * 2),
              item.type || "nom",
              d1,
              d2
            ]);
          }
          console.log(` -> Reçu +${enigmas.length} énigmes de l'IA`);
        }
      } catch (err) {
        console.warn(`Avertissement :`, err.message);
      }

      await sleep(2000);
    }

    const raw = JSON.stringify(pool);
    const gz = zlib.gzipSync(Buffer.from(raw));
    const destPath = path.join('vault_packs', `${tier.name}.json.gz`);
    fs.writeFileSync(destPath, gz);
    console.log(`[Succès] ${tier.name}.json.gz sauvegardé (${pool.length} énigmes).`);
  }
}

run().catch((err) => {
  console.error("Erreur critique :", err);
  process.exit(1);
});
