import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'public', 'assets');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_FILE = path.join(DATA_DIR, 'media.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

// Fast binary image dimensions reader
function getImageSize(buffer) {
  if (!buffer || buffer.length < 30) return null;
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
  }
  // WEBP
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height, format: 'webp' };
    } else if (chunk === 'VP8L') {
      const b0 = buffer[21], b1 = buffer[22], b2 = buffer[23], b3 = buffer[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height, format: 'webp' };
    } else if (chunk === 'VP8X') {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height, format: 'webp' };
    }
  }
  // JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xFF) break;
      const marker = buffer[offset + 1];
      if (marker === 0xC0 || marker === 0xC2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height, format: 'jpeg' };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }
  return null;
}

// Determine media type
function classifyMediaType(filename, ext, width, height) {
  const lower = filename.toLowerCase();
  if (ext === 'pdf') return 'document_pdf';
  if (ext === 'ttf' || ext === 'woff' || ext === 'woff2') return 'font';
  
  if (lower.includes('bastien-michau') || lower.includes('daniel-poirier') || lower.includes('jean-thomas-boily') || lower.includes('marc-plante') || lower.includes('profil-alex') || lower.includes('profil-pat')) {
    return 'team_portrait';
  }
  
  if (lower.includes('argon') || lower.includes('xact') || lower.includes('naak') || lower.includes('leki') || lower.includes('karpos') || lower.includes('vaude') || lower.includes('blizzard') || lower.includes('orford_logo') || lower.includes('logocoast') || lower.includes('clinique-sante') || lower.includes('skimoeast')) {
    return 'partner_sponsor';
  }

  if (lower.startsWith('logo') || lower.includes('-logo') || lower.includes('_logo') || lower.includes('logo-') || lower.includes('logo_')) {
    return 'logo';
  }

  if (lower.includes('banner') || lower.includes('banniere') || lower.includes('header') || lower.includes('titre') || lower.includes('pub-') || lower.includes('publicit')) {
    return 'banner_graphic';
  }

  if (['webp', 'jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
    return 'photo';
  }

  return 'other';
}

// Determine event association
function classifyEvent(filename) {
  const lower = filename.toLowerCase();
  
  if (lower.includes('gbc') || lower.includes('gravelbike') || lower.includes('gravel-bike') || lower.includes('bikepacking')) {
    return 'gbc500';
  }
  if (lower.includes('canadaman') || lower.includes('caxtri') || lower.includes('xtri') || lower.includes('triathlon-extreme') || lower.includes('5158') || lower.includes('2851')) {
    return 'canadaman_xtri';
  }
  if (lower.includes('rig-') || lower.includes('rig_') || lower.includes('gaspesie') || lower.includes('matapedia') || lower.includes('carleton')) {
    return 'raid_gaspesie';
  }
  if (lower.includes('temis') || lower.includes('témis') || lower.includes('opemican') || lower.includes('arws')) {
    return 'raid_temiscamingue';
  }
  if (lower.includes('tdn') || lower.includes('trail-des-neiges') || lower.includes('trail-de-neiges') || lower.includes('skimo')) {
    return 'trail_des_neiges';
  }
  if (lower.includes('velo-cafe') || lower.includes('vélo-café') || lower.includes('vcjpg')) {
    return 'velo_cafe';
  }
  if (lower.includes('endurance') || lower.includes('services') || lower.includes('production') || lower.includes('orford')) {
    return 'corporate_general';
  }

  return 'unassigned';
}

// Cache file contents to speed up search
const fileContents = [];
const searchDirs = [
  path.join(ROOT_DIR, 'src', 'data'),
  path.join(ROOT_DIR, 'src', 'pages'),
  path.join(ROOT_DIR, 'src', 'components')
];

function loadSearchFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      loadSearchFiles(full);
    } else if (ent.isFile() && (ent.name.endsWith('.json') || ent.name.endsWith('.astro') || ent.name.endsWith('.js') || ent.name.endsWith('.ts'))) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        fileContents.push({ path: path.relative(ROOT_DIR, full), content });
      } catch (_) {}
    }
  }
}

searchDirs.forEach(loadSearchFiles);

function findUsages(filename) {
  const usages = [];
  for (const item of fileContents) {
    if (item.content.includes(filename)) {
      usages.push(item.path);
    }
  }
  return usages;
}

// Main execution
console.log('Initializing Media Database in:', DB_FILE);
const db = new DatabaseSync(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS media_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT UNIQUE NOT NULL,
    file_path TEXT NOT NULL,
    media_type TEXT NOT NULL,
    event_category TEXT NOT NULL,
    format TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    aspect_ratio TEXT,
    is_used INTEGER NOT NULL DEFAULT 0,
    used_in TEXT,
    description TEXT,
    alt_text TEXT,
    tags TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_media_type ON media_assets(media_type);
  CREATE INDEX IF NOT EXISTS idx_event_category ON media_assets(event_category);
  CREATE INDEX IF NOT EXISTS idx_format ON media_assets(format);
  CREATE INDEX IF NOT EXISTS idx_is_used ON media_assets(is_used);
`);

const files = fs.readdirSync(ASSETS_DIR);
console.log(`Processing ${files.length} assets...`);

function generateVisualDescription(f, mediaType, eventCategory) {
  const name = f.toLowerCase();
  if (name.includes("daniel-poirier")) {
    return {
      description: "Portrait de Daniel Poirier, cofondateur d'Endurance Aventure et réalisateur de documentaires sportifs télévisés.",
      alt: "Portrait officiel de Daniel Poirier - Cofondateur et directeur de production",
      tags: ["daniel-poirier", "equipe", "fondateur", "portrait", "realisateur"]
    };
  }
  if (name.includes("jean-thomas-boily")) {
    return {
      description: "Portrait de Jean-Thomas Boily, cofondateur d'Endurance Aventure, paralympien et responsable des opérations logistiques terrain.",
      alt: "Portrait officiel de Jean-Thomas Boily - Cofondateur et logistique terrain",
      tags: ["jean-thomas-boily", "equipe", "fondateur", "portrait", "logistique"]
    };
  }
  if (name.includes("bastien-michau")) {
    return {
      description: "Portrait de Bastien Michau, associé, directeur de course, guide spéléo et concepteur officiel des parcours d'expédition.",
      alt: "Portrait officiel de Bastien Michau - Directeur de course et associé",
      tags: ["bastien-michau", "equipe", "directeur-course", "portrait", "associe"]
    };
  }
  if (name.includes("marc-plante")) {
    return {
      description: "Portrait de Marc Plante, associé et producteur exécutif chargé de la distribution internationale.",
      alt: "Portrait de Marc Plante - Producteur exécutif et associé",
      tags: ["marc-plante", "equipe", "producteur", "portrait", "associe"]
    };
  }
  if (name.includes("patricia-desgagne")) {
    return {
      description: "Portrait de Patricia Desgagné, chargée des relations médias et de l'accueil des délégations internationales.",
      alt: "Portrait de Patricia Desgagné - Relations médias et délégations",
      tags: ["patricia-desgagne", "equipe", "medias", "portrait"]
    };
  }
  if (name.includes("canadaman-2017-sommet-mont-megantic-ligne-arrivee")) {
    return {
      description: "Arche d'arrivée spectaculaire au sommet du Mont-Mégantic lors de l'épreuve extrême Canada Man / Canada Woman XTRI, vue panoramique sur les massifs québécois.",
      alt: "Arrivée grandiose au sommet du Mont-Mégantic - Triathlon Canada Man / Canada Woman XTRI",
      tags: ["canadaman", "xtri", "mont-megantic", "arrivee", "sommet", "triathlon", "paysage"]
    };
  }
  if (name.includes("jmmsony-september-13-2014_dsc1007") || name.includes("jmmsony-september-13-2014_dsc1025")) {
    return {
      description: "Cadreurs et photographes de l'équipe Endurance Aventure en pleine action sur le terrain avec caméras professionnelles pour captation télévisuelle et documentaire.",
      alt: "Cadreurs et photographes d'Endurance Aventure en action sur le terrain",
      tags: ["production-tele", "cameraman", "cadreur", "photographe", "tournage", "action"]
    };
  }
  if (name.includes("canadaman-xtri-copyright-quebec-dones")) {
    return {
      description: "Survol aérien cinématographique 4K par drone lors de l'épreuve Canada Man XTRI au-dessus des lacs et forêts québécoises.",
      alt: "Survol par drone cinématographique 4K en pleine nature - Canada Man XTRI",
      tags: ["drone", "production-tele", "aerien", "canadaman", "foret", "lac", "4k"]
    };
  }
  if (name.includes("gbc500") || name.includes("gravelbike") || name.includes("gravel-bike")) {
    return {
      description: "Épreuve de vélo de gravelle et bikepacking GBC500 à travers les chemins forestiers et routes de terre sauvages des Cantons-de-l'Est.",
      alt: "Cyclistes sur les routes de gravelle sauvages du GBC 500 dans les Cantons-de-l'Est",
      tags: ["gbc500", "gravel", "velo", "bikepacking", "cantons-de-lest", "autonomie"]
    };
  }
  if (name.includes("temiscamingue") || name.includes("arws") || name.includes("raid-international-gaspesie")) {
    return {
      description: "Épreuve d'expédition et raid multisport (canoë, VTT, trek d'orientation, franchissement de rivières et cordes) en milieu sauvage isolé.",
      alt: "Épreuve de raid aventure multisport en nature sauvage canadienne",
      tags: ["raid-aventure", "arws", "temiscamingue", "gaspesie", "multisport", "orientation", "expedition"]
    };
  }
  if (name.includes("canadaman") || name.includes("triathlon")) {
    return {
      description: "Triathlon extrême Canada Man / Canada Woman XTRI : nage en eau libre au lever du soleil, vélo sur routes vallonnées et course de sentier vers le sommet.",
      alt: "Triathlon extrême Canada Man / Woman XTRI au Lac-Mégantic",
      tags: ["triathlon", "canadaman", "xtri", "nage", "velo", "trail", "lac-megantic"]
    };
  }
  if (name.includes("trail-des-neiges") || name.includes("tdn") || name.includes("skimo")) {
    return {
      description: "Épreuve hivernale Trail des Neiges et ski alpinisme en conditions nordiques québécoises, neige damée et sous-bois féeriques.",
      alt: "Coureurs en plein effort sur les sentiers enneigés du Trail des Neiges",
      tags: ["trail-des-neiges", "hiver", "neige", "course-a-pied", "skimo", "nordique"]
    };
  }
  if (mediaType === "logo") {
    return {
      description: `Logo officiel et identité visuelle liée à ${f.replace(/[-_]/g, " ")}.`,
      alt: `Logo officiel ${f.replace(/[-_]/g, " ")}`,
      tags: ["logo", "branding", "vecteur"]
    };
  }
  return {
    description: `Archive visuelle d'expédition et événementiel de terrain (${eventCategory || "multisport"}).`,
    alt: `Endurance Aventure - ${eventCategory || "Événement de plein air"}`,
    tags: [eventCategory || "multisport", mediaType || "photo"]
  };
}

const insertStmt = db.prepare(`
  INSERT INTO media_assets (
    filename, file_path, media_type, event_category, format, size_bytes, width, height, aspect_ratio, is_used, used_in, description, alt_text, tags, created_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
  ON CONFLICT(filename) DO UPDATE SET
    media_type=excluded.media_type,
    event_category=excluded.event_category,
    format=excluded.format,
    size_bytes=excluded.size_bytes,
    width=excluded.width,
    height=excluded.height,
    aspect_ratio=excluded.aspect_ratio,
    is_used=excluded.is_used,
    used_in=excluded.used_in,
    description=COALESCE(excluded.description, media_assets.description),
    alt_text=COALESCE(excluded.alt_text, media_assets.alt_text),
    tags=COALESCE(excluded.tags, media_assets.tags)
`);

let count = 0;
const now = new Date().toISOString();

for (const f of files) {
  const filePath = path.join(ASSETS_DIR, f);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) continue;

  const ext = f.split('.').pop().toLowerCase();
  let dimensions = null;

  try {
    const buf = fs.readFileSync(filePath);
    dimensions = getImageSize(buf);
  } catch (_) {}

  const width = dimensions ? dimensions.width : null;
  const height = dimensions ? dimensions.height : null;
  let aspectRatio = null;
  if (width && height) {
    if (width > height * 1.1) aspectRatio = 'landscape';
    else if (height > width * 1.1) aspectRatio = 'portrait';
    else aspectRatio = 'square';
  }

  const mediaType = classifyMediaType(f, ext, width, height);
  const eventCategory = classifyEvent(f);
  const usages = findUsages(f);
  const isUsed = usages.length > 0 ? 1 : 0;
  const visualMeta = generateVisualDescription(f, mediaType, eventCategory);

  insertStmt.run(
    f,
    `/assets/${f}`,
    mediaType,
    eventCategory,
    ext,
    stat.size,
    width,
    height,
    aspectRatio,
    isUsed,
    JSON.stringify(usages),
    visualMeta.description,
    visualMeta.alt,
    JSON.stringify(visualMeta.tags),
    now
  );
  count++;
}

console.log(`Successfully indexed ${count} media assets into media.db!`);

// Print Breakdown
const typeStats = db.prepare('SELECT media_type, count(*) as count FROM media_assets GROUP BY media_type ORDER BY count DESC').all();
const eventStats = db.prepare('SELECT event_category, count(*) as count FROM media_assets GROUP BY event_category ORDER BY count DESC').all();
const usedStats = db.prepare('SELECT is_used, count(*) as count FROM media_assets GROUP BY is_used').all();

console.log('\n--- Breakdown by Media Type ---');
console.table(typeStats);

console.log('\n--- Breakdown by Event Category ---');
console.table(eventStats);

console.log('\n--- Breakdown by Usage (1 = In Use, 0 = In Stock) ---');
console.table(usedStats);
