import { Hono } from 'hono'
import { eq, and, desc, isNull, count } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { discussions, comments, users, cohorts, lessons } from '../db/schema'
import { renderMarkdown } from '../lib/markdown'
import { canAccessCohort, hasCommunityAccess } from '../lib/access'
import type { AppContext } from '../types'

const discussionRoutes = new Hono<AppContext>()

// ===== PER-COHORT DISCUSSIONS =====

// Discussion list — /cohort/:slug/discussions
discussionRoutes.get('/cohort/:slug/discussions', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const slug = c.req.param('slug')
  const db = getDb(c.env.DB)

  const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, slug)).get()
  if (!cohort) {
    return c.html(
      <Layout title="Not Found" user={user}>
        <div class="page-section" style="text-align: center; padding: 6rem 0;">
          <h2>Cohort not found</h2>
          <p><a href="/">← Back to homepage</a></p>
        </div>
      </Layout>,
      404
    )
  }

  const hasAccess = await canAccessCohort(c.env.DB, user, cohort.id, cohort.isPublic)
  if (!hasAccess) return c.redirect(`/cohort/${slug}`)

  const threads = await db
    .select({
      discussion: discussions,
      author: { name: users.name, id: users.id },
    })
    .from(discussions)
    .innerJoin(users, eq(discussions.userId, users.id))
    .where(
      and(
        eq(discussions.cohortId, cohort.id),
        eq(discussions.status, 'active')
      )
    )
    .orderBy(desc(discussions.isPinned), desc(discussions.createdAt))
    .all()

  // Get comment counts for each discussion
  const threadIds = threads.map(t => t.discussion.id)
  const commentCounts = new Map<number, number>()
  for (const t of threads) {
    const result = await db
      .select({ value: count() })
      .from(comments)
      .where(and(eq(comments.discussionId, t.discussion.id), eq(comments.status, 'active')))
      .get()
    commentCounts.set(t.discussion.id, result?.value || 0)
  }

  return c.html(
    <Layout title={`Discussions — ${cohort.title}`} user={user}>
      <div class="page-section">
        <a href={`/cohort/${slug}`} class="back-link">← {cohort.title}</a>

        <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 1rem;">
          <div>
            <p class="section-label">{cohort.title}</p>
            <h2>Discussions</h2>
          </div>
          <a href={`/cohort/${slug}/discussions/new`} style="display: inline-block; background: var(--accent); color: white; padding: 0.6rem 1.25rem; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 0.9rem;">
            New Discussion
          </a>
        </div>

        {threads.length > 0 ? (
          <div class="discussion-list" style="margin-top: 2rem;">
            {threads.map(({ discussion, author }) => (
              <a href={`/cohort/${slug}/discussions/${discussion.id}`} class="discussion-item">
                <div>
                  <h4>
                    {discussion.isPinned ? '📌 ' : ''}
                    {discussion.title}
                  </h4>
                  <span class="discussion-meta">
                    by {author.name || 'Anonymous'} · {new Date(discussion.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {(commentCounts.get(discussion.id) || 0) > 0 && ` · ${commentCounts.get(discussion.id)} replies`}
                  </span>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div class="empty-state" style="margin-top: 2rem;">
            <p>No discussions yet. Start a conversation!</p>
            <a href={`/cohort/${slug}/discussions/new`} style="display: inline-block; margin-top: 1rem; color: var(--accent); font-weight: 500;">Start a Discussion →</a>
          </div>
        )}
      </div>
    </Layout>
  )
})

// New discussion form — /cohort/:slug/discussions/new
discussionRoutes.get('/cohort/:slug/discussions/new', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const slug = c.req.param('slug')
  const db = getDb(c.env.DB)

  const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, slug)).get()
  if (!cohort) return c.redirect('/')

  const hasAccess = await canAccessCohort(c.env.DB, user, cohort.id, cohort.isPublic)
  if (!hasAccess) return c.redirect(`/cohort/${slug}`)

  // Get published lessons for the optional "lesson" dropdown
  const cohortLessons = await db
    .select({ id: lessons.id, weekNumber: lessons.weekNumber, title: lessons.title })
    .from(lessons)
    .where(and(eq(lessons.cohortId, cohort.id), eq(lessons.status, 'published')))
    .orderBy(lessons.weekNumber)
    .all()

  const error = c.req.query('error')
  const lessonIdParam = c.req.query('lesson_id')

  return c.html(
    <Layout title={`New Discussion — ${cohort.title}`} user={user}>
      <div class="page-section" style="max-width: 600px; margin: 0 auto;">
        <a href={`/cohort/${slug}/discussions`} class="back-link">← Discussions</a>

        <p class="section-label">{cohort.title}</p>
        <h2>New Discussion</h2>

        {error === 'missing_fields' && (
          <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            Please fill in the title and body.
          </div>
        )}

        <form method="post" action="/api/discussions" style="margin-top: 2rem;">
          <input type="hidden" name="cohort_id" value={String(cohort.id)} />
          <input type="hidden" name="return_slug" value={slug} />

          <div style="margin-bottom: 1.5rem;">
            <label for="lesson_id" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Related Lesson (optional)</label>
            <select id="lesson_id" name="lesson_id" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);">
              <option value="">General Discussion</option>
              {cohortLessons.map((l) => (
                <option value={String(l.id)} selected={lessonIdParam === String(l.id)}>Week {l.weekNumber}: {l.title}</option>
              ))}
            </select>
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label for="title" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Title *</label>
            <input
              type="text"
              id="title"
              name="title"
              required
              placeholder="What's on your mind?"
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            />
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label for="body" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Body * <span style="font-weight: 400; color: var(--text-tertiary);">(Markdown supported)</span></label>
            <textarea
              id="body"
              name="body"
              required
              rows={8}
              placeholder="Share your thoughts, questions, or ideas..."
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text); resize: vertical; font-family: var(--font-body);"
            />
          </div>

          <button type="submit" style="background: var(--accent); color: white; border: none; padding: 0.75rem 2rem; border-radius: 6px; font-size: 1rem; font-weight: 500; cursor: pointer;">
            Post Discussion
          </button>
        </form>
      </div>
    </Layout>
  )
})

// Discussion thread + comments — /cohort/:slug/discussions/:id
discussionRoutes.get('/cohort/:slug/discussions/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const slug = c.req.param('slug')
  const discussionId = parseInt(c.req.param('id'), 10)
  if (isNaN(discussionId)) return c.redirect(`/cohort/${slug}/discussions`)

  const db = getDb(c.env.DB)

  const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, slug)).get()
  if (!cohort) return c.redirect('/')

  const hasAccess = await canAccessCohort(c.env.DB, user, cohort.id, cohort.isPublic)
  if (!hasAccess) return c.redirect(`/cohort/${slug}`)

  const result = await db
    .select({
      discussion: discussions,
      author: { name: users.name, id: users.id, avatarUrl: users.avatarUrl },
    })
    .from(discussions)
    .innerJoin(users, eq(discussions.userId, users.id))
    .where(and(eq(discussions.id, discussionId), eq(discussions.status, 'active')))
    .get()

  if (!result) {
    return c.html(
      <Layout title="Discussion Not Found" user={user}>
        <div class="page-section" style="text-align: center; padding: 6rem 0;">
          <h2>Discussion not found</h2>
          <p><a href={`/cohort/${slug}/discussions`}>← Back to Discussions</a></p>
        </div>
      </Layout>,
      404
    )
  }

  const { discussion, author } = result
  const bodyHtml = renderMarkdown(discussion.body)

  // Get all comments with authors
  const threadComments = await db
    .select({
      comment: comments,
      author: { name: users.name, id: users.id, avatarUrl: users.avatarUrl },
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(and(eq(comments.discussionId, discussionId), eq(comments.status, 'active')))
    .orderBy(comments.createdAt)
    .all()

  // Separate top-level comments and replies
  const topLevel = threadComments.filter(c => !c.comment.parentId)
  const replies = threadComments.filter(c => c.comment.parentId)
  const replyMap = new Map<number, typeof threadComments>()
  replies.forEach(r => {
    const parentId = r.comment.parentId!
    if (!replyMap.has(parentId)) replyMap.set(parentId, [])
    replyMap.get(parentId)!.push(r)
  })

  return c.html(
    <Layout title={discussion.title} user={user}>
      <div class="page-section" style="max-width: 700px; margin: 0 auto;">
        <a href={`/cohort/${slug}/discussions`} class="back-link">← Discussions</a>

        <h2 style="margin-top: 1rem;">
          {discussion.isPinned ? '📌 ' : ''}
          {discussion.title}
        </h2>

        <div style="display: flex; align-items: center; gap: 0.75rem; margin-top: 0.5rem;">
          <a href={`/members/${author.id}`} style="color: var(--text-secondary); font-weight: 500; text-decoration: none;">
            {author.name || 'Anonymous'}
          </a>
          <span style="color: var(--text-tertiary); font-family: var(--font-mono); font-size: 0.8rem;">
            {new Date(discussion.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
        </div>

        <div class="md-content" style="margin-top: 1.5rem;" dangerouslySetInnerHTML={{ __html: bodyHtml }} />

        <div style="margin-top: 3rem; border-top: 1px solid var(--border); padding-top: 2rem;">
          <h3 style="font-family: var(--font-display);">{threadComments.length} {threadComments.length === 1 ? 'Reply' : 'Replies'}</h3>

          <div class="comment-list" style="margin-top: 1rem;">
            {topLevel.map(({ comment: cmt, author: cAuth }) => (
              <div class="comment" id={`comment-${cmt.id}`}>
                <div class="comment-header">
                  <a href={`/members/${cAuth.id}`} class="comment-author">{cAuth.name || 'Anonymous'}</a>
                  <span class="comment-time">{new Date(cmt.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
                <div class="comment-body md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(cmt.body) }} />

                {/* Replies */}
                {replyMap.has(cmt.id) && (
                  <div style="margin-left: 1.5rem; border-left: 2px solid var(--border); padding-left: 1rem;">
                    {replyMap.get(cmt.id)!.map(({ comment: reply, author: rAuth }) => (
                      <div class="comment" id={`comment-${reply.id}`}>
                        <div class="comment-header">
                          <a href={`/members/${rAuth.id}`} class="comment-author">{rAuth.name || 'Anonymous'}</a>
                          <span class="comment-time">{new Date(reply.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </div>
                        <div class="comment-body md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(reply.body) }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Reply form */}
          <div style="margin-top: 2rem; padding: 1.5rem; background: var(--surface); border-radius: 10px;">
            <h4 style="font-family: var(--font-display); margin-bottom: 1rem;">Add a Reply</h4>
            <form method="post" action={`/api/discussions/${discussionId}/comments`}>
              <input type="hidden" name="return_url" value={`/cohort/${slug}/discussions/${discussionId}`} />
              <textarea
                name="body"
                required
                rows={4}
                placeholder="Share your thoughts... (Markdown supported)"
                style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: white; color: var(--text); resize: vertical; font-family: var(--font-body); margin-bottom: 1rem;"
              />
              <button type="submit" style="background: var(--accent); color: white; border: none; padding: 0.6rem 1.5rem; border-radius: 6px; font-size: 0.9rem; font-weight: 500; cursor: pointer;">
                Post Reply
              </button>
            </form>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// ===== COMMUNITY-WIDE DISCUSSIONS (cohortId = null) =====

// Community discussion list — /community/discussions
discussionRoutes.get('/community/discussions', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const hasAccess = await hasCommunityAccess(c.env.DB, user)
  if (!hasAccess) return c.redirect('/community')

  const db = getDb(c.env.DB)

  const threads = await db
    .select({
      discussion: discussions,
      author: { name: users.name, id: users.id },
    })
    .from(discussions)
    .innerJoin(users, eq(discussions.userId, users.id))
    .where(
      and(
        isNull(discussions.cohortId),
        eq(discussions.status, 'active')
      )
    )
    .orderBy(desc(discussions.isPinned), desc(discussions.createdAt))
    .all()

  // Get comment counts
  const commentCounts = new Map<number, number>()
  for (const t of threads) {
    const result = await db
      .select({ value: count() })
      .from(comments)
      .where(and(eq(comments.discussionId, t.discussion.id), eq(comments.status, 'active')))
      .get()
    commentCounts.set(t.discussion.id, result?.value || 0)
  }

  return c.html(
    <Layout title="Community Discussions" user={user}>
      <div class="page-section">
        <a href="/community" class="back-link">← Community</a>

        <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 1rem;">
          <div>
            <p class="section-label">Community</p>
            <h2>Discussions</h2>
          </div>
          <a href="/community/discussions/new" style="display: inline-block; background: var(--accent); color: white; padding: 0.6rem 1.25rem; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 0.9rem;">
            New Discussion
          </a>
        </div>

        {threads.length > 0 ? (
          <div class="discussion-list" style="margin-top: 2rem;">
            {threads.map(({ discussion, author }) => (
              <a href={`/community/discussions/${discussion.id}`} class="discussion-item">
                <div>
                  <h4>
                    {discussion.isPinned ? '📌 ' : ''}
                    {discussion.title}
                  </h4>
                  <span class="discussion-meta">
                    by {author.name || 'Anonymous'} · {new Date(discussion.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {(commentCounts.get(discussion.id) || 0) > 0 && ` · ${commentCounts.get(discussion.id)} replies`}
                  </span>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div class="empty-state" style="margin-top: 2rem;">
            <p>No discussions yet. Start a conversation!</p>
            <a href="/community/discussions/new" style="display: inline-block; margin-top: 1rem; color: var(--accent); font-weight: 500;">Start a Discussion →</a>
          </div>
        )}
      </div>
    </Layout>
  )
})

// New community discussion form — /community/discussions/new
discussionRoutes.get('/community/discussions/new', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const hasAccess = await hasCommunityAccess(c.env.DB, user)
  if (!hasAccess) return c.redirect('/community')

  const error = c.req.query('error')

  return c.html(
    <Layout title="New Discussion" user={user}>
      <div class="page-section" style="max-width: 600px; margin: 0 auto;">
        <a href="/community/discussions" class="back-link">← Discussions</a>

        <p class="section-label">Community</p>
        <h2>New Discussion</h2>

        {error === 'missing_fields' && (
          <div style="margin-top: 1rem; padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            Please fill in the title and body.
          </div>
        )}

        <form method="post" action="/api/discussions" style="margin-top: 2rem;">
          <input type="hidden" name="return_community" value="1" />

          <div style="margin-bottom: 1.5rem;">
            <label for="title" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Title *</label>
            <input
              type="text"
              id="title"
              name="title"
              required
              placeholder="What's on your mind?"
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text);"
            />
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label for="body" style="display: block; font-weight: 500; margin-bottom: 0.5rem; font-size: 0.9rem;">Body * <span style="font-weight: 400; color: var(--text-tertiary);">(Markdown supported)</span></label>
            <textarea
              id="body"
              name="body"
              required
              rows={8}
              placeholder="Share your thoughts, questions, or ideas with the community..."
              style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: var(--surface); color: var(--text); resize: vertical; font-family: var(--font-body);"
            />
          </div>

          <button type="submit" style="background: var(--accent); color: white; border: none; padding: 0.75rem 2rem; border-radius: 6px; font-size: 1rem; font-weight: 500; cursor: pointer;">
            Post Discussion
          </button>
        </form>
      </div>
    </Layout>
  )
})

// Community discussion thread — /community/discussions/:id
discussionRoutes.get('/community/discussions/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/sign-in')

  const hasAccess = await hasCommunityAccess(c.env.DB, user)
  if (!hasAccess) return c.redirect('/community')

  const discussionId = parseInt(c.req.param('id'), 10)
  if (isNaN(discussionId)) return c.redirect('/community/discussions')

  const db = getDb(c.env.DB)

  const result = await db
    .select({
      discussion: discussions,
      author: { name: users.name, id: users.id, avatarUrl: users.avatarUrl },
    })
    .from(discussions)
    .innerJoin(users, eq(discussions.userId, users.id))
    .where(and(eq(discussions.id, discussionId), eq(discussions.status, 'active')))
    .get()

  if (!result) {
    return c.html(
      <Layout title="Discussion Not Found" user={user}>
        <div class="page-section" style="text-align: center; padding: 6rem 0;">
          <h2>Discussion not found</h2>
          <p><a href="/community/discussions">← Back to Discussions</a></p>
        </div>
      </Layout>,
      404
    )
  }

  const { discussion, author } = result
  const bodyHtml = renderMarkdown(discussion.body)

  const threadComments = await db
    .select({
      comment: comments,
      author: { name: users.name, id: users.id, avatarUrl: users.avatarUrl },
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(and(eq(comments.discussionId, discussionId), eq(comments.status, 'active')))
    .orderBy(comments.createdAt)
    .all()

  const topLevel = threadComments.filter(c => !c.comment.parentId)
  const repliesList = threadComments.filter(c => c.comment.parentId)
  const replyMap = new Map<number, typeof threadComments>()
  repliesList.forEach(r => {
    const parentId = r.comment.parentId!
    if (!replyMap.has(parentId)) replyMap.set(parentId, [])
    replyMap.get(parentId)!.push(r)
  })

  return c.html(
    <Layout title={discussion.title} user={user}>
      <div class="page-section" style="max-width: 700px; margin: 0 auto;">
        <a href="/community/discussions" class="back-link">← Discussions</a>

        <h2 style="margin-top: 1rem;">
          {discussion.isPinned ? '📌 ' : ''}
          {discussion.title}
        </h2>

        <div style="display: flex; align-items: center; gap: 0.75rem; margin-top: 0.5rem;">
          <a href={`/members/${author.id}`} style="color: var(--text-secondary); font-weight: 500; text-decoration: none;">
            {author.name || 'Anonymous'}
          </a>
          <span style="color: var(--text-tertiary); font-family: var(--font-mono); font-size: 0.8rem;">
            {new Date(discussion.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
        </div>

        <div class="md-content" style="margin-top: 1.5rem;" dangerouslySetInnerHTML={{ __html: bodyHtml }} />

        <div style="margin-top: 3rem; border-top: 1px solid var(--border); padding-top: 2rem;">
          <h3 style="font-family: var(--font-display);">{threadComments.length} {threadComments.length === 1 ? 'Reply' : 'Replies'}</h3>

          <div class="comment-list" style="margin-top: 1rem;">
            {topLevel.map(({ comment: cmt, author: cAuth }) => (
              <div class="comment" id={`comment-${cmt.id}`}>
                <div class="comment-header">
                  <a href={`/members/${cAuth.id}`} class="comment-author">{cAuth.name || 'Anonymous'}</a>
                  <span class="comment-time">{new Date(cmt.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
                <div class="comment-body md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(cmt.body) }} />

                {replyMap.has(cmt.id) && (
                  <div style="margin-left: 1.5rem; border-left: 2px solid var(--border); padding-left: 1rem;">
                    {replyMap.get(cmt.id)!.map(({ comment: reply, author: rAuth }) => (
                      <div class="comment" id={`comment-${reply.id}`}>
                        <div class="comment-header">
                          <a href={`/members/${rAuth.id}`} class="comment-author">{rAuth.name || 'Anonymous'}</a>
                          <span class="comment-time">{new Date(reply.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </div>
                        <div class="comment-body md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(reply.body) }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style="margin-top: 2rem; padding: 1.5rem; background: var(--surface); border-radius: 10px;">
            <h4 style="font-family: var(--font-display); margin-bottom: 1rem;">Add a Reply</h4>
            <form method="post" action={`/api/discussions/${discussionId}/comments`}>
              <input type="hidden" name="return_url" value={`/community/discussions/${discussionId}`} />
              <textarea
                name="body"
                required
                rows={4}
                placeholder="Share your thoughts... (Markdown supported)"
                style="width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: white; color: var(--text); resize: vertical; font-family: var(--font-body); margin-bottom: 1rem;"
              />
              <button type="submit" style="background: var(--accent); color: white; border: none; padding: 0.6rem 1.5rem; border-radius: 6px; font-size: 0.9rem; font-weight: 500; cursor: pointer;">
                Post Reply
              </button>
            </form>
          </div>
        </div>
      </div>
    </Layout>
  )
})

export default discussionRoutes
