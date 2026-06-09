import { Hono } from 'hono'
import { desc } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { feedback, cohorts } from '../db/schema'
import type { AppContext } from '../types'

const feedbackRoutes = new Hono<AppContext>()

// ===== FEEDBACK FORM =====
feedbackRoutes.get('/feedback', async (c) => {
  const user = c.get('user')
  const submitted = c.req.query('submitted')

  if (submitted === 'true') {
    return c.html(
      <Layout title="Thank You" user={user}>
        <div class="page-section success-message">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🙏</div>
          <h2>Thank you for your feedback</h2>
          <p class="lead" style="margin-top: 1rem;">
            Your feedback helps us make Learn Vibe Build better for everyone.
          </p>
          <p style="margin-top: 1.5rem; color: var(--text-secondary);">
            If you gave us permission to share your testimonial, we'll feature it on the site exactly as you specified.
          </p>
          <p style="margin-top: 2rem;">
            <a href="/">← Back to homepage</a>
          </p>
        </div>
      </Layout>
    )
  }

  // Sign-in required. Everyone we'd want feedback from has an account, and
  // gating it links feedback to the person + lets us pre-fill identity and
  // cohort. Signed-out visitors get a sign-in gate instead of the form.
  if (!user) {
    return c.html(
      <Layout
        title="Share Your Feedback — sign in"
        description="Sign in to share your Learn Vibe Build feedback."
        user={null}
       
      >
        <div class="page-section" style="max-width: 560px; margin: 0 auto;">
          <p class="section-label">Feedback</p>
          <h2>Sign in to share your feedback</h2>
          <p class="lead">
            We ask you to sign in so your feedback links to your account &mdash; no re-typing who you are, and we know which cohort you're speaking from.
          </p>
          <div style="margin-top: 1.5rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
            <a href="/sign-in?redirect_url=/feedback" style="display: inline-flex; align-items: center; gap: 0.4rem; background: var(--accent); color: white; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 500;">
              Sign in &rarr;
            </a>
            <a href="/sign-up?redirect_url=/feedback" style="color: var(--text-secondary); text-decoration: none; font-size: 0.95rem;">Don't have an account? Create one &rarr;</a>
          </div>
        </div>
      </Layout>
    )
  }

  const error = c.req.query('error')
  const errorMessages: Record<string, string> = {
    missing_fields: 'Please fill out at least one feedback field.',
    server_error: 'Something went wrong. Please try again.',
  }

  // Dynamic cohort list — pulled from the DB so it never goes stale as new
  // cohorts run. Newest first. Signed-in members get their own cohort
  // pre-selected via primaryCohortSlug.
  const db = getDb(c.env.DB)
  const allCohorts = await db.select({ slug: cohorts.slug, title: cohorts.title })
    .from(cohorts)
    .orderBy(desc(cohorts.startDate))
    .all()
  const preselectedCohort = user?.primaryCohortSlug ?? ''

  return c.html(
    <Layout
      title="Share Your Feedback"
      description="Tell us about your Learn Vibe Build experience. Your feedback helps us improve and inspires future builders."
      user={user}
    >
      <div class="page-section">
        <p class="section-label">Feedback</p>
        <h2>How was your experience?</h2>
        <p class="lead">
          Your feedback shapes the future of Learn Vibe Build. Tell us what worked, what didn't, and whether we can share your words with future builders.
        </p>

        {error && errorMessages[error] && (
          <div class="form-error">
            {errorMessages[error]}
          </div>
        )}

        <form method="post" action="/api/feedback" class="apply-form">
          {/* Identity comes from the session — the POST handler uses
              session name/email/userId, not the form. */}
          <div style="margin-bottom: 1.5rem; padding: 0.85rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem;">
            <span style="font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase; color: var(--text-tertiary); letter-spacing: 0.05em; margin-right: 0.5rem;">From</span>
            <strong>{user.name || user.email}</strong>
            {user.name && <span style="color: var(--text-tertiary); margin-left: 0.4rem; font-family: var(--font-mono); font-size: 0.85rem;">&lt;{user.email}&gt;</span>}
          </div>

          <div class="form-group">
            <label for="cohort">Which cohort were you in?</label>
            <select id="cohort" name="cohort_slug">
              {allCohorts.map(co => (
                <option value={co.slug} selected={co.slug === preselectedCohort}>{co.title}</option>
              ))}
              <option value="cohort-0" selected={preselectedCohort === 'cohort-0'}>Pilot Cohort &mdash; Foundations</option>
              <option value="other" selected={!preselectedCohort}>Other / just attended an event</option>
            </select>
          </div>

          <div class="form-group">
            <label>Overall rating</label>
            <div style="display: flex; gap: 1.25rem; margin-top: 0.25rem;">
              <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 1rem; color: var(--text-secondary); text-transform: none; font-family: var(--font-body); letter-spacing: normal;">
                <input type="radio" name="rating" value="1" />
                1
              </label>
              <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 1rem; color: var(--text-secondary); text-transform: none; font-family: var(--font-body); letter-spacing: normal;">
                <input type="radio" name="rating" value="2" />
                2
              </label>
              <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 1rem; color: var(--text-secondary); text-transform: none; font-family: var(--font-body); letter-spacing: normal;">
                <input type="radio" name="rating" value="3" />
                3
              </label>
              <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 1rem; color: var(--text-secondary); text-transform: none; font-family: var(--font-body); letter-spacing: normal;">
                <input type="radio" name="rating" value="4" />
                4
              </label>
              <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 1rem; color: var(--text-secondary); text-transform: none; font-family: var(--font-body); letter-spacing: normal;">
                <input type="radio" name="rating" value="5" />
                5
              </label>
            </div>
            <span style="font-size: 0.8rem; color: var(--text-tertiary); margin-top: 0.5rem; display: block;">1 = needs work, 5 = amazing</span>
          </div>

          <div class="form-group">
            <label for="highlight">What was the best part?</label>
            <textarea
              id="highlight"
              name="highlight"
              rows={4}
              placeholder="A specific moment, lesson, connection, or realization..."
            ></textarea>
          </div>

          <div class="form-group">
            <label for="testimonial">In a sentence or two, how would you describe LVB to a friend?</label>
            <textarea
              id="testimonial"
              name="testimonial"
              rows={3}
              placeholder="This is the part we might quote (with your permission) — be as honest as you like."
            ></textarea>
          </div>

          <div class="form-group">
            <label for="improvement">What could be better?</label>
            <textarea
              id="improvement"
              name="improvement"
              rows={4}
              placeholder="Anything — content, pacing, format, communication, tools..."
            ></textarea>
          </div>

          <div class="form-group" style="margin-top: 1.5rem;">
            <label style="margin-bottom: 0.75rem;">Can we share your testimonial?</label>
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
              <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; text-transform: none; font-family: var(--font-body); font-size: 0.95rem; color: var(--text-secondary); letter-spacing: normal;">
                <input type="radio" name="can_feature" value="0" checked style="margin-top: 0.2rem;" />
                <span>Keep it private — just for internal feedback</span>
              </label>
              <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; text-transform: none; font-family: var(--font-body); font-size: 0.95rem; color: var(--text-secondary); letter-spacing: normal;">
                <input type="radio" name="can_feature" value="2" style="margin-top: 0.2rem;" />
                <span>Yes, you can feature it anonymously</span>
              </label>
              <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; text-transform: none; font-family: var(--font-body); font-size: 0.95rem; color: var(--text-secondary); letter-spacing: normal;">
                <input type="radio" name="can_feature" value="3" style="margin-top: 0.2rem;" />
                <span>Yes, with my first name</span>
              </label>
              <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; text-transform: none; font-family: var(--font-body); font-size: 0.95rem; color: var(--text-secondary); letter-spacing: normal;">
                <input type="radio" name="can_feature" value="1" style="margin-top: 0.2rem;" />
                <span>Yes, with my full name and a link to my work</span>
              </label>
            </div>

          <div class="form-group" style="margin-top: 1rem;">
            <label for="website">Your website or project URL <span style="text-transform: none; font-weight: 300; letter-spacing: normal;">(optional — we'll link your testimonial here)</span></label>
            <input type="url" id="website" name="website" placeholder="https://yourproject.com" />
          </div>
          </div>

          <button type="submit" class="apply-btn">Submit Feedback</button>
        </form>
      </div>
    </Layout>
  )
})

export default feedbackRoutes
