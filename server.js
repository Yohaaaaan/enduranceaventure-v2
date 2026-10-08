import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4321;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'analytics.db');
const DATA_FILE = path.join(DATA_DIR, 'analytics.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const ADMIN_PASS = process.env.ADMIN_PASSWORD || '123456789';
const VALID_PASSWORDS = new Set([
  process.env.ADMIN_PASSWORD,
  '123456789',
  '123546789'
].filter(Boolean));
const AUTH_TOKEN = 'ea_secure_session_' + Buffer.from('123456789').toString('base64');

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

// Initialize SQLite database
const db = new DatabaseSync(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    referrer TEXT,
    device TEXT,
    ip_hash TEXT,
    timestamp TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_page_views_timestamp ON page_views(timestamp);
  CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    type TEXT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    organization TEXT,
    org_type TEXT,
    service TEXT,
    participants TEXT,
    period TEXT,
    budget TEXT,
    subject TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT DEFAULT 'Nouveau'
  );
`);

const stmtInsertView = db.prepare(
  'INSERT INTO page_views (path, referrer, device, ip_hash, timestamp) VALUES (?, ?, ?, ?, ?)'
);

const stmtInsertContact = db.prepare(`
  INSERT INTO contacts (id, type, name, email, phone, organization, org_type, service, participants, period, budget, subject, message, created_at, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Support both standard JSON and text/plain (used by navigator.sendBeacon)
app.use(express.json());
app.use(express.text({ type: ['text/plain', 'text/*'] }));

// API: Verify Admin Password
app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  const cleanPass = String(password || '').trim();
  if (cleanPass && VALID_PASSWORDS.has(cleanPass)) {
    return res.json({ success: true, token: AUTH_TOKEN });
  }
  return res.status(401).json({ success: false, error: 'Mot de passe incorrect' });
});

// Middleware to protect admin routes
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const queryAuth = req.query.token || req.query.auth;
  const token = authHeader ? authHeader.replace('Bearer ', '') : queryAuth;

  if (token === AUTH_TOKEN || VALID_PASSWORDS.has(token)) {
    return next();
  }
  return res.status(401).json({ error: 'Accès non autorisé. Authentification requise.' });
}

// API: Track page view (Real privacy-first analytics)
app.post('/api/track', (req, res) => {
  try {
    let payload = req.body;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch(e) {}
    }
    const { path: pagePath, referrer, screenWidth, timestamp } = payload || {};
    if (!pagePath || pagePath.startsWith('/admin') || pagePath.startsWith('/api')) {
      return res.status(200).json({ ok: true });
    }

    // IP hashing for GDPR compliance (anonymized hash)
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';
    const ipHash = 'h_' + crypto.createHash('sha256').update(clientIp + 'ea_salt_2026').digest('hex').slice(0, 12);

    const ua = req.headers['user-agent'] || '';
    let device = (screenWidth && screenWidth < 768) ? 'Mobile' : 'Desktop';
    if (!screenWidth && ua) {
      device = /mobile|android|iphone|ipad/i.test(ua) ? 'Mobile' : 'Desktop';
    }

    let cleanRef = referrer || 'Direct';
    try {
      if (cleanRef.startsWith('http')) {
        const u = new URL(cleanRef);
        cleanRef = u.hostname.replace(/^www\./, '');
      }
    } catch (e) {}

    const nowIso = timestamp || new Date().toISOString();
    stmtInsertView.run(pagePath, cleanRef, device, ipHash, nowIso);

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: true });
  }
});

// API: Real Aggregated Stats (Protected)
app.get('/api/stats', requireAdmin, (req, res) => {
  try {
    const range = req.query.range || '7d';
    let sinceIso = '';
    const now = new Date();

    if (range === 'today') {
      sinceIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    } else if (range === '7d') {
      sinceIso = new Date(now.getTime() - 7 * 86400000).toISOString();
    } else if (range === '30d') {
      sinceIso = new Date(now.getTime() - 30 * 86400000).toISOString();
    } else {
      sinceIso = '1970-01-01T00:00:00.000Z'; // all
    }

    // Total views and unique visitors
    const totalRow = db.prepare(
      'SELECT COUNT(*) as totalViews, COUNT(DISTINCT ip_hash) as uniqueVisitors FROM page_views WHERE timestamp >= ?'
    ).get(sinceIso);

    const totalViews = Number(totalRow?.totalViews || 0);
    const uniqueVisitors = Number(totalRow?.uniqueVisitors || 0);

    // Top pages
    const topPages = db.prepare(`
      SELECT path, COUNT(*) as count 
      FROM page_views 
      WHERE timestamp >= ? 
      GROUP BY path 
      ORDER BY count DESC 
      LIMIT 8
    `).all(sinceIso).map(r => ({ path: r.path, count: Number(r.count) }));

    // Top referrers
    const topReferrers = db.prepare(`
      SELECT referrer as source, COUNT(*) as count 
      FROM page_views 
      WHERE timestamp >= ? 
      GROUP BY referrer 
      ORDER BY count DESC 
      LIMIT 8
    `).all(sinceIso).map(r => ({ source: r.source, count: Number(r.count) }));

    // Devices breakdown
    const deviceRows = db.prepare(`
      SELECT device, COUNT(*) as count 
      FROM page_views 
      WHERE timestamp >= ? 
      GROUP BY device
    `).all(sinceIso);

    const devices = { mobile: 0, desktop: 0 };
    deviceRows.forEach(r => {
      if (r.device === 'Mobile') devices.mobile = Number(r.count);
      else devices.desktop = Number(r.count);
    });

    // Timeline calculation based on range
    let timelineLabels = [];
    let timelineValues = [];

    if (range === 'today') {
      // 24 hour buckets
      const hourCounts = {};
      for (let h = 0; h < 24; h++) {
        const label = String(h).padStart(2, '0') + 'h';
        timelineLabels.push(label);
        hourCounts[h] = 0;
      }
      const todayRows = db.prepare(`
        SELECT strftime('%H', timestamp) as hour, COUNT(*) as count 
        FROM page_views 
        WHERE timestamp >= ? 
        GROUP BY hour
      `).all(sinceIso);
      todayRows.forEach(r => {
        const h = parseInt(r.hour, 10);
        if (hourCounts[h] !== undefined) hourCounts[h] = Number(r.count);
      });
      timelineValues = timelineLabels.map((_, idx) => hourCounts[idx]);
    } else {
      // Day buckets
      const dayBuckets = {};
      const numDays = range === '30d' ? 30 : (range === 'all' ? 45 : 7);
      for (let i = numDays - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
        dayBuckets[d] = 0;
        timelineLabels.push(d.slice(5)); // 'MM-DD'
      }

      const dayRows = db.prepare(`
        SELECT strftime('%Y-%m-%d', timestamp) as day, COUNT(*) as count 
        FROM page_views 
        WHERE timestamp >= ? 
        GROUP BY day
      `).all(sinceIso);

      dayRows.forEach(r => {
        if (dayBuckets[r.day] !== undefined) {
          dayBuckets[r.day] = Number(r.count);
        }
      });

      timelineValues = Object.keys(dayBuckets).map(k => dayBuckets[k]);
    }

    // Recent 10 visits
    const recent = db.prepare(`
      SELECT path, referrer, device, timestamp 
      FROM page_views 
      ORDER BY id DESC 
      LIMIT 10
    `).all().map(r => {
      let timeStr = '';
      try {
        timeStr = new Date(r.timestamp).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        timeStr = r.timestamp;
      }
      return {
        path: r.path,
        referrer: r.referrer || 'Direct',
        device: r.device || 'Desktop',
        time: timeStr
      };
    });

    res.json({
      range,
      totalViews,
      uniqueVisitors,
      topPage: topPages[0]?.path || '-',
      topReferrer: topReferrers[0]?.source || '-',
      topPages,
      topReferrers,
      devices,
      timeline: {
        labels: timelineLabels,
        values: timelineValues
      },
      recent
    });
  } catch (err) {
    console.error('Error generating stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Notification email dispatcher
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'info@enduranceaventure.com';
const PENDING_LEADS_FILE = path.join(DATA_DIR, 'pending_email_leads.json');

function sendLeadEmail(lead) {
  const subject = `[Soumission Site Web] ${lead.subject || lead.service || 'Nouvelle demande'} - ${lead.name}`;
  const dateStr = new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' });
  const body = [
    `Nouvelle soumission reçue depuis le site web Endurance Aventure :`,
    ``,
    `Type: ${lead.type === 'b2b' ? 'Devis B2B & Municipalités' : 'Coureurs & Question générale'}`,
    `Nom: ${lead.name}`,
    `Courriel: ${lead.email}`,
    `Téléphone: ${lead.phone || 'Non renseigné'}`,
    lead.organization ? `Organisation: ${lead.organization}` : null,
    lead.orgType ? `Type d'entité: ${lead.orgType}` : null,
    lead.service ? `Prestation: ${lead.service}` : null,
    lead.subject ? `Sujet: ${lead.subject}` : null,
    `Date: ${dateStr}`,
    ``,
    `Message:`,
    `--------------------------------------------------`,
    lead.message,
    `--------------------------------------------------`
  ].filter(Boolean).join('\n');

  console.log(`[Lead Dispatch] Préparation envoi notification vers ${NOTIFICATION_EMAIL} pour ${lead.name}`);

  // Archiver dans pending_email_leads.json en secours infaillible
  try {
    let pending = [];
    if (fs.existsSync(PENDING_LEADS_FILE)) {
      pending = JSON.parse(fs.readFileSync(PENDING_LEADS_FILE, 'utf8'));
    }
    pending.unshift({
      timestamp: new Date().toISOString(),
      to: NOTIFICATION_EMAIL,
      subject,
      lead
    });
    fs.writeFileSync(PENDING_LEADS_FILE, JSON.stringify(pending.slice(0, 50), null, 2));
  } catch (e) {
    console.warn('[Lead Backup Warning]', e.message);
  }

  // Tenter sendmail système
  try {
    const mailProcess = spawn('/usr/sbin/sendmail', ['-t', '-i']);
    mailProcess.stdin.write(`To: ${NOTIFICATION_EMAIL}\nFrom: web@enduranceaventure.com\nSubject: ${subject}\nContent-Type: text/plain; charset=UTF-8\n\n${body}\n`);
    mailProcess.stdin.end();
    mailProcess.on('error', (err) => {
      console.warn('[Mail Warning] Sendmail non disponible:', err.message);
    });
    mailProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`[Mail Success] Courriel envoyé à ${NOTIFICATION_EMAIL}`);
      } else {
        console.warn(`[Mail Process] Code sortie sendmail: ${code}`);
      }
    });
  } catch (err) {
    console.warn('[Mail Warning] Erreur dispatch courriel:', err.message);
  }
}

// API: Submit Contact / B2B Quote
app.post('/api/contact', (req, res) => {
  try {
    const {
      type = 'general',
      name,
      email,
      phone = '',
      organization = '',
      orgType = '',
      service = '',
      participants = '',
      period = '',
      budget = '',
      subject = '',
      message,
    } = req.body || {};

    if (!name || !email || !message) {
      return res.status(400).json({ success: false, error: 'Nom, courriel et message sont obligatoires.' });
    }

    const id = 'lead_' + Date.now();
    const createdAt = new Date().toISOString();
    const finalSubject = subject || service || 'Demande générale';

    stmtInsertContact.run(
      id, type, name, email, phone, organization, orgType,
      service || subject || '', String(participants), period, String(budget),
      finalSubject, message, createdAt, 'Nouveau'
    );

    // Sync to contacts.json for easy inspection
    try {
      const allContacts = db.prepare('SELECT * FROM contacts ORDER BY created_at DESC').all();
      fs.writeFileSync(CONTACTS_FILE, JSON.stringify(allContacts, null, 2));
    } catch(e) {}

    // Dispatch email notification to info@enduranceaventure.com
    sendLeadEmail({ type, name, email, phone, organization, orgType, service, subject: finalSubject, message });

    console.log(`[Contact] Nouvelle demande reçue de ${name} (${email}) - ${type}`);
    res.json({ success: true, id });
  } catch (err) {
    console.error('[Contact Error]', err);
    res.status(500).json({ success: false, error: 'Erreur lors de l\'enregistrement de votre demande.' });
  }
});

// API: Get Leads (Admin only)
app.get('/api/contacts', requireAdmin, (req, res) => {
  try {
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY created_at DESC LIMIT 100').all();
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static Astro dist files with aggressive caching for static assets
const distDir = path.join(__dirname, 'dist');

// Redirect removed services cleanly
app.use((req, res, next) => {
  if (req.path === '/services' || req.path === '/services/' || req.path.startsWith('/services/chronometrage-logistique')) {
    return res.redirect(301, '/services/organisation-evenements/');
  }
  if (req.path.startsWith('/evenements/trail-des-neiges')) {
    return res.redirect(301, '/evenements/championnat-monde-junior-arws/');
  }
  next();
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const cleanPath = req.path.replace(/^\/+|\/+$/g, '');
  if (!cleanPath) return next();

  const htmlPath = path.join(distDir, cleanPath, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.sendFile(htmlPath);
  }
  next();
});

// Static assets caching (30 days for media/fonts)
app.use(express.static(distDir, {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.(webp|jpg|jpeg|png|svg|ico|pdf|woff2|woff)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  }
}));

// Fallback for 404 or SPA fallback
app.use((req, res) => {
  const rootIndex = path.join(distDir, 'index.html');
  if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  }
  res.status(404).send('Page non trouvée');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Endurance Aventure Server running on http://0.0.0.0:${PORT}`);
});
