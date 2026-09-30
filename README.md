# Endurance Aventure v2

Modern, secure, and ultra-fast web platform for [Endurance Aventure](https://enduranceaventure.com) — legendary adventure races, gravel bikepacking (GBC 500), snow trail, multisport raids, and extreme television production in Quebec.

## Key Features

- **Brand-Authentic Aesthetic**: Exact reproduction of the signature Red (`#DB2E3C`), Cyan (`#0099C5`), and Charcoal (`#171720`) color palette with high-impact sports typography.
- **Ultra-Fast & Secure (Zero Malware Surface)**: Static Site Generation with Astro v5 and Tailwind CSS. No vulnerable PHP or open SQL databases.
- **Rich Media & WebP Optimization**: 500+ action photos optimized into WebP format with responsive image sizing.
- **Privacy-First Analytics (`/admin`)**: Self-contained, cookie-less open-source analytics dashboard inspired by Plausible & Umami with Chart.js.
- **Complete SEO Continuity**: Full 301 redirect map for legacy WordPress paths, Schema.org `SportsEvent` JSON-LD structured data, and auto-generated XML sitemap.

## Quick Start

```bash
# Clone the repository
git clone git@github.com:Yohaaaaan/enduranceaventure-v2.git
cd enduranceaventure-v2

# Install dependencies
npm install

# Start local dev server
npm run dev

# Build and start production server
npm run build
npm start
```

## Production & Monitoring

The production service is managed by PM2 on the server:

```bash
pm2 status endurance-site
pm2 restart endurance-site
pm2 logs endurance-site
```

## License

Private & Proprietary — Endurance Aventure Inc.
