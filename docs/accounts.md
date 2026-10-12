# Accounts and cloud sync (v0.4.0)

From v0.4.0, using the extension requires a free NicheSpark account (email and
password, or Google). Projects, queries and keywords are kept in IndexedDB as
before and are also synced to the account, so they survive removing the
extension and appear on every computer where the user signs in.

## How it fits together

```
Extension (popup, dashboard)
  │  chrome.runtime messages (auth/*, sync/*)
  ▼
Background service worker
  ├─ AuthService ──POST──▶ https://nichespark.tech/api/auth/*   (Netlify function, netlify/functions/auth.mjs)
  │                            │ origin https://nichespark.tech, cookies forwarded
  │                            ▼
  │                        Neon Auth (Managed Better Auth)
  └─ SyncEngine ──Bearer JWT──▶ Neon Data API (PostgREST) ──▶ Postgres tables with row-level security
```

| Piece | Where |
| --- | --- |
| Database tables, triggers, RLS | `db/schema.sql` (applied to Neon project `nichespark`, id `rapid-rice-51072222`, branch `main`, database `neondb`) |
| Auth bridge | `netlify/functions/auth.mjs`, served at `/api/auth/:action` |
| Sign-in logic (token refresh, Google flow) | `src/auth/authService.ts` |
| Account state, data ownership, sign-out | `src/background/account.ts`, wiring in `accountDeps.ts` |
| Change tracking (outbox) | `src/storage/indexedDbStorage.ts` (DB version 2 adds the `outbox` store) |
| Push/pull | `src/sync/syncEngine.ts`, `src/sync/cloudApi.ts` |
| Sign-in screen, account bar | `src/ui/AuthGate.tsx`, `src/ui/account.ts` |
| Password reset page | `site/reset-password/` |

### Why there is an auth bridge

Neon Auth accepts requests only from trusted `http(s)` origins and keeps the
session in an HttpOnly cookie. An extension has a `chrome-extension://` origin
(Neon rejects it as a trusted domain) and cannot send a `Cookie` header. The
bridge calls Neon Auth from `https://nichespark.tech` and returns the Neon Auth
cookies to the extension as an opaque "jar" string, which the extension keeps in
`chrome.storage.local` and sends back to refresh its 15-minute JWT. The bridge
stores nothing, accepts only the NicheSpark extension IDs (CORS and origin
check), and only forwards a fixed list of actions.

### Google sign-in

1. The worker asks the bridge to start (`social-start`) with the redirect
   `https://<extension-id>.chromiumapp.org/`. The bridge returns Neon's sign-in
   URL plus a session-challenge cookie.
2. `chrome.identity.launchWebAuthFlow` opens Google. After sign-in, Neon
   redirects to the chromiumapp.org URL with `neon_auth_session_verifier`.
3. The worker sends the verifier and challenge to the bridge (`social-finish`),
   which exchanges them for a session.

Each extension ID's `https://<id>.chromiumapp.org` must be a trusted domain in
Neon Auth. Configured now: the store ID `mfkjoekmjfphffamabelfngbonnjdgep` and
the development ID `bboepjcnomhpgciggogklkmdadooogck`.

### Sync rules

- Every local write also writes an outbox entry in the same IndexedDB
  transaction, so no change is missed even if the worker stops.
- Push uploads the current version of each changed record (or a tombstone for a
  deletion), then removes the outbox entries that were not rewritten meanwhile.
- Pull downloads rows changed since the last pull (with a 60-second overlap),
  in `(updated_at, id)` order. A record with a pending local change keeps the
  local version until it is pushed. Between devices, the last upload wins per
  record.
- Deleting a project uploads a tombstone; a database trigger then deletes that
  project's queries and keywords on the server.
- Sync runs about 3 seconds after changes, when a page opens, every 5 minutes
  (alarm), and from "sync now" in the account bar.
- Local data belongs to one account (`nichespark.owner`). Data from before
  accounts is uploaded on the first sign-in. Signing out uploads what it can,
  then clears the local copy; if changes could not be uploaded, the user must
  confirm losing them.

## Development

- `npm run dev` and `npm run build` add `scripts/dev-extension-key.json` to the
  manifest so unpacked builds have the fixed development ID (needed for the
  Google redirect and the bridge's CORS allowlist). Loading an unpacked build
  therefore gets a new ID compared with older unpacked installs, and their local
  data is not visible to it.
- `npm run package` sets `NS_STORE_BUILD`, keeps the store ID (no `key`) and
  refuses to package a manifest with a `key`.
- To test against a local copy of the bridge, build with
  `NS_AUTH_BRIDGE=http://localhost:8888/api/auth` and serve
  `netlify/functions/auth.mjs` on that port.

## Before releasing v0.4.0 (owner steps)

1. **Own Google OAuth credentials.** Neon's shared Google credentials work for
   testing, but the Google screen then shows Neon's name. In Google Cloud
   Console: create an OAuth client of type *Web application*, add the redirect
   URI shown in Neon Console → project `nichespark` → Auth → OAuth providers →
   Google (it is `https://ep-flat-shape-b778n908.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth/callback/google`),
   fill in the consent screen (app name NicheSpark, support email, authorized
   domain nichespark.tech), publish it, then paste the Client ID and Secret in
   Neon Console.
2. **Email sender (optional).** Password reset emails come from Neon's shared
   sender (`auth@mail.myneon.app`, "Neon Auth"). A custom SMTP sender can be set
   in Neon Console → Auth.
3. **Chrome Web Store listing**: update the privacy answers (see
   `docs/chrome-web-store.md`) and give reviewers a test account in the
   "Test instructions" field, because the extension cannot be used without one.

## Limits (Neon Free plan, checked 2026-10-12)

- 0.5 GB storage for this project (Free plan branch limit shown on the project;
  the plan allows up to 1 GB per project), 100 CU-hours of compute and 5 GB of
  data transfer per month, 60,000 monthly active users for sign-in.
- When compute or transfer runs out, Neon suspends the database until the next
  month (no data is deleted). Collection keeps working locally and changes
  upload later. Upgrading the Neon plan lifts the limits.

## What was tested

- Unit tests (fake-indexeddb, mocked cloud and bridge): outbox tracking, DB
  upgrade from v1, two-device push/pull, deletions, conflicts, offline retry,
  paging, malformed rows, PostgREST request format, token refresh, Google flow
  parsing, ownership and sign-out rules (`tests/sync.test.ts`,
  `tests/account.test.ts`).
- Against the real Neon project: sign-up, sign-in, wrong password, token
  refresh, sign-out, Google sign-in start (challenge cookie), Data API upsert,
  row-level security (a second user sees nothing and cannot write another
  user's rows), anonymous access rejected, project-delete cascade.
- In real Chrome with the built extension (local copy of the bridge): sign-up
  from the popup, project created in the dashboard synced ("Synced just now"),
  then signing in on a second browser profile downloaded the project.
- **Not tested:** completing a Google sign-in (needs a real Google account in
  the browser), the password reset email and page end to end, and the deployed
  Netlify function before it is live.
