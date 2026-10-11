# NicheSpark

**Discover Keywords. Uncover Opportunities.**

NicheSpark is a Chrome extension (Manifest V3) for SEO niche research. It is
designed to collect real Google Autocomplete suggestions with A to Z, prefix,
suffix, and template queries, save them automatically, deduplicate them, and
export the results. All data stays in your browser.

## Project status

This is an early build. Work is happening in phases (see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

| Area | Status |
| --- | --- |
| Extension shell (popup, dashboard, service worker, content script) | Done. Builds, but not yet verified as loaded in Chrome |
| Projects: create, reopen, rename, delete (with confirmation), domain and language settings | Done |
| Query generation: A to Z (with start letter), prefix, suffix, `{seed}`/`{letter}` templates, plus a preview | Done and unit-tested |
| Keyword normalization, deduplication, source-query tracking | Done and unit-tested |
| Local storage (IndexedDB behind a `StorageService` interface) | Done. Unit-tested against a mock IndexedDB |
| Live Google Autocomplete collection | **Not implemented yet** |
| Collection controls (start, pause, resume, cancel, retry) and progress | **Not implemented yet** |
| Keyword filters, copy, CSV/JSON export, JSON import | **Not implemented yet** |

This build does not collect keywords yet. It never shows sample or made-up
keywords as real results.

## Development

Requirements: Node.js 20+ and npm.

```bash
npm install
npm test          # unit tests (Vitest)
npm run build     # type-check + production build into dist/
```

### Load in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin NicheSpark and open the popup to create a project.

After code changes, rebuild and click the reload icon on the extension card.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Remembers small UI preferences, such as the last opened project |
| `unlimitedStorage` | Large keyword collections in IndexedDB will not hit quota limits |
| Listed Google Search domains | Runs the content script only on supported Google Search pages |

NicheSpark does not request access to browsing history, cookies, or all
websites, and it never sends research data anywhere.

## Your data

Research data is stored only in this browser profile, in the extension's
IndexedDB. **It is deleted if you remove the extension or clear its site data.**
JSON backup export is planned. Until it exists, do not rely on this build for
data you cannot afford to lose.

## Tests

`npm test` runs automated unit tests. Browser APIs are mocked: IndexedDB uses
`fake-indexeddb`. These tests do not cover behavior in real Chrome or on
Google Search pages, so that still has to be checked manually.

## Project layout

```
src/
  shared/      types, constants, message contracts
  core/        query generation, keyword normalization/merging (pure, tested)
  storage/     StorageService interface, IndexedDB + in-memory implementations
  background/  service worker (collection scheduler goes here)
  content/     Google Search content script + isolated selectors
  popup/       popup UI
  dashboard/   dashboard UI
  ui/          shared UI components and theme
tests/         Vitest unit tests
public/        manifest.json and icons
```
