import type { PlannerConfig } from './types'

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  THE BOOTH PLAN CONFIG — edit this file to retune the planner.      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Nothing here is code: it's data. Add/remove questions, stores, and items;
 * change products, prices, and the quantity formulas. The engine (engine.ts)
 * reads it; no other file needs to change.
 *
 * Prep window (days) and active hazards live in `src/config.ts`
 * (PREP_DAYS / DEFAULT_HAZARDS) so they can also be overridden per event via
 * env vars — see .env.example.
 *
 * FORMULA CHEAT SHEET (see types.ts → Formula for the full math):
 *   raw   = base + Σ per[k]×count(k) + Σ perPerDay[k]×count(k)×days
 *   packs = ceil(raw / packSize), clamped to [min, max]
 *   k = a question id ("adults") or an aggregate ("people").
 *   • "2 gallons per adult per day", 5-gal case → perPerDay:{adults:2}, packSize:5
 *   • "5 lbs rice per person",        5-lb bag  → per:{people:5},      packSize:5
 *   • "one per 4 people, min 1"                  → per:{people:0.25},   min:1
 *   • "always exactly one"                       → base:1
 */
export const planConfig: PlannerConfig = {
  // Derived totals usable in formulas/conditions as if they were questions.
  aggregates: {
    people: ['adults', 'children', 'infants'],
  },

  categoryLabels: {
    water: 'Water',
    food: 'Food',
    medical: 'Medical & First Aid',
    tools: 'Tools & Gear',
    sanitation: 'Sanitation',
    shelter: 'Shelter-in-Place',
    baby: 'Baby',
    pets: 'Pets',
    documents: 'Documents',
  },
  categoryOrder: [
    'water',
    'food',
    'medical',
    'tools',
    'sanitation',
    'shelter',
    'baby',
    'pets',
    'documents',
  ],

  // ── The questionnaire (rendered on the phone, in this order) ────────
  questions: [
    { id: 'adults', type: 'counter', label: 'Adults', default: 2, min: 1 },
    { id: 'children', type: 'counter', label: 'Children', hint: 'Ages 2–12', default: 0 },
    {
      id: 'infants',
      type: 'counter',
      label: 'Infants',
      hint: 'Under 2 — adds diapers & formula',
      default: 0,
    },
    { id: 'pets', type: 'counter', label: 'Pets', hint: 'Adds pet food & water', default: 0 },
    {
      id: 'medicalNeeds',
      type: 'toggle',
      label: 'Anyone with medical needs?',
      hint: 'Prescriptions or medical supplies',
      default: false,
    },
  ],

  // ── Stores (shopping-list order) ────────────────────────────────────
  stores: [
    { id: 'costco', label: 'Costco', color: 'blue' },
    { id: 'lowes', label: "Lowe's", color: 'amber' },
    { id: 'target', label: 'Target', color: 'rose' },
    { id: 'pharmacy', label: 'Pharmacy', color: 'teal' },
    { id: 'petstore', label: 'Pet Store', color: 'violet' },
  ],

  // ── Items (prices/products illustrative — confirm before relying) ───
  items: [
    // Water
    {
      id: 'water-case',
      name: 'Drinking water',
      category: 'water',
      store: 'costco',
      product: 'Kirkland 40-pack 16.9oz bottled water (~5 gal/case)',
      rationale:
        'One gallon per person per day covers drinking, cooking, and basic hygiene. After a disaster the tap can run dry or unsafe, and water is the very first thing you run out of.',
      unitPrice: 4.99,
      unit: 'case',
      // 1 gallon per person per day; ~5 gallons per case.
      formula: { perPerDay: { people: 1 }, packSize: 5 },
    },

    // Food
    {
      id: 'rice',
      name: 'Rice',
      category: 'food',
      store: 'costco',
      product: 'Jasmine/long-grain rice, 5 lb bag',
      rationale:
        'A cheap, calorie-dense staple that stores for years and stretches every meal. When fresh food spoils without power, shelf-stable carbs keep everyone fed.',
      unitPrice: 8.49,
      unit: 'bag',
      // ~0.4 lb/person/day staple; 5-lb bag. (For "5 lbs per person" use per:{people:5}.)
      formula: { perPerDay: { people: 0.4 }, packSize: 5 },
    },
    {
      id: 'canned-protein',
      name: 'Canned protein (beans/tuna/chicken)',
      category: 'food',
      store: 'costco',
      product: 'Variety pack canned beans & tuna',
      rationale:
        'Protein keeps energy and morale up, and canned means no cooking and no refrigeration — just open and eat when the power is out.',
      unitPrice: 12.99,
      unit: 'pack (8 cans)',
      formula: { perPerDay: { people: 1 }, packSize: 8 }, // ~1 can/person/day
    },
    {
      id: 'shelf-meals',
      name: 'Ready-to-eat meals & snacks',
      category: 'food',
      store: 'target',
      product: 'Granola/protein bars + peanut butter',
      rationale:
        'Grab-and-go calories for the first chaotic hours — and familiar snacks are a real comfort for kids when nothing else feels normal.',
      unitPrice: 14.99,
      unit: 'box',
      formula: { perPerDay: { people: 1 }, packSize: 10 },
    },

    // Tools & gear
    {
      id: 'flashlight',
      name: 'Flashlights',
      category: 'tools',
      store: 'lowes',
      product: 'LED flashlight (2-pack)',
      rationale:
        'Power usually fails first. A flashlight for each person beats sharing one in the dark — and unlike candles, it won’t ignite a gas leak.',
      unitPrice: 16.98,
      unit: 'pack',
      formula: { per: { people: 0.2 }, min: 1 }, // 1, +1 around 5+ people
    },
    {
      id: 'batteries',
      name: 'Batteries',
      category: 'tools',
      store: 'costco',
      product: 'Kirkland AA/AAA variety pack',
      rationale:
        'Your flashlights and radio are dead weight without spares. One variety pack keeps the rest of the kit running.',
      unitPrice: 17.99,
      unit: 'pack',
      formula: { base: 1 },
    },
    {
      id: 'radio',
      name: 'Hand-crank / battery radio',
      category: 'tools',
      store: 'lowes',
      product: 'NOAA weather radio with USB charging',
      rationale:
        'When cell networks and power go down, a hand-crank NOAA radio is how you’ll still hear evacuation orders and weather alerts.',
      unitPrice: 29.99,
      unit: 'each',
      formula: { base: 1 },
    },
    {
      id: 'shovel',
      name: 'Utility shovel',
      category: 'tools',
      store: 'lowes',
      product: 'Folding/compact utility shovel',
      rationale:
        'Dig out after an earthquake or clear heavy snow to reach a blocked exit, a buried vehicle, or a gas shutoff.',
      unitPrice: 24.98,
      unit: 'each',
      formula: { base: 1 },
      condition: { whenHazardsAny: ['earthquake', 'winter'] },
    },
    {
      id: 'tarp',
      name: 'Heavy-duty tarp & duct tape',
      category: 'tools',
      store: 'lowes',
      product: 'Tarp + duct tape (shelter/repairs)',
      rationale:
        'Covers a blown-out window or damaged roof to keep wind and rain out until proper repairs are possible — days you might otherwise spend exposed.',
      unitPrice: 19.97,
      unit: 'set',
      formula: { base: 1 },
      condition: { whenHazardsAny: ['hurricane', 'flood'] },
    },

    // Medical
    {
      id: 'first-aid',
      name: 'First-aid kit',
      category: 'medical',
      store: 'target',
      product: 'Comprehensive first-aid kit (100+ pieces)',
      rationale:
        'Most disaster injuries are minor cuts, burns, and sprains. Treating them early prevents infection when clinics are closed or overwhelmed.',
      unitPrice: 24.99,
      unit: 'kit',
      formula: { per: { people: 0.2 }, min: 1 },
    },
    {
      id: 'meds',
      name: 'Prescription & OTC medications',
      category: 'medical',
      store: 'pharmacy',
      product: '7-day pill organizer + OTC pain/allergy meds',
      rationale:
        'Pharmacies can close for days after a disaster. A short backup of regular prescriptions and basic OTC meds bridges the gap until they reopen.',
      unitPrice: 21.0,
      unit: 'set',
      note: 'Ask your pharmacist about an emergency refill of regular prescriptions.',
      // Everyone gets one OTC set; medical-needs households get a backup set.
      formula: { base: 1, per: { medicalNeeds: 1 } },
    },

    // Sanitation
    {
      id: 'hygiene',
      name: 'Hygiene & sanitation',
      category: 'sanitation',
      store: 'costco',
      product: 'Toilet paper, wet wipes, hand sanitizer bundle',
      rationale:
        'When water service is disrupted, clean hands and basic sanitation are what stop illness from spreading through a crowded household.',
      unitPrice: 28.99,
      unit: 'bundle',
      formula: { per: { people: 0.25 }, min: 1 }, // ~1 per 4 people
    },
    {
      id: 'garbage-bags',
      name: 'Heavy-duty garbage bags',
      category: 'sanitation',
      store: 'target',
      product: 'Contractor-grade trash bags',
      rationale:
        'One of the most versatile items in a kit — waste containment, an emergency toilet liner, a rain poncho, or a way to keep gear dry.',
      unitPrice: 12.99,
      unit: 'box',
      formula: { base: 1 },
    },

    // Shelter-in-place (radiological / hazmat / national emergency)
    {
      id: 'n95',
      name: 'N95 respirator masks',
      category: 'shelter',
      store: 'lowes',
      product: 'N95 respirator masks (20-pack)',
      unitPrice: 19.99,
      unit: 'pack',
      rationale:
        'Filters smoke, dust, and airborne particles so you can keep breathing safely during a wildfire or after a building collapse.',
      formula: { base: 1, per: { people: 0.1 } },
      condition: { whenHazardsAny: ['shelter', 'wildfire'] },
    },
    {
      id: 'plastic-sheeting',
      name: 'Plastic sheeting & duct tape',
      category: 'shelter',
      store: 'lowes',
      product: 'Plastic sheeting roll + duct tape (seal a room)',
      unitPrice: 24.99,
      unit: 'set',
      rationale:
        'Seals a room’s windows, doors, and vents to keep contaminated outside air out during a shelter-in-place order.',
      formula: { base: 1 },
      condition: { whenHazardsAny: ['shelter'] },
    },

    // Baby (only if infants)
    {
      id: 'diapers',
      name: 'Diapers',
      category: 'baby',
      store: 'target',
      product: 'Diapers mega-box',
      rationale:
        'An infant goes through dozens of diapers a week. Running out mid-emergency, with stores closed, is the last thing a parent needs.',
      unitPrice: 39.99,
      unit: 'box',
      formula: { perPerDay: { infants: 1 }, packSize: 7 }, // ~1 box / infant / week
      condition: { whenPositive: ['infants'] },
    },
    {
      id: 'formula',
      name: 'Infant formula & wipes',
      category: 'baby',
      store: 'target',
      product: 'Formula tubs + baby wipes',
      rationale:
        'A hungry baby can’t wait for stores to reopen. Keep enough formula and wipes on hand to cover the full prep window.',
      unitPrice: 34.99,
      unit: 'set',
      formula: { per: { infants: 1 } },
      condition: { whenPositive: ['infants'] },
    },

    // Pets (only if pets)
    {
      id: 'pet-food',
      name: 'Pet food & water',
      category: 'pets',
      store: 'petstore',
      product: 'Dry pet food bag + collapsible bowls',
      rationale:
        'Emergency shelters and stores often have nothing for animals. Your pets depend entirely on the food and water you packed for them.',
      unitPrice: 26.99,
      unit: 'bag',
      formula: { perPerDay: { pets: 1 }, packSize: 7 },
      condition: { whenPositive: ['pets'] },
    },

    // Documents (everyone)
    {
      id: 'docs',
      name: 'Documents & cash pouch',
      category: 'documents',
      store: 'target',
      product: 'Waterproof document pouch',
      rationale:
        'If you have to evacuate fast, copies of IDs and insurance speed up aid and claims later — and cash still works when card readers are down.',
      unitPrice: 14.99,
      unit: 'each',
      note: 'Copies of IDs, insurance, prescriptions, and small bills in cash.',
      formula: { base: 1 },
    },
  ],
}
