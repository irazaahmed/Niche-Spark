// Shared Neon Auth / Data API helpers for the Netlify functions.

export const AUTH_URL = process.env.NEON_AUTH_URL ?? 'https://ep-flat-shape-b778n908.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth';
export const DATA_API_URL = process.env.NEON_DATA_API_URL ?? 'https://ep-flat-shape-b778n908.apirest.c-13.us-east-1.aws.neon.tech/neondb/rest/v1';
export const SITE_ORIGIN = 'https://nichespark.tech';

/** Keeps only Neon Auth cookies, as "name=value; name=value". */
export function mergeJar(jar, response) {
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

/** Calls Neon Auth from the trusted website origin, forwarding the cookie jar. */
export async function upstream(path, { method = 'GET', body, jar } = {}) {
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

/** Calls a Data API function (POST /rpc/:fn) as the user the JWT belongs to. */
export async function rpc(token, fn, args = {}) {
  const res = await fetch(`${DATA_API_URL}/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 204 */
  }
  return { res, data };
}

export const errorCode = (data) => (data && typeof data.code === 'string' ? data.code : '');
export const errorMessage = (data, fallback) => (data && typeof data.message === 'string' ? data.message : fallback);
export const str = (v, max = 320) => (typeof v === 'string' && v.length <= max ? v : null);
