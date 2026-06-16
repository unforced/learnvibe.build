import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { cohorts } from '../db/schema'
import { getCohortCapacity, getCapacityLabel } from '../lib/access'
import type { AppContext } from '../types'

const home = new Hono<AppContext>()

const ArrowSvg = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
)

const SmallArrowSvg = () => (
  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
)

// Compute "what week are we in" for a cohort by comparing today to its
// startDate. Week 1 starts on day 0; week N starts on day (N-1)*7. Returns
// null when the cohort has no startDate (or it parses as invalid) so the
// caller can fall back gracefully.
type CohortPhase = 'upcoming' | 'inflight' | 'completed'
type CohortProgress = { phase: CohortPhase; currentWeek: number; totalWeeks: number }

function computeCohortProgress(cohort: { startDate: string | null; weeks: number }): CohortProgress | null {
  if (!cohort.startDate) return null
  const start = new Date(cohort.startDate + 'T00:00:00')
  if (isNaN(start.getTime())) return null
  const dayMs = 1000 * 60 * 60 * 24
  const daysSince = (Date.now() - start.getTime()) / dayMs
  const totalWeeks = cohort.weeks
  if (daysSince < 0) return { phase: 'upcoming', currentWeek: 0, totalWeeks }
  // A cohort is "complete" the day after its last class — not after the
  // full N×7 days have elapsed. Last class is at day (totalWeeks - 1) * 7.
  const lastClassDay = (totalWeeks - 1) * 7
  if (Math.floor(daysSince) > lastClassDay) return { phase: 'completed', currentWeek: totalWeeks, totalWeeks }
  const week = Math.floor(daysSince / 7) + 1
  return { phase: 'inflight', currentWeek: week, totalWeeks }
}

home.get('/', async (c) => {
  const user = c.get('user')
  const db = getDb(c.env.DB)
  const cohort1 = await db.select().from(cohorts).where(eq(cohorts.slug, 'cohort-1')).get()
  const cohort2 = await db.select().from(cohorts).where(eq(cohorts.slug, 'cohort-2')).get()
  const cohort1Progress = cohort1 ? computeCohortProgress(cohort1) : null
  const cohort2Progress = cohort2 ? computeCohortProgress(cohort2) : null
  // Capacity for the enrolling cohort (Summer 2026) drives the spots-left
  // banner on the cohort card. Only surfaced when remaining <= 10 to avoid
  // false urgency early in enrollment.
  const cohort2Capacity = cohort2?.status === 'enrolling'
    ? await getCohortCapacity(c.env.DB, cohort2.slug)
    : null
  const cohort2CapacityLabel = getCapacityLabel(cohort2Capacity)

  // The "primary" cohort is whatever is most actionable right now —
  // an enrolling future cohort, an in-flight current one, or the most
  // recently completed one. Used to drive the hero pill + downstream
  // section copy so the page leads with whatever the visitor can act on.
  const primaryCohort = (() => {
    if (cohort2?.status === 'enrolling') return { cohort: cohort2, progress: cohort2Progress }
    if (cohort2Progress?.phase === 'inflight') return { cohort: cohort2, progress: cohort2Progress }
    if (cohort1Progress?.phase === 'inflight') return { cohort: cohort1, progress: cohort1Progress }
    if (cohort2?.status === 'upcoming') return { cohort: cohort2, progress: cohort2Progress }
    if (cohort1Progress?.phase === 'completed') return { cohort: cohort1, progress: cohort1Progress }
    return { cohort: cohort1 ?? cohort2 ?? null, progress: cohort1Progress ?? cohort2Progress }
  })()

  // Hero badge text adapts to where the primary cohort is in its run.
  const cohortStatusLabel = (() => {
    const c = primaryCohort.cohort
    const p = primaryCohort.progress
    if (!c) return 'Learn Vibe Build'
    if (c.status === 'enrolling') return `${c.title} · Enrolling`
    if (p?.phase === 'inflight') return `${c.title} · Week ${p.currentWeek} of ${p.totalWeeks}`
    if (p?.phase === 'completed') return `${c.title} · Complete`
    if (p?.phase === 'upcoming') return `${c.title} · Starts ${c.startDate ?? 'soon'}`
    return c.title
  })()

  return c.html(
    <Layout
      title="Become a builder"
      description="Three weeks, in person in Boulder. Learn to work with AI as a creative partner and ship real things on the open internet. No coding experience needed."
      user={user}
      fullWidth
    >
      {/* HERO */}
      <section class="hero">
        <h1 class="hero-title">Become a <span class="accent">builder</span>.</h1>
        <p class="hero-subtitle">Three weeks, in person in Boulder &mdash; learn to work with AI as a creative partner and ship real things on the open internet. No coding experience needed.</p>
        <p style="margin-top: 1rem; color: var(--text-tertiary); font-style: italic;">A community of practice for AI. We learn and grow together.</p>

        <div style="margin-top: 1.5rem; display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.85rem; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; font-family: var(--font-mono); font-size: 0.78rem; letter-spacing: 0.02em; color: var(--text-secondary);">
          <span style="display: inline-block; width: 0.5rem; height: 0.5rem; border-radius: 999px; background: var(--accent);"></span>
          {cohortStatusLabel}
        </div>

        {/* Auth-aware hero CTA — see #44 funnel continuity.
            Signed-in visitors see a dashboard shortcut (they're already in).
            Signed-out visitors during an enrollment window get a primary
            Apply CTA + secondary interest-list signup. When no cohort is
            enrolling, the interest list becomes the primary action. */}
        {user ? (
          <div style="margin-top: 1.5rem; max-width: 460px; margin-left: auto; margin-right: auto;">
            <p style="margin: 0 0 0.85rem 0; color: var(--text-secondary); font-size: 1rem;">
              Welcome back{user.name ? `, ${user.name.split(' ')[0]}` : ''}. You're already in.
            </p>
            <a href="/dashboard" class="hero-cta" style="margin-top: 0;">
              Go to your dashboard
              <ArrowSvg />
            </a>
          </div>
        ) : primaryCohort.cohort?.status === 'enrolling' ? (
          <div style="margin-top: 1.5rem; max-width: 540px; margin-left: auto; margin-right: auto; display: flex; flex-direction: column; gap: 0.75rem; align-items: center;">
            <a href="/enroll" class="hero-cta" style="margin-top: 0;">
              Apply for {primaryCohort.cohort.title}
              <ArrowSvg />
            </a>
            <form method="post" action="/api/interests" style="display: flex; gap: 0.5rem; align-items: stretch; width: 100%;">
              <input
                type="email"
                name="email"
                required
                autocomplete="email"
                placeholder="Or join the interest list — you@example.com"
                style="flex: 1; padding: 0.6rem 1rem; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; font-family: inherit;"
              />
              <button type="submit" style="padding: 0.6rem 1.2rem; white-space: nowrap; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; font-weight: 500; cursor: pointer;">
                Sign up
              </button>
            </form>
          </div>
        ) : (
          <form method="post" action="/api/interests" style="margin-top: 1.5rem; display: flex; gap: 0.5rem; align-items: stretch; max-width: 460px; margin-left: auto; margin-right: auto;">
            <input
              type="email"
              name="email"
              required
              autocomplete="email"
              placeholder="you@example.com"
              style="flex: 1; padding: 0.75rem 1rem; border: 1px solid var(--border); border-radius: 8px; font-size: 1rem; font-family: inherit;"
            />
            <button type="submit" class="hero-cta" style="margin-top: 0; padding: 0.75rem 1.5rem; white-space: nowrap; border: 0; cursor: pointer;">
              Join the list
              <ArrowSvg />
            </button>
          </form>
        )}
        <p class="hero-meta">Mondays &amp; Wednesdays 6&ndash;8pm MT<span class="sep">&middot;</span>3 Weeks<span class="sep">&middot;</span>Capped at 20<span class="sep">&middot;</span>$250&ndash;$750 sliding scale</p>
      </section>

      <div class="hp-divider"><hr /></div>

      {/* THE JOURNEY: LEARN / VIBE / BUILD */}
      <div class="journey-band" id="journey">
        <section class="hp-section">
          <p class="section-label">The Journey</p>
          <h2>Three weeks. Three movements. <span class="accent">Learn. Vibe. Build.</span></h2>
          <p class="lead">Six classes total, two per movement. We start with conversation and context, move into design and prototyping, then take what you've made and ship it &mdash; live on the open internet, yours to keep growing.</p>

          <div class="journey-grid">
            <div class="journey-step">
              <p class="journey-step-num">Week 1 &middot; Classes 1&ndash;2</p>
              <h3 class="journey-step-title">Learn</h3>
              <p>Conversation, context, and connectors &mdash; how to think and work with AI as a learning partner. We set up your living context document with <strong>Parachute</strong>, a personal knowledge system that gives your AI persistent memory across conversations and tools.</p>
            </div>
            <div class="journey-step">
              <p class="journey-step-num">Week 2 &middot; Classes 3&ndash;4</p>
              <h3 class="journey-step-title">Vibe</h3>
              <p>Prototype, design, experiment. The two-loop pattern &mdash; clarify what you're making, then build a real thing in Claude Design. Iteration, taste, and the practice of pushing back with specificity.</p>
            </div>
            <div class="journey-step">
              <p class="journey-step-num">Week 3 &middot; Classes 5&ndash;6</p>
              <h3 class="journey-step-title">Build</h3>
              <p>Claude Code, GitHub, hosting. From prototype to a real site at a real URL. Engineering principles for builders who don't consider themselves engineers &mdash; and demos to celebrate what you've made.</p>
            </div>
          </div>

          <p style="margin-top: 2rem; text-align: center; color: var(--text-secondary); font-size: 0.95rem;">
            Want the deeper breakdown? <a href="/curriculum" style="color: var(--accent);">Read the full curriculum &rarr;</a>
          </p>
        </section>
      </div>

      <div class="hp-divider"><hr /></div>

      {/* ABOUT */}
      <section class="hp-section hp-section-narrow">
        <p class="section-label">The Idea</p>
        <h2>A practice, not a tools tour</h2>
        <p class="lead">AI is moving fast. The tools change every month. What doesn't change is the shape of working well with AI &mdash; and that's what we practice, together.</p>
        <p>Think of it like Taiji: you can spend weeks on the same standing, the same movement, letting it deepen. Our course is the same. We return to the core moves &mdash; conversation, context, connection &mdash; each week, and each time you come back to them they go deeper. By the end, you have not just a set of tricks but a relationship with these tools that travels with you wherever they go next.</p>
        <p>The outcome is becoming a builder &mdash; someone who can make real things with AI. The path is a community that learns together.</p>
      </section>

      <div class="hp-divider"><hr /></div>

      {/* SUMMER 2026 (enrolling) + SPRING 2026 (just wrapped) + CU CLASS */}
      <section class="hp-section hp-section-narrow" id="cohort">
        <p class="section-label">What's happening</p>
        <h2>Summer 2026 is enrolling. Spring 2026 just wrapped.</h2>
        <p class="lead">
          Around 30 builders just spent six weeks together &mdash; websites going live, MCPs being written, automations replacing whole stacks, real things shipped for the first time. The next cohort is forming around what surfaced in that run. Apply for Summer 2026 below.
        </p>

        {/* SUMMER 2026 — the active offering, lead card */}
        <div class="cohort-card" style="border-color: var(--accent);">
          <span class="cohort-badge badge-open">{cohort2?.status === 'enrolling' ? 'Enrolling now' : (cohort2Progress?.phase === 'inflight' ? `In flight · Week ${cohort2Progress.currentWeek} of ${cohort2Progress.totalWeeks}` : 'Summer 2026')}</span>
          <h3>Summer 2026 Cohort</h3>
          <p class="cohort-detail">Mondays &amp; Wednesdays 6&ndash;8pm MT &middot; June 22 &ndash; July 8, 2026 &middot; 3 weeks &middot; In person at <a href="https://regenhub.xyz" target="_blank" style="color: inherit; text-decoration: underline;">Regen Hub</a>, Boulder &middot; capped at 20</p>
          <p>
            An accelerated, in-person intensive at the Regen Hub. Six classes across three movements &mdash; <strong>Learn, Vibe, Build</strong>. Office hours Tuesdays 1&ndash;3pm. Calls recorded, but no live online offering &mdash; this one's about being in the room together. Regen Hub co-working benefits are part of the value: discounted membership and free day passes alongside the cohort.
          </p>

          {cohort2CapacityLabel && (
            <div style={`margin-top: 1rem; padding: 0.7rem 1rem; background: ${cohort2Capacity?.isFull ? 'var(--surface)' : 'rgba(232, 97, 42, 0.08)'}; border: 1px solid ${cohort2Capacity?.isFull ? 'var(--border)' : 'var(--accent)'}; border-radius: 8px; font-size: 0.92rem; font-weight: 500; color: ${cohort2Capacity?.isFull ? 'var(--text-secondary)' : 'var(--accent)'};`}>
              ⚡ {cohort2CapacityLabel}
            </div>
          )}

          <div style="margin-top: 1.5rem; padding: 1rem 1.25rem; background: var(--surface); border-radius: 8px;">
            <p style="margin: 0 0 0.5rem; font-weight: 600; font-size: 0.95rem;">Sliding scale &mdash; pick what fits your abundance</p>
            <ul style="margin: 0; padding-left: 1.25rem; color: var(--text-secondary); line-height: 1.7; font-size: 0.92rem;">
              <li><strong>$250</strong> &mdash; for folks where this is a stretch</li>
              <li><strong>$500</strong> &mdash; suggested rate</li>
              <li><strong>$750</strong> &mdash; helps subsidize sliding-scale and scholarship spots</li>
              <li><strong>Scholarship</strong> &mdash; limited slots for demonstrated need or public-benefit / non-profit / student academic work</li>
            </ul>
          </div>

          <div style="margin-top: 1.5rem; display: flex; gap: 1rem; flex-wrap: wrap;">
            <a href="/enroll" style="padding: 0.75rem 1.5rem; background: var(--accent); color: white; border-radius: 8px; text-decoration: none; font-size: 0.95rem; font-weight: 500; display: inline-flex; align-items: center; gap: 0.4rem;">
              Apply now
              <SmallArrowSvg />
            </a>
            <a href="/curriculum" style="padding: 0.75rem 1.5rem; background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 8px; text-decoration: none; font-size: 0.95rem; font-weight: 500; display: inline-flex; align-items: center; gap: 0.4rem;">
              Read the curriculum
              <SmallArrowSvg />
            </a>
          </div>
        </div>

        {/* SPRING 2026 — historical, what just happened */}
        <div class="cohort-card" style="margin-top: 1.5rem;">
          <span class="cohort-badge" style="background: var(--surface); color: var(--text-secondary); border: 1px solid var(--border);">{cohort1Progress?.phase === 'completed' ? 'Just wrapped' : 'Cohort 1'}</span>
          <h3>Spring 2026 Cohort</h3>
          <p class="cohort-detail">Mondays 5:30&ndash;7:30pm MT &middot; April&ndash;May 2026 &middot; 6 weeks &middot; Boulder, CO &amp; Remote &middot; ~30 builders</p>
          <p>
            The first full run. Six weeks through the Six C's &mdash; Conversation, Context, Connectors, Craft, Code, Community. Real things shipped: ring sizers, LED control apps, ADHD transition tools, business automations, personal websites. Summer 2026 builds on what worked here.
          </p>

          <div class="cohort-weeks">
            <div class="cohort-week"><strong>Conversation</strong><span>Week 1</span></div>
            <div class="cohort-week"><strong>Context</strong><span>Week 2</span></div>
            <div class="cohort-week"><strong>Connectors</strong><span>Week 3</span></div>
            <div class="cohort-week"><strong>Craft</strong><span>Week 4</span></div>
            <div class="cohort-week"><strong>Code</strong><span>Week 5</span></div>
            <div class="cohort-week"><strong>Community</strong><span>Week 6</span></div>
          </div>

          {user && (
            <div style="margin-top: 1.5rem;">
              <a href="/dashboard" style="color: var(--text-secondary); font-size: 0.95rem; text-decoration: none;">Your dashboard &rarr;</a>
            </div>
          )}
        </div>

        <a href="/cu" style="display: block; margin-top: 1.5rem; padding: 1.5rem 1.75rem; background: var(--white); border: 1px solid var(--border); border-radius: 10px; text-decoration: none;">
          <p class="section-label" style="margin-bottom: 0.4rem;">At CU Boulder &middot; Fall 2026</p>
          <h3 style="font-family: var(--font-display); font-weight: 600; font-size: 1.15rem; letter-spacing: -0.01em; margin: 0 0 0.5rem; color: var(--text);">ATLS 4519 / 5519 &mdash; Learn Vibe Build</h3>
          <p style="margin: 0; color: var(--text-secondary); line-height: 1.6;">Aaron is teaching a semester-long version of this work at CU Boulder's ATLAS Institute in Fall 2026 &mdash; same lineage, longer arc. Distinct from the cohort but part of the same practice.</p>
          <p style="margin: 0.75rem 0 0; color: var(--accent); font-weight: 500; font-size: 0.9rem;">Course details &amp; how to register &rarr;</p>
        </a>

        {/* Compact lineage — the standalone section folded in here (2026-06).
            One line of provenance + one real quote beats a stats grid. */}
        <p style="margin-top: 2rem; color: var(--text-secondary); line-height: 1.7;">
          It started with a pilot &mdash; 13 builders in January 2026, real projects shipped to the internet. Spring grew it to ~30. Summer sharpens it to three weeks. Each run builds on what the last one taught us.
        </p>

        <div class="testimonial" style="margin-top: 1.25rem;">
          <blockquote>&ldquo;A challenging and mind-stretching opportunity to try out how you might want to interact with AI, our new &lsquo;cognitive appliance,&rsquo; with support from a super-knowledgeable teacher and a cohort of motivated students.&rdquo;</blockquote>
          <p class="testimonial-author">&mdash; Pilot cohort participant</p>
        </div>
      </section>

      <div class="hp-divider"><hr /></div>

      {/* REGEN HUB — ongoing community on-ramp */}
      <section class="hp-section hp-section-narrow" id="hub">
        <p class="section-label">The Hub</p>
        <h2>Come build with us at the <a href="https://regenhub.xyz" target="_blank" style="color: var(--accent); text-decoration: none;">Regen Hub</a>.</h2>
        <p class="lead">
          The cohort is the on-ramp. The Hub is where it keeps going. Boulder builders working with AI in public, every day &mdash; a co-working space, monthly AI events, and a cooperative community of makers, organizers, and creators.
        </p>

        <div style="margin-top: 2rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
          <div style="padding: 1.5rem 1.75rem; background: var(--white); border: 1px solid var(--border); border-radius: 10px;">
            <h3 style="font-family: var(--font-display); font-weight: 600; font-size: 1.1rem; margin: 0 0 0.5rem;">Try a free day pass</h3>
            <p style="margin: 0; color: var(--text-secondary); line-height: 1.6;">No cohort required &mdash; come work alongside builders for a day, see what's alive in the space.</p>
            <p style="margin-top: 0.85rem;"><a href="https://regenhub.xyz" target="_blank" style="font-size: 0.9rem; color: var(--accent); text-decoration: none;">regenhub.xyz &rarr;</a></p>
          </div>
          <div style="padding: 1.5rem 1.75rem; background: var(--white); border: 1px solid var(--border); border-radius: 10px;">
            <h3 style="font-family: var(--font-display); font-weight: 600; font-size: 1.1rem; margin: 0 0 0.5rem;">Cohort members get more</h3>
            <p style="margin: 0; color: var(--text-secondary); line-height: 1.6;">Discounted Regen Hub Cooperative membership and free co-working day passes during the cohort. The membership unlocks monthly AI events and ongoing access.</p>
          </div>
        </div>

        <style dangerouslySetInnerHTML={{ __html: `@media (max-width: 640px) { #hub > div[style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; } }` }} />
      </section>

      <div class="hp-divider"><hr /></div>

      {/* COMMUNITY */}
      <section class="hp-section hp-section-narrow">
        <p class="section-label">The Community</p>
        <h2>Shared practice, not a performance.</h2>
        <p class="lead">Whether you've been building with AI for years or have never even talked to ChatGPT, this program meets you where you are.</p>
        <p>The magic isn't just the curriculum &mdash; it's the people. You'll be learning alongside creators, thinkers, and builders from all kinds of backgrounds, sharing what you're making, getting real feedback, and being inspired by what others are building.</p>
        <p>Every week has space for an open circle &mdash; time to share creations, process, what you're noticing, what you're stuck on. Not mandatory, not a demo day. The sharing is part of the practice.</p>
        <p>And it doesn't end when the cohort does. Completing the program opens the door to ongoing membership in the Learn Vibe Build community &mdash; continued access to the people, conversations, and resources that keep the momentum going.</p>

        <div style="margin-top: 2.5rem; padding: 1.75rem; background: var(--white); border: 1px solid var(--border); border-radius: 10px;">
          <p class="section-label" style="margin-bottom: 0.5rem;">Coming Soon</p>
          <h3 style="font-family: var(--font-display); font-weight: 600; font-size: 1.15rem; letter-spacing: -0.01em; margin: 0 0 0.75rem;">The Augmented Knowledge Worker</h3>
          <p style="margin: 0; color: var(--text-secondary); line-height: 1.7;">AI for people whose work is thinking. A five-week live course for researchers, consultants, writers, strategists, and designers &mdash; co-taught by Benjamin Life and Aaron as the next step after Learn Vibe Build. Thinking clearly with AI, the iterative research loop, a second brain your AI can query, building your own tools, and shipping work that looks like you. Details soon.</p>
        </div>
      </section>

      <div class="hp-divider"><hr /></div>

      {/* WHO IT'S FOR */}
      <section class="hp-section hp-section-narrow">
        <p class="section-label">Who It's For</p>
        <h2>For people with ideas</h2>
        <p class="lead">This isn't about becoming a developer. It's about using AI to create what serves your life and work.</p>

        <div class="audience-list">
          <div class="audience-item">
            <span class="audience-role">Creators</span>
            <p>Who want a website, portfolio, or platform for their work</p>
          </div>
          <div class="audience-item">
            <span class="audience-role">Thinkers</span>
            <p>Who want to build tools for their own workflows and thinking</p>
          </div>
          <div class="audience-item">
            <span class="audience-role">Organizers</span>
            <p>Who need technology for their communities and projects</p>
          </div>
          <div class="audience-item">
            <span class="audience-role">Beginners</span>
            <p>Who've never written a line of code but have something they want to make</p>
          </div>
          <div class="audience-item">
            <span class="audience-role">Builders</span>
            <p>Who already work with AI and want to go deeper with agentic workflows</p>
          </div>
        </div>
      </section>

      <div class="hp-divider"><hr /></div>

      {/* GUIDES */}
      <section class="hp-section">
        <p class="section-label">Your Guides</p>
        <h2>Who you'll build with</h2>

        <div class="guides-grid">
          <div class="guide">
            <h3 class="guide-name">Aaron Gabriel</h3>
            <p class="guide-role">Lead Instructor</p>
            <p class="guide-bio">Founder of <a href="https://parachute.computer" target="_blank">Parachute</a>, a CU Boulder ATLAS Institute alum, founding member of <a href="https://regenhub.xyz" target="_blank">Regen Hub Cooperative</a>. Has spent the last year building with AI every day &mdash; including his own personal AI agent.</p>
          </div>
          <div class="guide">
            <h3 class="guide-name">Benjamin Life</h3>
            <p class="guide-role">Teaching Assistant &middot; Summer 2026</p>
            <p class="guide-bio">Spring 2026 alumnus, assisting this cohort. <em>(Bio coming soon.)</em></p>
          </div>
          <div class="guide">
            <h3 class="guide-name">Jon Bo</h3>
            <p class="guide-role">Teaching Assistant &middot; Spring 2026</p>
            <p class="guide-bio">3x founding engineer, builder of things, writer of words. Daily user of Claude Code. Brings deep engineering experience to help you build real things that work.</p>
          </div>
        </div>
      </section>

      <div class="hp-divider"><hr /></div>

      {/* FAQ */}
      <section class="hp-section hp-section-narrow" id="faq">
        <p class="section-label">FAQ</p>
        <h2>Common questions</h2>

        <div class="faq-list">
          <div class="faq-item">
            <h3 class="faq-q">Do I need coding experience?</h3>
            <p class="faq-a">No. The program is designed for people who have never written a line of code. The Vibe and Build movements are about making things with AI as creative partner &mdash; you provide the direction and taste, the AI does the mechanics. Code is the deeper cut for those who want to go further.</p>
          </div>
          <div class="faq-item">
            <h3 class="faq-q">What tech do I need?</h3>
            <p class="faq-a">A laptop and a Claude account. We'll walk you through everything else in the first session. Claude Pro ($20/month) is recommended for the best experience.</p>
          </div>
          <div class="faq-item">
            <h3 class="faq-q">Is it in-person or remote?</h3>
            <p class="faq-a"><strong>Summer 2026 is in-person only</strong>, at <a href="https://regenhub.xyz" style="color: var(--accent); text-decoration: none;">Regen Hub</a> in Boulder, CO. We'll record the calls for your reference, but there's no live remote option for this cohort &mdash; being in the room together is the point. Office hours Tuesday afternoons happen in person too.</p>
          </div>
          <div class="faq-item">
            <h3 class="faq-q">How much time per week?</h3>
            <p class="faq-a">Two two-hour live sessions per week (Mondays and Wednesdays 6&ndash;8pm MT), plus office hours Tuesdays 1&ndash;3pm MT. Outside class, 4&ndash;6 hours of your own time on what you're making is ideal. The work should give you time back, not take it.</p>
          </div>
          <div class="faq-item">
            <h3 class="faq-q">What will I build?</h3>
            <p class="faq-a">That's up to you. Past students have built personal websites, workflow tools, creative platforms, business automations, and small apps for their friends. By the end, you'll have something real on the open internet at a URL you own &mdash; and a practice of building with AI that travels with you.</p>
          </div>
          <div class="faq-item">
            <h3 class="faq-q">When does the next cohort start?</h3>
            <p class="faq-a">Summer 2026 runs <strong>June 22 &ndash; July 8, 2026</strong>. Six classes, Mondays and Wednesdays 6&ndash;8pm. Office hours Tuesdays 1&ndash;3pm. In person at the Regen Hub.</p>
          </div>
          <div class="faq-item">
            <h3 class="faq-q">What's the pricing?</h3>
            <p class="faq-a"><strong>Sliding scale &mdash; pick what matches your level of abundance.</strong> $250 if this feels like a stretch, $500 as the suggested rate, $750 if you'd like to help subsidize other spots. Scholarships available for demonstrated need or public-benefit / non-profit / student academic work. Cost should never be a barrier.</p>
          </div>
          <div class="faq-item">
            <h3 class="faq-q">What about the Regen Hub?</h3>
            <p class="faq-a">As a cohort member you get discounted Regen Hub Cooperative membership plus free co-working day passes during the cohort. Beyond the three weeks, there's an ongoing community at the hub &mdash; monthly AI events, co-working, fellow builders. The cohort is the on-ramp; the Hub is where it keeps going.</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section class="cta-section">
        <div class="cta-content">
          <h2>Ready to become a builder?</h2>
          <p>Summer 2026 starts <strong>June 22</strong>. Three weeks. Six classes. In person at the Regen Hub. Apply now &mdash; or drop your email and we'll keep you posted on future cohorts.</p>
          <div style="margin: 1.5rem auto 0; display: flex; gap: 0.75rem; align-items: stretch; max-width: 540px; flex-wrap: wrap; justify-content: center;">
            <a href="/enroll" class="cta-btn" style="margin: 0; padding: 0.75rem 1.5rem; white-space: nowrap; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 0.4rem;">
              Apply for Summer 2026
              <ArrowSvg />
            </a>
            <a href="/interest" style="padding: 0.75rem 1.5rem; white-space: nowrap; text-decoration: none; color: var(--text); display: inline-flex; align-items: center; gap: 0.4rem; align-self: center;">
              Or join the list &rarr;
            </a>
          </div>
          <p class="cta-aside">Questions? <a href="mailto:ag@unforced.dev">Reach out</a> &mdash; the next step is a conversation.</p>
        </div>
      </section>
    </Layout>
  )
})

export default home
