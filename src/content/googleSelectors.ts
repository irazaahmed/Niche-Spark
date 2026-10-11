// Every Google Search DOM selector lives here, so Google UI changes only
// require edits in this file. Verified against www.google.com on 2026-10-11.
export const GOOGLE_SELECTORS = {
  /** The main search box (a textarea on current Google, an input on older layouts). */
  searchBox: 'textarea[name="q"], input[name="q"]',
  /** Autocomplete suggestion rows. Google keeps hidden listboxes in the DOM, so visibility is checked separately. */
  option: '[role="listbox"] [role="option"]',
  /** Clean suggestion text inside an option (excludes entity labels such as "Dish"). */
  optionText: '.wM6W7d',
  /** Row container of an option. */
  optionRow: 'li',
  /**
   * Clock icon that marks the user's own search history. These rows are never
   * collected: they are personal history, not Google Autocomplete predictions.
   */
  historyIcon: '.sbic.sb27',
  /** Google's "unusual traffic" / CAPTCHA interstitial. */
  blockedPage: 'form#captcha-form, #recaptcha, iframe[src*="recaptcha"]',
} as const;

/** URL paths Google uses for its rate-limit / CAPTCHA interstitial. */
export const GOOGLE_BLOCKED_PATH_PREFIXES = ['/sorry'] as const;
