import { Context } from 'hono'
import { eq, and, ne, isNull, sql, desc } from 'drizzle-orm'
import { getDb } from '../db'
import { users, enrollments, memberships, interests, cohorts } from '../db/schema'
import { getSessionUserId } from './session'
import type { EmailEnv } from './email'
import type { AppContext } from '../types'

export type AuthUser = {
  id: number
  /** External auth id. For legacy Clerk accounts this is the Clerk user id;
   *  for magic-link accounts it's a synthetic `magic_<token>`. Auth keys on
   *  `id` (carried in the session cookie), not this — it only exists to
   *  satisfy the column's NOT NULL UNIQUE constraint. */
  clerkId: string
  email: string
  name: string | null
  role: string
  isEnrolled: boolean
  /** Slug of the user's most recent / current cohort enrollment, used to
   *  drive nav links to /cohort/:slug. NULL for users with no enrollment
   *  (admin/facilitator without a cohort, or users with only a community
   *  membership). Most-recent enrollment wins when multiple exist. */
  primaryCohortSlug?: string | null
}

/**
 * Get the authenticated user from the signed session cookie.
 * Returns null if not signed in.
 */
export async function getUser(c: Context<AppContext>): Promise<AuthUser | null> {
  try {
    const userId = await getSessionUserId(c)
    if (!userId) return null

    const db = getDb(c.env.DB)
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get()

    if (!user) return null
    // Soft-deleted accounts can't authenticate.
    if (user.role === 'deleted') return null

    // Check enrollment status for nav display + look up the user's most
    // recent enrollment's cohort slug so Layout can route to the right
    // /cohort/:slug. Newest enrollment wins when the user has multiple.
    let isEnrolled = false
    let primaryCohortSlug: string | null = null

    const enrollment = await db
      .select({ cohortSlug: cohorts.slug })
      .from(enrollments)
      .innerJoin(cohorts, eq(cohorts.id, enrollments.cohortId))
      .where(
        and(
          eq(enrollments.userId, user.id),
          ne(enrollments.status, 'dropped')
        )
      )
      .orderBy(desc(enrollments.enrolledAt))
      .get()

    if (enrollment) {
      isEnrolled = true
      primaryCohortSlug = enrollment.cohortSlug
    }

    if (user.role === 'admin' || user.role === 'facilitator') {
      isEnrolled = true
    } else if (!enrollment) {
      const membership = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, user.id),
            eq(memberships.status, 'active')
          )
        )
        .get()

      if (membership) isEnrolled = true
    }

    return { ...user, isEnrolled, primaryCohortSlug }
  } catch {
    return null
  }
}

/**
 * Find a user by email, or create one. Replaces the old Clerk `syncUser`.
 * Keyed on email (the natural identity for magic-link auth). On creation,
 * runs the same first-signup side effects Clerk's webhook used to: auto-
 * enroll any approved sponsored applications, link userId on paid ones, and
 * back-link interest-list rows.
 *
 * New accounts get a synthetic `clerk_id` (`magic_<token>`) to satisfy the
 * NOT NULL UNIQUE column without a table rebuild — see migration 0025.
 */
export async function findOrCreateUser(
  db: ReturnType<typeof getDb>,
  env: EmailEnv,
  args: { email: string; name?: string | null },
): Promise<{ user: typeof users.$inferSelect; isNew: boolean }> {
  const email = args.email.trim().toLowerCase()
  const name = args.name?.trim() || null

  const existing = await db.select().from(users).where(eq(users.email, email)).get()
  if (existing) {
    // Fill in a name we didn't have, but never overwrite one the user set.
    if (name && !existing.name) {
      await db.update(users).set({ name }).where(eq(users.id, existing.id))
      existing.name = name
    }
    // Reactivate a soft-deleted account on successful sign-in.
    if (existing.role === 'deleted') {
      await db.update(users).set({ role: 'student' }).where(eq(users.id, existing.id))
      existing.role = 'student'
    }
    return { user: existing, isNew: false }
  }

  const syntheticAuthId = `magic_${generateToken()}`
  const result = await db
    .insert(users)
    .values({
      clerkId: syntheticAuthId,
      email,
      name,
      role: 'student',
    })
    .returning()
  const newUser = result[0]

  // First-signup side effects. Loaded lazily to avoid a circular import
  // (auth → enrollment → email → …). Non-fatal — log and continue.
  try {
    const { autoEnrollOnSignup } = await import('./enrollment')
    await autoEnrollOnSignup(db, env, { id: newUser.id, email: newUser.email })
  } catch (e) {
    console.error('autoEnrollOnSignup failed (non-fatal):', e)
  }

  // Back-link any unlinked interest-list rows for this email (funnel
  // continuity — interest → signup → application → enrollment, see #44).
  try {
    await db
      .update(interests)
      .set({ userId: newUser.id })
      .where(and(
        eq(sql<string>`LOWER(${interests.email})`, newUser.email.toLowerCase()),
        isNull(interests.userId),
      ))
  } catch (e) {
    console.error('interests-link on signup failed (non-fatal):', e)
  }

  return { user: newUser, isNew: true }
}

/**
 * Check if a user has admin/facilitator privileges.
 */
export function isAdmin(user: AuthUser | null): boolean {
  if (!user) return false
  return user.role === 'admin' || user.role === 'facilitator'
}

/**
 * Constant-time string compare. Prevents timing attacks when comparing
 * secrets/tokens (e.g. application payment tokens).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Generate a URL-safe random token (32 hex chars = 128 bits).
 */
export function generateToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
