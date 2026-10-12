// Auth bridge between the NicheSpark extension and Neon Auth (Managed Better Auth).
//
// Neon Auth only accepts requests from http(s) origins it trusts and keeps the
// session in an HttpOnly cookie. A Chrome extension has neither: its origin is
// chrome-extension://… and it cannot send a Cookie header. This function calls
// Neon Auth from the trusted https://nichespark.tech origin and hands the
// extension the Neon Auth cookies as an opaque "jar" string, which the
// extension stores and sends back to refresh its short-lived JWT.
//
// It stores nothing and only forwards a fixed set of auth calls.

const AUTH_URL = process.env.NEON_AUTH_URL ?? 'https://ep-flat-shape-b778n908.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth';
const SITE_ORIGIN = 'https://nichespark.tech';
const EXTENSION_IDS = (process.env.NS_EXTENSION_IDS ?? 'mfkjoekmjfphffamabelfngbonnjdgep,bboepjcnomhpgciggogklkmdadooogck').split(',');
const MAX_BODY = 8 * 1024;

export const config = { path: '/api/auth/:action' };

const allowedOrigin = (origin) => EXTENSION_IDS.some((id) => origin === `chrome-extension://${id}`);
const allowedRedirect = (url) => EXTENSION_IDS.some((id) => url === `https://${id}.chromiumapp.org/`);

function cors(origin) {
  return allowedOrigin(origin)
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'origin',
      }
    : { vary: 'origin' };
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(origin) },
  });
}

/** Keeps only Neon Auth cookies, as "name=value; name=value". */
function mergeJar(jar, response) {
  const cookies = new Map();
  for (const part of (jar ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name?.startsWith('__Secure-neon-auth')) cookies.set(name, rest.join('='));
  }
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attrs] = header.split(';');
    const [name, ...rest] = pair.trim().split('=');
    if (!name.startsWith('__Secure-neon-auth')) continue;
    const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || rest.join('=') === '';
    if (expired) cookies.delete(name);
    else cookies.set(name, rest.join('='));
  }
  return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function upstream(path, { method = 'GET', body, jar } = {}) {
  const headers = { origin: SITE_ORIGIN };
  if (body) headers['content-type'] = 'application/json';
  if (jar) headers.cookie = jar;
  const res = await fetch(`${AUTH_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  return { res, data, jar: mergeJar(jar, res) };
}

const publicUser = (u) => (u ? { id: u.id, email: u.email, name: u.name ?? '', image: u.image ?? null, emailVerified: !!u.emailVerified } : null);
const errorCode = (data) => (data && typeof data.code === 'string' ? data.code : '');
const errorMessage = (data, fallback) => (data && typeof data.message === 'string' ? data.message : fallback);
const str = (v, max = 320) => (typeof v === 'string' && v.length <= max ? v : null);

/** The account exists but its email must be verified with the emailed code. */
function verifyEmailReply(email, message, origin) {
  return json(403, { error: message, code: 'verify_email', email }, origin);
}

/** Session reply: the user, the cookie jar, and a fresh JWT for the Data API. */
async function sessionReply(jar, origin) {
  const session = await upstream('/get-session', { jar });
  if (!session.res.ok || !session.data?.user) return json(401, { error: 'Your session has ended. Please sign in again.' }, origin);
  const token = await upstream('/token', { jar: session.jar });
  if (!token.res.ok || !token.data?.token) return json(401, { error: 'Could not refresh your session. Please sign in again.' }, origin);
  return json(200, { user: publicUser(session.data.user), jar: token.jar, token: token.data.token }, origin);
}

const actions = {
  async 'sign-up'(b, origin) {
    const email = str(b.email), password = str(b.password, 128), name = str(b.name ?? '', 100) ?? '';
    if (!email || !password) return json(400, { error: 'Email and password are required.' }, origin);
    const r = await upstream('/sign-up/email', { method: 'POST', body: { email, password, name: name || email.split('@')[0] } });
    if (!r.res.ok) return json(r.res.status, { error: errorMessage(r.data, 'Could not create your account.') }, origin);
    // With email verification on, sign-up creates the account but no session until the code is entered.
    if (!r.data?.token) return verifyEmailReply(email, `We sent a 6-digit code to ${email}. Enter it to finish creating your account.`, origin);
    return sessionReply(r.jar, origin);
  },
  async 'sign-in'(b, origin) {
    const email = str(b.email), password = str(b.password, 128);
    if (!email || !password) return json(400, { error: 'Email and password are required.' }, origin);
    const r = await upstream('/sign-in/email', { method: 'POST', body: { email, password } });
    // Neon Auth sends a new code when an unverified account signs in.
    if (r.res.status === 403 && errorCode(r.data) === 'EMAIL_NOT_VERIFIED') {
      return verifyEmailReply(email, `Please verify your email first. We sent a 6-digit code to ${email}.`, origin);
    }
    if (!r.res.ok) return json(r.res.status, { error: errorMessage(r.data, 'Wrong email or password.') }, origin);
    return sessionReply(r.jar, origin);
  },
  async 'social-start'(b, origin) {
    const redirect = str(b.redirect, 200);
    if (!redirect || !allowedRedirect(redirect)) return json(400, { error: 'Unsupported redirect.' }, origin);
    const provider = b.provider === 'google' ? 'google' : null;
    if (!provider) return json(400, { error: 'Unsupported provider.' }, origin);
    // newUserCallbackURL too: without it, first-time Google users are sent to the website instead of back to the extension.
    const r = await upstream('/sign-in/social', { method: 'POST', body: { provider, callbackURL: redirect, newUserCallbackURL: redirect, errorCallbackURL: redirect } });
    if (!r.res.ok || !r.data?.url) return json(502, { error: errorMessage(r.data, 'Could not start Google sign-in.') }, origin);
    return json(200, { url: r.data.url, jar: r.jar }, origin);
  },
  async 'social-finish'(b, origin) {
    const verifier = str(b.verifier, 512), jar = str(b.jar, 8192);
    if (!verifier || !jar) return json(400, { error: 'Google sign-in did not complete.' }, origin);
    const r = await upstream(`/get-session?neon_auth_session_verifier=${encodeURIComponent(verifier)}`, { jar });
    if (!r.res.ok || !r.data?.user) return json(401, { error: 'Google sign-in did not complete. Please try again.' }, origin);
    return sessionReply(r.jar, origin);
  },
  async 'verify-email'(b, origin) {
    const email = str(b.email), otp = str(b.otp, 12);
    if (!email || !otp || !/^[0-9]{6}$/.test(otp.trim())) return json(400, { error: 'Enter the 6-digit code from the email.' }, origin);
    const r = await upstream('/email-otp/verify-email', { method: 'POST', body: { email, otp: otp.trim() } });
    if (!r.res.ok) {
      const code = errorCode(r.data);
      const error =
        code === 'OTP_EXPIRED' ? 'This code has expired. Send a new code and try again.'
        : code === 'TOO_MANY_ATTEMPTS' ? 'Too many wrong codes. Send a new code and try again.'
        : code === 'INVALID_OTP' ? 'That code is not right. Check the latest email and try again.'
        : errorMessage(r.data, 'Could not verify the code.');
      return json(400, { error, code }, origin);
    }
    return sessionReply(r.jar, origin);
  },
  async 'resend-code'(b, origin) {
    const email = str(b.email);
    if (!email) return json(400, { error: 'Enter your email address.' }, origin);
    const r = await upstream('/email-otp/send-verification-otp', { method: 'POST', body: { email, type: 'email-verification' } });
    if (!r.res.ok) return json(r.res.status === 429 ? 429 : 502, { error: r.res.status === 429 ? 'Please wait a minute before asking for another code.' : errorMessage(r.data, 'Could not send a new code.') }, origin);
    return json(200, { ok: true }, origin);
  },
  async session(b, origin) {
    const jar = str(b.jar, 8192);
    if (!jar) return json(401, { error: 'Not signed in.' }, origin);
    return sessionReply(jar, origin);
  },
  async 'sign-out'(b, origin) {
    const jar = str(b.jar, 8192);
    if (jar) await upstream('/sign-out', { method: 'POST', body: {}, jar });
    return json(200, { ok: true }, origin);
  },
  /** Called by the website's /reset-password/ page (same origin), not by the extension. */
  async 'reset-password'(b, origin) {
    const token = str(b.token, 512), newPassword = str(b.newPassword, 128);
    if (!token || !newPassword) return json(400, { error: 'This reset link is incomplete. Request a new one from the extension.' }, origin);
    if (newPassword.length < 8) return json(400, { error: 'Use a password of at least 8 characters.' }, origin);
    const r = await upstream('/reset-password', { method: 'POST', body: { token, newPassword } });
    if (!r.res.ok) return json(r.res.status, { error: errorMessage(r.data, 'This reset link has expired. Request a new one from the extension.') }, origin);
    return json(200, { ok: true }, origin);
  },
  async 'forgot-password'(b, origin) {
    const email = str(b.email);
    if (!email) return json(400, { error: 'Enter your email address.' }, origin);
    const r = await upstream('/request-password-reset', { method: 'POST', body: { email, redirectTo: `${SITE_ORIGIN}/reset-password/` } });
    if (!r.res.ok) return json(r.res.status, { error: errorMessage(r.data, 'Could not send the reset email.') }, origin);
    return json(200, { ok: true }, origin);
  },
};

export default async (req, context) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' }, origin);
  const name = context.params?.action;
  const action = actions[name];
  if (!action) return json(404, { error: 'Unknown action.' }, origin);
  const fromSite = origin === SITE_ORIGIN && name === 'reset-password';
  if (!fromSite && !allowedOrigin(origin)) return json(403, { error: 'Forbidden.' }, origin);
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { error: 'Request too large.' }, origin);
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return json(400, { error: 'Invalid JSON.' }, origin);
  }
  try {
    return await action(body ?? {}, origin);
  } catch {
    return json(502, { error: 'The sign-in service is unavailable. Please try again.' }, origin);
  }
};
