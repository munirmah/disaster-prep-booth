import type { Slide } from './types'

/**
 * THE BOOTH SCRIPT.
 *
 * This ordered array is what plays on the screen, top to bottom, then loops.
 * Reorder, add, or remove entries here to re-program the display — no other
 * file needs to change for content edits.
 *
 * Durations are tuned for a passersby audience: long enough to read at a
 * glance from a few feet away, short enough that the loop stays lively.
 */
export const slides: Slide[] = [
  {
    id: 'intro',
    type: 'title',
    durationMs: 8000,
    title: 'Are You Ready?',
    subtitle: 'A few minutes today can protect your family tomorrow.',
  },

  // ── Prep checklists ────────────────────────────────────────────────
  {
    id: 'go-bag',
    type: 'checklist',
    kicker: 'Build Your Kit',
    icon: '🎒',
    durationMs: 14000,
    title: 'Emergency Go-Bag Essentials',
    items: [
      'Water — 1 gallon per person, per day (3-day supply)',
      'Non-perishable food for 3 days + manual can opener',
      'Flashlight, extra batteries, and a power bank',
      'First-aid kit and a 7-day supply of medications',
      'Copies of IDs, insurance, and emergency contacts',
      'Cash in small bills, whistle, and a phone charger',
    ],
  },
  {
    id: 'family-plan',
    type: 'checklist',
    kicker: 'Make a Plan',
    icon: '👪',
    durationMs: 14000,
    title: 'Your Family Emergency Plan',
    items: [
      'Pick two meeting spots: one nearby, one out of the neighborhood',
      'Choose an out-of-town contact everyone can call or text',
      'Know two ways out of every room and your building',
      'Plan for kids, elders, pets, and anyone with special needs',
      'Practice the plan together twice a year',
    ],
  },

  // ── Hazard guidance ────────────────────────────────────────────────
  
{
    id: 'winter-storm',
    type: 'hazard',
    kicker: 'Winter Storm',
    hazard: 'Winter Storm',
    icon: '❄️',
    durationMs: 13000,
    headline: 'Stay warm, stay put, stay powered.',
    steps: [
      'Keep flashlights, batteries, and a charged power bank ready for outages',
      'Stock extra blankets and warm layers — heat one room if power is out',
      'Never run a generator or grill indoors (carbon monoxide kills)',
      'Keep water and easy meals on hand; pipes and stores may freeze or close',
    ],
  },
  {
    id: 'fire',
    type: 'hazard',
    kicker: 'House Fire',
    hazard: 'Fire',
    icon: '🔥',
    durationMs: 13000,
    headline: 'Get out, stay out, and call for help.',
    steps: [
      'Get low under the smoke and move to your nearest exit',
      'Feel doors with the back of your hand — hot means find another way',
      'Once outside, go to your meeting spot and never go back in',
      'Call 911 from a safe place outside',
    ],
  },
  {
    id: 'flood',
    type: 'hazard',
    kicker: 'Flooding',
    hazard: 'Flood',
    icon: '🌊',
    durationMs: 13000,
    headline: 'Turn Around, Don’t Drown.',
    steps: [
      'Move to higher ground immediately — do not wait',
      'Never walk or drive through moving water',
      'Just 6 inches of water can knock you off your feet',
      'Stay tuned to local alerts and follow evacuation orders',
    ],
  },

  {
    id: 'shelter-in-place',
    type: 'hazard',
    kicker: 'Shelter-in-Place',
    hazard: 'Radiological / National Emergency',
    icon: '🏠',
    durationMs: 14000,
    headline: 'Get Inside. Stay Inside. Stay Tuned.',
    steps: [
      'Get inside a sturdy building right away — a basement offers the most protection',
      'Seal the room: close windows, doors, and vents; turn off fans and AC',
      'Stay tuned to a battery radio for official instructions and the all-clear',
      'If you were outside, remove and bag outer clothing and wash exposed skin',
    ],
  },

  // ── Quiz / engagement ──────────────────────────────────────────────
  {
    id: 'quiz-water',
    type: 'quiz',
    kicker: 'Quick Quiz',
    durationMs: 12000,
    revealAfterMs: 6500,
    question: 'How much water should you store per person, per day?',
    options: ['1 cup', '1 quart', '1 gallon', '5 gallons'],
    answerIndex: 2,
    explanation: 'One gallon covers both drinking and basic sanitation.',
  },
  {
    id: 'quiz-shelter',
    type: 'quiz',
    kicker: 'Quick Quiz',
    durationMs: 12000,
    revealAfterMs: 6500,
    question: 'During a shelter-in-place order, you should:',
    options: [
      'Drive away fast',
      'Get inside, seal the room, tune in',
      'Open windows for fresh air',
      'Wait outside for help',
    ],
    answerIndex: 1,
    explanation: 'Get Inside, Stay Inside, Stay Tuned — the safest response to many emergencies.',
  },

  {
    id: 'outro',
    type: 'title',
    durationMs: 9000,
    title: 'Start Today',
    subtitle: 'Visit ready.gov and talk to a Humanity First volunteer at this booth.',
  },
]
