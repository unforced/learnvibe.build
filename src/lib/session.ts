// Stateless signed-cookie sessions — the Clerk replacement.
//
// A session is an HMAC-SHA256-signed payload `{ uid, iat }` stored in an
// httpOnly cookie. No sessions table: verification is pure crypto + a single
// users-by-id lookup (in getUser), same DB cost as before. Sign-out clears
// the cookie. If we ever need server-side revocation, add a token-version
// column on users and fold it into the signed payload.
//
// Cookie: lvb_session — httpOnly, Secure, SameSite=Lax, Path=/, 30-day Max-Age.
// SameSite=Lax (not Strict) so the magic-link click (a top-level GET from the
// email client) and the post-verify redirect carry the cookie normally.

import { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { AppContext } from '../types'

const COOKIE_NAME = 'lvb_session'
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

interface SessionPayload {
  uid: number
  iat: number // issued-at, epoch seconds
}

function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return new Uint8Array(sig)
}

/** Constant-time compare of two byte arrays. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]
  return r === 0
}

/** Build a signed token string: base64url(payloadJSON).base64url(hmac). */
async function sign(secret: string, payload: SessionPayload): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = base64url(await hmac(secret, body))
  return `${body}.${sig}`
}

/** Verify + parse a signed token. Returns the payload or null. */
async function verify(secret: string, token: string): Promise<SessionPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  try {
    // base64urlToBytes(sig) can throw on a malformed (attacker-supplied)
    // cookie — keep it inside the try so verify() honours its null-on-invalid
    // contract on its own, rather than leaning on a caller's catch.
    const expected = await hmac(secret, body)
    const got = base64urlToBytes(sig)
    if (!bytesEqual(expected, got)) return null
    const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(body))) as SessionPayload
    if (typeof payload.uid !== 'number' || typeof payload.iat !== 'number') return null
    // Expiry check
    if (Date.now() / 1000 - payload.iat > SESSION_TTL_SECONDS) return null
    return payload
  } catch {
    return null
  }
}

/** Issue a session cookie for a user. Call after verifying a magic link. */
export async function setSession(c: Context<AppContext>, userId: number): Promise<void> {
  const secret = c.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET not configured')
  const token = await sign(secret, { uid: userId, iat: Math.floor(Date.now() / 1000) })
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

/** Read + verify the session cookie. Returns the user id or null. */
export async function getSessionUserId(c: Context<AppContext>): Promise<number | null> {
  const secret = c.env.SESSION_SECRET
  if (!secret) return null
  const token = getCookie(c, COOKIE_NAME)
  if (!token) return null
  const payload = await verify(secret, token)
  return payload?.uid ?? null
}

/** Clear the session cookie (sign-out). */
export function clearSession(c: Context<AppContext>): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' })
}
