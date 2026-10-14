import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// 1. LIGHTWEIGHT ZERO-DEPENDENCY .ENV LOADER
// ==========================================
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  try {
    const envContent = fs.readFileSync(ENV_FILE, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        if (!process.env[k]) {
          process.env[k] = v;
        }
      }
    }
  } catch (e) {
    console.warn('[Security] Could not load .env file:', e.message);
  }
}

const app = express();

// Disable Express fingerprint to prevent technological reconnaissance
app.disable('x-powered-by');

const PORT = process.env.PORT || 4321;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'analytics.db');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');

// Ensure data directory exists with restricted permissions (0700)
try {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
} catch (e) {}

// ==========================================
// 2. CRYPTOGRAPHIC SECRETS & AUTH SYSTEM
// ==========================================
const SECRETS_FILE = path.join(DATA_DIR, '.auth_secrets.json');
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
let SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  let savedSecrets = {};
  if (fs.existsSync(SECRETS_FILE)) {
    try {
      savedSecrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
    } catch (e) {}
  }
  if (!ADMIN_PASSWORD) {
    ADMIN_PASSWORD = savedSecrets.ADMIN_PASSWORD || 'EA2026_Securite!Expert98';
  }
  if (!SESSION_SECRET) {
    SESSION_SECRET = savedSecrets.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  }
  try {
    fs.writeFileSync(
      SECRETS_FILE,
      JSON.stringify({ ADMIN_PASSWORD, SESSION_SECRET }, null, 2),
      { mode: 0o600 }
    );
  } catch (e) {}
}

// Cryptographic session token generation & verification (HMAC-SHA256 with 24h validity)
function createSessionToken() {
  const timestamp = Date.now();
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(String(timestamp)).digest('hex');
  return `${timestamp}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [timestampStr, providedSig] = parts;
  const timestamp = Number(timestampStr);
  if (isNaN(timestamp)) return false;

  const age = Date.now() - timestamp;
  // Valid for 24 hours (86,400,000 ms), reject if in future (>10s clock drift)
  if (age < -10000 || age > 86400000) return false;

  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(String(timestamp)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(providedSig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch (e) {
    return false;
  }
}

// Timing-safe password verification
function verifyAdminPassword(inputPass) {
  if (!inputPass || typeof inputPass !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(inputPass.trim()).digest();
  const hashB = crypto.createHash('sha256').update(ADMIN_PASSWORD.trim()).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// ==========================================
// 3. IN-MEMORY RATE LIMITERS (ANTI-BRUTE-FORCE & ANTI-SPAM)
// ==========================================
const authAttempts = new Map(); // ip -> { count: number, blockedUntil: number }
const contactAttempts = new Map(); // ip -> Array of timestamps

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff && typeof xff === 'string') {
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// Periodic cleanup every 10 minutes to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of authAttempts.entries()) {
    if (data.blockedUntil < now && data.count === 0) authAttempts.delete(ip);
  }
  for (const [ip, timestamps] of contactAttempts.entries()) {
    const recent = timestamps.filter(t => now - t < 3600000);
    if (recent.length === 0) contactAttempts.delete(ip);
    else contactAttempts.set(ip, recent);
  }
}, 600000);

// ==========================================
// 4. SQLITE DATABASE INITIALIZATION
// ==========================================
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

// Restrict request body size to 50kb to prevent DoS / memory exhaustion
app.use(express.json({ limit: '50kb' }));
app.use(express.text({ limit: '50kb', type: ['text/plain', 'text/*'] }));

// ==========================================
// 5. API ROUTES & SECURITY CONTROLS
// ==========================================

// API: Verify Admin Password with Brute-Force Rate Limiting
app.post('/api/auth', async (req, res) => {
  const clientIp = getClientIp(req);
  const now = Date.now();
  const attemptData = authAttempts.get(clientIp) || { count: 0, blockedUntil: 0 };

  if (attemptData.blockedUntil > now) {
    const remainingSec = Math.ceil((attemptData.blockedUntil - now) / 1000);
    return res.status(429).json({ 
      success: false, 
      error: `Trop de tentatives erronées. Accès temporairement bloqué pendant encore ${remainingSec}s.` 
    });
  }

  const { password } = req.body || {};
  const isCorrect = verifyAdminPassword(password);

  if (isCorrect) {
    authAttempts.delete(clientIp);
    const token = createSessionToken();
    return res.json({ success: true, token });
  }

  // Failed attempt: increment counter
  attemptData.count += 1;
  // Block for 15 minutes after 5 consecutive failures
  if (attemptData.count >= 5) {
    attemptData.blockedUntil = now + 15 * 60 * 1000;
  }
  authAttempts.set(clientIp, attemptData);

  // Intentional delay to kill timing and rapid enumeration attacks
  await new Promise(r => setTimeout(r, 600));

  return res.status(401).json({ 
    success: false, 
    error: attemptData.count >= 5 
      ? 'Trop de tentatives erronées. Accès temporairement suspendu pour 15 minutes.' 
      : 'Mot de passe incorrect.' 
  });
});

// Middleware to protect admin routes
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const queryAuth = req.query.token || req.query.auth;
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : (queryAuth ? String(queryAuth).trim() : '');

  if (verifySessionToken(token)) {
    return next();
  }
  return res.status(401).json({ error: 'Accès non autorisé. Session invalide ou expirée.' });
}

// API: Track page view (Real privacy-first analytics)
app.post('/api/track', (req, res) => {
  try {
    let payload = req.body;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch(e) {}
    }
    const { path: pagePath, referrer, screenWidth, timestamp } = payload || {};
    if (!pagePath || pagePath.startsWith('/admin') || pagePath.startsWith('/api') || pagePath.startsWith('/_')) {
      return res.status(200).json({ ok: true, ignored: 'admin_or_system' });
    }

    // Filter out bots, search crawlers, and automated scripts
    const ua = req.headers['user-agent'] || '';
    if (/bot|crawler|spider|slurp|curl|wget|python|postman|node-fetch|axios|headless/i.test(ua)) {
      return res.status(200).json({ ok: true, ignored: 'bot' });
    }

    // IP hashing for GDPR compliance (anonymized hash)
    const clientIp = getClientIp(req);
    
    // Ignore internal loopback traffic
    if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost') {
      return res.status(200).json({ ok: true, ignored: 'loopback' });
    }

    const ipHash = 'h_' + crypto.createHash('sha256').update(clientIp + 'ea_salt_2026').digest('hex').slice(0, 12);

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

    // Deduplicate rapid reloads / F5 refreshes (30-min reading window per institutional GA4 standard)
    const thirtyMinAgoIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const recentView = db.prepare(
      'SELECT id FROM page_views WHERE ip_hash = ? AND path = ? AND timestamp >= ? LIMIT 1'
    ).get(ipHash, pagePath, thirtyMinAgoIso);

    if (recentView) {
      return res.status(200).json({ ok: true, deduplicated: true });
    }

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
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'bmichau@enduranceaventure.com';
const PENDING_LEADS_FILE = path.join(DATA_DIR, 'pending_email_leads.json');
const GMAIL_SENDER_SCRIPT = '/home/opc/.agents/skills/gmail-sender/scripts/send_email.py';

function fallbackSendmail(subject, body) {
  try {
    const mailProcess = spawn('/usr/sbin/sendmail', ['-t', '-i']);
    mailProcess.stdin.write(`To: ${NOTIFICATION_EMAIL}\nFrom: web@enduranceaventure.com\nSubject: ${subject}\nContent-Type: text/plain; charset=UTF-8\n\n${body}\n`);
    mailProcess.stdin.end();
    mailProcess.on('error', (err) => {
      console.warn('[Mail Warning] Sendmail non disponible:', err.message);
    });
    mailProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`[Mail Sendmail] Courriel expédié via sendmail système à ${NOTIFICATION_EMAIL}`);
      }
    });
  } catch (err) {
    console.warn('[Mail Warning] Erreur fallback sendmail:', err.message);
  }
}

function sendLeadEmail(lead) {
  // Ensure subject and email contain NO newline characters (CRLF Injection defense)
  const safeSubject = String(`[Demande Site Web] ${lead.subject || lead.service || 'Nouveau contact'} - ${lead.name}`)
    .replace(/[\r\n]/g, ' ')
    .trim();
  const safeReplyTo = String(lead.email).replace(/[\r\n]/g, '').trim();
  const dateStr = new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' });
  const body = [
    `Nouvelle demande reçue depuis le site web Endurance Aventure :`,
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

  // Archiver dans pending_email_leads.json en secours permanent (chmod 0600)
  try {
    let pending = [];
    if (fs.existsSync(PENDING_LEADS_FILE)) {
      pending = JSON.parse(fs.readFileSync(PENDING_LEADS_FILE, 'utf8'));
    }
    pending.unshift({
      timestamp: new Date().toISOString(),
      to: NOTIFICATION_EMAIL,
      subject: safeSubject,
      lead
    });
    fs.writeFileSync(PENDING_LEADS_FILE, JSON.stringify(pending.slice(0, 50), null, 2), { mode: 0o600 });
  } catch (e) {
    console.warn('[Lead Backup Warning]', e.message);
  }

  // Envoi prioritaire par passerelle SMTP authentifiée
  if (fs.existsSync(GMAIL_SENDER_SCRIPT)) {
    try {
      const py = spawn('python3', [
        GMAIL_SENDER_SCRIPT,
        '--to', NOTIFICATION_EMAIL,
        '--subject', safeSubject,
        '--body', body,
        '--reply-to', safeReplyTo
      ]);
      py.stdout.on('data', (d) => console.log(`[Mail Success] ${d.toString().trim()}`));
      py.stderr.on('data', (d) => console.warn(`[Mail Warning] ${d.toString().trim()}`));
      py.on('close', (code) => {
        if (code !== 0) {
          console.warn('[Mail Warning] Échec passerelle SMTP, tentative sendmail fallback...');
          fallbackSendmail(safeSubject, body);
        }
      });
    } catch (err) {
      console.warn('[Mail Warning] Exception passerelle SMTP:', err.message);
      fallbackSendmail(safeSubject, body);
    }
  } else {
    fallbackSendmail(safeSubject, body);
  }
}

// API: Submit Contact / B2B Quote with Anti-Spam & Strict Sanitization
app.post('/api/contact', (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const now = Date.now();

    // 1. Anti-bot Honeypot check (hidden field)
    const {
      website_url,
      _gotcha,
      homepage
    } = req.body || {};

    if (website_url || _gotcha || homepage) {
      // Deceive bot into thinking it succeeded, drop silently
      console.log(`[Anti-Spam] Bot submission dropped silently from IP ${clientIp}`);
      return res.json({ success: true, id: 'lead_verified' });
    }

    // 2. IP Rate Limiting: Max 5 submissions per hour per IP
    const timestamps = (contactAttempts.get(clientIp) || []).filter(t => now - t < 3600000);
    if (timestamps.length >= 5) {
      return res.status(429).json({
        success: false,
        error: 'Limite de messages atteinte pour cette heure. Veuillez nous contacter par téléphone si urgent.'
      });
    }

    let {
      type = 'general',
      name = '',
      email = '',
      phone = '',
      organization = '',
      orgType = '',
      service = '',
      participants = '',
      period = '',
      budget = '',
      subject = '',
      message = '',
    } = req.body || {};

    // 3. Strict Input Sanitization & CRLF Injection Prevention
    const sanitizeSingleLine = (val, maxLen) => {
      return String(val || '')
        .replace(/[\r\n\t]/g, ' ')
        .trim()
        .slice(0, maxLen);
    };

    name = sanitizeSingleLine(name, 100);
    email = sanitizeSingleLine(email, 120);
    phone = sanitizeSingleLine(phone, 35);
    organization = sanitizeSingleLine(organization, 120);
    orgType = sanitizeSingleLine(orgType, 60);
    service = sanitizeSingleLine(service, 120);
    subject = sanitizeSingleLine(subject, 150);
    participants = sanitizeSingleLine(participants, 50);
    period = sanitizeSingleLine(period, 50);
    budget = sanitizeSingleLine(budget, 50);
    type = sanitizeSingleLine(type, 20);

    // Message can contain newlines, but bounded to 5,000 chars
    message = String(message || '').trim().slice(0, 5000);

    // 4. Required fields & Email regex validation
    if (!name || !email || !message) {
      return res.status(400).json({ success: false, error: 'Nom, courriel et message sont obligatoires.' });
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Format d\'adresse courriel invalide.' });
    }

    if (message.length < 5) {
      return res.status(400).json({ success: false, error: 'Le message est trop court.' });
    }

    // Record submission timestamp for rate limiting
    timestamps.push(now);
    contactAttempts.set(clientIp, timestamps);

    const id = 'lead_' + Date.now();
    const createdAt = new Date().toISOString();
    const finalSubject = subject || service || 'Demande générale';

    stmtInsertContact.run(
      id, type, name, email, phone, organization, orgType,
      service || subject || '', String(participants), period, String(budget),
      finalSubject, message, createdAt, 'Nouveau'
    );

    // Sync to contacts.json with mode 0600
    try {
      const allContacts = db.prepare('SELECT * FROM contacts ORDER BY created_at DESC').all();
      fs.writeFileSync(CONTACTS_FILE, JSON.stringify(allContacts, null, 2), { mode: 0o600 });
    } catch(e) {}

    // Dispatch email notification
    sendLeadEmail({ type, name, email, phone, organization, orgType, service, subject: finalSubject, message });

    console.log(`[Contact] Nouvelle demande légitime de ${name} (${email}) - ${type}`);
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

// ==========================================
// 6. STATIC FILE SERVING & PATH TRAVERSAL DEFENSE
// ==========================================
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

// Explicit boundary check to prevent path traversal attacks
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const cleanPath = req.path.replace(/^\/+|\/+$/g, '');
  if (!cleanPath) return next();

  const resolvedHtmlPath = path.resolve(distDir, cleanPath, 'index.html');
  if (!resolvedHtmlPath.startsWith(distDir)) {
    return res.status(403).send('Forbidden');
  }

  if (fs.existsSync(resolvedHtmlPath)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.sendFile(resolvedHtmlPath);
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

// Fallback for 404
app.use((req, res) => {
  const rootIndex = path.join(distDir, 'index.html');
  if (fs.existsSync(rootIndex)) {
    return res.status(404).sendFile(rootIndex);
  }
  res.status(404).send('Page non trouvée');
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Endurance Aventure Server (Hardened) running on http://127.0.0.1:${PORT}`);
});
