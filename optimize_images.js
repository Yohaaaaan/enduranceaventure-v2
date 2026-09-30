import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ASSETS_DIR = '/mnt/data/enduranceaventure-v2/public/assets';

async function optimizeImages() {
  console.log('🖼️ Starting image optimization with sharp...');
  
  // 1. Isolate the heavy video out of public/
  const heavyVideo = path.join(ASSETS_DIR, 'CAXTRI-2019-web-English-SD.mp4');
  if (fs.existsSync(heavyVideo)) {
    const archiveDir = '/mnt/data/site-replicator/output/enduranceaventure.com/assets/videos';
    fs.mkdirSync(archiveDir, { recursive: true });
    console.log(`📦 Moving 328MB video out of static public root to archive...`);
    fs.renameSync(heavyVideo, path.join(archiveDir, 'CAXTRI-2019-web-English-SD.mp4'));
  }

  // 2. Scan all JPG/PNG
  const files = fs.readdirSync(ASSETS_DIR);
  let converted = 0;
  let savedBytes = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) continue;

    const inputPath = path.join(ASSETS_DIR, file);
    const baseName = path.basename(file, ext);
    const outputPath = path.join(ASSETS_DIR, `${baseName}.webp`);

    try {
      const originalStat = fs.statSync(inputPath);
      // Skip if already small and webp exists
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) continue;

      // Convert to WebP with quality 82 and max width 1920
      await sharp(inputPath)
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toFile(outputPath);

      const newStat = fs.statSync(outputPath);
      converted++;
      savedBytes += (originalStat.size - newStat.size);

      if (converted % 25 === 0) {
        console.log(`  ↳ Converted ${converted} images to WebP...`);
      }
    } catch (err) {
      // Ignore corrupted or unsupported images
    }
  }

  console.log(`✨ Optimization complete:`);
  console.log(`   - Images converted to WebP: ${converted}`);
  console.log(`   - Bandwidth saved: ${(savedBytes / (1024 * 1024)).toFixed(2)} MB`);
}

optimizeImages().catch(console.error);
