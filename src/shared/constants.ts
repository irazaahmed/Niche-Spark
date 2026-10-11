export const PRODUCT_NAME = 'NicheSpark';
export const TAGLINE = 'Discover Keywords. Uncover Opportunities.';

/**
 * Google Search hosts the content script is allowed to run on.
 * Chrome match patterns cannot wildcard top-level domains, so each host is
 * listed explicitly. Keep in sync with public/manifest.json (enforced by tests).
 */
export const SUPPORTED_GOOGLE_DOMAINS = [
  'www.google.com',
  'www.google.co.uk',
  'www.google.ca',
  'www.google.com.au',
  'www.google.co.in',
  'www.google.com.pk',
  'www.google.ie',
  'www.google.co.nz',
  'www.google.co.za',
  'www.google.com.sg',
  'www.google.ae',
  'www.google.de',
  'www.google.fr',
  'www.google.es',
  'www.google.it',
  'www.google.nl',
  'www.google.com.br',
  'www.google.com.mx',
] as const;

export const DEFAULT_GOOGLE_DOMAIN = 'www.google.com';
export const DEFAULT_LANGUAGE = 'en';

export const LIMITS = {
  seedMaxLength: 100,
  affixMaxLength: 60,
  queryMaxLength: 200,
  projectNameMaxLength: 80,
  maxAffixes: 200,
  maxTemplates: 50,
} as const;
