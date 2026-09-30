import fs from 'fs';
import path from 'path';

const RAW_DIR = '/mnt/data/site-replicator/output/enduranceaventure.com/raw_api';
const DATA_DIR = '/mnt/data/enduranceaventure-v2/src/data';

fs.mkdirSync(DATA_DIR, { recursive: true });

// 1. Process News Posts
const rawPosts = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'posts.json'), 'utf8'));
const cleanNews = rawPosts.map((p) => {
  // Extract first image in content if available
  const imgMatch = p.content.rendered.match(/<img[^>]+src="([^">]+)"/);
  let image = imgMatch ? imgMatch[1] : '/assets/EnduranceAventure.jpg';
  
  // Clean local path
  if (image.includes('wp-content/uploads/')) {
    const fname = path.basename(new URL(image).pathname);
    image = `/assets/${fname}`;
  }

  // Clean excerpt
  let excerpt = (p.excerpt?.rendered || p.content?.rendered || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) + '...';

  return {
    id: p.id,
    slug: p.slug,
    title: p.title.rendered.replace(/&#8211;/g, '–').replace(/&rsquo;/g, "'").replace(/&nbsp;/g, ' '),
    date: p.date.split('T')[0],
    excerpt: excerpt,
    content: p.content.rendered,
    image: image,
  };
});

fs.writeFileSync(path.join(DATA_DIR, 'news.json'), JSON.stringify(cleanNews, null, 2));
console.log(`✅ Processed ${cleanNews.length} news articles.`);

// 2. Structured Events
const events = [
  {
    id: 'gbc500',
    slug: 'gbc500',
    title: 'Gravel Bikepacking Challenge 500 (GBC 500)',
    subtitle: 'L\'ultime défi de vélo gravelle et bikepacking au Québec',
    category: 'Gravel Bike / Bikepacking',
    location: 'Cantons-de-l\'Est / Mont Mégantic, QC',
    dates: 'Édition 2026 : Août 2026',
    distance: '500 km / 250 km / 100 km',
    image: '/assets/2023-08-05_GBC500_mc_1498-scaled.jpg',
    logo: '/assets/logo-GBC500-ARGON18.png',
    featured: true,
    description: 'Une aventure épique d\'endurance en autonomie complète à travers les plus beaux chemins de terre, forêts et sommets du Québec.',
    highlights: ['500 km en autonomie ou avec soutien', 'Parcours GPS balisé', 'Ravitaillements & Campings de bivouac', 'Suivi en direct par puce GPS'],
    registrationLink: 'https://enduranceaventure.com/contactez-nous/',
    status: 'Inscriptions Ouvertes'
  },
  {
    id: 'trail-des-neiges',
    slug: 'trail-des-neiges',
    title: 'Trail des Neiges',
    subtitle: 'La grande classique hivernale en raquettes et crampons',
    category: 'Course Hivernale / Snow Trail',
    location: 'Mont-Orford, QC',
    dates: 'Février 2027',
    distance: '5 km / 10 km / 15 km Nocturne',
    image: '/assets/51581835318_775ae15a4e_k.jpg',
    featured: true,
    description: 'Affrontez le froid, la neige et les montées abruptes du Mont-Orford lors d\'une des épreuves hivernales les plus emblématiques.',
    highlights: ['Parcours illuminé en soirée', 'Ambiance festive avec feu de joie', 'Épreuve accessible à tous les niveaux'],
    registrationLink: 'https://enduranceaventure.com/contactez-nous/',
    status: 'Bientôt Disponible'
  },
  {
    id: 'raid-gaspesie',
    slug: 'raid-gaspesie',
    title: 'Raid International Gaspésie',
    subtitle: 'L\'aventure grandeur nature entre mer et montagnes',
    category: 'Raid Aventure Multisport',
    location: 'Péninsule Gaspésienne, QC',
    dates: 'Automne',
    distance: 'Multisport (Kayak, VTT, Trek, Corde)',
    image: '/assets/51582278409_86672a9a9f_k.jpg',
    featured: true,
    description: 'Une immersion totale de plusieurs jours par équipes dans les paysages sauvages et côtiers de la Gaspésie.',
    highlights: ['Orientation à la carte et boussole', 'Sections nautiques en mer', 'Équipes de 2 ou 4 athlètes'],
    registrationLink: 'https://enduranceaventure.com/contactez-nous/',
    status: 'Sur Sélection'
  },
  {
    id: 'raid-temiscamingue',
    slug: 'raid-temiscamingue',
    title: 'Raid Témiscamingue',
    subtitle: 'L\'expédition boréale au cœur de la forêt québécoise',
    category: 'Raid Aventure Multisport',
    location: 'Témiscamingue, QC',
    dates: 'Automne',
    distance: '3 jours d\'expédition',
    image: '/assets/raid-endurance-aventure-basse-cote-nord-2008.jpg',
    featured: false,
    description: 'Une épreuve légendaire de navigation et de dépassement de soi en milieu sauvage isolé.',
    highlights: ['Canoë en eaux vives', 'Sections de course d\'orientation', 'Bivouacs sauvages'],
    registrationLink: 'https://enduranceaventure.com/contactez-nous/',
    status: 'Archives & Édition future'
  }
];

fs.writeFileSync(path.join(DATA_DIR, 'events.json'), JSON.stringify(events, null, 2));
console.log(`✅ Saved ${events.length} structured events.`);

// 3. Corporate Services
const services = [
  {
    id: 'organisation-evenements',
    slug: 'organisation-evenements',
    title: 'Organisation d\'Événements Sportifs & Corporatifs',
    subtitle: 'Plus de 20 ans d\'expertise terrain pour vos défis sur-mesure',
    image: '/assets/organisation-evenements-sportifs-services-endurance-aventure.jpg',
    description: 'De la conception de parcours extrêmes à la gestion logistique et médicale complète, Endurance Aventure conçoit et réalise des événements outdoor inoubliables pour les marques, villes et entreprises.',
    features: [
      'Ingénierie et traçage de parcours (GPS, sécurité, autorisations)',
      'Logistique d\'accueil, ravitaillements et campings',
      'Chronométrage et gestion des classements en direct',
      'Sécurité civile, plans d\'urgence et premiers secours'
    ]
  },
  {
    id: 'production-tele',
    slug: 'production-tele',
    title: 'Production Télévisuelle & Audiovisuelle',
    subtitle: 'Captation extrême en environnements hostiles et sauvages',
    image: '/assets/production-tele-services-endurance-aventure-e1517973509712.jpg',
    description: 'Nos équipes de tournage tout-terrain (drones, cadreurs sportifs, télévisions nationales) capturent l\'intensité de vos épreuves sportives et documentaires d\'expédition.',
    features: [
      'Tournage outdoor en 4K / HDR et prises de vue par drone agréé',
      'Production d\'émissions télévisées et documentaires sportifs',
      'Clips promotionnels et capsules réseaux sociaux quotidiennes',
      'Post-production complète, montage dynamique et étalonnage'
    ]
  },
  {
    id: 'chronometrage-logistique',
    slug: 'chronometrage-logistique',
    title: 'Chronométrage Électronique & Suivi GPS Live',
    subtitle: 'Précision et suivi des athlètes en temps réel',
    image: '/assets/51586236989_64f608f4ba_k.jpg',
    description: 'Solutions de chronométrage par puces RFID et balises satellites de géolocalisation en direct pour la sécurité et le suivi des participants par leurs proches.',
    features: [
      'Puces RFID jetables ou réutilisables',
      'Suivi en temps réel sur carte interactive en ligne',
      'Affichage instantané des temps intermédiaires et podiums',
      'Alertes SOS et géosécurité pour les courses longue distance'
    ]
  }
];

fs.writeFileSync(path.join(DATA_DIR, 'services.json'), JSON.stringify(services, null, 2));
console.log(`✅ Saved ${services.length} structured corporate services.`);
