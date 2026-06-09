import { Hono } from 'hono'
import type { AppContext } from './types'
import { getUser } from './lib/auth'
import home from './routes/home'
import pages from './routes/pages'
import api from './routes/api'
import cohortRoutes from './routes/cohort'
import authRoutes from './routes/auth'
import dashboardRoutes from './routes/dashboard'
import adminRoutes from './routes/admin'
import webhookRoutes from './routes/webhooks'
import paymentRoutes from './routes/payment'
import feedbackRoutes from './routes/feedback'
import communityRoutes from './routes/community'
import memberRoutes from './routes/members'
import settingsRoutes from './routes/settings'
import projectRoutes from './routes/projects'
import discussionRoutes from './routes/discussions'
import apiV1 from './routes/api-v1'
import mcp from './routes/mcp'
import oauth from './routes/oauth'
import interest from './routes/interest'

const app = new Hono<AppContext>()

// ===== AUTH MIDDLEWARE =====
// Resolve the signed session cookie into a user on every request
// (non-blocking — unauthenticated requests just get user=null). See
// src/lib/session.ts + src/lib/auth.ts.
app.use('*', async (c, next) => {
  const user = await getUser(c)
  c.set('user', user)
  await next()
})

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Webhook routes (Clerk user sync — no auth middleware needed)
app.route('/', webhookRoutes)

// API routes (form submissions)
app.route('/', api)

// JSON API v1 (Bearer token auth — for MCP and external clients)
app.route('/', apiV1)

// MCP (Model Context Protocol) server at /mcp — OAuth tokens or API keys
app.route('/', mcp)

// OAuth 2.1 Authorization Server for the MCP + discovery metadata
app.route('/', oauth)

// Auth routes (sign-in, sign-up, sign-out, callback)
app.route('/', authRoutes)

// Dashboard (requires auth)
app.route('/', dashboardRoutes)

// Admin routes (requires admin role)
app.route('/', adminRoutes)

// Payment routes (checkout, success, cancelled)
app.route('/', paymentRoutes)

// Feedback routes
app.route('/', feedbackRoutes)

// Community routes
app.route('/', communityRoutes)
app.route('/', memberRoutes)
app.route('/', settingsRoutes)
app.route('/', projectRoutes)
app.route('/', discussionRoutes)

// SSR homepage — handles `/` directly. (There used to be a static
// public/index.html that GitHub Pages served separately; both are gone.)
app.route('/', home)

// Redirects from old static URLs to dynamic routes
app.get('/cohort-1.html', (c) => c.redirect('/cohort/cohort-1', 301))
app.get('/cohort-1/week-:num.html', (c) => {
  const num = c.req.param('num')
  return c.redirect(`/cohort/cohort-1/week/${num}`, 301)
})

// Cohort content routes
app.route('/', cohortRoutes)

// JSX page routes (apply form, etc.)
app.route('/', pages)

// Interest list (Cohort 2 signup) — public form + POST handler
app.route('/', interest)

export default app
