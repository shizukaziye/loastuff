// Registry + methodology configuration for the LOA tier lists.
// Raid/gate/boss/difficulty data mirrors lostark.bible's own registry (see README:
// "When a new patch drops"). Combat-Power chart data only exists for raids that were
// still accepting stats after the July 2025 patch — raids retired before then are
// marked cpData:false and render an explanation instead of an empty chart.
window.LOA_CONFIG = {
  // Cloudflare worker proxy (worker/ in this repo). lostark.bible sends no CORS
  // headers, so the browser cannot query it directly.
  workerUrl: 'https://loa-tierlist-stats.shizukaziye.workers.dev',

  defaultRoute: 'serca/g2/nightmare',

  // Combat-Power-era patches only (wildsoul/april 2025 have no CP data). Newest last.
  patches: [
    { api: 'july',  name: 'July 2025' },
    { api: 'nov',   name: 'November 2025' },
    { api: 'jan26', name: 'January 2026' },
    { api: 'mar26', name: 'March 2026' },
    { api: 'jun26', name: 'June 2026' },
  ],

  raids: [
    { slug: 'serca', name: 'Serca', category: 'Shadow Raid', cpData: true,
      difficulties: [
        { name: 'Normal', slug: 'normal', minIlvl: 1710 },
        { name: 'Hard', slug: 'hard', minIlvl: 1730 },
        { name: 'Nightmare', slug: 'nightmare', minIlvl: 1740 },
      ],
      gates: [
        { short: 'G1', slug: 'g1', boss: 'Witch of Agony, Serca' },
        { short: 'G2', slug: 'g2', boss: 'Corvus Tul Rak' },
      ] },
    { slug: 'kazeros', name: 'Kazeros', category: 'Kazeros Raid', cpData: true,
      difficulties: [
        { name: 'Normal', slug: 'normal', minIlvl: 1710 },
        { name: 'Hard', slug: 'hard', minIlvl: 1730 },
        { name: 'The First', slug: 'the-first', minIlvl: 1740 },
      ],
      gates: [
        { short: 'G1', slug: 'g1', boss: 'Abyss Lord Kazeros' },
        { short: 'G2', slug: 'g2', boss: 'Death Incarnate Kazeros' },
      ] },
    { slug: 'armoche', name: 'Armoche', category: 'Kazeros Raid', cpData: true,
      difficulties: [
        { name: 'Normal', slug: 'normal', minIlvl: 1700 },
        { name: 'Hard', slug: 'hard', minIlvl: 1720 },
      ],
      gates: [
        { short: 'G1', slug: 'g1', boss: 'Brelshaza, Ember in the Ashes' },
        { short: 'G2', slug: 'g2', boss: 'Armoche, Sentinel of the Abyss' },
      ] },
    { slug: 'horizon-cathedral', name: 'Horizon Cathedral', category: 'Abyssal Dungeon', cpData: true,
      difficulties: [
        { name: 'Level 1', slug: 'level-1', minIlvl: 1700 },
        { name: 'Level 2', slug: 'level-2', minIlvl: 1720 },
        { name: 'Level 3', slug: 'level-3', minIlvl: 1750 },
      ],
      gates: [
        { short: 'G1', slug: 'g1', boss: 'Archbishop Arcenos' },
        { short: 'G2', slug: 'g2', boss: 'Arcenos, Vanguard of Fanaticism' },
      ] },
    { slug: 'extreme-aegir', name: 'Extreme Aegir', category: 'Event Raid', cpData: true,
      difficulties: [
        { name: 'Extreme Normal', slug: 'extreme-normal', minIlvl: 1720 },
        { name: 'Extreme Hard', slug: 'extreme-hard', minIlvl: 1750 },
        { name: 'Extreme Nightmare', slug: 'extreme-nightmare', minIlvl: 1770 },
      ],
      gates: [
        { short: 'G2', slug: 'g2', boss: 'Aegir, the Oppressor' },
      ] },
    // ---- retired before Combat-Power-era stats collection: no chart data exists ----
    { slug: 'mordum', name: 'Mordum', category: 'Kazeros Raid', cpData: false, stopped: 'April 2026',
      difficulties: [
        { name: 'Normal', slug: 'normal', minIlvl: 1680 },
        { name: 'Hard', slug: 'hard', minIlvl: 1700 },
      ],
      gates: [
        { short: 'G1', slug: 'g1', boss: 'Infernas' },
        { short: 'G2', slug: 'g2', boss: 'Blossoming Fear, Naitreya' },
        { short: 'G3', slug: 'g3', boss: 'Mordum, the Abyssal Punisher' },
      ] },
    { slug: 'brelshaza', name: 'Brelshaza', category: 'Kazeros Raid', cpData: false, stopped: 'November 2025',
      difficulties: [
        { name: 'Normal', slug: 'normal', minIlvl: 1670 },
        { name: 'Hard', slug: 'hard', minIlvl: 1690 },
      ],
      gates: [
        { short: 'G1', slug: 'g1', boss: 'Narok the Butcher' },
        { short: 'G2', slug: 'g2', boss: 'Phantom Manifester Brelshaza' },
      ] },
    { slug: 'aegir', name: 'Aegir', category: 'Kazeros Raid', cpData: false, stopped: 'November 2025',
      difficulties: [
        { name: 'Normal', slug: 'normal', minIlvl: 1660 },
        { name: 'Hard', slug: 'hard', minIlvl: 1680 },
      ],
      gates: [
        { short: 'G1', slug: 'g1', boss: 'Akkan, Lord of Death' },
        { short: 'G2', slug: 'g2', boss: 'Aegir, the Oppressor' },
      ] },
    { slug: 'behemoth', name: 'Behemoth', category: 'Epic Raid', cpData: false, stopped: 'July 2025',
      difficulties: [ { name: 'Normal', slug: 'normal', minIlvl: 1640 } ],
      gates: [
        { short: 'G1', slug: 'g1', boss: 'Behemoth, the Storm Commander' },
        { short: 'G2', slug: 'g2', boss: 'Behemoth, Cruel Storm Slayer' },
      ] },
    { slug: 'extreme-thaemine', name: 'Extreme Thaemine', category: 'Event Raid', cpData: false, stopped: 'January 2026',
      difficulties: [
        { name: 'Extreme Normal', slug: 'extreme-normal', minIlvl: 1700 },
        { name: 'Extreme Hard', slug: 'extreme-hard', minIlvl: 1730 },
      ],
      gates: [ { short: 'G4', slug: 'g4', boss: 'Thaemine, Conqueror of Stars' } ] },
    { slug: 'tarkal', name: 'Tarkal', category: 'Assault Raid', cpData: false, stopped: 'November 2025',
      difficulties: [
        { name: 'Normal', slug: 'normal', minIlvl: 1680 },
        { name: 'Hard', slug: 'hard', minIlvl: 1720 },
      ],
      gates: [ { short: 'G1', slug: 'g1', boss: 'Flame of Darkness, Tarkal' } ] },
  ],

  // Some difficulties are logged under a different boss identity.
  bossRemap: {
    'Mordum, the Abyssal Punisher': { 'Hard': 'Flash of Punishment' },
    'Death Incarnate Kazeros': { 'Normal': 'Archdemon Kazeros' },
  },

  // Combos whose data lives on an older patch than the current one.
  patchOverride: {
    'kazeros|the-first': 'mar26',
  },

  // Methodology: each class ranked by its strongest engraving; tiers are % of #1.
  tiers: [
    { key: 'S', pct: 98, hue: '#E8CD8A', glow: true },
    { key: 'A', pct: 95, hue: '#E25C55' },
    { key: 'B', pct: 90, hue: '#E29A50' },
    { key: 'C', pct: 85, hue: '#D9C25F' },
    { key: 'D', pct: 80, hue: '#7DB56E' },
    { key: 'F', pct: 0,  hue: '#7290C7' },
  ],

  excludeClasses: ['Bard', 'Artist'],
  supportSpecs: ['Blessed Aura', 'Desperate Salvation', 'Full Bloom', 'Liberator', 'Princess'],
  // safety net: any spec whose value sits on the support-attribution scale
  supportOutlierFactor: 2.2,
  smallSample: 300,
  displayNames: { Guardianknight: 'Guardian Knight' },
};
