import { Hono } from 'hono'
import type { AppContext } from '../types'
import { getDb } from '../db'
import { payments, applications, enrollments } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getStripe, isStripeConfigured } from '../lib/stripe'
import { sendEnrollmentConfirmed } from '../lib/email'
import { cohorts } from '../db/schema'

const webhookRoutes = new Hono<AppContext>()

/**
 * POST /api/webhooks/stripe — Stripe payment webhook
 *
 * Handles:
 * - checkout.session.completed → create enrollment + update payment
 */
webhookRoutes.post('/api/webhooks/stripe', async (c) => {
  if (!isStripeConfigured(c.env.STRIPE_SECRET_KEY)) {
    return c.json({ error: 'Stripe not configured' }, 503)
  }

  const body = await c.req.text()
  const sig = c.req.header('stripe-signature')

  if (!sig) {
    return c.json({ error: 'Missing stripe-signature header' }, 400)
  }

  const stripe = getStripe(c.env.STRIPE_SECRET_KEY)

  let event
  try {
    // Verify webhook signature if secret is configured
    if (c.env.STRIPE_WEBHOOK_SECRET) {
      event = await stripe.webhooks.constructEventAsync(body, sig, c.env.STRIPE_WEBHOOK_SECRET)
    } else {
      // Dev mode: parse without verification
      event = JSON.parse(body)
    }
  } catch (err: any) {
    console.error('Stripe webhook signature verification failed:', err.message)
    return c.json({ error: 'Invalid signature' }, 400)
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const applicationId = parseInt(session.metadata?.application_id || '0', 10)
    const cohortId = parseInt(session.metadata?.cohort_id || '0', 10)

    if (!applicationId || !cohortId) {
      console.error('Missing metadata in Stripe session:', session.id)
      return c.json({ received: true })
    }

    const db = getDb(c.env.DB)

    try {
      // Update or create payment record
      const existingPayment = await db.select().from(payments)
        .where(eq(payments.applicationId, applicationId))
        .get()

      if (existingPayment) {
        await db.update(payments)
          .set({
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: session.payment_intent,
            status: 'completed',
            paidAt: new Date().toISOString(),
          })
          .where(eq(payments.id, existingPayment.id))
      } else {
        await db.insert(payments).values({
          applicationId,
          cohortId,
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: session.payment_intent,
          amountCents: session.amount_total || 0,
          status: 'completed',
          paidAt: new Date().toISOString(),
        })
      }

      // Update application status to enrolled
      await db.update(applications)
        .set({ status: 'enrolled' })
        .where(eq(applications.id, applicationId))

      // If the applicant has a user account, create enrollment.
      // UNIQUE(user_id, cohort_id) makes the insert idempotent — we
      // catch the constraint violation if /payment/success already ran.
      const app = await db.select().from(applications).where(eq(applications.id, applicationId)).get()
      if (app?.userId) {
        try {
          await db.insert(enrollments).values({
            userId: app.userId,
            cohortId,
            status: 'active',
          })
        } catch (e) {
          // Enrollment already exists from the success-page path. Expected.
        }

        // Link payment to user
        await db.update(payments)
          .set({ userId: app.userId })
          .where(eq(payments.applicationId, applicationId))
      }

      // Send enrollment confirmation email (reuse `app` from above)
      const cohort = await db.select().from(cohorts).where(eq(cohorts.id, cohortId)).get()
      const appForEmail = app || await db.select().from(applications).where(eq(applications.id, applicationId)).get()
      if (appForEmail && cohort) {
        // If app.userId is set, the user has a linked Clerk account and
        // the dashboard CTA makes sense. Otherwise they need to sign up
        // first, which the default CTA covers.
        const hasAccount = !!appForEmail.userId
        c.executionCtx.waitUntil(
          sendEnrollmentConfirmed(c.env, appForEmail.email, appForEmail.name, cohort.title, hasAccount)
        )
      }

      console.log(`Payment completed for application ${applicationId}, cohort ${cohortId}`)
    } catch (err) {
      console.error('Error processing Stripe webhook:', err)
      return c.json({ error: 'Processing error' }, 500)
    }
  }

  return c.json({ received: true })
})

export default webhookRoutes
