// Every Google Search DOM selector lives here (and in the Phase 4 adapter that uses them)
// so Google UI changes only require edits in one place.
export const GOOGLE_SELECTORS = {
  searchBox: 'textarea[name="q"], input[name="q"]',
} as const;
