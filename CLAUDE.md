# NicheSpark Development Guidelines

## Project Identity

Product: NicheSpark

Tagline: Discover Keywords. Uncover Opportunities.

Purpose: Build a Chrome Extension that collects real Google Autocomplete suggestions for SEO niche research, saves them automatically, organizes unique keywords, and exports research data.

The long-term vision is a broader SEO research platform. The first priority is a reliable Chrome Extension MVP.

## Primary Objective

Help SEO researchers discover and organize long-tail keywords without manually copying every suggestion.

The three primary research modes are:

1. A to Z keyword research.
2. Prefix keyword research.
3. Suffix keyword research.

All successful results must be saved automatically and associated with their source queries.

## Required Working Principles

- Inspect existing code before changing files.
- Preserve working functionality.
- Implement small, testable changes.
- Prefer real functionality over mockups.
- Never fabricate live Google suggestions or keyword metrics.
- Never claim testing succeeded unless it actually ran.
- Report blockers and incomplete functionality honestly.
- Ask for clarification when an important product decision cannot be inferred safely.

## Preferred Technology

- Chrome Extension Manifest V3
- TypeScript
- React
- Vite
- Chrome Storage API
- Vitest

Use IndexedDB if the data model or storage volume makes it more appropriate.

Avoid unnecessary frameworks, paid APIs, backend services, and dependencies in the initial release.

## Architecture

Keep these responsibilities separate:

- Popup interface
- Dashboard interface
- Google Autocomplete adapter
- Query generation
- Collection scheduling
- Keyword normalization
- Deduplication and source tracking
- Project management
- Persistent storage
- Export and import
- Tests

Keep Google-specific DOM selectors in a dedicated adapter.

Keep storage access behind a service interface.

Do not place all functionality in one large component or source file.

## Google Autocomplete Integration

Capture genuine suggestions from the visible Google Search interface wherever technically feasible.

Use supported browser APIs and an appropriate extension content script architecture.

Respect Google policies, applicable rate limits, browser security restrictions, and access controls.

Never bypass CAPTCHA or anti-bot mechanisms.

Handle unavailable dropdowns, empty responses, page changes, timeouts, and missing selectors.

Do not treat a generated query as proof that suggestions were successfully captured.

Do not mark failed queries as completed.

Keep collection user-initiated and provide pause, resume, cancel, and retry controls.

## Query Generation

Support these patterns:

- Seed followed by letters A to Z.
- Custom prefixes followed by the seed.
- Seed followed by custom suffixes.
- Configurable query templates.

Use deterministic query generation.

Validate input and remove accidental duplicate queries.

Preview queries before execution where appropriate.

Do not assume every query will return suggestions.

## Keyword Data

Each project should keep its own keyword collection.

Preserve:

- Original keyword text
- Normalized keyword key
- Source queries
- Research methods
- First collected timestamp
- Last collected timestamp
- Collection count

Deduplicate case-insensitively after trimming and normalizing whitespace.

Preserve relationships when the same keyword is discovered by different queries.

Persist successful results incrementally.

## User Interface

The interface must be clean, responsive, accessible, and easy to understand.

Prioritize:

- Project selection
- Seed keyword input
- Collection controls
- Progress indicators
- Keyword search
- Filters and sorting
- Copy functionality
- CSV and JSON export
- Helpful error messages

Do not prioritize animations or unnecessary visual effects over reliability.

## Privacy and Data Safety

Keep research data local in the MVP.

Do not collect unrelated browsing history, credentials, authentication cookies, or unrelated website content.

Do not transmit research data to remote services.

Use only necessary permissions.

Validate imported files and confirm destructive actions.

Explain how to export backups and how local data may be lost when extension data is cleared or the extension is removed.

## Testing and Verification

Write tests for:

- Query generation
- Keyword normalization
- Deduplication
- Source tracking
- Storage behavior
- CSV export
- JSON import
- Collection state management

Run the relevant tests and build after meaningful changes.

Distinguish mocked tests from real Chrome integration tests.

If browser testing is unavailable, explain what remains to be verified manually.

## Development Workflow

At the beginning of each session:

1. Read this file.
2. Inspect the current repository and Git status.
3. Identify the next incomplete task.
4. Review the relevant implementation and tests.
5. Make a focused change.
6. Run relevant verification.
7. Update documentation if behavior changes.
8. Report results and remaining limitations.

Do not overwrite or rewrite working code without a clear reason.

Do not silently remove features or change the data model.

## Roadmap

Phase 1: Functional extension foundation.

Phase 2: Query generation and persistent storage.

Phase 3: Real Google Autocomplete collection.

Phase 4: A to Z, prefix, and suffix collection controls.

Phase 5: Keyword dashboard and export.

Phase 6: Reliability, tests, documentation, and packaging.

Phase 7: Optional hosted dashboard, cloud synchronization, and advanced SEO research.

Keep the MVP focused. Do not start later phases before the essential earlier functionality has been verified.

## Definition of Done

A feature is done only when its code exists, relevant tests pass where applicable, its limitations are documented, and its behavior has been verified to the extent possible in the available environment.

Always report exactly what has and has not been tested.
