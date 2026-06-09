import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { projects, users, cohorts } from '../db/schema'
import { renderMarkdown } from '../lib/markdown'
import { hasCommunityAccess } from '../lib/access'
import { isAdmin } from '../lib/auth'
import type { AppContext } from '../types'

const projectRoutes = new Hono<AppContext>()

// Project gallery — /projects
projectRoutes.get('/projects', async (c) => {
  const user = c.get('user')

  if (!user) return c.redirect('/sign-in')

  const hasAccess = await hasCommunityAccess(c.env.DB, user)
  if (!hasAccess) return c.redirect('/community')

  const db = getDb(c.env.DB)

  const allProjects = await db
    .select({
      project: projects,
      author: { name: users.name, id: users.id, avatarUrl: users.avatarUrl },
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.status, 'active'))
    .orderBy(desc(projects.createdAt))
    .all()

  return c.html(
    <Layout title="Projects" user={user}>
      <div class="page-section">
        <a href="/community" class="back-link">← Community</a>

        <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 1rem;">
          <div>
            <p class="section-label">Project Showcase</p>
            <h2>What We're Building</h2>
          </div>
          <a href="/projects/new" style="display: inline-block; background: var(--accent); color: white; padding: 0.6rem 1.25rem; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 0.9rem;">
            Share a Project
          </a>
        </div>

        {allProjects.length > 0 ? (
          <div class="project-grid" style="margin-top: 2rem;">
            {allProjects.map(({ project, author }) => (
              <a href={`/projects/${project.id}`} class="project-card">
                <h4>{project.title}</h4>
                <p>{project.description.length > 120 ? project.description.slice(0, 120) + '...' : project.description}</p>
                <div class="project-card-footer">
                  <span class="project-card-author">by {author.name || 'Anonymous'}</span>
                  <div class="project-card-links">
                    {project.url && <span>Live</span>}
                    {project.githubUrl && <span>GitHub</span>}
                  </div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div class="empty-state" style="margin-top: 2rem;">
            <p>No projects shared yet. Be the first!</p>
            <a href="/projects/new" style="display: inline-block; margin-top: 1rem; color: var(--accent); font-weight: 500;">Share a Project →</a>
          </div>
        )}
      </div>
    </Layout>
  )
})

// New project form — /projects/new
projectRoutes.get('/projects/new', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const error = c.req.query('error')
  const db = getDb(c.env.DB)

  // Get cohorts for the dropdown
  const allCohorts = await db.select({ id: cohorts.id, title: cohorts.title }).from(cohorts).all()

  return c.html(
    <Layout title="Share a Project" user={user}>
      <div class="page-section" style="max-width: 600px; margin: 0 auto;">
        <a href="/projects" class="back-link">← Projects</a>

        <p class="section-label">New Project</p>
        <h2>Share Your Project</h2>
        <p class="lead" style="margin-top: 0.5rem;">Show the community what you've built.</p>

        {error === 'missing_fields' && (
          <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            Please fill in the title and description.
          </div>
        )}

        <form method="post" action="/api/projects" style="margin-top: 2rem;">
          <div style="margin-bottom: 1.5rem;">
            <label for="title" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Project Title *</label>
            <input
              type="text"
              id="title"
              name="title"
              required
              placeholder="My AI-Powered App"
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            />
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label for="description" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Description * <span style="font-weight: 400; color: var(--text-tertiary);">(Markdown supported)</span></label>
            <textarea
              id="description"
              name="description"
              required
              rows={6}
              placeholder="What does your project do? What did you learn building it? What AI tools did you use?"
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text); resize: vertical; font-family: var(--font-body);"
            />
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label for="url" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Live URL</label>
            <input
              type="url"
              id="url"
              name="url"
              placeholder="https://myproject.com"
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            />
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label for="github_url" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">GitHub URL</label>
            <input
              type="url"
              id="github_url"
              name="github_url"
              placeholder="https://github.com/you/project"
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            />
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label for="cohort_id" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Cohort (optional)</label>
            <select
              id="cohort_id"
              name="cohort_id"
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            >
              <option value="">No specific cohort</option>
              {allCohorts.map((ch) => (
                <option value={String(ch.id)}>{ch.title}</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            style="background: var(--accent); color: white; border: none; padding: 0.75rem 2rem; border-radius: 6px; font-size: 1rem; font-weight: 500; cursor: pointer;"
          >
            Share Project
          </button>
        </form>
      </div>
    </Layout>
  )
})

// Project detail — /projects/:id
projectRoutes.get('/projects/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const hasAccess = await hasCommunityAccess(c.env.DB, user)
  if (!hasAccess) return c.redirect('/community')

  const projectId = parseInt(c.req.param('id'), 10)
  if (isNaN(projectId)) return c.redirect('/projects')

  const db = getDb(c.env.DB)

  const result = await db
    .select({
      project: projects,
      author: { name: users.name, id: users.id, avatarUrl: users.avatarUrl, github: users.github },
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.id, projectId))
    .get()

  if (!result || result.project.status !== 'active') {
    return c.html(
      <Layout title="Project Not Found" user={user}>
        <div class="page-section" style="text-align: center; padding: 6rem 0;">
          <h2>Project not found</h2>
          <p><a href="/projects">← Back to Projects</a></p>
        </div>
      </Layout>,
      404
    )
  }

  const { project, author } = result
  const descHtml = renderMarkdown(project.description)
  const isOwner = user.id === project.userId
  const canEdit = isOwner || isAdmin(user)

  return c.html(
    <Layout title={project.title} user={user}>
      <div class="page-section" style="max-width: 700px; margin: 0 auto;">
        <a href="/projects" class="back-link">← Projects</a>

        <h2 style="margin-top: 1rem;">{project.title}</h2>

        <div style="display: flex; align-items: center; gap: 0.75rem; margin-top: 0.75rem; flex-wrap: wrap;">
          <a href={`/members/${author.id}`} style="color: var(--text-secondary); font-weight: 500; text-decoration: none;">
            by {author.name || 'Anonymous'}
          </a>
          <span style="color: var(--text-tertiary); font-family: var(--font-mono); font-size: 0.8rem;">
            {new Date(project.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
        </div>

        <div style="display: flex; gap: 1rem; margin-top: 1rem; flex-wrap: wrap;">
          {project.url && (
            <a href={project.url} target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 0.25rem; color: var(--accent); font-weight: 500; font-size: 0.9rem;">
              Visit Project →
            </a>
          )}
          {project.githubUrl && (
            <a href={project.githubUrl} target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 0.25rem; color: var(--text-secondary); font-weight: 500; font-size: 0.9rem;">
              GitHub →
            </a>
          )}
          {canEdit && (
            <a href={`/projects/${project.id}/edit`} style="color: var(--text-tertiary); font-size: 0.9rem;">
              Edit
            </a>
          )}
        </div>

        <div class="md-content" style="margin-top: 2rem;" dangerouslySetInnerHTML={{ __html: descHtml }} />
      </div>
    </Layout>
  )
})

// Edit project — /projects/:id/edit
projectRoutes.get('/projects/:id/edit', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const projectId = parseInt(c.req.param('id'), 10)
  if (isNaN(projectId)) return c.redirect('/projects')

  const db = getDb(c.env.DB)

  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get()
  if (!project || (project.userId !== user.id && !isAdmin(user))) {
    return c.redirect('/projects')
  }

  const allCohorts = await db.select({ id: cohorts.id, title: cohorts.title }).from(cohorts).all()
  const error = c.req.query('error')

  return c.html(
    <Layout title={`Edit: ${project.title}`} user={user}>
      <div class="page-section" style="max-width: 600px; margin: 0 auto;">
        <a href={`/projects/${project.id}`} class="back-link">← Back to Project</a>

        <p class="section-label">Edit Project</p>
        <h2>{project.title}</h2>

        {error === 'missing_fields' && (
          <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            Please fill in the title and description.
          </div>
        )}

        <form method="post" action={`/api/projects/${project.id}`} style="margin-top: 2rem;">
          <div style="margin-bottom: 1.5rem;">
            <label for="title" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Project Title *</label>
            <input
              type="text"
              id="title"
              name="title"
              required
              value={project.title}
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            />
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label for="description" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Description *</label>
            <textarea
              id="description"
              name="description"
              required
              rows={6}
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text); resize: vertical; font-family: var(--font-body);"
            >{project.description}</textarea>
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label for="url" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Live URL</label>
            <input type="url" id="url" name="url" value={project.url || ''} style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);" />
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label for="github_url" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">GitHub URL</label>
            <input type="url" id="github_url" name="github_url" value={project.githubUrl || ''} style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);" />
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label for="cohort_id" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Cohort (optional)</label>
            <select id="cohort_id" name="cohort_id" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);">
              <option value="">No specific cohort</option>
              {allCohorts.map((ch) => (
                <option value={String(ch.id)} selected={project.cohortId === ch.id}>{ch.title}</option>
              ))}
            </select>
          </div>

          <button type="submit" style="background: var(--accent); color: white; border: none; padding: 0.75rem 2rem; border-radius: 6px; font-size: 1rem; font-weight: 500; cursor: pointer;">
            Save Changes
          </button>
        </form>
      </div>
    </Layout>
  )
})

export default projectRoutes
