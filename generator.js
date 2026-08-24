const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("ERREUR : GEMINI_API_KEY est absente des Secrets GitHub !");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);

const BATCHES = 3;

const TIERS = [
  { id: 1, name: 'tier1_facile', diff: 'Niveau Debutant (Niv 1-10) : Objets simples du quotidien, nature evidente, animaux, actions familieres.' },
  { id: 2, name: 'tier2_moyen', diff: 'Niveau Intermediaire (Niv 11-30) : Metiers, sciences, sports, geographie, cuisine, culture.' },
  { id: 3, name: 'tier3_difficile', diff: 'Niveau Avance (Niv 31-60) : Concepts abstraits, physique, histoire, processus complexes.' },
  { id: 4, name: 'tier4_expert', diff: 'Niveau Expert / Maitre (Niv 61-100+) : Litterature, mythologie, vocabulaire noble, alchimie, philosophie.' }
];

const THEMES = [
  "Sciences & Espace", "Nature & Animaux", "Histoire & Civilisations",
  "Cuisine & Terroir", "Arts & Musique", "Sports & Aventure",
  "Objets & Outils", "Sensations & Emotions"
];

// Détection automatique du meilleur modèle actif sur votre clé API
async function detectBestModel() {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
    const data = await res.json();
    if (data.models && Array.isArray(data.models)) {
      const supported = data.models
        .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace('models/', ''));
      
      console.log("Modeles supportes par votre cle API :", supported);
      const preferences = [
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro',
        'gemini-1.5-flash-8b',
        'gemini-pro',
        'gemini-2.0-flash'
      ];

      for (const pref of preferences) {
        if (supported.includes(pref)) return pref;
      }
      return supported[0] || 'gemini-pro';
    }
  } catch (e) {
    console.warn("Detection auto impossible :", e.message);
  }
  return 'gemini-pro';
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const chosenModelName = await detectBestModel();
  console.log(`\n>>> Modele selectionne : ${chosenModelName} <<<\n`);

  const model = genAI.getGenerativeModel({
    model: chosenModelName,
    generationConfig: {
      temperature: 0.85
    }
  });

  fs.mkdirSync('vault_packs', { recursive: true });
  let globalId = 1;

  for (const tier of TIERS) {
    console.log(`\n=== Generation IA pour ${tier.name} ===`);
    const pool = [];
    const seenCombos = new Set();

    for (let b = 0; b < BATCHES; b++) {
      const theme = THEMES[b % THEMES.length];
      console.log(`[Palier ${tier.id}] Lot ${b + 1}/${BATCHES} (${theme})...`);

      const prompt = `Tu es le concepteur en chef du jeu "2Mots".
Reponds UNIQUEMENT par un tableau JSON brut sans balises markdown contenant 20 enigmes semantiques 100% FRANCAISES, HAUTEMENT LOGIQUES et INGENIEUSES.

Difficulte requise : ${tier.diff}
Thematique : ${theme}

REGLES ABSOLUES :
1. LE LIEN SEMANTIQUE DOIT ETRE EVIDENT OU ASTUCIEUX : word1 + word2 menent indiscutablement a answer (ex: SOLEIL + PLUIE -> ARC-EN-CIEL, VOLANT + PLUME -> BADMINTON, VOLCAN + LAVE -> EXPLOSER).
2. NATURE GRAMMATICALE IDENTIQUE : answer, distractor1 et distractor2 DOIVENT avoir STRICTEMENT la meme nature (3 verbes a l infinitif, 3 noms, ou 3 adjectifs).
3. INDICE CONTEXTUEL : L indice "clue" decrit la passerelle avec precision et elegance sans reveler le mot.

Format JSON attendu :
[
  {
    "word1": "VOLANT",
    "word2": "PLUME",
    "answer": "BADMINTON",
    "clue": "Sport de raquette rapide et aerien",
    "difficulty": ${tier.id === 1 ? 1 : tier.id === 2 ? 4 : tier.id === 3 ? 7 : 9},
    "type": "nom",
    "distractor1": "TENNIS",
    "distractor2": "SQUASH"
  }
]`;

      try {
        const result = await model.generateContent(prompt);
        let text = result.response.text();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const enigmas = JSON.parse(text);

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
              item.clue || "Point commun semantique",
              item.difficulty || (tier.id * 2),
              item.type || "nom",
              d1,
              d2
            ]);
          }
          console.log(` -> Reçu +${enigmas.length} énigmes de l'IA (Total palier: ${pool.length})`);
        }
      } catch (err) {
        console.error(`Erreur lot ${b + 1} :`, err.message);
      }

      await sleep(1500);
    }

    if (pool.length === 0) {
      throw new Error(`Aucune enigme generee pour ${tier.name}`);
    }

    const raw = JSON.stringify(pool);
    const gz = zlib.gzipSync(Buffer.from(raw));
    const destPath = path.join('vault_packs', `${tier.name}.json.gz`);
    fs.writeFileSync(destPath, gz);
    console.log(`[Succes] ${tier.name}.json.gz sauvegarde (${pool.length} enigmes, ${(gz.length / 1024).toFixed(1)} Ko).`);
  }
}

run().catch((err) => {
  console.error("Erreur critique :", err);
  process.exit(1);
});
