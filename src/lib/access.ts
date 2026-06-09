import { eq, and, ne, sql, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { enrollments, memberships, applications } from '../db/schema'
import type { AuthUser } from './auth'

// Hard cap of seats per cohort. Currently hardcoded to 20 for Summer 2026
// (kept small so Aaron can tend to people directly); when other cohorts
// use a different cap, surface this on the cohorts table.
export const COHORT_SEAT_CAP = 20

export interface CohortCapacity {
  cap: number
  taken: number       // approved + enrolled (soft + hard holds)
  remaining: number   // cap - taken, never negative
  isFull: boolean
}

/**
 * Compute how many seats remain in a cohort. Counts:
 *   - applications with status='approved' (paid path: paid+enrolled, sliding-
 *     scale and alumni are auto-approved on submit and held until checkout
 *     completes; scholarship stays 'pending' until admin approves so doesn't
 *     count here yet)
 *   - applications with status='enrolled' (already paid + enrolled)
 *
 * The cap is conservative: abandoned approved-but-unpaid applications still
 * hold a seat until the admin manually rejects them. That's the right
 * default for "don't oversell a 20-seat in-person event."
 */
export async function getCohortCapacity(
  db: D1Database,
  cohortSlug: string,
  cap: number = COHORT_SEAT_CAP,
): Promise<CohortCapacity> {
  const database = getDb(db)
  const row = await database
    .select({ count: sql<number>`count(*)` })
    .from(applications)
    .where(and(
      eq(applications.cohortSlug, cohortSlug),
      inArray(applications.status, ['approved', 'enrolled']),
    ))
    .get()
  const taken = row?.count ?? 0
  const remaining = Math.max(0, cap - taken)
  return { cap, taken, remaining, isFull: remaining === 0 }
}

/**
 * Marketing-friendly bucket for the "spots left" banner. Returns null when
 * we don't want to show anything (>10 remaining or no cohort).
 */
export function getCapacityLabel(capacity: CohortCapacity | null): string | null {
  if (!capacity) return null
  if (capacity.isFull) return 'Cohort full'
  if (capacity.remaining <= 5) return 'Fewer than 5 spots left'
  if (capacity.remaining <= 10) return 'Fewer than 10 spots left'
  return null
}

/**
 * Check if a user has access to community features.
 * Requires: authenticated + at least one non-dropped enrollment OR active membership OR admin/facilitator.
 */
export async function hasCommunityAccess(
  db: D1Database,
  user: AuthUser | null
): Promise<boolean> {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'facilitator') return true

  const database = getDb(db)

  // Check any active enrollment
  const enrollment = await database
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, user.id),
        ne(enrollments.status, 'dropped')
      )
    )
    .get()

  if (enrollment) return true

  // Check active membership
  const membership = await database
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.status, 'active')
      )
    )
    .get()

  if (membership) return true

  return false
}

/**
 * Check if a user has access to a gated cohort.
 * Access is granted if the user:
 * 1. Is an admin or facilitator
 * 2. Is enrolled in the cohort
 * 3. Has an active membership (alumni get continued access)
 */
export async function canAccessCohort(
  db: D1Database,
  user: AuthUser | null,
  cohortId: number,
  isPublic: number
): Promise<boolean> {
  // Public cohorts are accessible to everyone
  if (isPublic) return true

  // Not logged in — no access
  if (!user) return false

  // Admins and facilitators can see everything
  if (user.role === 'admin' || user.role === 'facilitator') return true

  const database = getDb(db)

  // Check enrollment
  const enrollment = await database
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, user.id),
        eq(enrollments.cohortId, cohortId)
      )
    )
    .get()

  if (enrollment && enrollment.status !== 'dropped') return true

  // Check active membership (alumni can access all content)
  const membership = await database
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.status, 'active')
      )
    )
    .get()

  if (membership) return true

  return false
}
