import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { applications, cohorts, payments, enrollments, users } from '../db/schema'
import { enrollUserAndNotify } from '../lib/enrollment'
import { getStripe, isStripeConfigured, getApplicationAmount, formatCents } from '../lib/stripe'
import { timingSafeEqual } from '../lib/auth'
import type { AppContext } from '../types'

const payment = new Hono<AppContext>()

// ===== CHECKOUT: Create Stripe session and redirect =====
// Anyone with an approved application can access this (no auth required — they might not have an account yet)
payment.get('/payment/checkout/:applicationId', async (c) => {
  const user = c.get('user')
  const db = getDb(c.env.DB)
  const applicationId = parseInt(c.req.param('applicationId'), 10)

  if (!isStripeConfigured(c.env.STRIPE_SECRET_KEY)) {
    return c.html(
      <Layout title="Payment" user={user}>
        <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 6rem 0;">
          <h2>Payment Not Available</h2>
          <p style="margin-top: 1rem; color: var(--text-secondary);">
            Payment processing is being set up. Please check back soon or contact us directly.
          </p>
          <a href="/" style="margin-top: 2rem; display: inline-block; color: var(--accent);">← Back to Home</a>
        </div>
      </Layout>
    )
  }

  // Get the application
  const app = await db.select().from(applications).where(eq(applications.id, applicationId)).get()

  if (!app) {
    return c.html(
      <Layout title="Not Found" user={user}>
        <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 6rem 0;">
          <h2>Application Not Found</h2>
          <p style="margin-top: 1rem; color: var(--text-secondary);">
            We couldn't find this application. Please check the link and try again.
          </p>
          <a href="/" style="margin-top: 2rem; display: inline-block; color: var(--accent);">← Back to Home</a>
        </div>
      </Layout>,
      404
    )
  }

  // Gate access — either the ?t= query param matches the application's
  // token (link from approval email), or the current session user is
  // the owner (clicked from their dashboard / apply status). Prevents
  // strangers from initiating Stripe sessions by guessing sequential ids.
  const providedToken = c.req.query('t') || ''
  const hasValidToken =
    app.paymentToken != null && providedToken !== '' &&
    timingSafeEqual(providedToken, app.paymentToken)
  const isOwner =
    user != null &&
    (app.userId === user.id || app.email.toLowerCase() === user.email.toLowerCase())
  if (!hasValidToken && !isOwner) {
    return c.html(
      <Layout title="Access Denied" user={user}>
        <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 6rem 0;">
          <h2>Access Denied</h2>
          <p style="margin-top: 1rem; color: var(--text-secondary);">
            This payment link is invalid or has expired. Use the link from your approval email, or <a href="/dashboard" style="color: var(--accent);">sign in to your dashboard</a> to find it.
          </p>
        </div>
      </Layout>,
      403
    )
  }

  // Must be approved
  if (app.status !== 'approved') {
    return c.html(
      <Layout title="Payment" user={user}>
        <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 6rem 0;">
          <h2>Application Not Ready</h2>
          <p style="margin-top: 1rem; color: var(--text-secondary);">
            {app.status === 'pending'
              ? "Your application is still under review. We'll let you know when it's approved."
              : "This application is not eligible for payment."}
          </p>
          <a href="/dashboard" style="margin-top: 2rem; display: inline-block; color: var(--accent);">Go to your dashboard →</a>
        </div>
      </Layout>
    )
  }

  // Check for existing completed payment
  const existingPayment = await db.select().from(payments)
    .where(
      and(
        eq(payments.applicationId, applicationId),
        eq(payments.status, 'completed')
      )
    )
    .get()

  if (existingPayment) {
    return c.html(
      <Layout title="Already Paid" user={user}>
        <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 6rem 0;">
          <h2>Payment Already Completed</h2>
          <p style="margin-top: 1rem; color: var(--text-secondary);">
            Your payment has already been processed. You should have access to the cohort.
          </p>
          <a href="/dashboard" style="margin-top: 2rem; display: inline-block; color: var(--accent);">Go to Dashboard →</a>
        </div>
      </Layout>
    )
  }

  // Get cohort info for the checkout session
  const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, app.cohortSlug)).get()

  if (!cohort) {
    return c.html(
      <Layout title="Error" user={user}>
        <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 6rem 0;">
          <h2>Cohort Not Found</h2>
          <p style="margin-top: 1rem; color: var(--text-secondary);">The cohort for this application could not be found.</p>
        </div>
      </Layout>,
      500
    )
  }

  const amountCents = getApplicationAmount(app)

  // Sponsored applicants ($0) — skip Stripe, auto-enroll
  if (amountCents === 0) {
    // Refuse to enroll someone other than the application's owner.
    // Previously this enrolled whichever user was logged in, which
    // meant admins clicking a sponsored link would enroll themselves.
    if (user && user.email.toLowerCase() === app.email.toLowerCase()) {
      // Idempotent enroll + welcome email via the shared helper.
      await enrollUserAndNotify(db, c.env, {
        userId: user.id,
        applicationId: app.id,
        cohortId: cohort.id,
      })
      // Record the $0 payment for completeness (idempotent guard via
      // applicationId — most paths only ever insert once).
      const existingPayment = await db.select().from(payments)
        .where(eq(payments.applicationId, app.id)).get()
      if (!existingPayment) {
        await db.insert(payments).values({
          userId: user.id,
          applicationId: app.id,
          cohortId: cohort.id,
          amountCents: 0,
          status: 'completed',
          paidAt: new Date().toISOString(),
        })
      }
      return c.redirect('/payment/success?sponsored=true')
    }

    // Either signed-out, or signed in as someone else (e.g. admin).
    // Tell them to sign in/up with the application's email — the
    // autoEnrollOnSignup hook in findOrCreateUser will then enroll them.
    return c.html(
      <Layout title="Complete Your Enrollment" user={user}>
        <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 4rem 0;">
          <p class="section-label">Sponsored</p>
          <h2>You're In!</h2>
          <p class="lead" style="margin-top: 1rem;">
            Your spot in {cohort.title} has been sponsored — no payment needed.
          </p>
          {user && user.email.toLowerCase() !== app.email.toLowerCase() ? (
            <>
              <p style="margin-top: 1.5rem; color: var(--text-secondary);">
                You're signed in as <strong>{user.email}</strong>, but this enrollment is for <strong>{app.email}</strong>.
                Sign out and sign back in (or create an account) using <strong>{app.email}</strong> to complete enrollment.
              </p>
              <div style="margin-top: 1.5rem; display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
                <a href="/sign-out" style="display: inline-block; border: 1px solid var(--border); padding: 0.85rem 1.5rem; border-radius: 8px; text-decoration: none; color: var(--text); font-weight: 500;">
                  Sign Out
                </a>
                <a href="/sign-up" style="display: inline-block; background: var(--accent); color: white; padding: 0.85rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600;">
                  Create Account →
                </a>
              </div>
            </>
          ) : (
            <>
              <p style="margin-top: 1.5rem; color: var(--text-secondary);">
                Create an account using <strong>{app.email}</strong> — your enrollment will link automatically.
              </p>
              <a href="/sign-up" style="display: inline-block; margin-top: 1.5rem; background: var(--accent); color: white; padding: 0.85rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600;">
                Create Account →
              </a>
            </>
          )}
        </div>
      </Layout>
    )
  }

  // Create Stripe checkout session
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY)
  const baseUrl = new URL(c.req.url).origin

  try {
    // Reuse a recent pending session if one exists (handles double-click
    // and back-button retries without spawning duplicate Stripe sessions).
    const existingPending = await db.select().from(payments)
      .where(
        and(
          eq(payments.applicationId, app.id),
          eq(payments.status, 'pending')
        )
      )
      .get()

    if (existingPending?.stripeCheckoutSessionId) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(
          existingPending.stripeCheckoutSessionId
        )
        const notExpired = existingSession.expires_at * 1000 > Date.now()
        const stillOpen = existingSession.status === 'open' && existingSession.url
        // Only reuse if the session's amount still matches the current
        // application amount. If admin changed pricing mid-flight, the
        // old session is stale — expire it and create a fresh one.
        const amountMatches = existingSession.amount_total === amountCents
        if (notExpired && stillOpen && amountMatches) {
          return c.redirect(existingSession.url!)
        }
        if (stillOpen && !amountMatches) {
          // Best-effort: tell Stripe to close the stale session so the
          // applicant can't accidentally pay the old amount via a stored link.
          try {
            await stripe.checkout.sessions.expire(existingPending.stripeCheckoutSessionId)
          } catch (expireErr) {
            console.error('[Payment] Could not expire stale session:', expireErr)
          }
        }
      } catch (e) {
        console.error('[Payment] Could not retrieve existing session, creating new one:', e)
      }
    }

    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: app.email,
      allow_promotion_codes: true,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: cohort.title, description: `Learn Vibe Build enrollment — ${cohort.title}` },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      metadata: {
        application_id: String(app.id),
        cohort_id: String(cohort.id),
        applicant_name: app.name,
      },
      success_url: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/payment/cancelled?application_id=${app.id}`,
    })

    // Upsert the pending payment row — one per application at a time.
    if (existingPending) {
      await db.update(payments)
        .set({ stripeCheckoutSessionId: stripeSession.id, amountCents })
        .where(eq(payments.id, existingPending.id))
    } else {
      await db.insert(payments).values({
        userId: user?.id ?? null,
        applicationId: app.id,
        cohortId: cohort.id,
        stripeCheckoutSessionId: stripeSession.id,
        amountCents,
        status: 'pending',
      })
    }

    return c.redirect(stripeSession.url!)
  } catch (error) {
    console.error('Stripe checkout error:', error)
    return c.html(
      <Layout title="Payment Error" user={user}>
        <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 6rem 0;">
          <h2>Payment Error</h2>
          <p style="margin-top: 1rem; color: var(--text-secondary);">
            Something went wrong creating the payment session. Please try again or contact us.
          </p>
          <a href={`/payment/checkout/${applicationId}${app.paymentToken ? `?t=${app.paymentToken}` : ''}`} style="display: inline-block; margin-top: 1.5rem; background: var(--accent); color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; font-weight: 500;">
            Try Again
          </a>
        </div>
      </Layout>,
      500
    )
  }
})

// ===== PAYMENT SUCCESS =====
payment.get('/payment/success', async (c) => {
  const user = c.get('user')
  const sessionId = c.req.query('session_id')
  const sponsored = c.req.query('sponsored')

  if (sponsored === 'true') {
    return c.html(
      <Layout title="Welcome!" user={user}>
        <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 4rem 0;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🎉</div>
          <h2>You're enrolled!</h2>
          <p class="lead" style="margin-top: 1rem;">
            Your sponsored spot is confirmed. Welcome to Learn Vibe Build.
          </p>
          <a href="/dashboard" style="display: inline-block; margin-top: 2rem; background: var(--accent); color: white; padding: 0.85rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Go to Dashboard →
          </a>
        </div>
      </Layout>
    )
  }

  // Verify the Stripe session if we have a session ID.
  // Any failure here is visible to the user — we don't silently claim
  // success. Stripe webhooks are the authoritative path for enrollment;
  // this handler is a best-effort confirmation for the in-browser flow.
  let verificationFailed = false
  let verifiedPaid = false

  if (sessionId && isStripeConfigured(c.env.STRIPE_SECRET_KEY)) {
    try {
      const stripe = getStripe(c.env.STRIPE_SECRET_KEY)
      const session = await stripe.checkout.sessions.retrieve(sessionId)

      if (session.payment_status === 'paid') {
        verifiedPaid = true
        const db = getDb(c.env.DB)
        const applicationId = parseInt(session.metadata?.application_id || '0', 10)
        const cohortId = parseInt(session.metadata?.cohort_id || '0', 10)

        await db.update(payments)
          .set({
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: session.payment_intent as string,
            status: 'completed',
            paidAt: new Date().toISOString(),
          })
          .where(eq(payments.applicationId, applicationId))

        if (applicationId) {
          await db.update(applications)
            .set({ status: 'enrolled' })
            .where(eq(applications.id, applicationId))
        }

        if (user && cohortId) {
          // UNIQUE(user_id, cohort_id) on enrollments means a duplicate
          // insert (e.g. webhook raced us) raises. We catch and ignore.
          try {
            await db.insert(enrollments).values({
              userId: user.id,
              cohortId,
              status: 'active',
            })
          } catch (e) {
            // Enrollment already exists — that's the success state, not a failure.
          }

          await db.update(payments)
            .set({ userId: user.id })
            .where(eq(payments.stripeCheckoutSessionId, session.id))
        }
      }
    } catch (error) {
      console.error('[Payment] Error verifying session:', error)
      verificationFailed = true
    }
  }

  // If we failed to verify, show a pending/processing state — not a
  // green checkmark. The webhook will reconcile in the background.
  if (verificationFailed || (sessionId && !verifiedPaid)) {
    return c.html(
      <Layout title="Processing Payment" user={user}>
        <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 4rem 0;">
          <h2>Processing your payment…</h2>
          <p class="lead" style="margin-top: 1rem;">
            We received your payment but are still confirming with Stripe. You'll get an enrollment email within a few minutes. Refresh this page in a bit, or check your <a href="/dashboard" style="color: var(--accent);">dashboard</a>.
          </p>
          <p style="margin-top: 1.5rem; color: var(--text-tertiary); font-size: 0.9rem;">
            Still seeing this after 10 minutes? Email ag@unforced.dev.
          </p>
        </div>
      </Layout>
    )
  }

  return c.html(
    <Layout title="Payment Successful" user={user}>
      <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 4rem 0;">
        <div style="font-size: 3rem; margin-bottom: 1rem;">🎉</div>
        <h2>Payment successful!</h2>
        <p class="lead" style="margin-top: 1rem;">
          Welcome to Learn Vibe Build. Your enrollment is confirmed.
        </p>
        <p style="margin-top: 1.5rem; color: var(--text-secondary);">
          {user
            ? "Head to your dashboard to see your cohort."
            : "Create your account to access your cohort content."}
        </p>
        <a href={user ? "/dashboard" : "/sign-up"} style="display: inline-block; margin-top: 1.5rem; background: var(--accent); color: white; padding: 0.85rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600;">
          {user ? "Go to Dashboard →" : "Create Account →"}
        </a>
      </div>
    </Layout>
  )
})

// ===== PAYMENT CANCELLED =====
payment.get('/payment/cancelled', async (c) => {
  const user = c.get('user')
  const applicationIdRaw = c.req.query('application_id')
  const applicationId = applicationIdRaw ? parseInt(applicationIdRaw, 10) : null

  // Re-fetch the token so the Try Again link stays authorized.
  let retryUrl: string | null = null
  if (applicationId) {
    const db = getDb(c.env.DB)
    const app = await db.select({ paymentToken: applications.paymentToken })
      .from(applications).where(eq(applications.id, applicationId)).get()
    retryUrl = `/payment/checkout/${applicationId}${app?.paymentToken ? `?t=${app.paymentToken}` : ''}`
  }

  return c.html(
    <Layout title="Payment Cancelled" user={user}>
      <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 4rem 0;">
        <h2>Payment Cancelled</h2>
        <p class="lead" style="margin-top: 1rem;">
          No worries — your application is still approved. You can complete payment whenever you're ready.
        </p>
        {retryUrl && (
          <a href={retryUrl} style="display: inline-block; margin-top: 2rem; background: var(--accent); color: white; padding: 0.85rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Try Again →
          </a>
        )}
        <p style="margin-top: 1.5rem;">
          <a href="/" style="color: var(--text-secondary);">← Back to Home</a>
        </p>
      </div>
    </Layout>
  )
})

export default payment
