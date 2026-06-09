// Passwordless magic-link auth (Clerk replacement).
//
//   GET  /sign-in, /sign-up  → email-input form (find-or-create; same flow)
//   POST /auth/magic         → mint token, email link, show "check your email"
//   GET  /auth/verify?token= → consume token, find-or-create user, set session
//   GET  /sign-out           → clear session cookie
//
// No passwords, no third-party identity provider. The signed session cookie
// (src/lib/session.ts) is the only credential; the magic token (single-use,
// 20-min TTL, hashed in D1) is how you get one.

import { Hono } from 'hono'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { findOrCreateUser } from '../lib/auth'
import { createMagicToken, consumeMagicToken } from '../lib/magic-link'
import { setSession, clearSession } from '../lib/session'
import { sendMagicLink, isEmailConfigured } from '../lib/email'
import type { AppContext } from '../types'

const auth = new Hono<AppContext>()

/** Only allow same-site relative redirects (no open-redirect, no //host). */
function safeRedirect(raw: string | undefined | null): string {
  if (!raw) return '/dashboard'
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard'
}

function emailRequestPage(opts: {
  mode: 'sign-in' | 'sign-up'
  redirectUrl: string
  error?: string
}) {
  const { mode, redirectUrl, error } = opts
  const isSignUp = mode === 'sign-up'
  const errorMessages: Record<string, string> = {
    missing_email: 'Please enter your email address.',
    invalid_email: 'That email doesn\'t look right — give it another go.',
    server_error: 'Something went wrong on our end. Please try again.',
  }
  return (
    <Layout title={isSignUp ? 'Create your account' : 'Sign in'} user={null}>
      <div class="page-section" style="max-width: 460px; margin: 0 auto; padding: 3rem 0;">
        <p class="section-label">{isSignUp ? 'Create account' : 'Sign in'}</p>
        <h2>{isSignUp ? 'Create your account' : 'Welcome back'}</h2>
        <p class="lead">
          {isSignUp
            ? 'Enter your email and we\'ll send you a link to finish setting up — no password to remember.'
            : 'Enter your email and we\'ll send you a sign-in link. No password needed.'}
        </p>

        {error && errorMessages[error] && (
          <div class="form-error" style="margin-top: 1rem;">{errorMessages[error]}</div>
        )}

        <form method="post" action="/auth/magic" class="apply-form" style="margin-top: 1.5rem;">
          <input type="hidden" name="redirect_url" value={redirectUrl} />
          <input type="hidden" name="mode" value={mode} />
          {isSignUp && (
            <div class="form-group">
              <label for="name">Your name <span style="color: var(--text-tertiary); font-weight: 400;">(optional)</span></label>
              <input type="text" id="name" name="name" autocomplete="name" />
            </div>
          )}
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required autocomplete="email" placeholder="you@example.com" />
          </div>
          <button type="submit" class="apply-btn">Email me a link &rarr;</button>
        </form>

        <p style="margin-top: 1.5rem; font-size: 0.9rem; color: var(--text-secondary);">
          {isSignUp ? (
            <>Already have an account? <a href={`/sign-in${redirectUrl !== '/dashboard' ? `?redirect_url=${encodeURIComponent(redirectUrl)}` : ''}`} style="color: var(--accent);">Sign in</a></>
          ) : (
            <>New here? <a href={`/sign-up${redirectUrl !== '/dashboard' ? `?redirect_url=${encodeURIComponent(redirectUrl)}` : ''}`} style="color: var(--accent);">Create an account</a></>
          )}
        </p>
      </div>
    </Layout>
  )
}

// ===== SIGN-IN / SIGN-UP (same magic-link flow) =====
auth.get('/sign-in', (c) => {
  const user = c.get('user')
  if (user) return c.redirect(safeRedirect(c.req.query('redirect_url')))
  return c.html(emailRequestPage({ mode: 'sign-in', redirectUrl: safeRedirect(c.req.query('redirect_url')), error: c.req.query('error') }))
})

auth.get('/sign-up', (c) => {
  const user = c.get('user')
  if (user) return c.redirect(safeRedirect(c.req.query('redirect_url')))
  return c.html(emailRequestPage({ mode: 'sign-up', redirectUrl: safeRedirect(c.req.query('redirect_url')), error: c.req.query('error') }))
})

// ===== REQUEST A MAGIC LINK =====
auth.post('/auth/magic', async (c) => {
  const body = await c.req.parseBody()
  const email = String(body.email || '').trim().toLowerCase()
  const name = String(body.name || '').trim() || null
  const mode = String(body.mode || 'sign-in') === 'sign-up' ? 'sign-up' : 'sign-in'
  const redirectUrl = safeRedirect(String(body.redirect_url || ''))

  const back = (err: string) => c.redirect(`/${mode === 'sign-up' ? 'sign-up' : 'sign-in'}?error=${err}${redirectUrl !== '/dashboard' ? `&redirect_url=${encodeURIComponent(redirectUrl)}` : ''}`)

  if (!email) return back('missing_email')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return back('invalid_email')

  // Magic-link email IS the credential delivery for the only auth path, so a
  // broken email config must surface as a visible error — never a silent
  // "check your email" dead-end where no link ever arrives.
  if (!isEmailConfigured(c.env.EMAIL)) {
    console.error('magic link request: EMAIL binding not configured')
    return back('server_error')
  }

  try {
    const db = getDb(c.env.DB)
    const token = await createMagicToken(db, { email, name, redirectTo: redirectUrl })
    const origin = new URL(c.req.url).origin
    const link = `${origin}/auth/verify?token=${encodeURIComponent(token)}`
    // Await the send and check the result. This does NOT leak account
    // existence (a token + email is minted for any address, account or not),
    // but it does turn a failed send into a visible "try again" instead of a
    // lie. createMagicToken already ran, so a failed send just leaves an
    // unused token that expires harmlessly in 20 minutes.
    const result = await sendMagicLink(c.env, email, link)
    if (!result.success) {
      console.error('magic link send failed:', result.error)
      return back('server_error')
    }
  } catch (e) {
    console.error('magic link request failed:', e)
    return back('server_error')
  }

  return c.html(
    <Layout title="Check your email" user={null}>
      <div class="page-section success-message" style="max-width: 520px; margin: 0 auto;">
        <div style="font-size: 2.5rem; margin-bottom: 1rem;">📬</div>
        <h2>Check your email</h2>
        <p class="lead" style="margin-top: 1rem;">
          We sent a sign-in link to <strong>{email}</strong>. Click it and you're in &mdash; the link works once and expires in 20 minutes.
        </p>
        <p style="margin-top: 1.5rem; color: var(--text-secondary); font-size: 0.9rem;">
          Didn't get it? Check spam, or <a href={`/${mode === 'sign-up' ? 'sign-up' : 'sign-in'}`} style="color: var(--accent);">try again</a>.
        </p>
      </div>
    </Layout>
  )
})

// ===== VERIFY A MAGIC LINK =====
auth.get('/auth/verify', async (c) => {
  const token = c.req.query('token') || ''
  const db = getDb(c.env.DB)

  // Guard the session secret BEFORE consuming the token — otherwise a missing
  // SESSION_SECRET burns the single-use token on a 500 and the user can't even
  // retry with the same link. Check first so the token survives.
  if (!c.env.SESSION_SECRET) {
    console.error('/auth/verify: SESSION_SECRET not configured — cannot issue session')
    return c.redirect('/sign-in?error=server_error')
  }

  const data = await consumeMagicToken(db, token)
  if (!data) {
    return c.html(
      <Layout title="Link expired" user={null}>
        <div class="page-section" style="max-width: 480px; margin: 0 auto; text-align: center; padding: 5rem 0;">
          <h2>This link is no longer valid</h2>
          <p style="margin-top: 1rem; color: var(--text-secondary);">
            Magic links work once and expire after 20 minutes. Request a fresh one and you'll be right in.
          </p>
          <a href="/sign-in" style="margin-top: 1.5rem; display: inline-block; background: var(--accent); color: white; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 500;">
            Email me a new link &rarr;
          </a>
        </div>
      </Layout>,
      410,
    )
  }

  // Find or create the account, then issue the session cookie.
  const { user } = await findOrCreateUser(db, c.env, { email: data.email, name: data.name })
  await setSession(c, user.id)

  return c.redirect(safeRedirect(data.redirectTo))
})

// ===== SIGN-OUT =====
auth.get('/sign-out', (c) => {
  clearSession(c)
  return c.redirect('/')
})

export default auth
