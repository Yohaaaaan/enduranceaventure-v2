# Endurance Aventure v2 — Project Guide & Agent Instructions

Modern, high-performance, and secure web application rebuilding Endurance Aventure (`enduranceaventure.com`). Built with Astro, Tailwind CSS, Express, and Chart.js analytics.

## Project Overview

- **Mission**: Fully modernize and secure the legacy WordPress site that suffered from malware infections, while strictly preserving 100% of the brand identity, visual style, colors, typography, and assets.
- **Brand Colors**:
  - Primary Red: `#DB2E3C` (Action & Adventure accents)
  - Dark Charcoal: `#171720` (Immersive deep background)
  - Action Cyan: `#0099C5` (Water, outdoor trails & Secondary CTA)
  - Muted Slate: `#8A8D9F`
- **Typography**:
  - Headings: `Montserrat`, `Impact`, sans-serif
  - Body: `Source Sans 3`, `Inter`, sans-serif
- **Tech Stack**:
  - Framework: [Astro v5](https://astro.build/) (Static Site Generation + Server API integration)
  - Styling: [Tailwind CSS v3](https://tailwindcss.com/)
  - Analytics Backend: Express with privacy-first SQLite/JSON tracking (Plausible / Umami style)
  - Charts: [Chart.js](https://www.chartjs.org/)
  - Process Management: PM2 (`endurance-site`)

---

## Directory Structure

```text
/
├── public/
│   ├── assets/                 # 500+ optimized WebP photos, logos, graphics
│   ├── robots.txt              # Search engine directives
│   ├── ai.txt                  # Machine-readable context manifest for AI agents
│   └── llms.txt                # Industry standard LLM directory and navigation guide
├── src/
│   ├── components/             # Reusable UI elements (Header, Footer, Navigation)
│   ├── data/                   # Structured data (events.json, services.json, news.json)
│   ├── layouts/
│   │   └── Layout.astro        # Base layout with Schema.org JSON-LD & tracking script
│   └── pages/
│       ├── index.astro         # Immersive Homepage
│       ├── evenements/         # Sports events (GBC 500, Trail des Neiges, Raids)
│       ├── services/           # Corporate & Media services (TV production, drones)
│       ├── entreprise.astro    # Company history & Founder (Daniel Poirier)
│       ├── nouvelles/          # 26 news articles & archives
│       ├── contact.astro       # Interactive contact form
│       └── admin/              # Open-source privacy analytics dashboard
├── astro.config.mjs            # Astro configuration with sitemap & 301 redirects
├── tailwind.config.mjs         # Tailwind theme extension & brand tokens
├── server.js                   # Node Express server for static files & analytics API
├── package.json
├── AGENTS.md                   # Agent & Contributor instructions (always in sync with CLAUDE.md)
└── CLAUDE.md                   # Mirror of AGENTS.md
```

---

## Core Features & Remediation

1. **Zero Malware Attack Surface**:
   - Eliminated old PHP/WordPress plugins and vulnerable open endpoints.
   - Built with pre-rendered HTML and secure static file delivery.

2. **SEO & 301 Redirects**:
   - Preserves Google indexing by redirecting all legacy WordPress `/non-classifiee/*` and test pages (`/gbc500_temp`, `/rit-temp`, `/gravelbike`) to canonical modern URLs.
   - Dynamic XML Sitemap generated at `/sitemap-index.xml`.
   - Rich Snippets: `Schema.org/SportsEvent`, `SportsActivityLocation`, and `BlogPosting` JSON-LD.

3. **Performance & Media Optimization**:
   - 521 original photos converted to WebP with responsive fallback.
   - 328MB legacy raw video moved to cold storage archive.

4. **Privacy-First Analytics Dashboard (`/admin`)**:
   - Real-time visitor tracking (Pageviews, unique visitors, referrers, devices).
   - Zero third-party cookies (GDPR & privacy compliant).
   - Interactive Chart.js timeline and live visit stream.

---

## Development & Deployment Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build static production bundle
npm run build

# Start production server (Node Express + Analytics API)
npm start

# PM2 service management
pm2 status endurance-site
pm2 restart endurance-site
pm2 logs endurance-site
```

---

## Rules for Agents & Contributors

- **Aesthetic Integrity**: Never change the signature Red (`#DB2E3C`) and Cyan (`#0099C5`) palette or core typography without explicit user request.
- **Git Discipline**:
  - Always stage files by explicit name (NEVER `git add -A` / `git add .`).
  - Never commit `.env`, secrets, or large binary files (>10MB).
  - Write all commit messages and repository documentation in **English**.
  - Keep `AGENTS.md` and `CLAUDE.md` 100% identical at all times.
- **Server Safety**: Always use PM2 for running backend processes. Never use `nohup` or background `&`.
