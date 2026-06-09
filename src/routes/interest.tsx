import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { interests, users } from '../db/schema'
import { sendEmail, isEmailConfigured } from '../lib/email'
import { renderEmailTemplate } from '../lib/email-templates'
import type { AppContext } from '../types'

const interest = new Hono<AppContext>()

// ===== /interest — public form =====
// Email-only by design. We used to collect name + a 4-checkbox interest
// segmentation, but the friction wasn't pulling its weight. The schema
// keeps `name` and `interests_json` columns nullable / default-empty so
// future segmentation can come back without a migration.
interest.get('/interest', (c) => {
  const user = c.get('user')
  const error = c.req.query('error')
  const errorMessages: Record<string, string> = {
    missing_email: 'An email is required.',
    invalid_email: 'That email doesn\'t look right — give it another go.',
    server_error: 'Something went wrong on our end. Please try again.',
  }
  return c.html(
    <Layout
      title="Join the interest list — Learn Vibe Build"
      description="Drop your email to hear about Learn Vibe Build cohorts and events."
      user={user}
    >
      <div class="page-section" style="max-width: 520px; margin: 0 auto;">
        <a href="/" style="font-size: 0.85rem; color: var(--text-tertiary); text-decoration: none;">&larr; Home</a>

        <p class="section-label" style="margin-top: 1.5rem;">Interest list</p>
        <h2>Stay in the loop</h2>
        <p class="lead">
          Summer 2026 is enrolling now &mdash; <a href="/enroll" style="color: var(--accent);">apply here</a>. For future cohorts and Hub events, drop your email below and we'll be in touch &mdash; thoughtful and infrequent.
        </p>

        {error && errorMessages[error] && (
          <div class="form-error" style="margin-top: 1rem;">{errorMessages[error]}</div>
        )}

        <form method="post" action="/api/interests" style="margin-top: 1.5rem; display: flex; gap: 0.5rem; align-items: stretch; flex-wrap: wrap;">
          <input
            type="email"
            id="email"
            name="email"
            required
            autocomplete="email"
            placeholder="you@example.com"
            style="flex: 1; min-width: 220px; padding: 0.75rem 1rem; border: 1px solid var(--border); border-radius: 8px; font-size: 1rem; font-family: inherit;"
          />
          <button type="submit" class="apply-btn" style="margin: 0; padding: 0.75rem 1.5rem; white-space: nowrap;">Join the list</button>
        </form>
      </div>
    </Layout>
  )
})

// ===== POST /api/interests — submit form =====
interest.post('/api/interests', async (c) => {
  const db = getDb(c.env.DB)
  const body = await c.req.parseBody()

  const email = String(body.email || '').trim().toLowerCase()
  // `name` field is no longer in the public form. We still accept it on
  // POST in case a future surface (admin-side, API, etc.) wants to pass
  // one — but we don't require or expose it. Defaults null otherwise.
  const name = String(body.name || '').trim() || null
  const referer = c.req.header('Referer') || ''
  const sourcePath = (() => {
    try { return new URL(referer).pathname || null } catch { return null }
  })()

  if (!email) return c.redirect('/interest?error=missing_email')
  if (!email.includes('@') || email.length > 254) return c.redirect('/interest?error=invalid_email')

  // Skip the confirmation email on re-submits — preserves all signal in
  // the DB (when they came back) without re-mailing them.
  const existing = await db.select().from(interests).where(eq(interests.email, email)).get()

  // Link to user if one already exists for this email (signup-then-
  // interest path). syncUser handles the inverse (interest-then-signup)
  // by linking unlinked rows when a new account is created. See #44.
  const existingUser = await db.select({ id: users.id }).from(users)
    .where(eq(users.email, email))
    .get()
  const linkedUserId = existingUser?.id ?? null

  // The interest list lives in D1 (interests table). The old Resend
  // audience mirror was retired with the Cloudflare email migration —
  // resend_contact_id stays null for new rows (column kept for history).

  try {
    await db.insert(interests).values({
      email,
      name,
      sourcePath,
      // interests_json defaults to '[]'; we no longer collect tags via the
      // public form. Schema unchanged so old rows keep their data.
      interestsJson: '[]',
      resendContactId: null,
      userId: linkedUserId,
    })
  } catch (e) {
    console.error('[interests] insert failed:', e)
    return c.redirect('/interest?error=server_error')
  }

  if (!existing && isEmailConfigured(c.env.EMAIL)) {
    try {
      const tpl = await renderEmailTemplate(c.env.DB, 'interest_received', {})
      await sendEmail({
        emailBinding: c.env.EMAIL,
        from: c.env.EMAIL_FROM,
        replyTo: c.env.EMAIL_REPLY_TO,
        to: email,
        subject: tpl.subject,
        html: tpl.html,
        db: c.env.DB,
        template: 'interest_received',
      })
    } catch (e) {
      console.error('[interests] confirmation email failed:', e)
      // Don't fail the user-facing flow — admin can resend manually
      // from /admin/emails.
    }
  }

  return c.redirect('/interest/success')
})

// ===== /interest/success =====
// Funnel continuity (#44): if the user is signed in, surface concrete
// next steps — apply (when a cohort is enrolling) and the dashboard. If
// signed out, offer a subtle "go deeper now" link to sign-up alongside
// the thank-you copy. Don't push, just leave the door open.
interest.get('/interest/success', (c) => {
  const user = c.get('user')
  return c.html(
    <Layout title="On the list — Learn Vibe Build" user={user}>
      <div class="page-section success-message" style="max-width: 600px; margin: 0 auto;">
        <h2>You're on the list</h2>
        <p class="lead">
          We'll be in touch as new cohorts and events take shape. In the meantime, feel free to <a href="mailto:ag@unforced.dev" style="color: var(--accent);">reply with whatever's alive in you</a> around AI right now — questions, ideas, things you're trying to make.
        </p>

        {user ? (
          <div style="margin-top: 2rem; padding: 1.25rem 1.5rem; background: var(--surface); border: 1px solid var(--border); border-radius: 10px;">
            <p style="margin: 0 0 0.85rem 0; font-size: 0.95rem;">
              <strong>Want to take the next step?</strong>
            </p>
            <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
              <a href="/enroll" style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.6rem 1.1rem; background: var(--accent); color: white; border-radius: 6px; text-decoration: none; font-size: 0.9rem; font-weight: 500;">
                Apply &rarr;
              </a>
              <a href="/dashboard" style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.6rem 1.1rem; background: var(--white); border: 1px solid var(--border); color: var(--text); border-radius: 6px; text-decoration: none; font-size: 0.9rem; font-weight: 500;">
                Dashboard &rarr;
              </a>
            </div>
          </div>
        ) : (
          <p style="margin-top: 1.5rem; font-size: 0.9rem; color: var(--text-secondary);">
            Want to go deeper now? <a href="/sign-up" style="color: var(--accent);">Create an account &rarr;</a>
          </p>
        )}

        <p style="margin-top: 2rem;">
          <a href="/">← Back to homepage</a>
        </p>
      </div>
    </Layout>
  )
})

export default interest
