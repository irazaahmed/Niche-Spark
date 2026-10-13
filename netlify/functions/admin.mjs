// Admin API for https://nichespark.tech/admin/.
//
// The admin signs in with their NicheSpark account (email or Google). Only
// accounts with role = 'admin' in Neon Auth get in. The Neon Auth session is
// kept in an HttpOnly cookie scoped to /api/admin, and every request runs the
// admin_* database functions with that account's JWT; the functions check the
// admin role themselves (db/admin.sql). No database password is stored here.

import { errorMessage, rpc, SITE_ORIGIN, str, upstream } from '../lib/neon.mjs';

export const config = { path: '/api/admin/:action' };

const SESSION_COOKIE = 'ns_admin';
const CHALLENGE_COOKIE = 'ns_admin_challenge';
const ADMIN_PAGE = `${SITE_ORIGIN}/admin/`;
const MAX_BODY = 8 * 1024;

/** Database functions the admin page may call, with the arguments each takes. */
const RPC = {
  admin_overview: [],
  admin_users: [],
  admin_user_projects: ['p_user'],
  admin_project_keywords: ['p_user', 'p_project', 'p_limit'],
  admin_delete_project: ['p_user', 'p_project'],
  admin_delete_user: ['p_user'],
};

const enc = (s) => Buffer.from(s, 'utf8').toString('base64url');
const dec = (s) => {
  try {
    return Buffer.from(s, 'base64url').toString('utf8');
  } catch {
    return '';
  }
};

function readCookie(req, name) {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return dec(v.join('='));
  }
  return '';
}

const cookie = (name, value, maxAge) =>
  `${name}=${value ? enc(value) : ''}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${value ? maxAge : 0}`;

function json(status, body, cookies = []) {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

/** Turns a Neon Auth cookie jar into an admin session, or explains why not. */
async function adminSession(jar) {
  if (!jar) return { error: 'Not signed in.', status: 401 };
  const session = await upstream('/get-session', { jar });
  if (!session.res.ok || !session.data?.user) return { error: 'Your session has ended. Please sign in again.', status: 401 };
  const token = await upstream('/token', { jar: session.jar });
  if (!token.res.ok || !token.data?.token) return { error: 'Could not refresh your session. Please sign in again.', status: 401 };
  const check = await rpc(token.data.token, 'ns_is_admin');
  if (check.data !== true) return { error: `${session.data.user.email} is not an admin account.`, status: 403, jar: token.jar };
  const u = session.data.user;
  return { user: { id: u.id, email: u.email, name: u.name ?? '' }, token: token.data.token, jar: token.jar };
}

/** Replies with the admin user and stores the session cookie; signs out non-admins. */
async function finishLogin(jar) {
  const s = await adminSession(jar);
  if (s.error) {
    if (s.jar) await upstream('/sign-out', { method: 'POST', body: {}, jar: s.jar }).catch(() => {});
    return json(s.status, { error: s.error }, [cookie(SESSION_COOKIE, '', 0), cookie(CHALLENGE_COOKIE, '', 0)]);
  }
  return json(200, { user: s.user }, [cookie(SESSION_COOKIE, s.jar, 7 * 86400), cookie(CHALLENGE_COOKIE, '', 0)]);
}

const actions = {
  async login(b) {
    const email = str(b.email), password = str(b.password, 128);
    if (!email || !password) return json(400, { error: 'Enter your email and password.' });
    const r = await upstream('/sign-in/email', { method: 'POST', body: { email, password } });
    if (!r.res.ok) return json(r.res.status === 403 ? 403 : 401, { error: errorMessage(r.data, 'Wrong email or password.') });
    return finishLogin(r.jar);
  },
  async 'google-start'() {
    const r = await upstream('/sign-in/social', {
      method: 'POST',
      body: { provider: 'google', callbackURL: ADMIN_PAGE, newUserCallbackURL: ADMIN_PAGE, errorCallbackURL: ADMIN_PAGE },
    });
    if (!r.res.ok || !r.data?.url) return json(502, { error: errorMessage(r.data, 'Could not start Google sign-in.') });
    return json(200, { url: r.data.url }, [cookie(CHALLENGE_COOKIE, r.jar, 600)]);
  },
  async 'google-finish'(b, req) {
    const verifier = str(b.verifier, 512);
    const challenge = readCookie(req, CHALLENGE_COOKIE);
    if (!verifier || !challenge) return json(400, { error: 'Google sign-in did not complete. Please try again.' });
    const r = await upstream(`/get-session?neon_auth_session_verifier=${encodeURIComponent(verifier)}`, { jar: challenge });
    if (!r.res.ok || !r.data?.user) return json(401, { error: 'Google sign-in did not complete. Please try again.' });
    return finishLogin(r.jar);
  },
  async me(_b, req) {
    const s = await adminSession(readCookie(req, SESSION_COOKIE));
    if (s.error) return json(s.status, { error: s.error }, s.status === 401 ? [cookie(SESSION_COOKIE, '', 0)] : []);
    return json(200, { user: s.user }, [cookie(SESSION_COOKIE, s.jar, 7 * 86400)]);
  },
  async logout(_b, req) {
    const jar = readCookie(req, SESSION_COOKIE);
    if (jar) await upstream('/sign-out', { method: 'POST', body: {}, jar }).catch(() => {});
    return json(200, { ok: true }, [cookie(SESSION_COOKIE, '', 0)]);
  },
  async rpc(b, req) {
    const allowed = RPC[b.fn];
    if (!allowed) return json(400, { error: 'Unknown admin function.' });
    const args = {};
    for (const key of allowed) {
      const v = b.args?.[key];
      if (v === undefined) continue;
      if (key === 'p_limit' ? !Number.isInteger(v) : typeof v !== 'string' || v.length > 400) return json(400, { error: `Invalid ${key}.` });
      args[key] = v;
    }
    const s = await adminSession(readCookie(req, SESSION_COOKIE));
    if (s.error) return json(s.status, { error: s.error });
    const r = await rpc(s.token, b.fn, args);
    if (!r.res.ok) return json(r.res.status === 403 ? 403 : 400, { error: errorMessage(r.data, 'The request failed.') });
    return json(200, { data: r.data ?? null }, [cookie(SESSION_COOKIE, s.jar, 7 * 86400)]);
  },
};

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  // Same-origin requests only (the cookie is also SameSite=Strict).
  if (req.headers.get('origin') !== SITE_ORIGIN) return json(403, { error: 'Forbidden.' });
  const action = actions[context.params?.action];
  if (!action) return json(404, { error: 'Unknown action.' });
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { error: 'Request too large.' });
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return json(400, { error: 'Invalid JSON.' });
  }
  try {
    return await action(body ?? {}, req);
  } catch {
    return json(502, { error: 'The admin service is unavailable. Please try again.' });
  }
};
