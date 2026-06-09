import { eq, and, ne } from 'drizzle-orm'
import type { getDb } from '../db'
import { applications, enrollments, cohorts, users } from '../db/schema'
import { sendEnrollmentConfirmed, type EmailEnv } from './email'

type Db = ReturnType<typeof getDb>

/**
 * Enroll a user in a cohort, mark the application as enrolled, and send
 * the confirmation email. Idempotent: if an enrollment already exists,
 * the unique constraint catches the duplicate insert and we skip the
 * notification (assuming they were already notified).
 *
 * Used by: admin approval (sponsored auto-enroll), Stripe webhook,
 * payment.tsx sponsored branch, and the Clerk user.created hook
 * (retroactive enrollment when a user signs up after being approved).
 */
export async function enrollUserAndNotify(
  db: Db,
  env: EmailEnv,
  args: {
    userId: number
    applicationId: number
    cohortId: number
  },
): Promise<{ enrolled: boolean; alreadyEnrolled: boolean }> {
  const { userId, applicationId, cohortId } = args

  // Insert enrollment idempotently. The unique (user_id, cohort_id)
  // constraint protects us from duplicates across concurrent paths.
  let alreadyEnrolled = false
  try {
    await db.insert(enrollments).values({
      userId,
      cohortId,
      status: 'active',
    })
  } catch (e) {
    alreadyEnrolled = true
  }

  // Link application to user + mark enrolled (idempotent).
  await db.update(applications)
    .set({ status: 'enrolled', userId })
    .where(eq(applications.id, applicationId))

  // Only send the welcome email on a real first enrollment to avoid
  // re-spamming users who already got the welcome email through another
  // path (e.g. Stripe webhook fired then this ran on user signup).
  if (!alreadyEnrolled) {
    const cohort = await db.select().from(cohorts).where(eq(cohorts.id, cohortId)).get()
    const app = await db.select().from(applications).where(eq(applications.id, applicationId)).get()
    if (cohort && app) {
      // We always reach this helper with a real userId — meaning the user
      // has an account. The "Create Your Account" CTA would be misleading.
      await sendEnrollmentConfirmed(env, app.email, app.name, cohort.title, true)
    }
  }

  return { enrolled: true, alreadyEnrolled }
}

/**
 * After a new user signs up (Clerk user.created webhook), find any of
 * their approved applications and auto-enroll them if the application
 * was sponsored ($0). For paid applications we link the userId so the
 * Stripe webhook can find them later, but we don't enroll until paid.
 */
export async function autoEnrollOnSignup(
  db: Db,
  env: EmailEnv,
  user: { id: number; email: string },
): Promise<{ enrolledCount: number; linkedCount: number }> {
  // Find any approved (or already enrolled but not linked) applications
  // for this user's email that haven't been linked to a userId yet.
  const candidateApps = await db.select()
    .from(applications)
    .where(
      and(
        eq(applications.email, user.email),
        ne(applications.status, 'rejected'),
      ),
    )
    .all()

  let enrolledCount = 0
  let linkedCount = 0

  for (const app of candidateApps) {
    // Always link userId to the application if missing.
    if (!app.userId) {
      await db.update(applications)
        .set({ userId: user.id })
        .where(eq(applications.id, app.id))
      linkedCount++
    }

    // Auto-enroll cases:
    //   (a) approved at $0 — sponsored, not yet enrolled
    //   (b) status='enrolled' but no actual enrollment row exists
    //       (e.g. someone else clicked their sponsored payment link
    //       while logged in, marking their app enrolled but creating
    //       the enrollment row under the wrong user)
    // Tier is just a default-amount preset for the admin form; what
    // actually gates enrollment is the amount they were approved at.
    const isSponsoredApproved =
      app.status === 'approved' && app.approvedAmountCents === 0
    const isMarkedEnrolledButOrphaned = app.status === 'enrolled'

    if (isSponsoredApproved || isMarkedEnrolledButOrphaned) {
      // Enroll into the cohort the application was made for (not a
      // hardcoded cohort-1 — Summer 2026 and later need this).
      const cohort = await db.select().from(cohorts)
        .where(eq(cohorts.slug, app.cohortSlug ?? 'cohort-1'))
        .get()
      if (cohort) {
        await enrollUserAndNotify(db, env, {
          userId: user.id,
          applicationId: app.id,
          cohortId: cohort.id,
        })
        enrolledCount++
      }
    }
  }

  return { enrolledCount, linkedCount }
}

/**
 * Look up a user account by email. Used at admin approval time to
 * decide whether we can enroll a sponsored applicant immediately.
 */
export async function findUserByEmail(db: Db, email: string) {
  return db.select().from(users).where(eq(users.email, email)).get()
}
