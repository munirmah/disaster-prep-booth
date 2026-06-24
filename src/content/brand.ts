/**
 * Branding for the Humanity First USA disaster-preparedness booth.
 *
 * Colors and logo are taken from humanityfirstusa.org:
 *  - logo: official horizontal lockup (oval figure + "Humanity First /
 *    Serving Mankind"), sampled brand blue #0069b4.
 *  - the logo art already contains the org name + "Serving Mankind" tagline,
 *    so `tagline` here is the booth PROGRAM label shown beside the mark.
 *
 * Keep `colors` in sync with the CSS variables in src/index.css (:root).
 */
export const brand = {
  orgName: 'Humanity First',
  tagline: 'Disaster Preparedness',
  motto: 'Serving Mankind',
  website: 'humanityfirstusa.org',
  logoSrc: './brand/hf-logo-horizontal.png',
  colors: {
    primary: '#0069b4', // official Humanity First blue — dominant
    accent: '#e63946', // emergency red (urgency / CTA / error)
    secondary: '#0f766e', // calm teal-green (ready / owned / correct)
    warning: '#b45309', // amber (caution: hazards, unpublished)
    ink: '#062a44', // deep blue for dark backgrounds
    paper: '#faf8f5', // warm off-white page surface
  },
} as const
