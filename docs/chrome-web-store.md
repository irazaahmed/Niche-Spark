# Chrome Web Store submission kit (NicheSpark v0.2.0)

Copy each block into the matching field in the Developer Dashboard.

## Package

- Upload: `site/downloads/nichespark-0.2.0.zip` (built by `npm run package`;
  production build, no dev auto-reload code).

## Store listing tab

**Name** (from the manifest): NicheSpark

**Summary** (manifest `description`, max 132 characters):

> Discover Keywords. Uncover Opportunities. Collect Google Autocomplete suggestions for SEO niche research.

**Description**:

```
NicheSpark collects the real suggestions Google Autocomplete shows and turns them into an organized keyword list for your niche. It's built for SEO researchers, bloggers and site owners who want long-tail keywords without typing queries and copying suggestions by hand.

HOW IT WORKS
1. Create a project from a seed keyword, for example "mobile car detailing".
2. Choose a research method: A to Z, prefix, suffix or your own templates.
3. Click Start. NicheSpark opens Google Search in a background tab, enters each query and reads the suggestions Google displays.
4. Review, filter, copy and export your keywords.

RESEARCH METHODS
• A to Z: seed + every letter (start from any letter)
• Prefix: your words before the seed (best, cheap, affordable…)
• Suffix: your words after the seed (near me, cost, prices…)
• Templates: your own patterns with {seed} and {letter}
Every query can be previewed before collection starts.

FEATURES
• Real suggestions only. Nothing is invented or shown as sample data.
• Automatic saving after every query, with deduplication (case and spacing ignored)
• Source tracking: see which queries and methods found each keyword
• Pause, resume, cancel and retry failed queries. Completed queries are skipped.
• Honest status: each query is marked done, empty or failed, with the reason
• Search, filter by method or source query, and sort six ways
• Copy all, filtered or selected keywords (one per line)
• CSV export (all, filtered or selected) and JSON backup and restore
• Multiple projects, 18 Google domains, any interface language

RESPECTFUL BY DESIGN
• Collection is always started by you, runs one query at a time, and waits at least 2 seconds between queries.
• If Google shows a verification (CAPTCHA) or consent page, NicheSpark stops and waits for you. It never tries to get around it.
• Your own search-history entries in the dropdown are recognized and never saved.

PRIVATE
• No account, no server, no tracking, no ads.
• All projects and keywords stay in your browser (IndexedDB) and are never uploaded.
• Runs only on Google Search pages.

Note: suggestions reflect what Google shows in your browser at that moment, which can vary by location, language and sign-in state. NicheSpark does not show search volume or difficulty.

Website: https://nichespark.tech
```

**Category**: Productivity → Tools (or the closest "Tools" category offered)

**Language**: English

**Graphics** (see `store-assets/`):

| Asset | Size | File |
| --- | --- | --- |
| Store icon | 128×128 | `public/icons/icon-128.png` |
| Screenshots (1–5) | 1280×800 | `store-assets/screenshot-*.png` |
| Small promo tile | 440×280 | `store-assets/promo-small-440x280.png` |
| Marquee promo tile (optional) | 1400×560 | `store-assets/promo-marquee-1400x560.png` |

**Official URL / Homepage**: https://nichespark.tech

**Support URL**: https://nichespark.tech/#faq

## Privacy practices tab

**Single purpose**:

```
NicheSpark helps users research SEO keywords by collecting the Google Autocomplete suggestions shown for queries the user chooses, and saving them in a local, organized keyword list.
```

**Permission justifications**:

- `storage`:
  ```
  Saves small interface preferences (such as the last opened project) and the progress of the current collection job, so collection can continue after the popup is closed.
  ```
- `unlimitedStorage`:
  ```
  Keyword projects are stored locally in IndexedDB and can grow to many thousands of keywords. This prevents the browser's default quota from deleting or blocking the user's saved research.
  ```
- Host permissions (the listed `https://www.google.*/*` Google Search domains):
  ```
  The content script runs only on Google Search pages. When the user starts a collection, it enters the user's chosen queries into the Google search box and reads the visible autocomplete suggestions. No other sites are accessed, and no other page content is read.
  ```

**Remote code**: No, I am not using remote code. (All JavaScript is bundled in the package; nothing is loaded from external servers.)

**Data usage**: tick **none** of the data categories. NicheSpark does not
collect or transmit user data. Research data stays on the device.

Certify all three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**: https://nichespark.tech/privacy.html

## Distribution tab

- Visibility: **Public** (or **Unlisted** for a soft launch, where only people with the link can install)
- Regions: all regions
- Pricing: free

## Review risk to know about

The extension types queries into Google Search and reads the suggestions.
Google's own Terms of Service restrict automated access to its services, and
reviewers may look closely at this. The listing is written to be accurate:
collection is user-started, slow, one query at a time, and stops at any
verification page. If the review raises this, reply plainly with how it
works; do not change the description to hide it.
