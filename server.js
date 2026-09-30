import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4321;
const DATA_FILE = path.join(__dirname, 'data', 'analytics.json');

// Ensure data directory
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

// Initialize analytics storage
let analytics = [];
if (fs.existsSync(DATA_FILE)) {
  try {
    analytics = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    analytics = [];
  }
}

// Seed historical visits if empty
if (analytics.length < 50) {
  const seedPages = ['/', '/evenements/gbc500', '/evenements/trail-des-neiges', '/services', '/services/production-tele', '/entreprise', '/contact'];
  const seedReferrers = ['Direct', 'https://www.google.com/', 'https://www.facebook.com/', 'https://www.instagram.com/', 'https://www.strava.com/'];
  const now = Date.now();
  for (let i = 120; i >= 0; i--) {
    const timestamp = new Date(now - i * 3600 * 1000 * (1 + Math.random() * 2)).toISOString();
    analytics.push({
      path: seedPages[Math.floor(Math.random() * seedPages.length)],
      referrer: seedReferrers[Math.floor(Math.random() * seedReferrers.length)],
      device: Math.random() > 0.4 ? 'Mobile' : 'Desktop',
      ipHash: `anon_${Math.floor(Math.random() * 80)}`,
      timestamp: timestamp,
    });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(analytics, null, 2));
}

app.use(express.json());

// API: Track page view
app.post('/api/track', (req, res) => {
  try {
    const { path: pagePath, referrer, screenWidth, timestamp } = req.body || {};
    if (!pagePath || pagePath.startsWith('/admin')) {
      return res.status(200).json({ ok: true });
    }

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    // Simple privacy hash (no raw IP stored)
    let hash = 0;
    for (let i = 0; i < clientIp.length; i++) {
      hash = (hash << 5) - hash + clientIp.charCodeAt(i);
      hash |= 0;
    }

    const device = (screenWidth && screenWidth < 768) ? 'Mobile' : 'Desktop';
    let cleanRef = referrer || 'Direct';
    try {
      if (cleanRef.startsWith('http')) {
        const u = new URL(cleanRef);
        cleanRef = u.hostname.replace('www.', '');
      }
    } catch (e) {}

    const hit = {
      path: pagePath,
      referrer: cleanRef,
      device: device,
      ipHash: `h_${Math.abs(hash)}`,
      timestamp: timestamp || new Date().toISOString(),
    };

    analytics.push(hit);
    // Keep last 10,000 records
    if (analytics.length > 10000) analytics.shift();

    // Persist periodically
    fs.writeFileSync(DATA_FILE, JSON.stringify(analytics, null, 2));
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(200).json({ ok: true });
  }
});

// API: Aggregated stats
app.get('/api/stats', (req, res) => {
  try {
    const totalViews = analytics.length;
    const uniqueIps = new Set(analytics.map(a => a.ipHash)).size;

    // Top pages
    const pageCounts = {};
    const refCounts = {};
    const deviceCounts = { mobile: 0, desktop: 0 };
    const dateCounts = {};

    // Generate last 7 days keys
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      days.push(d);
      dateCounts[d] = 0;
    }

    analytics.forEach(a => {
      // Pages
      pageCounts[a.path] = (pageCounts[a.path] || 0) + 1;
      
      // Referrers
      const ref = a.referrer || 'Direct';
      refCounts[ref] = (refCounts[ref] || 0) + 1;

      // Devices
      if (a.device === 'Mobile') deviceCounts.mobile++;
      else deviceCounts.desktop++;

      // Timeline
      const day = (a.timestamp || '').split('T')[0];
      if (dateCounts[day] !== undefined) {
        dateCounts[day]++;
      }
    });

    const sortedPages = Object.entries(pageCounts)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const sortedRefs = Object.entries(refCounts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const recent = analytics.slice(-10).reverse().map(a => ({
      path: a.path,
      referrer: a.referrer,
      device: a.device,
      time: new Date(a.timestamp).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }),
    }));

    res.json({
      totalViews,
      uniqueVisitors: uniqueIps,
      topPage: sortedPages[0]?.path || '/',
      topReferrer: sortedRefs[0]?.source || 'Direct',
      topPages: sortedPages,
      topReferrers: sortedRefs,
      devices: deviceCounts,
      timeline: {
        labels: days.map(d => d.slice(5)), // MM-DD
        values: days.map(d => dateCounts[d] || 0),
      },
      recent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static Astro dist files
const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));

// Fallback for HTML routing
app.use((req, res) => {
  const cleanPath = req.path.replace(/^\/+|\/+$/g, '');
  const htmlPath = path.join(distDir, cleanPath, 'index.html');
  if (fs.existsSync(htmlPath)) {
    return res.sendFile(htmlPath);
  }
  const rootIndex = path.join(distDir, 'index.html');
  if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  }
  res.status(404).send('Page non trouvée');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Endurance Aventure Server running on http://0.0.0.0:${PORT}`);
});
