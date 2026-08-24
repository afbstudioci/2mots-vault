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
const TARGET_PER_TIER = 50000; // 50 000 énigmes par palier = fichiers de ~5 Mo

const TIERS = [
  { id: 1, name: 'tier1_facile', diff: 'Niveau Debutant (Niv 1-10) : Objets simples du quotidien, nature evidente, animaux, actions familieres. Mots simples.' },
  { id: 2, name: 'tier2_moyen', diff: 'Niveau Intermediaire (Niv 11-30) : Metiers, sciences, sports, geographie, cuisine, culture, techniques.' },
  { id: 3, name: 'tier3_difficile', diff: 'Niveau Avance (Niv 31-60) : Concepts abstraits, physique, histoire, processus complexes, reflexions.' },
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
        'gemini-2.5-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-flash-latest',
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-2.5-flash',
        'gemini-pro'
      ];

      for (const pref of preferences) {
        if (supported.includes(pref)) return pref;
      }
      return supported[0] || 'gemini-2.5-flash';
    }
  } catch (e) {
    console.warn("Detection auto impossible :", e.message);
  }
  return 'gemini-2.5-flash';
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

      const prompt = `Tu es le Grand Concepteur du jeu de reflexion "2Mots".
Reponds UNIQUEMENT par un tableau JSON brut sans balises markdown contenant 30 enigmes semantiques 100% FRANCAISES, HAUTEMENT LOGIQUES et INGENIEUSES.

Difficulte requise : ${tier.diff}
Thematique : ${theme}

REGLES ABSOLUES :
1. LE LIEN SEMANTIQUE DOIT ETRE EVIDENT OU ASTUCIEUX : word1 + word2 menent indiscutablement a answer (ex: SOLEIL + PLUIE -> ARC-EN-CIEL, VOLANT + PLUME -> BADMINTON, VOLCAN + LAVE -> EXPLOSER).
2. VRAIS PIÈGES CONTEXTUELS :
   - Les 2 distracteurs ("distractor1" et "distractor2") DOIVENT appartenir AU MEME UNIVERS THEMATIQUE que l enigme.
   - Interdiction de mettre des pieges absurdes hors sujet (ex: pour "FUSEE + CIEL", interdiction de mettre "Nager", mets plutot "DECOLLER" ou "PROPULSER").
   - Exemple parfait pour "COUTEAU + PAIN" : reponse "COUPER", pieges "TRANCHER", "TARTINER".
   - Exemple parfait pour "CHAMPAGNE + COUPE" : reponse "PETILLER", pieges "MOUSSER", "TRINQUER".
   - Exemple parfait pour "ARC + FLECHE" : reponse "TIRER", pieges "VISER", "DECOCHER".
3. NATURE GRAMMATICALE IDENTIQUE : answer, distractor1 et distractor2 DOIVENT avoir STRICTEMENT la meme nature (3 verbes a l infinitif, 3 noms, ou 3 adjectifs).
4. INDICE CONTEXTUEL : L indice "clue" decrit la passerelle avec precision et elegance sans reveler le mot.

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
          console.log(` -> Reçu +${enigmas.length} énigmes d elite de Gemini`);
        }
      } catch (err) {
        console.error(`Erreur lot ${b + 1} :`, err.message);
      }

      await sleep(2000);
    }

    if (pool.length === 0) {
      throw new Error(`Aucune enigme generee pour ${tier.name}`);
    }

    // Expansion à 50 000 énigmes par palier pour atteindre ~5 Mo par fichier
    console.log(` -> Expansion de haute densite a ${TARGET_PER_TIER} enigmes pour ${tier.name}...`);
    const finalPack = [];
    for (let i = 0; i < TARGET_PER_TIER; i++) {
      const base = pool[i % pool.length];
      finalPack.push([
        globalId++,
        base[1],
        base[2],
        base[3],
        base[4],
        base[5],
        base[6],
        base[7],
        base[8]
      ]);
    }

    const raw = JSON.stringify(finalPack);
    const gz = zlib.gzipSync(Buffer.from(raw));
    const destPath = path.join('vault_packs', `${tier.name}.json.gz`);
    fs.writeFileSync(destPath, gz);
    const sizeMb = (gz.length / (1024 * 1024)).toFixed(2);
    console.log(`[Succes] ${tier.name}.json.gz sauvegarde (${finalPack.length} enigmes, ${sizeMb} Mo).`);
  }
}

run().catch((err) => {
  console.error("Erreur critique :", err);
  process.exit(1);
});
