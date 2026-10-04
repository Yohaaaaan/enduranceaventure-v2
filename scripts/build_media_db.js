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
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_media_type ON media_assets(media_type);
  CREATE INDEX IF NOT EXISTS idx_event_category ON media_assets(event_category);
  CREATE INDEX IF NOT EXISTS idx_format ON media_assets(format);
  CREATE INDEX IF NOT EXISTS idx_is_used ON media_assets(is_used);
`);

const files = fs.readdirSync(ASSETS_DIR);
console.log(`Processing ${files.length} assets...`);

const insertStmt = db.prepare(`
  INSERT INTO media_assets (
    filename, file_path, media_type, event_category, format, size_bytes, width, height, aspect_ratio, is_used, used_in, created_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
    used_in=excluded.used_in
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
