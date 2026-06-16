# Learn Vibe Build — Project Context

## What This Is
Cohort-based AI learning platform. Teaches people to build with AI as a creative partner. Based in Boulder, CO + remote. Run by Aaron Gabriel (ag@unforced.dev) and Jon Bo.

**Live at:** https://learnvibe.build
**Workers.dev:** https://learnvibe-build.ag-8f2.workers.dev
**Repo:** https://github.com/Unforced-Dev/learnvibe.build

## Tech Stack
- **Runtime:** Cloudflare Workers
- **Framework:** Hono v4 with JSX SSR (no client-side React)
- **Database:** Cloudflare D1 (SQLite) — `learnvibe-db` (see wrangler.toml for database ID)
- **ORM:** Drizzle ORM with migrations in `drizzle/migrations/`
- **Auth:** Clerk (client-side JS embed, @clerk/backend for server verification)
- **Payments:** Stripe (SDK installed, checkout flow built, awaiting keys)
- **Email:** Resend (API key configured, sends from `hello@mail.unforced.dev`)
- **Markdown:** `marked` for lesson content rendering
- **Fonts:** Space Grotesk (display), Inter (body), JetBrains Mono (mono)
- **Accent color:** `#e8612a` (orange)

## Deployment
```bash
# CLOUDFLARE_API_TOKEN must be set in environment (see Cloudflare dashboard → API Tokens)
npx wrangler deploy
```

**Cloudflare Account:** Unforced Development (see Cloudflare dashboard for account/zone IDs)

### Secrets (set via `wrangler secret put`):
- `CLERK_SECRET_KEY` — ✅ Set (rotate via Clerk dashboard)
- `RESEND_API_KEY` — ✅ Set (rotate via Resend dashboard)
- `STRIPE_SECRET_KEY` — ✅ Set
- `STRIPE_WEBHOOK_SECRET` — ✅ Set
- `CLERK_WEBHOOK_SECRET` — ✅ Set

### Vars (in wrangler.toml):
- `CLERK_PUBLISHABLE_KEY` — test key for Clerk
- `EMAIL_FROM` — `Learn Vibe Build <hello@mail.unforced.dev>`

## Architecture

### Route Structure (`src/index.tsx`)
All routes mount off the root Hono app in this order:
1. Auth middleware (Clerk session parsing, non-blocking)
2. `/api/health` — health check
3. Webhook routes (`/api/webhooks/clerk`, `/api/webhooks/stripe`)
4. API routes (`/api/applications`, `/api/admin/*`)
5. Auth routes (`/sign-in`, `/sign-up`, `/sign-out`, `/auth/callback`)
6. Dashboard (`/dashboard`)
7. Admin (`/admin`, `/admin/applications`, `/admin/lessons`, `/admin/email`)
8. Payment (`/payment/checkout/:id`, `/payment/success`, `/payment/cancelled`)
9. Legacy redirects (`/cohort-1.html` → `/cohort/cohort-1`)
10. Cohort content (`/cohort/:slug`, `/cohort/:slug/week/:num`)
11. Pages (`/apply`, `/apply/success`, `/apply/status`)

### Database Schema (`src/db/schema.ts`)
6 tables + 1 payments table:
- **users** — Clerk-synced user accounts (id, clerkId, email, name, role)
- **applications** — Cohort applications (name, email, background, projectInterest, status, pricingTier)
- **cohorts** — Cohort definitions (slug, title, weeks, priceCents, status, isPublic)
- **lessons** — Weekly lesson content (cohortId, weekNumber, contentMarkdown, status)
- **enrollments** — User ↔ Cohort relationship (userId, cohortId, status)
- **memberships** — Community/alumni access (userId, type, status)
- **payments** — Stripe payment records (applicationId, stripeCheckoutSessionId, amountCents, status)

### Key Files
- `src/lib/auth.ts` — getUser, syncUser, isAdmin, isClerkConfigured
- `src/lib/stripe.ts` — Stripe client, checkout session creation, pricing tiers
- `src/lib/email.ts` — Resend email sending, branded HTML templates
- `src/lib/access.ts` — canAccessCohort() for content gating
- `src/components/Layout.tsx` — Auth-aware HTML layout wrapper
- `src/styles/design-system.ts` — CSS custom properties and styles
- `public/slides/vibecoding-101.html` — Slide deck for university class

## Current State (as of April 2026)

### What's Working
- ✅ Homepage with "Now Enrolling" Cohort 1 messaging
- ✅ Application form → saves to D1 → sends confirmation email
- ✅ Application status check page (`/apply/status`)
- ✅ Admin dashboard with application review (approve/reject with pricing tiers)
- ✅ Approval emails with payment links, rejection emails
- ✅ Stripe payment flow (keys configured, webhook active)
- ✅ Clerk auth (sign-in/sign-up/sign-out with callback + webhook)
- ✅ Admin email broadcast to cohort members (`/admin/email`)
- ✅ Member dashboard showing enrollments or application status
- ✅ Cohort 1 content (6 weeks of lessons in D1)
- ✅ Dynamic cohort content pages with markdown rendering
- ✅ Admin user (Aaron) promoted in D1
- ✅ Feedback viewer in admin panel

### What's Pending
- 🎨 **Personalized curriculum** — Future vision for AI-enabled learning paths (design phase)
- 📅 **Free Vibecode session** — Event at Regen Hub (needs planning/page)

### Key Dates
- **Cohort 1 start date:** April 20, 2026 (delayed from April 6)

### Pricing Tiers (admin-selectable on approval)
- Full Price: $500
- Discounted: $250 (alumni, RegenHub)
- Sponsored: $0 (auto-enrolls without Stripe)

### Email Flow
- **Apply** → "Application received" confirmation
- **Admin approves** → "You're approved!" with payment link + amount
- **Admin rejects** → Graceful rejection
- **Stripe payment** → "You're enrolled!" welcome email
- **Admin broadcast** → Custom markdown email to selected audience
- **From:** `Learn Vibe Build <hello@mail.unforced.dev>`
- **Reply-to:** `ag@unforced.dev` (configurable via `EMAIL_REPLY_TO` in wrangler.toml)

## Funnel model (interest → signup → application → enrollment)

Interest signups are the **first step of the funnel**, not a silo. The `interests` table has a nullable `user_id` FK to `users`, populated bidirectionally:

- **POST /api/interests** (signup-then-interest path) — at insert time, looks up `users.email`; if a match exists, sets `interests.user_id` on the new row.
- **`syncUser` in `src/lib/auth.ts`** (interest-then-signup path) — after upserting the user, back-links any unlinked `interests` row matching the email to the new `user.id`. Best-effort, non-fatal.

Migration `0021_interests_link_to_users.sql` added the column + backfilled existing rows by email. Admin sees the link on `/admin/interests` (✓ Linked badge → user profile) and can filter via `?account=linked|unlinked`. The dashboard shows a small "Thanks for joining the list on …" banner when the signed-in user has a linked interest row. The homepage hero swaps the email signup form for a "welcome back" treatment when the visitor is already authed.

## D1 Data
- Cohort 1 (slug: `cohort-1`, status: `enrolling`, $500, 6 weeks). Live-session link is admin-editable on the /admin dashboard.
- Pilot (Cohort 0): Was the original January 2026 cohort, 13 builders, sponsored by Gitcoin
- Seed SQL files removed (2026-04-17) — data lives in D1 now; edit via `wrangler d1 execute`.

## Commands
```bash
npm run dev          # Local dev
npm run deploy       # Deploy to Workers
npm run db:generate  # Generate Drizzle migration
npm run db:migrate:local   # Apply migration locally
npm run db:migrate:remote  # Apply migration to production D1
```

## People
- **Aaron Gabriel** — Lead Facilitator. Founder of Parachute (parachute.computer), CU Boulder ATLAS Institute alum, founding member of Regen Hub Cooperative (regenhub.xyz). Note: at CU he goes by his legal name **Aaron G Neyer** (aaron.neyer@colorado.edu) — used on the `/cu` course page/flyer; "Aaron Gabriel" is the LVB brand name everywhere else.
- **Jon Bo** — Co-Facilitator. 3x founding engineer, builder of things, writer of words. Daily user of Claude Code.
