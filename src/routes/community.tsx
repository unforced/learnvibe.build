import { Hono } from 'hono'
import { eq, and, ne, desc, count } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { users, projects, discussions, enrollments } from '../db/schema'
import { hasCommunityAccess } from '../lib/access'
import type { AppContext } from '../types'

const communityRoutes = new Hono<AppContext>()

// Community hub — /community
communityRoutes.get('/community', async (c) => {
  const user = c.get('user')

  if (!user) {
    return c.redirect('/sign-in')
  }

  const hasAccess = await hasCommunityAccess(c.env.DB, user)
  if (!hasAccess) {
    return c.html(
      <Layout title="Community" user={user}>
        <div class="page-section" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 4rem 0;">
          <p class="section-label">Community</p>
          <h2>Join the Community</h2>
          <p style="margin-top: 1rem; color: var(--text-secondary); line-height: 1.7;">
            Community features are available to enrolled cohort members. Apply to join a cohort to get access.
          </p>
          <a href="/interest" style="display: inline-block; margin-top: 2rem; background: var(--accent); color: white; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 500;">
            Join the interest list
          </a>
        </div>
      </Layout>,
      403
    )
  }

  const db = getDb(c.env.DB)

  // Get counts for the hub cards
  const [memberCount, projectCount, discussionCount] = await Promise.all([
    db.select({ value: count() }).from(enrollments)
      .where(ne(enrollments.status, 'dropped'))
      .get()
      .then(r => r?.value || 0),
    db.select({ value: count() }).from(projects)
      .where(eq(projects.status, 'active'))
      .get()
      .then(r => r?.value || 0),
    db.select({ value: count() }).from(discussions)
      .where(eq(discussions.status, 'active'))
      .get()
      .then(r => r?.value || 0),
  ])

  // Get recent projects for preview
  const recentProjects = await db
    .select({
      project: projects,
      author: { name: users.name, id: users.id },
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.status, 'active'))
    .orderBy(desc(projects.createdAt))
    .limit(3)
    .all()

  // Get recent discussions for preview
  const recentDiscussions = await db
    .select({
      discussion: discussions,
      author: { name: users.name, id: users.id },
    })
    .from(discussions)
    .innerJoin(users, eq(discussions.userId, users.id))
    .where(eq(discussions.status, 'active'))
    .orderBy(desc(discussions.createdAt))
    .limit(3)
    .all()

  return c.html(
    <Layout title="Community" user={user}>
      <div class="page-section">
        <a href="/dashboard" class="back-link">← Dashboard</a>

        <p class="section-label">Community</p>
        <h2>Welcome to the LVB Community</h2>
        <p class="lead" style="margin-top: 0.5rem;">
          Connect with fellow builders, share projects, and learn together.
        </p>

        <div class="community-grid" style="margin-top: 2rem;">
          <a href="/members" class="community-card">
            <h3>Members</h3>
            <p>Browse the member directory and connect with fellow learners.</p>
            <span class="community-card-count">{memberCount} members</span>
          </a>

          <a href="/projects" class="community-card">
            <h3>Projects</h3>
            <p>See what people are building and share your own work.</p>
            <span class="community-card-count">{projectCount} projects</span>
          </a>

          <a href="/community/discussions" class="community-card">
            <h3>Discussions</h3>
            <p>Ask questions, share ideas, and have conversations.</p>
            <span class="community-card-count">{discussionCount} threads</span>
          </a>

          <a href="/settings/profile" class="community-card">
            <h3>Your Profile</h3>
            <p>Update your bio, links, and how others see you.</p>
            <span class="community-card-count">Edit →</span>
          </a>
        </div>

        {recentProjects.length > 0 && (
          <div style="margin-top: 3rem;">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <h3 style="font-family: var(--font-display);">Recent Projects</h3>
              <a href="/projects" style="color: var(--accent); font-size: 0.9rem;">View all →</a>
            </div>
            <div class="project-grid" style="margin-top: 1rem;">
              {recentProjects.map(({ project, author }) => (
                <a href={`/projects/${project.id}`} class="project-card">
                  <h4>{project.title}</h4>
                  <p>{project.description.length > 120
                    ? project.description.slice(0, 120) + '...'
                    : project.description}</p>
                  <div class="project-card-footer">
                    <span class="project-card-author">by {author.name || 'Anonymous'}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {recentDiscussions.length > 0 && (
          <div style="margin-top: 3rem;">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <h3 style="font-family: var(--font-display);">Recent Discussions</h3>
              <a href="/community/discussions" style="color: var(--accent); font-size: 0.9rem;">View all →</a>
            </div>
            <div class="discussion-list" style="margin-top: 1rem;">
              {recentDiscussions.map(({ discussion, author }) => (
                <a href={`/community/discussions/${discussion.id}`} class="discussion-item">
                  <div>
                    <h4>{discussion.title}</h4>
                    <span class="discussion-meta">
                      by {author.name || 'Anonymous'} · {new Date(discussion.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
})

export default communityRoutes
