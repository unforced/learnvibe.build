import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { enrollments, cohorts, applications, lessons, lessonProgress, projects, interests } from '../db/schema'
import { formatCents, getApplicationAmount } from '../lib/stripe'
import { getRecentActivity } from '../lib/activity'
import type { AppContext } from '../types'

const dashboard = new Hono<AppContext>()

dashboard.get('/dashboard', async (c) => {
  const user = c.get('user')

  // Redirect to sign-in if not authenticated
  if (!user) {
    return c.redirect('/sign-in')
  }

  // Get user's enrollments
  const db = getDb(c.env.DB)
  const userEnrollments = await db
    .select({
      enrollment: enrollments,
      cohort: cohorts,
    })
    .from(enrollments)
    .innerJoin(cohorts, eq(enrollments.cohortId, cohorts.id))
    .where(eq(enrollments.userId, user.id))
    .all()

  // Get progress for each cohort
  const cohortProgressMap = new Map<number, { completed: number; total: number }>()
  for (const { cohort } of userEnrollments) {
    const [totalList, completedList] = await Promise.all([
      db.select({ id: lessons.id }).from(lessons)
        .where(and(eq(lessons.cohortId, cohort.id), eq(lessons.status, 'published')))
        .all(),
      db.select({ id: lessonProgress.id }).from(lessonProgress)
        .where(and(eq(lessonProgress.userId, user.id), eq(lessonProgress.cohortId, cohort.id)))
        .all(),
    ])
    cohortProgressMap.set(cohort.id, { completed: completedList.length, total: totalList.length })
  }

  // Get user's projects
  const userProjects = userEnrollments.length > 0
    ? await db.select().from(projects)
        .where(and(eq(projects.userId, user.id), eq(projects.status, 'active')))
        .orderBy(desc(projects.createdAt)).limit(3).all()
    : []

  // Linked interest row (if any) — surfaced as a small banner so the user
  // sees the funnel continuity. See #44. Picks the earliest signup as the
  // canonical "joined the list on" date even if there are duplicates.
  const interestRow = await db.select({ createdAt: interests.createdAt })
    .from(interests)
    .where(eq(interests.userId, user.id))
    .orderBy(interests.createdAt)
    .get()

  return c.html(
    <Layout title="Dashboard" user={user}>
      <div class="page-section" style="max-width: 800px; margin: 0 auto;">
        <p class="section-label">Dashboard</p>
        <h2>Welcome back{user.name ? `, ${user.name.split(' ')[0]}` : ''}</h2>

        {interestRow && (
          <div style="margin-top: 1rem; padding: 0.7rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; color: var(--text-secondary);">
            <span aria-hidden="true" style="margin-right: 0.4rem;">✓</span>
            Thanks for joining the interest list on{' '}
            <strong style="color: var(--text);">
              {new Date(interestRow.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </strong>
            .
          </div>
        )}

        {userEnrollments.length > 0 ? (
          <>
            {userEnrollments
              .filter(({ enrollment, cohort }) => enrollment.status === 'active' && cohort.meetingUrl)
              .map(({ cohort }) => (
                <div style="margin-top: 1.5rem; padding: 1rem 1.25rem; background: linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%); border: 1px solid #f59e0b; border-radius: 10px; color: #78350f; display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between;">
                  <div style="flex: 1; min-width: 200px;">
                    <div style="font-weight: 600; font-size: 1rem;">🔴 Live session — {cohort.title}</div>
                    <div style="font-size: 0.85rem; color: #92400e; margin-top: 0.15rem;">Mondays 5:30–7:30pm MT</div>
                  </div>
                  <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <a
                      href={`/cohort/${cohort.slug}/sessions.ics`}
                      style="padding: 0.5rem 0.85rem; background: rgba(255,255,255,0.6); border: 1px solid #f59e0b; border-radius: 6px; text-decoration: none; color: #78350f; font-size: 0.85rem; font-weight: 500; white-space: nowrap;"
                    >
                      📅 Add to calendar
                    </a>
                    <a
                      href={cohort.meetingUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      style="padding: 0.5rem 1rem; background: #78350f; color: white; border-radius: 6px; text-decoration: none; font-size: 0.9rem; font-weight: 500; white-space: nowrap;"
                    >
                      Join →
                    </a>
                  </div>
                </div>
              ))}

            <p class="lead" style="margin-top: 0.5rem;">Your cohorts</p>
            <div class="week-grid" style="margin-top: 1.5rem;">
              {userEnrollments.map(({ enrollment, cohort }) => {
                const progress = cohortProgressMap.get(cohort.id)
                const pct = progress && progress.total > 0
                  ? Math.round((progress.completed / progress.total) * 100) : 0
                return (
                  <a href={`/cohort/${cohort.slug}`} class="week-card">
                    <div class="week-card-info">
                      <h3>{cohort.title}</h3>
                      {cohort.description && <p>{cohort.description}</p>}
                      {progress && progress.total > 0 && (
                        <div style="margin-top: 0.75rem;">
                          <div class="progress-bar" style="height: 6px;">
                            <div class="progress-fill" style={`width: ${pct}%`}></div>
                          </div>
                          <span style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem; display: block;">
                            {progress.completed}/{progress.total} lessons · {pct}%
                          </span>
                        </div>
                      )}
                    </div>
                    <span class="week-card-meta">
                      <span class={`badge badge-${enrollment.status === 'active' ? 'active' : 'completed'}`}>
                        {enrollment.status}
                      </span>
                    </span>
                  </a>
                )
              })}
            </div>
          </>
        ) : (
          await (async () => {
            // Check if user has a pending/approved application
            const userApp = await db.select().from(applications)
              .where(eq(applications.email, user.email))
              .get()

            if (userApp && userApp.status === 'approved') {
              const amountCents = getApplicationAmount(userApp)
              return (
                <div style="margin-top: 2rem; padding: 2rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px;">
                  <h3 style="font-family: var(--font-display); color: #166534; margin-bottom: 0.5rem;">Application Approved!</h3>
                  <p style="color: #15803d; line-height: 1.6;">
                    {amountCents > 0
                      ? `Complete your payment of ${formatCents(amountCents)} to start learning.`
                      : 'Your spot is sponsored — complete enrollment to get started.'}
                  </p>
                  <a href={`/payment/checkout/${userApp.id}${userApp.paymentToken ? `?t=${userApp.paymentToken}` : ''}`} style="display: inline-block; margin-top: 1rem; background: var(--accent); color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; font-weight: 600;">
                    {amountCents > 0 ? `Pay ${formatCents(amountCents)} & Enroll →` : 'Complete Enrollment →'}
                  </a>
                </div>
              )
            }

            if (userApp && userApp.status === 'pending') {
              return (
                <div style="margin-top: 2rem; padding: 2rem; background: var(--surface); border-radius: 10px;">
                  <h3 style="font-family: var(--font-display); margin-bottom: 0.5rem;">Application Under Review</h3>
                  <p style="color: var(--text-secondary); line-height: 1.6;">
                    Your application is being reviewed. We'll be in touch soon.
                  </p>
                </div>
              )
            }

            return (
              <div style="margin-top: 2rem; padding: 2rem; background: var(--surface); border-radius: 10px;">
                <p style="color: var(--text-secondary);">
                  You're not enrolled in any cohorts yet.
                </p>
                <a href="/interest" style="display: inline-block; margin-top: 1rem; color: var(--accent); font-weight: 500;">
                  Join the interest list →
                </a>
              </div>
            )
          })()
        )}

        {/* Quick links */}
        {userEnrollments.length > 0 && (
          <div style="margin-top: 2rem; display: flex; gap: 0.75rem; flex-wrap: wrap;">
            <a href="/community" style="display: inline-block; padding: 0.5rem 1rem; background: var(--surface); border-radius: 6px; text-decoration: none; color: var(--text); font-size: 0.9rem; font-weight: 500;">
              Community →
            </a>
            <a href="/projects/new" style="display: inline-block; padding: 0.5rem 1rem; background: var(--surface); border-radius: 6px; text-decoration: none; color: var(--text); font-size: 0.9rem; font-weight: 500;">
              Share Project →
            </a>
            <a href="/settings/profile" style="display: inline-block; padding: 0.5rem 1rem; background: var(--surface); border-radius: 6px; text-decoration: none; color: var(--text); font-size: 0.9rem; font-weight: 500;">
              Edit Profile →
            </a>
            <a href="/feedback" style="display: inline-block; padding: 0.5rem 1rem; background: var(--surface); border-radius: 6px; text-decoration: none; color: var(--text); font-size: 0.9rem; font-weight: 500;">
              Give Feedback →
            </a>
          </div>
        )}

        {/* User's projects */}
        {userProjects.length > 0 && (
          <div style="margin-top: 2.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <h3 style="font-family: var(--font-display);">Your Projects</h3>
              <a href="/projects" style="color: var(--accent); font-size: 0.9rem;">View all →</a>
            </div>
            <div class="project-grid" style="margin-top: 1rem;">
              {userProjects.map((project) => (
                <a href={`/projects/${project.id}`} class="project-card">
                  <h4>{project.title}</h4>
                  <p>{project.description.length > 100 ? project.description.slice(0, 100) + '...' : project.description}</p>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Activity Feed */}
        {userEnrollments.length > 0 && await (async () => {
          const activity = await getRecentActivity(c.env.DB, 8)
          if (activity.length === 0) return null

          return (
            <div style="margin-top: 3rem;">
              <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <h3 style="font-family: var(--font-display);">Recent Activity</h3>
                <a href="/community" style="color: var(--accent); font-size: 0.9rem;">Community →</a>
              </div>
              <div class="activity-feed" style="margin-top: 1rem;">
                {activity.map((item) => (
                  <a href={item.url} class="activity-item">
                    <span class="activity-icon">
                      {item.type === 'discussion' ? '💬' : item.type === 'comment' ? '↩️' : '🚀'}
                    </span>
                    <div class="activity-content">
                      <span><strong>{item.authorName}</strong> {item.title}</span>
                    </div>
                    <span class="activity-time">
                      {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )
        })()}

        <div style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid var(--border);">
          <p style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-tertiary);">
            {user.email} · {user.role}
            {userEnrollments.length > 0 && <> · <a href={`/members/${user.id}`} style="color: var(--accent);">View profile</a></>}
          </p>
        </div>
      </div>
    </Layout>
  )
})

export default dashboard
