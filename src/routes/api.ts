import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { applications, lessons, feedback, users, projects, lessonProgress, discussions, comments, apiKeys, oauthTokens, artifacts, cohorts, enrollments, memberships } from '../db/schema'
import { getDb } from '../db'
import { isAdmin, generateToken } from '../lib/auth'
import { generateApiKey, hashApiKey, getKeyPrefix } from '../lib/api-auth'
import { sendApplicationReceived } from '../lib/email'
import { TIERS_BY_COHORT, PRICING_TIERS } from '../lib/stripe'
import { getCohortCapacity } from '../lib/access'
import type { AppContext } from '../types'

const api = new Hono<AppContext>()

// ===== PUBLIC: Application submission =====
api.post('/api/applications', async (c) => {
  // Auth-required as of #25 — signup creates an applications row linked
  // to the signed-in user from the start. Anonymous submissions are
  // rejected (the GET /enroll handler routes unauthed visitors through
  // /sign-up?redirect_url=/enroll, so this is mostly a defensive guard).
  const user = c.get('user')
  if (!user) {
    return c.redirect('/sign-up?redirect_url=/enroll')
  }

  const body = await c.req.parseBody()
  const db = getDb(c.env.DB)

  const name = String(body.name || '').trim() || user.name || ''
  // Email comes from the authenticated session, NOT from the form. The
  // form doesn't even render an email input anymore (see pages.tsx). This
  // closes the "applied with one email, signed up with another" diagnostic
  // state by construction.
  const email = user.email.trim().toLowerCase()
  const background = String(body.background || '').trim()
  const projectInterest = String(body.project_interest || '').trim()
  const referralSource = String(body.referral_source || '').trim()
  const referredBy = String(body.referred_by || '').trim() || null
  // Tier model (Summer 2026+): applicant self-selects sliding_low/mid/high
  // or scholarship. Alumni tier is server-applied if we detect a prior
  // enrollment — we don't trust the form for that. For backward compat
  // with the old pay-what-you-can form, `contribution` is still accepted
  // and gets mapped onto the legacy fields.
  const pricingTierRaw = String(body.pricing_tier || '').trim()
  const scholarshipRequest = String(body.scholarship_request || '').trim() || null
  // Legacy fields — kept so older deployed forms still post cleanly
  const contribution = String(body.contribution || '').trim()
  const requestedAmountRaw = String(body.requested_amount || '').trim()
  const requestedReason = String(body.requested_reason || '').trim() || null

  // Validate required fields
  if (!name || !email || !background || !projectInterest || !referralSource) {
    return c.redirect('/enroll?error=missing_fields')
  }

  // Basic RFC-5322-adjacent check — catches "@." and common typos. Should
  // never fail since email comes from Clerk, but defensive.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.redirect('/enroll?error=invalid_email')
  }

  // Length bounds — generous but not unlimited, to prevent payload abuse.
  if (
    name.length > 200 ||
    email.length > 320 ||
    background.length > 5000 ||
    projectInterest.length > 5000 ||
    referralSource.length > 500 ||
    (referredBy && referredBy.length > 200) ||
    (scholarshipRequest && scholarshipRequest.length > 3000) ||
    (requestedReason && requestedReason.length > 2000)
  ) {
    return c.redirect('/enroll?error=too_long')
  }

  try {
    // Detect the currently-enrolling cohort. Apply form ought to have
    // guarded on this already (the /apply GET handler renders an "apps
    // closed" state when no cohort is enrolling) but defensive here.
    const enrollingCohort = await db.select({ slug: cohorts.slug, id: cohorts.id, title: cohorts.title })
      .from(cohorts)
      .where(eq(cohorts.status, 'enrolling'))
      .get()
    const cohortSlug = enrollingCohort?.slug ?? 'cohort-2'
    const cohortTitle = enrollingCohort?.title ?? 'the next cohort'

    // Check for existing application with this email — they already signed
    // up, so send them to their dashboard where status (pending / approved
    // / enrolled) and any payment link surface.
    const existing = await db.select({ id: applications.id })
      .from(applications)
      .where(eq(applications.email, email.toLowerCase()))
      .get()

    if (existing) {
      return c.redirect('/dashboard')
    }

    // Alumni detection — if this user has any prior enrollment, they may
    // pick the alumni tier on the form. Server enforces (form-claimed
    // alumni tier without prior enrollment is rejected).
    let isAlumni = false
    if (enrollingCohort) {
      const userEnrollments = await db.select({ cohortId: enrollments.cohortId })
        .from(enrollments)
        .where(eq(enrollments.userId, user.id))
        .all()
      isAlumni = userEnrollments.some(e => e.cohortId !== enrollingCohort.id)
    }

    // Resolve pricing tier. Form must post a known tier for the cohort.
    let pricingTier = 'pending'
    let requestedAmountCents: number | null = null
    let requestedAmountReason: string | null = null

    if (pricingTierRaw) {
      const allowed = TIERS_BY_COHORT[cohortSlug] ?? []
      if (!allowed.includes(pricingTierRaw)) {
        return c.redirect('/enroll?error=invalid_amount')
      }
      if (pricingTierRaw === 'alumni' && !isAlumni) {
        return c.redirect('/enroll?error=invalid_amount')
      }
      if (pricingTierRaw === 'scholarship' && !scholarshipRequest) {
        return c.redirect('/enroll?error=missing_fields')
      }
      pricingTier = pricingTierRaw
      requestedAmountCents = PRICING_TIERS[pricingTierRaw]?.amountCents ?? null
    } else if (contribution === 'pwyc') {
      // Legacy pay-what-you-can path — preserved so an older cached form
      // still submits cleanly. Maps onto the requestedAmountCents fields.
      const dollars = parseInt(requestedAmountRaw || '0', 10)
      if (Number.isNaN(dollars) || dollars < 0 || dollars > 750) {
        return c.redirect('/enroll?error=invalid_amount')
      }
      requestedAmountCents = dollars * 100
      requestedAmountReason = requestedReason
    } else if (contribution === 'full') {
      requestedAmountCents = 50000
    }

    // Branch: scholarship stays as an application (admin reviews limited
    // slots). Sliding-scale and alumni go direct — no admin review — into
    // immediate Stripe checkout. Cap enforcement only applies to the
    // direct path; scholarship 'pending' apps don't claim a seat yet.
    const isScholarship = pricingTier === 'scholarship'
    const isDirectEnrollment = pricingTier !== 'pending' && !isScholarship

    if (isDirectEnrollment && enrollingCohort) {
      const capacity = await getCohortCapacity(c.env.DB, cohortSlug)
      if (capacity.isFull) {
        return c.redirect('/enroll?error=cohort_full')
      }
    }

    // Direct enrollment path: pre-approve so the form submit lands the
    // applicant straight at Stripe checkout. paymentToken gates the
    // checkout URL so it can't be guessed.
    const paymentToken = isDirectEnrollment ? generateToken() : null
    const initialStatus = isDirectEnrollment ? 'approved' : 'pending'
    const approvedAmountCents = isDirectEnrollment ? requestedAmountCents : null
    const approvedAt = isDirectEnrollment ? new Date().toISOString() : null

    const insertResult = await db.insert(applications).values({
      name,
      email: email.toLowerCase(),
      userId: user.id,
      background,
      projectInterest,
      referralSource,
      referredBy,
      scholarshipRequest,
      cohortSlug,
      pricingTier,
      requestedAmountCents,
      requestedAmountReason,
      status: initialStatus,
      approvedAmountCents,
      approvedAt,
      paymentToken,
    }).returning({ id: applications.id })

    const applicationId = insertResult[0]?.id

    // Send confirmation email (non-blocking — don't fail the request if email fails)
    c.executionCtx.waitUntil(
      sendApplicationReceived(c.env, email, name, cohortTitle)
    )

    // Sliding-scale + alumni: straight to Stripe. Scholarship: success page
    // explaining we'll review and get back to them.
    if (isDirectEnrollment && applicationId && paymentToken) {
      return c.redirect(`/payment/checkout/${applicationId}?t=${paymentToken}`)
    }

    return c.redirect('/enroll/success')
  } catch (error) {
    console.error('Failed to save application:', error)
    return c.redirect('/enroll?error=server_error')
  }
})

// ===== ADMIN: Create lesson =====
api.post('/api/admin/lessons', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user)) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.parseBody()
  const cohortId = parseInt(String(body.cohort_id || '0'), 10)
  const weekNumber = parseInt(String(body.week_number || '0'), 10)
  const title = String(body.title || '').trim()
  const description = String(body.description || '').trim()
  const date = String(body.date || '').trim()
  const contentMarkdown = String(body.content_markdown || '')
  const status = String(body.status || 'draft')

  if (!cohortId || !weekNumber || !title) {
    return c.redirect('/admin/lessons/new?error=missing_fields')
  }

  try {
    const db = getDb(c.env.DB)
    const result = await db.insert(lessons).values({
      cohortId,
      weekNumber,
      title,
      description: description || null,
      date: date || null,
      contentMarkdown,
      status,
      sortOrder: weekNumber,
    }).returning()

    return c.redirect(`/admin/lessons/${result[0].id}/edit`)
  } catch (error) {
    console.error('Failed to create lesson:', error)
    return c.redirect('/admin/lessons/new?error=server_error')
  }
})

// ===== ADMIN: Update lesson =====
api.post('/api/admin/lessons/:id', async (c) => {
  const user = c.get('user')
  if (!isAdmin(user)) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = parseInt(c.req.param('id'), 10)
  const body = await c.req.parseBody()
  const cohortId = parseInt(String(body.cohort_id || '0'), 10)
  const weekNumber = parseInt(String(body.week_number || '0'), 10)
  const title = String(body.title || '').trim()
  const description = String(body.description || '').trim()
  const date = String(body.date || '').trim()
  const contentMarkdown = String(body.content_markdown || '')
  const recordingUrlRaw = String(body.recording_url || '').trim()
  const transcriptMarkdown = String(body.transcript_markdown || '').trim()
  const status = String(body.status || 'draft')

  if (!cohortId || !weekNumber || !title) {
    return c.redirect(`/admin/lessons/${id}/edit?error=missing_fields`)
  }

  // Validate recording URL is http(s) if provided.
  const recordingUrl = recordingUrlRaw || null
  if (recordingUrl && !/^https?:\/\//i.test(recordingUrl)) {
    return c.redirect(`/admin/lessons/${id}/edit?error=invalid_recording_url`)
  }

  try {
    const db = getDb(c.env.DB)
    await db.update(lessons)
      .set({
        cohortId,
        weekNumber,
        title,
        description: description || null,
        date: date || null,
        contentMarkdown,
        recordingUrl,
        transcriptMarkdown: transcriptMarkdown || null,
        status,
        sortOrder: weekNumber,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(lessons.id, id))

    return c.redirect(`/admin/lessons/${id}/edit?saved=true`)
  } catch (error) {
    console.error('Failed to update lesson:', error)
    return c.redirect(`/admin/lessons/${id}/edit?error=server_error`)
  }
})

// ===== PUBLIC: Feedback submission =====
api.post('/api/feedback', async (c) => {
  const user = c.get('user')
  // Sign-in required (matches the gated /feedback GET). Defensive guard.
  if (!user) {
    return c.redirect('/sign-in?redirect_url=/feedback')
  }

  const body = await c.req.parseBody()

  // Identity comes from the session, never the form.
  const name = user.name || user.email
  const email = user.email
  const userId = user.id

  const cohortSlug = String(body.cohort_slug || '').trim() || null
  const ratingStr = String(body.rating || '').trim()
  const rating = ratingStr ? parseInt(ratingStr, 10) : null
  const highlight = String(body.highlight || '').trim() || null
  const testimonial = String(body.testimonial || '').trim() || null
  const improvement = String(body.improvement || '').trim() || null
  const canFeatureStr = String(body.can_feature || '0')
  // 0 = private, 1 = full name + link, 2 = anonymous, 3 = first name only
  const canFeature = ['1', '2', '3'].includes(canFeatureStr) ? parseInt(canFeatureStr, 10) : 0
  const website = String(body.website || '').trim() || null

  // Need identity (name+email — always present for signed-in) and at least
  // one substantive field.
  if (!name || !email || (!highlight && !testimonial && !improvement)) {
    return c.redirect('/feedback?error=missing_fields')
  }

  try {
    const db = getDb(c.env.DB)
    await db.insert(feedback).values({
      name,
      email,
      cohortSlug,
      rating,
      highlight,
      testimonial,
      improvement,
      canFeature,
      website,
      userId,
    })

    return c.redirect('/feedback?submitted=true')
  } catch (error) {
    console.error('Failed to save feedback:', error)
    return c.redirect('/feedback?error=server_error')
  }
})

// ===== PROFILE: Update your profile =====
api.post('/api/profile', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const body = await c.req.parseBody()

  const name = String(body.name || '').trim()
  const bio = String(body.bio || '').trim() || null
  const location = String(body.location || '').trim() || null
  const website = String(body.website || '').trim() || null
  const github = String(body.github || '').trim() || null
  const avatarUrl = String(body.avatar_url || '').trim() || null

  if (!name) {
    return c.redirect('/settings/profile?error=missing_fields')
  }

  // URL fields must be http(s) — prevents `javascript:` / `data:` href XSS
  // when these get rendered as clickable links on /members/:id.
  const httpsOnly = /^https?:\/\//i
  if (website && !httpsOnly.test(website)) {
    return c.redirect('/settings/profile?error=invalid_website')
  }
  if (avatarUrl && !httpsOnly.test(avatarUrl)) {
    return c.redirect('/settings/profile?error=invalid_avatar')
  }
  // GitHub is a username, not a URL — strip any accidental https prefix.
  const githubUsername = github?.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/$/, '') || null
  if (githubUsername && !/^[a-zA-Z0-9-]{1,39}$/.test(githubUsername)) {
    return c.redirect('/settings/profile?error=invalid_github')
  }

  // Length bounds.
  if (
    name.length > 200 ||
    (bio && bio.length > 2000) ||
    (location && location.length > 200) ||
    (website && website.length > 500) ||
    (avatarUrl && avatarUrl.length > 500)
  ) {
    return c.redirect('/settings/profile?error=too_long')
  }

  try {
    const db = getDb(c.env.DB)
    await db.update(users)
      .set({
        name,
        bio,
        location,
        website,
        github: githubUsername,
        avatarUrl,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, user.id))

    return c.redirect('/settings/profile?saved=true')
  } catch (error) {
    console.error('Failed to update profile:', error)
    return c.redirect('/settings/profile?error=server_error')
  }
})

// ===== PROJECTS: Create a project =====
api.post('/api/projects', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const body = await c.req.parseBody()

  const title = String(body.title || '').trim()
  const description = String(body.description || '').trim()
  const url = String(body.url || '').trim() || null
  const githubUrl = String(body.github_url || '').trim() || null
  const cohortIdStr = String(body.cohort_id || '').trim()
  const cohortId = cohortIdStr ? parseInt(cohortIdStr, 10) : null

  if (!title || !description) {
    return c.redirect('/projects/new?error=missing_fields')
  }

  try {
    const db = getDb(c.env.DB)
    const result = await db.insert(projects).values({
      userId: user.id,
      title,
      description,
      url,
      githubUrl,
      cohortId,
    }).returning()

    return c.redirect(`/projects/${result[0].id}`)
  } catch (error) {
    console.error('Failed to create project:', error)
    return c.redirect('/projects/new?error=server_error')
  }
})

// ===== PROJECTS: Update a project =====
api.post('/api/projects/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const id = parseInt(c.req.param('id'), 10)
  const body = await c.req.parseBody()

  const title = String(body.title || '').trim()
  const description = String(body.description || '').trim()
  const url = String(body.url || '').trim() || null
  const githubUrl = String(body.github_url || '').trim() || null
  const cohortIdStr = String(body.cohort_id || '').trim()
  const cohortId = cohortIdStr ? parseInt(cohortIdStr, 10) : null

  if (!title || !description) {
    return c.redirect(`/projects/${id}/edit?error=missing_fields`)
  }

  try {
    const db = getDb(c.env.DB)

    // Verify ownership (or admin)
    const project = await db.select().from(projects).where(eq(projects.id, id)).get()
    if (!project || (project.userId !== user.id && !isAdmin(user))) {
      return c.redirect('/projects')
    }

    await db.update(projects)
      .set({
        title,
        description,
        url,
        githubUrl,
        cohortId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, id))

    return c.redirect(`/projects/${id}`)
  } catch (error) {
    console.error('Failed to update project:', error)
    return c.redirect(`/projects/${id}/edit?error=server_error`)
  }
})

// ===== PROGRESS: Toggle lesson complete/incomplete =====
api.post('/api/progress/:lessonId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const lessonId = parseInt(c.req.param('lessonId'), 10)
  const body = await c.req.parseBody()
  const cohortId = parseInt(String(body.cohort_id || '0'), 10)
  const rawReturnUrl = String(body.return_url || '/dashboard')
  const returnUrl = rawReturnUrl.startsWith('/') && !rawReturnUrl.startsWith('//') ? rawReturnUrl : '/dashboard'

  if (isNaN(lessonId) || !cohortId) {
    return c.redirect(returnUrl)
  }

  try {
    const db = getDb(c.env.DB)

    // Check if already completed
    const existing = await db
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, user.id),
          eq(lessonProgress.lessonId, lessonId)
        )
      )
      .get()

    if (existing) {
      // Toggle off — remove the progress record
      await db.delete(lessonProgress).where(eq(lessonProgress.id, existing.id))
    } else {
      // Toggle on — create a progress record
      await db.insert(lessonProgress).values({
        userId: user.id,
        lessonId,
        cohortId,
      })
    }

    return c.redirect(returnUrl)
  } catch (error) {
    console.error('Failed to toggle progress:', error)
    return c.redirect(returnUrl)
  }
})

// ===== DISCUSSIONS: Create a discussion =====
api.post('/api/discussions', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const body = await c.req.parseBody()

  const title = String(body.title || '').trim()
  const discussionBody = String(body.body || '').trim()
  const cohortIdStr = String(body.cohort_id || '').trim()
  const cohortId = cohortIdStr ? parseInt(cohortIdStr, 10) : null
  const lessonIdStr = String(body.lesson_id || '').trim()
  const lessonId = lessonIdStr ? parseInt(lessonIdStr, 10) : null
  const returnSlug = String(body.return_slug || '').trim()
  const returnCommunity = String(body.return_community || '').trim()

  if (!title || !discussionBody) {
    if (returnSlug) {
      return c.redirect(`/cohort/${returnSlug}/discussions/new?error=missing_fields`)
    }
    return c.redirect('/community/discussions/new?error=missing_fields')
  }

  try {
    const db = getDb(c.env.DB)
    const result = await db.insert(discussions).values({
      cohortId,
      lessonId,
      userId: user.id,
      title,
      body: discussionBody,
    }).returning()

    if (returnSlug) {
      return c.redirect(`/cohort/${returnSlug}/discussions/${result[0].id}`)
    }
    return c.redirect(`/community/discussions/${result[0].id}`)
  } catch (error) {
    console.error('Failed to create discussion:', error)
    if (returnSlug) {
      return c.redirect(`/cohort/${returnSlug}/discussions/new?error=server_error`)
    }
    return c.redirect('/community/discussions/new?error=server_error')
  }
})

// ===== DISCUSSIONS: Add a comment =====
api.post('/api/discussions/:id/comments', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const discussionId = parseInt(c.req.param('id'), 10)
  const body = await c.req.parseBody()

  const commentBody = String(body.body || '').trim()
  const parentIdStr = String(body.parent_id || '').trim()
  const parentId = parentIdStr ? parseInt(parentIdStr, 10) : null
  const rawReturnUrl = String(body.return_url || '/community/discussions')
  const returnUrl = rawReturnUrl.startsWith('/') && !rawReturnUrl.startsWith('//') ? rawReturnUrl : '/community/discussions'

  if (!commentBody) {
    return c.redirect(returnUrl)
  }

  try {
    const db = getDb(c.env.DB)
    await db.insert(comments).values({
      discussionId,
      userId: user.id,
      parentId,
      body: commentBody,
    })

    return c.redirect(returnUrl)
  } catch (error) {
    console.error('Failed to add comment:', error)
    return c.redirect(returnUrl)
  }
})

// ===== API KEYS: Create an API key =====
api.post('/api/api-keys', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const body = await c.req.parseBody()
  const name = String(body.name || '').trim()

  if (!name) {
    return c.redirect('/settings/api-keys?error=missing_name')
  }

  try {
    const rawKey = generateApiKey()
    const keyHash = await hashApiKey(rawKey)
    const keyPrefix = getKeyPrefix(rawKey)

    const db = getDb(c.env.DB)
    await db.insert(apiKeys).values({
      userId: user.id,
      name,
      keyHash,
      keyPrefix,
      scopes: 'read:write',
    })

    // Show the raw key once — pass it in the URL (HTTPS protects it in transit)
    return c.redirect(`/settings/api-keys?new_key=${encodeURIComponent(rawKey)}`)
  } catch (error) {
    console.error('Failed to create API key:', error)
    return c.redirect('/settings/api-keys?error=server_error')
  }
})

// ===== API KEYS: Revoke an API key =====
api.post('/api/api-keys/:id/revoke', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const id = parseInt(c.req.param('id'), 10)

  try {
    const db = getDb(c.env.DB)

    // Verify ownership
    const key = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).get()
    if (!key || key.userId !== user.id) {
      return c.redirect('/settings/api-keys')
    }

    await db.update(apiKeys)
      .set({ status: 'revoked' })
      .where(eq(apiKeys.id, id))

    return c.redirect('/settings/api-keys?revoked=true')
  } catch (error) {
    console.error('Failed to revoke API key:', error)
    return c.redirect('/settings/api-keys')
  }
})

// ===== OAUTH TOKENS: Revoke a connected app from the UI =====
api.post('/api/oauth/tokens/:id/revoke', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.redirect('/settings/api-keys')

  const db = getDb(c.env.DB)
  const token = await db.select().from(oauthTokens).where(eq(oauthTokens.id, id)).get()
  if (!token || token.userId !== user.id) {
    return c.redirect('/settings/api-keys')
  }

  await db.update(oauthTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(oauthTokens.id, id))

  return c.redirect('/settings/api-keys?disconnected=true')
})

// ===== ARTIFACTS =====
// Shared helper — is this user enrolled in the cohort the lesson belongs to,
// OR an admin/facilitator? Gates both create and (indirectly) view.
async function canPostArtifactToLesson(
  db: ReturnType<typeof getDb>,
  user: { id: number; role: string },
  lessonId: number,
): Promise<{ ok: true; cohortId: number } | { ok: false; redirectTo: string }> {
  const lesson = await db.select({ id: lessons.id, cohortId: lessons.cohortId, slug: cohorts.slug })
    .from(lessons)
    .innerJoin(cohorts, eq(cohorts.id, lessons.cohortId))
    .where(eq(lessons.id, lessonId))
    .get()
  if (!lesson) return { ok: false, redirectTo: '/dashboard' }
  if (user.role === 'admin' || user.role === 'facilitator') return { ok: true, cohortId: lesson.cohortId }
  const enr = await db.select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.userId, user.id), eq(enrollments.cohortId, lesson.cohortId)))
    .get()
  if (enr) return { ok: true, cohortId: lesson.cohortId }
  const mem = await db.select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'active')))
    .get()
  if (mem) return { ok: true, cohortId: lesson.cohortId }
  return { ok: false, redirectTo: `/cohort/${lesson.slug}/week/1` }
}

function sanitizeArtifactInputs(body: Record<string, any>): {
  title: string | null
  bodyMarkdown: string | null
  attachedUrl: string | null
  generatedBy: 'human' | 'collaborative' | 'ai'
  visibility: 'class' | 'instructor'
  error?: string
} {
  const title = String(body.title || '').trim().slice(0, 200) || null
  const bodyMarkdown = String(body.body_markdown || '').trim().slice(0, 20000) || null
  const attachedUrl = String(body.attached_url || '').trim().slice(0, 500) || null
  const rawGen = String(body.generated_by || 'collaborative')
  const rawVis = String(body.visibility || 'class')

  if (!bodyMarkdown && !attachedUrl) {
    return {
      title, bodyMarkdown, attachedUrl,
      generatedBy: 'collaborative', visibility: 'class',
      error: 'empty',
    }
  }
  if (attachedUrl && !/^https?:\/\//i.test(attachedUrl)) {
    return {
      title, bodyMarkdown, attachedUrl,
      generatedBy: 'collaborative', visibility: 'class',
      error: 'invalid_url',
    }
  }
  const generatedBy = (rawGen === 'human' || rawGen === 'ai') ? rawGen : 'collaborative'
  const visibility = rawVis === 'instructor' ? 'instructor' : 'class'
  return { title, bodyMarkdown, attachedUrl, generatedBy, visibility }
}

// Create artifact — POST /api/artifacts
api.post('/api/artifacts', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const body = await c.req.parseBody()
  const lessonId = parseInt(String(body.lesson_id || ''), 10)
  if (!Number.isFinite(lessonId) || lessonId <= 0) return c.redirect('/dashboard')

  const db = getDb(c.env.DB)
  const access = await canPostArtifactToLesson(db, user, lessonId)
  if (!access.ok) return c.redirect(access.redirectTo)

  const sanitized = sanitizeArtifactInputs(body)
  // Lookup the cohort slug + week number for redirect
  const lesson = await db.select({ weekNumber: lessons.weekNumber, slug: cohorts.slug })
    .from(lessons)
    .innerJoin(cohorts, eq(cohorts.id, lessons.cohortId))
    .where(eq(lessons.id, lessonId))
    .get()
  if (!lesson) return c.redirect('/dashboard')
  const returnUrl = `/cohort/${lesson.slug}/week/${lesson.weekNumber}`

  if (sanitized.error) {
    return c.redirect(`${returnUrl}?artifact_error=${sanitized.error}#artifact-form`)
  }

  await db.insert(artifacts).values({
    lessonId,
    userId: user.id,
    title: sanitized.title,
    bodyMarkdown: sanitized.bodyMarkdown,
    attachedUrl: sanitized.attachedUrl,
    generatedBy: sanitized.generatedBy,
    visibility: sanitized.visibility,
  })
  return c.redirect(`${returnUrl}?artifact_saved=1#artifacts`)
})

// Update artifact — POST /api/artifacts/:id (owner only)
api.post('/api/artifacts/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id)) return c.redirect('/dashboard')

  const db = getDb(c.env.DB)
  const existing = await db.select().from(artifacts).where(eq(artifacts.id, id)).get()
  if (!existing) return c.redirect('/dashboard')
  if (existing.userId !== user.id) {
    // Non-owner can't edit (admins can delete but not edit — matches
    // discussion/project edit model).
    return c.redirect('/dashboard')
  }

  const body = await c.req.parseBody()
  const sanitized = sanitizeArtifactInputs(body)
  const lesson = await db.select({ weekNumber: lessons.weekNumber, slug: cohorts.slug })
    .from(lessons)
    .innerJoin(cohorts, eq(cohorts.id, lessons.cohortId))
    .where(eq(lessons.id, existing.lessonId))
    .get()
  const returnUrl = lesson ? `/cohort/${lesson.slug}/week/${lesson.weekNumber}` : '/dashboard'

  if (sanitized.error) {
    return c.redirect(`${returnUrl}?artifact_error=${sanitized.error}#artifact-${id}`)
  }

  await db.update(artifacts).set({
    title: sanitized.title,
    bodyMarkdown: sanitized.bodyMarkdown,
    attachedUrl: sanitized.attachedUrl,
    generatedBy: sanitized.generatedBy,
    visibility: sanitized.visibility,
    updatedAt: new Date().toISOString(),
  }).where(eq(artifacts.id, id))

  return c.redirect(`${returnUrl}?artifact_saved=1#artifact-${id}`)
})

// Delete artifact — POST /api/artifacts/:id/delete (owner or admin)
api.post('/api/artifacts/:id/delete', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id)) return c.redirect('/dashboard')

  const db = getDb(c.env.DB)
  const existing = await db.select().from(artifacts).where(eq(artifacts.id, id)).get()
  if (!existing) return c.redirect('/dashboard')
  const canDelete = existing.userId === user.id || isAdmin(user)
  if (!canDelete) return c.redirect('/dashboard')

  const lesson = await db.select({ weekNumber: lessons.weekNumber, slug: cohorts.slug })
    .from(lessons)
    .innerJoin(cohorts, eq(cohorts.id, lessons.cohortId))
    .where(eq(lessons.id, existing.lessonId))
    .get()
  const returnUrl = lesson ? `/cohort/${lesson.slug}/week/${lesson.weekNumber}` : '/dashboard'

  // Soft delete — keeps history, prevents accidental re-share collisions.
  await db.update(artifacts)
    .set({ status: 'deleted', updatedAt: new Date().toISOString() })
    .where(eq(artifacts.id, id))

  return c.redirect(`${returnUrl}?artifact_deleted=1#artifacts`)
})

export default api
