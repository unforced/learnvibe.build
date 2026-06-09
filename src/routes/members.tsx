import { Hono } from 'hono'
import { eq, and, ne, desc, count } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { users, enrollments, projects, discussions, comments } from '../db/schema'
import { hasCommunityAccess } from '../lib/access'
import { renderMarkdown } from '../lib/markdown'
import type { AppContext } from '../types'

const memberRoutes = new Hono<AppContext>()

// Member directory — /members
memberRoutes.get('/members', async (c) => {
  const user = c.get('user')

  if (!user) return c.redirect('/sign-in')

  const hasAccess = await hasCommunityAccess(c.env.DB, user)
  if (!hasAccess) return c.redirect('/community')

  const db = getDb(c.env.DB)

  // Get all users who have at least one non-dropped enrollment
  const enrolledUsers = await db
    .selectDistinct({
      id: users.id,
      name: users.name,
      bio: users.bio,
      avatarUrl: users.avatarUrl,
      location: users.location,
      role: users.role,
    })
    .from(users)
    .innerJoin(enrollments, eq(users.id, enrollments.userId))
    .where(ne(enrollments.status, 'dropped'))
    .orderBy(users.name)
    .all()

  return c.html(
    <Layout title="Members" user={user}>
      <div class="page-section">
        <a href="/community" class="back-link">← Community</a>

        <p class="section-label">Member Directory</p>
        <h2>Our Community</h2>
        <p class="lead" style="margin-top: 0.5rem;">
          {enrolledUsers.length} members building with AI
        </p>

        <div class="member-grid" style="margin-top: 2rem;">
          {enrolledUsers.map((member) => (
            <a href={`/members/${member.id}`} class="member-card">
              <div class="member-avatar">
                {member.avatarUrl
                  ? <img src={member.avatarUrl} alt={member.name || 'Member'} style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />
                  : <span>{(member.name || '?')[0].toUpperCase()}</span>}
              </div>
              <div class="member-card-info">
                <h4>{member.name || 'Anonymous'}</h4>
                {member.bio && (
                  <p>{member.bio.length > 80 ? member.bio.slice(0, 80) + '...' : member.bio}</p>
                )}
                <span class="member-card-meta">
                  {member.role !== 'student' && <span class={`badge badge-${member.role === 'admin' || member.role === 'facilitator' ? 'active' : 'completed'}`}>{member.role}</span>}
                  {member.location && <span>{member.location}</span>}
                </span>
              </div>
            </a>
          ))}
        </div>

        {enrolledUsers.length === 0 && (
          <div class="empty-state">
            <p>No members yet. Be the first to join!</p>
          </div>
        )}
      </div>
    </Layout>
  )
})

// Individual member profile — /members/:id
memberRoutes.get('/members/:id', async (c) => {
  const user = c.get('user')
  const memberId = parseInt(c.req.param('id'), 10)

  if (!user) return c.redirect('/sign-in')

  const hasAccess = await hasCommunityAccess(c.env.DB, user)
  if (!hasAccess) return c.redirect('/community')

  if (isNaN(memberId)) return c.redirect('/members')

  const db = getDb(c.env.DB)

  const member = await db.select().from(users).where(eq(users.id, memberId)).get()

  if (!member) {
    return c.html(
      <Layout title="Member Not Found" user={user}>
        <div class="page-section" style="text-align: center; padding: 6rem 0;">
          <h2>Member not found</h2>
          <p><a href="/members">← Back to Members</a></p>
        </div>
      </Layout>,
      404
    )
  }

  // Get member's projects
  const memberProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, memberId), eq(projects.status, 'active')))
    .orderBy(desc(projects.createdAt))
    .all()

  // Get member's discussions
  const memberDiscussions = await db
    .select()
    .from(discussions)
    .where(and(eq(discussions.userId, memberId), eq(discussions.status, 'active')))
    .orderBy(desc(discussions.createdAt))
    .limit(5)
    .all()

  const isOwnProfile = user.id === memberId

  return c.html(
    <Layout title={member.name || 'Member Profile'} user={user}>
      <div class="page-section" style="max-width: 700px; margin: 0 auto;">
        <a href="/members" class="back-link">← Members</a>

        <div class="profile-header">
          <div class="profile-avatar">
            {member.avatarUrl
              ? <img src={member.avatarUrl} alt={member.name || 'Member'} style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />
              : <span style="font-size: 2rem;">{(member.name || '?')[0].toUpperCase()}</span>}
          </div>
          <div class="profile-info">
            <h2>{member.name || 'Anonymous'}</h2>
            {member.role !== 'student' && (
              <span class={`badge badge-${member.role === 'admin' || member.role === 'facilitator' ? 'active' : 'completed'}`}>
                {member.role}
              </span>
            )}
            {member.bio && <p style="margin-top: 0.5rem; color: var(--text-secondary); line-height: 1.6;">{member.bio}</p>}
            <div class="profile-meta">
              {member.location && <span>{member.location}</span>}
              {member.createdAt && <span>Joined {new Date(member.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>}
            </div>
            <div class="profile-links">
              {member.website && (
                <a href={member.website} target="_blank" rel="noopener">Website</a>
              )}
              {member.github && (
                <a href={`https://github.com/${member.github}`} target="_blank" rel="noopener">GitHub</a>
              )}
            </div>
            {isOwnProfile && (
              <a href="/settings/profile" style="display: inline-block; margin-top: 1rem; color: var(--accent); font-size: 0.9rem; font-weight: 500;">
                Edit Your Profile →
              </a>
            )}
          </div>
        </div>

        {memberProjects.length > 0 && (
          <div style="margin-top: 3rem;">
            <h3 style="font-family: var(--font-display);">Projects</h3>
            <div class="project-grid" style="margin-top: 1rem;">
              {memberProjects.map((project) => (
                <a href={`/projects/${project.id}`} class="project-card">
                  <h4>{project.title}</h4>
                  <p>{project.description.length > 100 ? project.description.slice(0, 100) + '...' : project.description}</p>
                  <div class="project-card-footer">
                    <div class="project-card-links">
                      {project.url && <span>Live</span>}
                      {project.githubUrl && <span>GitHub</span>}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {memberDiscussions.length > 0 && (
          <div style="margin-top: 3rem;">
            <h3 style="font-family: var(--font-display);">Recent Discussions</h3>
            <div class="discussion-list" style="margin-top: 1rem;">
              {memberDiscussions.map((d) => (
                <a href={d.cohortId ? `/cohort/${d.cohortId}/discussions/${d.id}` : `/community/discussions/${d.id}`} class="discussion-item">
                  <div>
                    <h4>{d.title}</h4>
                    <span class="discussion-meta">
                      {new Date(d.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {memberProjects.length === 0 && memberDiscussions.length === 0 && (
          <div class="empty-state" style="margin-top: 3rem;">
            <p>{isOwnProfile ? "You haven't shared any projects or started any discussions yet." : "This member hasn't shared any projects or discussions yet."}</p>
            {isOwnProfile && (
              <div style="margin-top: 1rem;">
                <a href="/projects/new" style="color: var(--accent); font-weight: 500;">Share a Project →</a>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
})

export default memberRoutes
