# NicheSpark

**Discover Keywords. Uncover Opportunities.**

NicheSpark is a Chrome extension (Manifest V3) for SEO niche research. It is
designed to collect real Google Autocomplete suggestions with A to Z, prefix,
suffix, and template queries, save them automatically, deduplicate them, and
export the results. All data stays in your browser.

**Install:** [NicheSpark on the Chrome Web Store](https://chromewebstore.google.com/detail/nichespark/mfkjoekmjfphffamabelfngbonnjdgep) · Website: https://nichespark.tech

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
| Live Google Autocomplete collection (Google adapter) | Implemented. Unit-tested on a simulated page. DOM behavior checked by hand on www.google.com (2026-10-11). The full extension flow is **not yet verified in Chrome** |
| Collection controls: start (all, selected, or from a letter), pause, resume, cancel, retry failed, skip completed, progress | Implemented and unit-tested with mocks. **Not yet verified in Chrome** |
| Keyword search, filters (method, source query), six sort orders, selection | Implemented. Pure logic unit-tested; UI checked in a browser with a stand-in for the extension APIs (not inside the installed extension) |
| Copy (all, filtered, selected), CSV export (all, filtered, selected), delete selected | Implemented. CSV escaping unit-tested; buttons checked in a browser as above |
| JSON backup export and validated import (always as a new project) | Implemented. Unit-tested on both storage engines; export → import round trip checked in a browser |

NicheSpark never shows sample or made-up keywords as real results.

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

### Auto-reload while developing

```bash
npm run dev
```

This rebuilds `dist/` on every file change, and the extension reloads itself.
You don't have to click reload in `chrome://extensions`. Load `dist/` with
**Load unpacked** once, keep `npm run dev` running, and every saved change
shows up automatically. Open NicheSpark pages close when the extension
reloads. Google tabs are refreshed the next time a collection starts.

The auto-reload code is only in `npm run dev` builds. It connects to
`ws://127.0.0.1:35729` on your own computer. `npm run build` (the version you
share or publish) does not include it.

## Collecting keywords

1. Create a project with a seed keyword (popup or dashboard).
2. Pick a method: **A to Z**, **Prefix**, **Suffix**, or **Template**. For
   prefixes, suffixes, and templates, add entries first under *Research
   queries* in the dashboard.
3. Click **Start**. To collect specific queries only, tick them in the
   dashboard preview and click **Collect N selected**.
4. NicheSpark opens Google in a background tab. For each query it enters the
   text in the search box, waits for the dropdown to settle, and saves the
   suggestions. Progress is saved after every query, so you can close the popup.
5. Use **Pause**, **Resume**, and **Cancel** at any time. Keywords collected
   so far are always kept. **Retry failed** runs only the failed queries again.

How results are recorded:
- **Done**: suggestions were captured and saved.
- **Empty**: Google showed no suggestions for that query.
- **Failed**: the dropdown did not appear in time or the page changed. The
  error is kept, and the query can be retried.
- If Google shows an unusual-traffic or CAPTCHA page, or a consent page, the
  job stops with **Needs your action**. Resolve it yourself in the Google tab,
  then click **Resume**. NicheSpark never tries to get past these pages.
- After 3 failed queries in a row, the job pauses automatically.
- Your own search-history entries in the dropdown (clock icon) are never saved.

Suggestions reflect what Google showed in your browser at that moment.
Location, language, and sign-in state can change them.

## Troubleshooting

- **"Could not reach Google in the NicheSpark tab"**: open the tab. If Google
  shows a consent or sign-in page, complete it, then click Resume.
- **Many failed queries**: increase the delay, check your connection, then
  click Retry failed.
- **Job shows "Interrupted"**: Chrome restarted the extension mid-job. Click Resume.
- **Changes don't show up**: make sure `npm run dev` is running. If you used
  `npm run build` instead, click reload on the NicheSpark card in
  `chrome://extensions`.

## Website (nichespark.tech)

The public website is a static site in `site/`, deployed by Netlify
(`netlify.toml` sets the publish folder; no build step is needed).

- `npm run package` creates a production zip of the extension in
  `site/downloads/` for the website's download button. Run it after every
  release and commit the new zip. It builds into `release/`, so a running
  `npm run dev` is not affected.
- `node scripts/generate-og.mjs` regenerates the social preview image.

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
Back up regularly with **Backup (JSON)**.

## Export, copy and backup

In the dashboard, each project's **Keywords** section has:

- **Copy all / Copy filtered / Copy selected**: one keyword per line, ready to
  paste anywhere.
- **Export all (CSV) / CSV: filtered / CSV: selected**: columns are keyword,
  normalized key, research methods, source queries, first and last collected
  (UTC) and times seen. Several sources or methods are joined with ` | `.
  Files are UTF-8 with a BOM so Excel shows non-Latin text correctly. Cells
  that start with `=`, `+`, `-` or `@` get a leading `'` so a spreadsheet can
  never run them as formulas.
- **Delete selected** asks for confirmation first.

**Backup (JSON)** (top of each project) downloads the whole project: settings,
prefix/suffix/template lists, every query with its status, and every keyword
with its sources.

**Import backup (JSON)** (sidebar) validates the file first and lists any
problems. A valid backup is always added as a **new** project (for example,
"Detailing (imported)"). Existing projects are never overwritten or merged.

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
  background/  service worker: collection scheduler + Chrome tab driver
  content/     Google Search content script, adapter, isolated selectors
  popup/       popup UI
  dashboard/   dashboard UI
  ui/          shared UI components and theme
tests/         Vitest unit tests
public/        manifest.json and icons
```
