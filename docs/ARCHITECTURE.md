# NicheSpark Architecture

NicheSpark is a Manifest V3 Chrome extension. Research data lives in the
browser's IndexedDB and, from v0.4.0, is synced to the user's NicheSpark account
(Neon Postgres through the Neon Data API, sign-in through Neon Auth and a small
Netlify function). Accounts and sync are described in [accounts.md](accounts.md).
There is no paid API.

## Components

```
┌──────────────┐   runtime messages   ┌──────────────────────────┐
│ Popup (React)│ ───────────────────▶ │ Background service worker│
└──────────────┘                      │  - Collection scheduler  │
┌──────────────┐   runtime messages   │  - Job state persistence │
│ Dashboard    │ ───────────────────▶ │                          │
│ (React page) │                      └─────────┬────────────────┘
└──────┬───────┘                                │ tabs.sendMessage
       │ StorageService (IndexedDB)             ▼
       │                              ┌──────────────────────────┐
       └─────────────────────────────▶│ Content script on Google │
                                      │  - Google adapter (DOM)  │
                                      └──────────────────────────┘
```

| Responsibility | Location |
| --- | --- |
| Shared types and data model | `src/shared/` |
| Query generation (A–Z, prefix, suffix, templates) | `src/core/queryGeneration.ts` |
| Keyword normalization, dedup, source tracking | `src/core/keywords.ts` |
| Storage interface and implementations | `src/storage/` |
| Collection state machine (pure) | `src/core/collectionState.ts` |
| Collection scheduler (pacing, pause/resume/cancel/retry) | `src/background/scheduler.ts`, `chromeDeps.ts` |
| Google Autocomplete adapter | `src/content/googleAdapter.ts` (selectors in `googleSelectors.ts`) |
| Popup UI | `src/popup/` |
| Dashboard UI | `src/dashboard/` |
| CSV / JSON / clipboard export and JSON import | `src/core/export*.ts` *(Phase 6)* |

UI components never touch `chrome.*` or IndexedDB directly. They go through the
storage service and a small messaging client. That keeps the core logic reusable
for a future hosted dashboard.

## Data model

- **Project**: name, seed keyword, Google domain, language, prefixes, suffixes,
  query templates, and created/updated timestamps.
- **QueryRecord**: one generated query for a project, with its method
  (`az`, `prefix`, `suffix`, `template`), its status (`pending`, `succeeded`,
  `empty`, `failed`), attempt count, last error, and suggestion count.
  The completed, pending, and failed counts are calculated from these records.
- **KeywordRecord**: id `${projectId}:${key}`, original text, normalized key,
  source queries, research methods, first/last collected timestamps, and a
  collection count.

Normalization uses `NFC`, trims, collapses whitespace runs to one space, and
lower-cases to build the key. The displayed text keeps the casing from the first
capture.

### Why IndexedDB

A project can easily reach thousands of keywords. Every capture is a
read-modify-write merge, and that needs to be atomic and incremental.
IndexedDB gives transactions and per-project indexes. `chrome.storage.local`
would mean rewriting large arrays on every capture. The extension origin's
IndexedDB is shared by the service worker, popup, and dashboard.

## Collection design (Phases 4–5)

1. The user starts a job from the popup or dashboard. Jobs are always started
   by the user, and only one job runs at a time.
2. The background worker opens a tab on the project's Google domain, or reuses
   the one it opened before.
3. For each pending query, the worker sends `collect(query)` to the content
   script. The adapter:
   - finds the search box (`textarea[name=q]`, falling back to `input[name=q]`)
   - clears it and waits for any old dropdown to close
   - sets the value and dispatches the input events Google's page listens for
   - watches the suggestion listbox with a `MutationObserver` until it has been
     stable for a short time, or a timeout is reached
   - checks that the box still holds the query, so stale results are not read
   - returns the suggestion text, or `empty`, `timeout`, `blocked` (CAPTCHA or
     "unusual traffic"), `consent_required`, or `unsupported_page`
4. The worker saves the result and the query status before moving to the next
   query. A conservative, configurable delay with jitter sits between queries.
5. If the worker sees `blocked` or `consent_required`, it pauses the job and
   asks the user to act. It never tries to get around those pages.

## Observed Google behavior (checked by hand on 2026-10-11)

- Programmatic `input` events on `textarea[name=q]` trigger real suggestions,
  including in a hidden background tab (about 300 ms).
- The previous query's dropdown stays visible for about 150 ms after new input, so
  the adapter waits for the list to change and settle before reading.
- `.wM6W7d` holds the clean suggestion text, without entity labels like "Dish".
  `aria-label` is lower-cased and is used only as a fallback.
- Search-history rows carry the `.sbic.sb27` icon (predictions use `sb43`).
  The "Delete from history" buttons are reused DOM nodes and cannot be trusted.
- An empty, focused box shows the user's recent searches. These are never read
  as results.

## Technical risks

- **Google DOM changes.** The selectors are undocumented and change without
  notice. They live in one adapter file, and every failure is reported
  instead of hidden.
- **Synthetic input.** Google may ignore programmatically dispatched events or
  behave differently with them. This has to be verified in real Chrome.
- **Stale or partial dropdowns.** Suggestions arrive asynchronously. Reading
  too early could give the previous query's results. The adapter clears the
  box, waits for the results to settle, and checks the box value before reading.
- **Rate limiting and CAPTCHA.** Too many queries can trigger Google's
  "unusual traffic" page. The extension uses slow pacing and pauses
  immediately when it sees that page.
- **Consent interstitials.** Some regions (EU/UK) show a consent page first.
  The user has to accept it manually.
- **Personalization.** Suggestions can vary with sign-in state, location,
  history, and language. Results show what Google offered that browser at that
  time, not a universal list.
- **MV3 service worker lifetime.** Chrome may stop an idle worker. Job state is
  saved after every query. If a running job is found after a worker restart, it
  is marked `interrupted` so the user can resume it. It is never treated as
  completed.
- **Domain coverage.** Chrome match patterns cannot wildcard top-level domains,
  so only an explicit list of Google domains is supported.

## Permissions (planned)

| Permission | Why |
| --- | --- |
| `storage` | Small settings and job-state flags |
| `unlimitedStorage` | Large keyword collections in IndexedDB will not hit quota limits |
| Host access to the listed Google domains | Run the adapter content script on Google Search only |

There is no `history`, `cookies`, or `<all_urls>` access.
