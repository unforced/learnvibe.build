// Minimal MCP (Model Context Protocol) server for Learn Vibe Build.
// Exposes a JSON-RPC 2.0 endpoint at POST /mcp. Bearer-token auth via
// the existing API key system — get a key at /settings/api-keys and
// configure it in your MCP client's Authorization header.
//
// OAuth 2.1 flow is out of scope for this phase; tracked separately.

import { Hono } from 'hono'
import { eq, and, asc, desc, or, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import {
  cohorts, lessons, enrollments, lessonProgress, projects,
  discussions, comments, users, applications, artifacts, memberships,
} from '../db/schema'
import { authenticateApiKey } from '../lib/api-auth'
import { authenticateOAuthToken } from '../lib/oauth'
import { isAdmin } from '../lib/auth'
import { sendBroadcast, type BroadcastAudience } from '../lib/email'
import { renderMarkdown } from '../lib/markdown'
import { validateDeck } from '../lib/deck-schema'
import type { AppContext } from '../types'
import type { AuthUser } from '../lib/auth'

const mcp = new Hono<AppContext>()

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = {
  name: 'learnvibe',
  version: '1.0.0',
}

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: any
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: number | string | null
  result?: any
  error?: { code: number; message: string; data?: any }
}

function ok(id: number | string | null | undefined, result: any): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function err(id: number | string | null | undefined, code: number, message: string, data?: any): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined && { data }) } }
}

// MCP responses wrap tool output in { content: [{ type: 'text', text: ... }] }.
function textResult(obj: any): any {
  return {
    content: [{
      type: 'text',
      text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2),
    }],
  }
}

// ===== TOOL DEFINITIONS =====

type ToolHandler = (args: any, user: AuthUser, db: ReturnType<typeof getDb>, c: any) => Promise<any>

interface ToolDef {
  name: string
  description: string
  inputSchema: any
  adminOnly?: boolean
  handler: ToolHandler
}

/** Resolve the user's "active cohort" — preferred default for tools that
 *  take a cohortSlug. Logic: prefer a single non-dropped enrollment;
 *  break ties by latest cohort id. Returns null when the user has no
 *  enrollments (e.g. interest-list signups, admins not in any cohort).
 *  Tools that fall through to this should error clearly when null,
 *  asking the caller to pass cohortSlug explicitly. */
async function resolveActiveCohortSlug(
  db: ReturnType<typeof getDb>,
  userId: number,
): Promise<string | null> {
  const rows = await db
    .select({ slug: cohorts.slug, status: enrollments.status, cohortId: cohorts.id })
    .from(enrollments)
    .innerJoin(cohorts, eq(enrollments.cohortId, cohorts.id))
    .where(eq(enrollments.userId, userId))
    .all()
  if (rows.length === 0) return null
  const live = rows.filter(r => r.status !== 'dropped')
  const candidates = live.length > 0 ? live : rows
  // Latest cohortId wins for stable behavior in multi-cohort cases.
  candidates.sort((a, b) => b.cohortId - a.cohortId)
  return candidates[0].slug
}

/** The slide-deck JSON vocabulary, inlined into tool descriptions so any
 *  Claude session can author decks correctly without reading code. Keep in
 *  sync with src/lib/deck-schema.ts (the validator is the source of truth). */
const DECK_MODEL_DOC = `Deck JSON model: { title: string, slides: Slide[] } (max 40 slides). Every slide has: layout (string), optional notes (speaker-notes string, shown in the presenter overlay), optional label (short screen label like "05 Signature Prompt"). Layouts and their fields:
- title: { kicker, heading, sub, meta } — opening slide; meta is the mono footer line.
- statement: { kicker, heading, lead?, dark?, surface? } — one big statement; dark/surface switch the background.
- arc: { kicker, heading, items: [{num, name, now?}], note? } — sequence of chips with one highlighted "now" chip.
- cards: { kicker, heading, cards: [{label, heading, body}] } — 2 or 3 cards; the grid adapts to the count.
- prompt: { kicker, heading, filename?, barLabel?, paragraphs: string[], footnote? } — dark terminal-style prompt block; filename adds the surface background + filename header treatment.
- list: { kicker, heading, items: [{num?, name, sub?, desc}], footnote? } — numbered editorial rows.
- twoCol: { kicker, heading, cols: [{label, heading, body?, kv?: [{k, v}], pinned?}] } — exactly 2 column cards; pinned adds an orange left edge.
- closing: { kicker, heading, items?: [{num, name, desc}], mantras?: string[], signoff? } — compact recap + display-size mantras.
Text handling in ALL fields: everything is HTML-escaped (no raw HTML), [[text]] renders as an orange accent span, and newlines become line breaks in heading/sub fields.`

const TOOLS: ToolDef[] = [
  {
    name: 'get_my_profile',
    description: "Get the current user's profile, role, and cohort enrollments.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, user, db) => {
      const profile = await db.select().from(users).where(eq(users.id, user.id)).get()
      const userEnrollments = await db
        .select({ cohort: cohorts, enrollment: enrollments })
        .from(enrollments)
        .innerJoin(cohorts, eq(enrollments.cohortId, cohorts.id))
        .where(eq(enrollments.userId, user.id))
        .all()
      return textResult({
        id: profile?.id,
        email: profile?.email,
        name: profile?.name,
        role: profile?.role,
        bio: profile?.bio,
        location: profile?.location,
        website: profile?.website,
        github: profile?.github,
        enrollments: userEnrollments.map(e => ({
          cohortSlug: e.cohort.slug,
          cohortTitle: e.cohort.title,
          status: e.enrollment.status,
          enrolledAt: e.enrollment.enrolledAt,
        })),
      })
    },
  },
  {
    name: 'update_my_profile',
    description: "Update fields on your own LVB profile. Pass only the fields you want to change — others stay as they are. Useful for filling out your profile (name, bio, location, website, github) without leaving your AI conversation. Email and role are read-only here (email is managed by your Clerk account; role is admin-only). Returns the updated profile.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Your display name.' },
        bio: { type: 'string', description: 'Short bio. Markdown-light is fine.' },
        location: { type: 'string', description: 'City / region.' },
        website: { type: 'string', description: 'Personal site or portfolio URL.' },
        github: { type: 'string', description: 'GitHub username OR full URL.' },
      },
      additionalProperties: false,
    },
    handler: async (args, user, db) => {
      // Build the update payload from the fields that were actually sent.
      // Empty string is treated as "clear this field" → null. Undefined =
      // don't touch. This lets callers ask Claude things like "remove my
      // bio" and have it pass bio: '' explicitly.
      const updates: Record<string, string | null> = {}
      const fields: Array<keyof typeof args & ('name' | 'bio' | 'location' | 'website' | 'github')> = [
        'name', 'bio', 'location', 'website', 'github',
      ]
      for (const f of fields) {
        if (Object.prototype.hasOwnProperty.call(args, f)) {
          const v = args[f]
          if (typeof v !== 'string') {
            throw new Error(`${f} must be a string (got ${typeof v})`)
          }
          // Light bounds — defensive only.
          if (v.length > 2000) {
            throw new Error(`${f} is too long (max 2000 chars)`)
          }
          updates[f] = v.trim() === '' ? null : v.trim()
        }
      }
      if (Object.keys(updates).length === 0) {
        throw new Error('No fields to update — pass at least one of: name, bio, location, website, github.')
      }
      updates.updatedAt = new Date().toISOString()

      await db.update(users).set(updates).where(eq(users.id, user.id))
      const updated = await db.select().from(users).where(eq(users.id, user.id)).get()
      if (!updated) throw new Error('Profile not found after update')
      return textResult({
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        bio: updated.bio,
        location: updated.location,
        website: updated.website,
        github: updated.github,
        updatedFields: Object.keys(updates).filter(k => k !== 'updatedAt'),
      })
    },
  },
  {
    name: 'list_cohorts',
    description: 'List all cohorts (past, current, upcoming).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, _user, db) => {
      const rows = await db.select().from(cohorts).orderBy(asc(cohorts.id)).all()
      return textResult(rows.map(c => ({
        slug: c.slug, title: c.title, description: c.description,
        startDate: c.startDate, endDate: c.endDate, weeks: c.weeks,
        status: c.status,
      })))
    },
  },
  {
    name: 'get_cohort',
    description: 'Get details for a cohort by slug (e.g. "cohort-1").',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
    },
    handler: async (args, _user, db) => {
      const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, args.slug)).get()
      if (!cohort) throw new Error(`Cohort '${args.slug}' not found`)
      return textResult(cohort)
    },
  },
  {
    name: 'list_lessons',
    description: 'List lessons for a cohort, with each lesson\'s title, description, date, and your completion status. If cohortSlug is omitted, defaults to your active enrolled cohort (most students only have one). Drafts are returned for admins; published-only for students. Common follow-up: get_lesson(weekNumber=N) to read the full content + transcript for a specific week.',
    inputSchema: {
      type: 'object',
      properties: {
        cohortSlug: { type: 'string', description: 'Cohort slug like "cohort-1". Optional — defaults to your active enrolled cohort.' },
      },
    },
    handler: async (args, user, db) => {
      const slug = args.cohortSlug || (await resolveActiveCohortSlug(db, user.id))
      if (!slug) throw new Error("No cohortSlug provided and you're not enrolled in any cohort. Pass cohortSlug explicitly (try list_cohorts to see available options).")
      const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, slug)).get()
      if (!cohort) throw new Error(`Cohort '${slug}' not found`)
      const admin = isAdmin(user)
      const rows = await db.select()
        .from(lessons)
        .where(admin
          ? eq(lessons.cohortId, cohort.id)
          : and(eq(lessons.cohortId, cohort.id), eq(lessons.status, 'published')))
        .orderBy(asc(lessons.weekNumber))
        .all()
      const progress = await db.select()
        .from(lessonProgress)
        .where(and(eq(lessonProgress.userId, user.id), eq(lessonProgress.cohortId, cohort.id)))
        .all()
      const completed = new Set(progress.map(p => p.lessonId))
      return textResult({
        cohortSlug: cohort.slug,
        cohortTitle: cohort.title,
        lessons: rows.map(l => ({
          weekNumber: l.weekNumber,
          title: l.title,
          description: l.description,
          date: l.date,
          status: l.status,
          completed: completed.has(l.id),
          hasTranscript: !!l.transcriptMarkdown,
          hasTranscriptSummary: !!l.transcriptSummary,
        })),
      })
    },
  },
  {
    name: 'get_lesson',
    description: 'Read a lesson — title, description, date, lesson plan markdown, and a short transcript summary (when present). The full session transcript is intentionally NOT in this response (it can be 30-100K chars per week and bloats context); reach for get_lesson_transcript when you need verbatim quotes or specific moments. cohortSlug defaults to your active enrolled cohort if omitted; weekNumber is required.',
    inputSchema: {
      type: 'object',
      properties: {
        cohortSlug: { type: 'string', description: 'Cohort slug like "cohort-1". Optional — defaults to your active enrolled cohort.' },
        weekNumber: { type: 'integer', minimum: 1, description: 'Week number (1-indexed). Required.' },
      },
      required: ['weekNumber'],
    },
    handler: async (args, user, db) => {
      const slug = args.cohortSlug || (await resolveActiveCohortSlug(db, user.id))
      if (!slug) throw new Error("No cohortSlug provided and you're not enrolled in any cohort. Pass cohortSlug explicitly (try list_cohorts to see available options).")
      const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, slug)).get()
      if (!cohort) throw new Error(`Cohort '${slug}' not found`)
      const admin = isAdmin(user)
      const lesson = await db.select()
        .from(lessons)
        .where(and(
          eq(lessons.cohortId, cohort.id),
          eq(lessons.weekNumber, args.weekNumber),
          ...(admin ? [] : [eq(lessons.status, 'published')]),
        ))
        .get()
      if (!lesson) throw new Error(`Lesson Week ${args.weekNumber} not found in ${slug}`)
      return textResult({
        cohortSlug: cohort.slug,
        weekNumber: lesson.weekNumber,
        title: lesson.title,
        description: lesson.description,
        date: lesson.date,
        status: lesson.status,
        contentMarkdown: lesson.contentMarkdown,
        recordingUrl: lesson.recordingUrl,
        // Default-surface a short summary, NOT the full transcript. Full
        // verbatim transcript is available via get_lesson_transcript when
        // a caller actually needs it. transcriptSummary is admin-written
        // (often by piping the transcript through Claude).
        transcriptSummary: lesson.transcriptSummary,
        hasTranscript: !!lesson.transcriptMarkdown,
        hasTranscriptSummary: !!lesson.transcriptSummary,
        // Live presentation page when a slide deck is stored for this week.
        // The deck JSON itself is available via get_deck.
        slidesUrl: lesson.slidesJson
          ? `https://learnvibe.build/cohort/${cohort.slug}/week/${lesson.weekNumber}/slides`
          : null,
      })
    },
  },
  {
    name: 'get_deck',
    description: `Read the slide deck stored for a lesson, as deck-model JSON, plus the live presentation URL. Errors when no deck is stored for that week (get_lesson's slidesUrl field tells you whether one exists). cohortSlug defaults to your active enrolled cohort; weekNumber is required. ${DECK_MODEL_DOC}`,
    inputSchema: {
      type: 'object',
      properties: {
        cohortSlug: { type: 'string', description: 'Cohort slug like "cohort-1". Optional — defaults to your active enrolled cohort.' },
        weekNumber: { type: 'integer', minimum: 1, description: 'Week number (1-indexed). Required.' },
      },
      required: ['weekNumber'],
    },
    handler: async (args, user, db) => {
      const slug = args.cohortSlug || (await resolveActiveCohortSlug(db, user.id))
      if (!slug) throw new Error("No cohortSlug provided and you're not enrolled in any cohort. Pass cohortSlug explicitly.")
      const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, slug)).get()
      if (!cohort) throw new Error(`Cohort '${slug}' not found`)
      const admin = isAdmin(user)
      const lesson = await db.select({
        weekNumber: lessons.weekNumber,
        title: lessons.title,
        slidesJson: lessons.slidesJson,
      })
        .from(lessons)
        .where(and(
          eq(lessons.cohortId, cohort.id),
          eq(lessons.weekNumber, args.weekNumber),
          ...(admin ? [] : [eq(lessons.status, 'published')]),
        ))
        .get()
      if (!lesson) throw new Error(`Lesson Week ${args.weekNumber} not found in ${slug}`)
      if (!lesson.slidesJson) throw new Error(`No slide deck stored for Week ${args.weekNumber} in ${slug}`)
      return textResult({
        cohortSlug: cohort.slug,
        weekNumber: lesson.weekNumber,
        lessonTitle: lesson.title,
        slidesUrl: `https://learnvibe.build/cohort/${cohort.slug}/week/${lesson.weekNumber}/slides`,
        deck: JSON.parse(lesson.slidesJson),
      })
    },
  },
  {
    name: 'get_lesson_transcript',
    description: 'Read the full verbatim session transcript for a lesson. Heavy — the entire session conversation, typically 30-100K chars when present. Prefer get_lesson for the short summary; reach for this only when you need verbatim quotes, specific moments, or detailed context the summary loses. Returns null when no transcript exists for that week. cohortSlug defaults to your active enrolled cohort.',
    inputSchema: {
      type: 'object',
      properties: {
        cohortSlug: { type: 'string', description: 'Cohort slug. Optional — defaults to your active enrolled cohort.' },
        weekNumber: { type: 'integer', minimum: 1, description: 'Week number (1-indexed). Required.' },
      },
      required: ['weekNumber'],
    },
    handler: async (args, user, db) => {
      const slug = args.cohortSlug || (await resolveActiveCohortSlug(db, user.id))
      if (!slug) throw new Error("No cohortSlug provided and you're not enrolled in any cohort. Pass cohortSlug explicitly.")
      const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, slug)).get()
      if (!cohort) throw new Error(`Cohort '${slug}' not found`)
      const admin = isAdmin(user)
      const lesson = await db.select({
        weekNumber: lessons.weekNumber,
        recordingUrl: lessons.recordingUrl,
        transcriptMarkdown: lessons.transcriptMarkdown,
        status: lessons.status,
      })
        .from(lessons)
        .where(and(
          eq(lessons.cohortId, cohort.id),
          eq(lessons.weekNumber, args.weekNumber),
          ...(admin ? [] : [eq(lessons.status, 'published')]),
        ))
        .get()
      if (!lesson) throw new Error(`Lesson Week ${args.weekNumber} not found in ${slug}`)
      return textResult({
        cohortSlug: cohort.slug,
        weekNumber: lesson.weekNumber,
        recordingUrl: lesson.recordingUrl,
        transcriptMarkdown: lesson.transcriptMarkdown,
      })
    },
  },
  {
    name: 'toggle_lesson_complete',
    description: 'Toggle your completion status for a lesson. Returns the new state.',
    inputSchema: {
      type: 'object',
      properties: {
        cohortSlug: { type: 'string' },
        weekNumber: { type: 'integer', minimum: 1 },
      },
      required: ['cohortSlug', 'weekNumber'],
    },
    handler: async (args, user, db) => {
      const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, args.cohortSlug)).get()
      if (!cohort) throw new Error(`Cohort '${args.cohortSlug}' not found`)
      const lesson = await db.select()
        .from(lessons)
        .where(and(eq(lessons.cohortId, cohort.id), eq(lessons.weekNumber, args.weekNumber)))
        .get()
      if (!lesson) throw new Error(`Lesson Week ${args.weekNumber} not found`)
      const existing = await db.select().from(lessonProgress)
        .where(and(eq(lessonProgress.userId, user.id), eq(lessonProgress.lessonId, lesson.id)))
        .get()
      if (existing) {
        await db.delete(lessonProgress).where(eq(lessonProgress.id, existing.id))
        return textResult({ completed: false, weekNumber: args.weekNumber })
      }
      await db.insert(lessonProgress).values({
        userId: user.id,
        lessonId: lesson.id,
        cohortId: cohort.id,
      })
      return textResult({ completed: true, weekNumber: args.weekNumber })
    },
  },
  {
    name: 'list_my_projects',
    description: "List your active projects.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, user, db) => {
      const rows = await db.select().from(projects)
        .where(and(eq(projects.userId, user.id), eq(projects.status, 'active')))
        .orderBy(desc(projects.createdAt))
        .all()
      return textResult(rows.map(p => ({
        id: p.id, title: p.title, url: p.url, githubUrl: p.githubUrl,
        description: p.description, createdAt: p.createdAt,
      })))
    },
  },
  {
    name: 'create_project',
    description: 'Add a project to the community gallery. Returns the created project id.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string', description: 'Markdown allowed.' },
        url: { type: 'string', description: 'Live URL (optional).' },
        githubUrl: { type: 'string', description: 'GitHub repo URL (optional).' },
        cohortSlug: { type: 'string', description: "Cohort to associate with (optional)." },
      },
      required: ['title', 'description'],
    },
    handler: async (args, user, db) => {
      let cohortId: number | null = null
      if (args.cohortSlug) {
        const c = await db.select({ id: cohorts.id }).from(cohorts).where(eq(cohorts.slug, args.cohortSlug)).get()
        if (c) cohortId = c.id
      }
      const inserted = await db.insert(projects).values({
        userId: user.id,
        title: args.title,
        description: args.description,
        url: args.url || null,
        githubUrl: args.githubUrl || null,
        cohortId,
      }).returning().get()
      return textResult({ id: inserted.id, title: inserted.title })
    },
  },
  {
    name: 'list_discussions',
    description: 'List discussions. Optionally filter by cohort slug.',
    inputSchema: {
      type: 'object',
      properties: {
        cohortSlug: { type: 'string', description: 'Filter to this cohort; omit for community-wide.' },
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
      },
    },
    handler: async (args, _user, db) => {
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 100)
      let cohortId: number | null = null
      if (args.cohortSlug) {
        const c = await db.select({ id: cohorts.id }).from(cohorts).where(eq(cohorts.slug, args.cohortSlug)).get()
        if (!c) throw new Error(`Cohort '${args.cohortSlug}' not found`)
        cohortId = c.id
      }
      const rows = await db.select({ d: discussions, user: { name: users.name, id: users.id } })
        .from(discussions)
        .innerJoin(users, eq(discussions.userId, users.id))
        .where(and(
          eq(discussions.status, 'active'),
          cohortId != null ? eq(discussions.cohortId, cohortId) : isNull(discussions.cohortId),
        ))
        .orderBy(desc(discussions.isPinned), desc(discussions.updatedAt))
        .limit(limit)
        .all()
      return textResult(rows.map(r => ({
        id: r.d.id,
        title: r.d.title,
        author: r.user.name,
        isPinned: !!r.d.isPinned,
        createdAt: r.d.createdAt,
        updatedAt: r.d.updatedAt,
      })))
    },
  },
  {
    name: 'get_discussion',
    description: 'Get a discussion with all its comments.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    handler: async (args, _user, db) => {
      const disc = await db.select({ d: discussions, user: { name: users.name } })
        .from(discussions)
        .innerJoin(users, eq(discussions.userId, users.id))
        .where(eq(discussions.id, args.id))
        .get()
      if (!disc) throw new Error(`Discussion ${args.id} not found`)
      const cmts = await db.select({ c: comments, user: { name: users.name } })
        .from(comments)
        .innerJoin(users, eq(comments.userId, users.id))
        .where(and(eq(comments.discussionId, args.id), eq(comments.status, 'active')))
        .orderBy(asc(comments.createdAt))
        .all()
      return textResult({
        id: disc.d.id,
        title: disc.d.title,
        body: disc.d.body,
        author: disc.user.name,
        createdAt: disc.d.createdAt,
        comments: cmts.map(c => ({
          id: c.c.id,
          body: c.c.body,
          author: c.user.name,
          parentId: c.c.parentId,
          createdAt: c.c.createdAt,
        })),
      })
    },
  },
  {
    name: 'create_discussion',
    description: 'Start a new discussion thread. Returns the created id.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string', description: 'Markdown allowed.' },
        cohortSlug: { type: 'string', description: 'Scope to a cohort; omit for community-wide.' },
      },
      required: ['title', 'body'],
    },
    handler: async (args, user, db) => {
      let cohortId: number | null = null
      if (args.cohortSlug) {
        const c = await db.select({ id: cohorts.id }).from(cohorts).where(eq(cohorts.slug, args.cohortSlug)).get()
        if (c) cohortId = c.id
      }
      const inserted = await db.insert(discussions).values({
        userId: user.id,
        title: args.title,
        body: args.body,
        cohortId,
      }).returning().get()
      return textResult({ id: inserted.id, title: inserted.title })
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a discussion.',
    inputSchema: {
      type: 'object',
      properties: {
        discussionId: { type: 'integer' },
        body: { type: 'string', description: 'Markdown allowed.' },
        parentId: { type: 'integer', description: 'Reply to another comment (optional).' },
      },
      required: ['discussionId', 'body'],
    },
    handler: async (args, user, db) => {
      const inserted = await db.insert(comments).values({
        userId: user.id,
        discussionId: args.discussionId,
        body: args.body,
        parentId: args.parentId || null,
      }).returning().get()
      return textResult({ id: inserted.id })
    },
  },

  // ===== ARTIFACTS =====
  {
    name: 'submit_artifact',
    description: 'Share an artifact attached to a lesson. An artifact is whatever you made for the week — a document, a reflection, a link. Either bodyMarkdown or attachedUrl must be provided. Defaults to generatedBy="ai" and visibility="class" for MCP submissions.',
    inputSchema: {
      type: 'object',
      properties: {
        cohortSlug: { type: 'string' },
        weekNumber: { type: 'integer', minimum: 1 },
        title: { type: 'string', description: 'Optional title.' },
        bodyMarkdown: { type: 'string', description: 'Inline prose / reflection / the artifact itself.' },
        attachedUrl: { type: 'string', description: 'Link to an external doc/site/image (http or https).' },
        generatedBy: { type: 'string', enum: ['human', 'collaborative', 'ai'], default: 'ai' },
        visibility: { type: 'string', enum: ['class', 'instructor'], default: 'class' },
      },
      required: ['cohortSlug', 'weekNumber'],
    },
    handler: async (args, user, db) => {
      const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, args.cohortSlug)).get()
      if (!cohort) throw new Error(`Cohort '${args.cohortSlug}' not found`)
      const lesson = await db.select().from(lessons)
        .where(and(eq(lessons.cohortId, cohort.id), eq(lessons.weekNumber, args.weekNumber)))
        .get()
      if (!lesson) throw new Error(`Lesson Week ${args.weekNumber} not found in ${args.cohortSlug}`)

      // Access check: must be enrolled in this cohort, or admin/facilitator, or have active membership.
      if (!isAdmin(user)) {
        const enr = await db.select({ id: enrollments.id }).from(enrollments)
          .where(and(eq(enrollments.userId, user.id), eq(enrollments.cohortId, cohort.id))).get()
        if (!enr) {
          const mem = await db.select({ id: memberships.id }).from(memberships)
            .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'active'))).get()
          if (!mem) throw new Error('You must be enrolled in this cohort to share artifacts.')
        }
      }

      const title = args.title ? String(args.title).slice(0, 200) : null
      const bodyMarkdown = args.bodyMarkdown ? String(args.bodyMarkdown).slice(0, 20000) : null
      const attachedUrl = args.attachedUrl ? String(args.attachedUrl).slice(0, 500) : null
      if (!bodyMarkdown && !attachedUrl) {
        throw new Error('Either bodyMarkdown or attachedUrl must be provided.')
      }
      if (attachedUrl && !/^https?:\/\//i.test(attachedUrl)) {
        throw new Error('attachedUrl must start with http:// or https://')
      }
      const generatedBy = ['human', 'collaborative', 'ai'].includes(args.generatedBy) ? args.generatedBy : 'ai'
      const visibility = args.visibility === 'instructor' ? 'instructor' : 'class'

      const inserted = await db.insert(artifacts).values({
        lessonId: lesson.id,
        userId: user.id,
        title, bodyMarkdown, attachedUrl, generatedBy, visibility,
      }).returning().get()

      return textResult({
        id: inserted.id,
        url: `https://learnvibe.build/cohort/${cohort.slug}/week/${lesson.weekNumber}#artifact-${inserted.id}`,
        generatedBy, visibility,
      })
    },
  },
  {
    name: 'list_artifacts',
    description: 'List artifacts attached to a lesson (respects visibility — you see class-visible + your own; admins see all).',
    inputSchema: {
      type: 'object',
      properties: {
        cohortSlug: { type: 'string' },
        weekNumber: { type: 'integer', minimum: 1 },
      },
      required: ['cohortSlug', 'weekNumber'],
    },
    handler: async (args, user, db) => {
      const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, args.cohortSlug)).get()
      if (!cohort) throw new Error(`Cohort '${args.cohortSlug}' not found`)
      const lesson = await db.select().from(lessons)
        .where(and(eq(lessons.cohortId, cohort.id), eq(lessons.weekNumber, args.weekNumber)))
        .get()
      if (!lesson) throw new Error(`Lesson Week ${args.weekNumber} not found`)

      const admin = isAdmin(user)
      const rows = await db.select({
        id: artifacts.id,
        title: artifacts.title,
        bodyMarkdown: artifacts.bodyMarkdown,
        attachedUrl: artifacts.attachedUrl,
        generatedBy: artifacts.generatedBy,
        visibility: artifacts.visibility,
        createdAt: artifacts.createdAt,
        userId: artifacts.userId,
        authorName: users.name,
      })
        .from(artifacts)
        .innerJoin(users, eq(users.id, artifacts.userId))
        .where(and(
          eq(artifacts.lessonId, lesson.id),
          eq(artifacts.status, 'active'),
          admin
            ? eq(artifacts.lessonId, lesson.id)
            : or(eq(artifacts.visibility, 'class'), eq(artifacts.userId, user.id))!,
        ))
        .orderBy(desc(artifacts.createdAt))
        .all()

      return textResult(rows.map(r => ({
        id: r.id,
        title: r.title || 'Untitled',
        author: r.authorName || 'Anonymous',
        authorId: r.userId,
        generatedBy: r.generatedBy,
        visibility: r.visibility,
        createdAt: r.createdAt,
        bodyMarkdown: r.bodyMarkdown,
        attachedUrl: r.attachedUrl,
      })))
    },
  },
  {
    name: 'update_artifact',
    description: 'Update one of your own artifacts. Only fields you pass are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        title: { type: 'string' },
        bodyMarkdown: { type: 'string' },
        attachedUrl: { type: 'string' },
        generatedBy: { type: 'string', enum: ['human', 'collaborative', 'ai'] },
        visibility: { type: 'string', enum: ['class', 'instructor'] },
      },
      required: ['id'],
    },
    handler: async (args, user, db) => {
      const existing = await db.select().from(artifacts).where(eq(artifacts.id, args.id)).get()
      if (!existing) throw new Error(`Artifact ${args.id} not found`)
      if (existing.userId !== user.id) throw new Error('You can only edit your own artifacts.')
      const updates: Record<string, any> = { updatedAt: new Date().toISOString() }
      if (args.title !== undefined) updates.title = String(args.title).slice(0, 200) || null
      if (args.bodyMarkdown !== undefined) updates.bodyMarkdown = String(args.bodyMarkdown).slice(0, 20000) || null
      if (args.attachedUrl !== undefined) {
        const u = String(args.attachedUrl).slice(0, 500) || null
        if (u && !/^https?:\/\//i.test(u)) throw new Error('attachedUrl must start with http:// or https://')
        updates.attachedUrl = u
      }
      if (args.generatedBy) updates.generatedBy = args.generatedBy
      if (args.visibility) updates.visibility = args.visibility
      // Enforce "at least one of body or url" on the *resulting* row.
      const nextBody = 'bodyMarkdown' in updates ? updates.bodyMarkdown : existing.bodyMarkdown
      const nextUrl = 'attachedUrl' in updates ? updates.attachedUrl : existing.attachedUrl
      if (!nextBody && !nextUrl) throw new Error('Artifact must have either bodyMarkdown or attachedUrl.')
      await db.update(artifacts).set(updates).where(eq(artifacts.id, args.id))
      return textResult({ id: args.id, updated: Object.keys(updates).filter(k => k !== 'updatedAt') })
    },
  },
  {
    name: 'delete_artifact',
    description: 'Soft-delete your own artifact (admins can delete any).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    handler: async (args, user, db) => {
      const existing = await db.select().from(artifacts).where(eq(artifacts.id, args.id)).get()
      if (!existing) throw new Error(`Artifact ${args.id} not found`)
      if (existing.userId !== user.id && !isAdmin(user)) {
        throw new Error('You can only delete your own artifacts.')
      }
      await db.update(artifacts)
        .set({ status: 'deleted', updatedAt: new Date().toISOString() })
        .where(eq(artifacts.id, args.id))
      return textResult({ id: args.id, deleted: true })
    },
  },
  {
    name: 'list_my_artifacts',
    description: 'List all of your own artifacts across every lesson, newest first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, user, db) => {
      const rows = await db.select({
        id: artifacts.id,
        title: artifacts.title,
        generatedBy: artifacts.generatedBy,
        visibility: artifacts.visibility,
        createdAt: artifacts.createdAt,
        lessonId: artifacts.lessonId,
        weekNumber: lessons.weekNumber,
        cohortSlug: cohorts.slug,
        cohortTitle: cohorts.title,
      })
        .from(artifacts)
        .innerJoin(lessons, eq(lessons.id, artifacts.lessonId))
        .innerJoin(cohorts, eq(cohorts.id, lessons.cohortId))
        .where(and(eq(artifacts.userId, user.id), eq(artifacts.status, 'active')))
        .orderBy(desc(artifacts.createdAt))
        .all()
      return textResult(rows)
    },
  },

  // ===== ADMIN TOOLS =====
  {
    name: 'admin_upsert_lesson',
    description: 'ADMIN: create or update a lesson by (cohortSlug, weekNumber). Only cohort slug, week, and at least one field to set are needed. recordingUrl auto-embeds when YouTube; transcriptMarkdown renders in a collapsible section below the lesson; transcriptSummary is the short admin-written summary that get_lesson surfaces by default for student queries.',
    adminOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        cohortSlug: { type: 'string' },
        weekNumber: { type: 'integer', minimum: 1 },
        title: { type: 'string' },
        description: { type: 'string' },
        date: { type: 'string', description: 'ISO date (YYYY-MM-DD).' },
        contentMarkdown: { type: 'string' },
        recordingUrl: { type: 'string', description: 'http(s) URL. YouTube auto-embeds; other URLs render as a "Watch recording" link.' },
        transcriptMarkdown: { type: 'string', description: 'Full session transcript, markdown supported. Renders in a collapsible section below the lesson content.' },
        transcriptSummary: { type: 'string', description: 'Short summary of the transcript (1-2 paragraphs). Surfaced by default on get_lesson; cheap to ship to students. Typically generated by piping the full transcript through Claude with a "summarize" prompt.' },
        status: { type: 'string', enum: ['draft', 'published'] },
      },
      required: ['cohortSlug', 'weekNumber'],
    },
    handler: async (args, _user, db) => {
      const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, args.cohortSlug)).get()
      if (!cohort) throw new Error(`Cohort '${args.cohortSlug}' not found`)
      const existing = await db.select()
        .from(lessons)
        .where(and(eq(lessons.cohortId, cohort.id), eq(lessons.weekNumber, args.weekNumber)))
        .get()
      // Validate recording URL shape if provided.
      if (args.recordingUrl !== undefined && args.recordingUrl !== null && args.recordingUrl !== '') {
        if (!/^https?:\/\//i.test(args.recordingUrl)) {
          throw new Error('recordingUrl must start with http:// or https://')
        }
      }
      const now = new Date().toISOString()
      if (existing) {
        const updates: Record<string, any> = { updatedAt: now }
        if (args.title !== undefined) updates.title = args.title
        if (args.description !== undefined) updates.description = args.description
        if (args.date !== undefined) updates.date = args.date
        if (args.contentMarkdown !== undefined) updates.contentMarkdown = args.contentMarkdown
        if (args.recordingUrl !== undefined) updates.recordingUrl = args.recordingUrl || null
        if (args.transcriptMarkdown !== undefined) updates.transcriptMarkdown = args.transcriptMarkdown || null
        if (args.transcriptSummary !== undefined) updates.transcriptSummary = args.transcriptSummary || null
        if (args.status !== undefined) updates.status = args.status
        await db.update(lessons).set(updates).where(eq(lessons.id, existing.id))
        return textResult({ action: 'updated', id: existing.id, weekNumber: args.weekNumber })
      }
      if (!args.title) throw new Error('title is required when creating a new lesson')
      const inserted = await db.insert(lessons).values({
        cohortId: cohort.id,
        weekNumber: args.weekNumber,
        title: args.title,
        description: args.description ?? null,
        date: args.date ?? null,
        contentMarkdown: args.contentMarkdown ?? '',
        recordingUrl: args.recordingUrl || null,
        transcriptMarkdown: args.transcriptMarkdown || null,
        transcriptSummary: args.transcriptSummary || null,
        status: args.status ?? 'draft',
        sortOrder: args.weekNumber,
        createdAt: now,
        updatedAt: now,
      }).returning().get()
      return textResult({ action: 'created', id: inserted.id, weekNumber: args.weekNumber })
    },
  },
  {
    name: 'admin_upsert_deck',
    description: `ADMIN: store (or replace) the slide deck for a lesson, identified by (cohortSlug, weekNumber). The deck is validated against the deck model before saving — on validation failure you get every problem found, fix them and retry. Slides render server-side at the returned slidesUrl in the Learn Vibe Build deck style (1920x1080 stage, scale-to-fit, arrow-key navigation, 'n' for speaker notes, print-to-PDF). The lesson must already exist — create it first with admin_upsert_lesson. Pass deck: null to remove a stored deck. ${DECK_MODEL_DOC}`,
    adminOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        cohortSlug: { type: 'string' },
        weekNumber: { type: 'integer', minimum: 1 },
        deck: {
          type: ['object', 'null'],
          description: 'The full deck as { title, slides } per the deck model in this tool\'s description. null removes the stored deck.',
        },
      },
      required: ['cohortSlug', 'weekNumber', 'deck'],
    },
    handler: async (args, _user, db) => {
      const cohort = await db.select().from(cohorts).where(eq(cohorts.slug, args.cohortSlug)).get()
      if (!cohort) throw new Error(`Cohort '${args.cohortSlug}' not found`)
      const lesson = await db.select({ id: lessons.id })
        .from(lessons)
        .where(and(eq(lessons.cohortId, cohort.id), eq(lessons.weekNumber, args.weekNumber)))
        .get()
      if (!lesson) throw new Error(`Lesson Week ${args.weekNumber} not found in ${args.cohortSlug} — create it first with admin_upsert_lesson`)

      const now = new Date().toISOString()
      if (args.deck === null) {
        await db.update(lessons).set({ slidesJson: null, updatedAt: now }).where(eq(lessons.id, lesson.id))
        return textResult({ action: 'removed', weekNumber: args.weekNumber })
      }

      const validated = validateDeck(args.deck)
      if (!validated.ok) {
        throw new Error(`Deck failed validation:\n- ${validated.errors.join('\n- ')}`)
      }
      await db.update(lessons)
        .set({ slidesJson: JSON.stringify(validated.deck), updatedAt: now })
        .where(eq(lessons.id, lesson.id))
      return textResult({
        action: 'saved',
        weekNumber: args.weekNumber,
        slideCount: validated.deck.slides.length,
        slidesUrl: `https://learnvibe.build/cohort/${cohort.slug}/week/${args.weekNumber}/slides`,
      })
    },
  },
  {
    name: 'admin_send_email',
    description: 'ADMIN: send a markdown email to an explicit list of email addresses. Use this to resend after a partial broadcast failure or for one-off targeted sends. Rate-limited internally to stay under the email send rate limit.',
    adminOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        emails: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 100,
          description: 'List of recipient email addresses.',
        },
        subject: { type: 'string', minLength: 1 },
        bodyMarkdown: { type: 'string', minLength: 1, description: 'Email body, in markdown.' },
        audience: {
          type: 'string',
          enum: ['enrolled', 'approved', 'applicants', 'generic'],
          default: 'enrolled',
          description: 'Hint for the email template (header copy varies by audience).',
        },
      },
      required: ['emails', 'subject', 'bodyMarkdown'],
    },
    handler: async (args, _user, _db, c) => {
      const html = renderMarkdown(args.bodyMarkdown)
      const audience = (args.audience || 'enrolled') as BroadcastAudience
      const result = await sendBroadcast(c.env, args.emails, args.subject, html, audience)
      return textResult({
        sent: result.sent,
        failed: result.failed,
        total: result.total,
      })
    },
  },
  {
    name: 'admin_list_applications',
    description: 'ADMIN: list applications, optionally filtered by status.',
    adminOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'enrolled'] },
        limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
      },
    },
    handler: async (args, _user, db) => {
      const limit = Math.min(Math.max(args.limit ?? 50, 1), 200)
      const rows = args.status
        ? await db.select().from(applications).where(eq(applications.status, args.status)).orderBy(desc(applications.createdAt)).limit(limit).all()
        : await db.select().from(applications).orderBy(desc(applications.createdAt)).limit(limit).all()
      return textResult(rows.map(a => ({
        id: a.id, name: a.name, email: a.email, status: a.status,
        pricingTier: a.pricingTier, createdAt: a.createdAt,
      })))
    },
  },
  {
    name: 'admin_send_magic_link',
    description: 'ADMIN: email a fresh magic sign-in link to an address. Use to help someone who can\'t find their link or is stuck signing in — magic-link auth has no verification-code step, so this is usually all that\'s needed. Creates the user on first verify if they don\'t exist yet.',
    adminOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email to send the sign-in link to.' },
        redirectUrl: { type: 'string', description: 'Relative path to land on after sign-in. Defaults to /dashboard.' },
      },
      required: ['email'],
    },
    handler: async (args, _user, db, c) => {
      const { createMagicToken } = await import('../lib/magic-link')
      const { sendMagicLink } = await import('../lib/email')
      const email = String(args.email || '').trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Invalid email address')
      }
      const redirectTo = typeof args.redirectUrl === 'string' && args.redirectUrl.startsWith('/') && !args.redirectUrl.startsWith('//')
        ? args.redirectUrl : '/dashboard'
      const token = await createMagicToken(db, { email, redirectTo })
      const link = `https://learnvibe.build/auth/verify?token=${encodeURIComponent(token)}`
      await sendMagicLink(c.env, email, link)
      return textResult({ ok: true, email, note: 'Magic sign-in link emailed. Single-use, expires in 20 minutes.' })
    },
  },
]

// ===== JSON-RPC HANDLER =====

mcp.post('/mcp', async (c) => {
  // Auth: try OAuth token first (preferred for third-party clients like Claude),
  // fall back to API key (legacy / CLI path). Both produce an AuthUser.
  const authHeader = c.req.header('Authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  let authUser: AuthUser | null = null

  if (bearer.startsWith('lvb-mcp_')) {
    authUser = await authenticateOAuthToken(getDb(c.env.DB), bearer)
  } else if (bearer.startsWith('lvb_')) {
    authUser = await authenticateApiKey(c)
  }

  if (!authUser) {
    const origin = new URL(c.req.url).origin
    // Point unauthenticated clients at the protected-resource metadata so
    // they can discover the authorization server and start OAuth.
    c.header('WWW-Authenticate', `Bearer realm="learnvibe", resource_metadata="${origin}/.well-known/oauth-protected-resource"`)
    return c.json(err(null, -32001, 'Unauthorized — authorize via OAuth or provide an API key Bearer token'), 401)
  }

  const body = await c.req.json().catch(() => null) as JsonRpcRequest | JsonRpcRequest[] | null
  if (!body) {
    return c.json(err(null, -32700, 'Parse error — body must be valid JSON'), 400)
  }

  // Spec supports batched requests; handle both shapes.
  const requests = Array.isArray(body) ? body : [body]
  const responses: JsonRpcResponse[] = []

  for (const req of requests) {
    responses.push(await handleRpc(req, authUser, c))
  }

  return c.json(Array.isArray(body) ? responses : responses[0])
})

// Optional GET — some MCP clients probe for SSE stream capability.
// We don't support server-initiated messages, so return 405.
mcp.get('/mcp', (c) => {
  return c.text('Method Not Allowed — POST JSON-RPC to this endpoint.', 405)
})

async function handleRpc(req: JsonRpcRequest, user: AuthUser, c: any): Promise<JsonRpcResponse> {
  if (req.jsonrpc !== '2.0') return err(req.id, -32600, 'Invalid Request — jsonrpc must be "2.0"')

  try {
    switch (req.method) {
      case 'initialize':
        return ok(req.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: "Learn Vibe Build MCP server. Use tools to access lessons, projects, discussions, and your profile.",
        })

      case 'notifications/initialized':
        // Client post-init ack; no response needed for notifications but we return an empty ok.
        return ok(req.id, {})

      case 'tools/list':
        return ok(req.id, {
          tools: TOOLS
            .filter(t => !t.adminOnly || isAdmin(user))
            .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        })

      case 'tools/call': {
        const name = req.params?.name as string | undefined
        if (!name) return err(req.id, -32602, 'Invalid params — "name" required')
        const tool = TOOLS.find(t => t.name === name)
        if (!tool) return err(req.id, -32602, `Unknown tool: ${name}`)
        if (tool.adminOnly && !isAdmin(user)) return err(req.id, -32001, `Tool "${name}" requires an admin account`)
        const args = req.params?.arguments || {}
        const db = getDb(c.env.DB)
        try {
          const result = await tool.handler(args, user, db, c)
          return ok(req.id, result)
        } catch (toolErr: any) {
          return ok(req.id, {
            content: [{ type: 'text', text: `Error: ${toolErr.message}` }],
            isError: true,
          })
        }
      }

      case 'ping':
        return ok(req.id, {})

      default:
        return err(req.id, -32601, `Method not found: ${req.method}`)
    }
  } catch (e: any) {
    console.error('[MCP] Internal error:', e)
    return err(req.id, -32603, `Internal error: ${e.message}`)
  }
}

export default mcp
