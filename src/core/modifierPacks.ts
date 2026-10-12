// Ready-made prefix and suffix lists. Each pack is a starting point the user
// adds to a project's list (and can then edit); nothing is run automatically.
import { normalizeKey, normalizeText } from './keywords';

export interface ModifierPack {
  id: string;
  label: string;
  description: string;
  words: readonly string[];
}

export const PREFIX_PACKS: readonly ModifierPack[] = [
  {
    id: 'commercial',
    label: 'Commercial',
    description: 'Comparing and choosing',
    words: ['best', 'top', 'professional', 'reliable', 'trusted', 'recommended'],
  },
  {
    id: 'budget',
    label: 'Budget',
    description: 'Price-sensitive buyers',
    words: ['cheap', 'affordable', 'budget', 'low cost', 'discount', 'free'],
  },
  {
    id: 'local',
    label: 'Local',
    description: 'Searching nearby',
    words: ['local', 'nearby', 'home', '24 hour', 'emergency'],
  },
  {
    id: 'learning',
    label: 'Learning',
    description: 'Beginners and how-tos',
    words: ['learn', 'how to start', 'beginner', 'diy', 'online'],
  },
];

export const SUFFIX_PACKS: readonly ModifierPack[] = [
  {
    id: 'pricing',
    label: 'Pricing',
    description: 'Cost and quotes',
    words: ['cost', 'price', 'prices', 'price list', 'rates', 'charges', 'quote'],
  },
  {
    id: 'local',
    label: 'Local',
    description: 'Near me and booking',
    words: ['near me', 'nearby', 'open now', 'home service', 'booking', 'delivery'],
  },
  {
    id: 'commercial',
    label: 'Commercial',
    description: 'Reviews and comparisons',
    words: ['reviews', 'vs', 'alternatives', 'comparison', 'companies', 'services'],
  },
  {
    id: 'learning',
    label: 'Learning',
    description: 'Guides and training',
    words: ['course', 'training', 'tips', 'guide', 'for beginners', 'tools'],
  },
  {
    id: 'business',
    label: 'Business',
    description: 'Starting or working in it',
    words: ['business', 'jobs', 'salary', 'income', 'equipment', 'license'],
  },
];

/**
 * Adds a pack's words to an existing list, keeping the list's order and
 * skipping words already present (case- and spacing-insensitive).
 * Returns the new list and how many words were added.
 */
export function addPackToList(list: readonly string[], pack: ModifierPack): { list: string[]; added: number } {
  const seen = new Set(list.map(normalizeKey));
  const out = list.map(normalizeText).filter(Boolean);
  let added = 0;
  for (const word of pack.words) {
    const key = normalizeKey(word);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalizeText(word));
    added++;
  }
  return { list: out, added };
}
