-- Migration 0023 — Summer 2026 Cohort: schema updates + data
--
-- Three things happen here:
--
-- 1. APPLICATIONS gets two new optional fields:
--    - referred_by (text, nullable) — name/email of the person who referred
--      this applicant. Manual $50 hub credit flow per Aaron.
--    - scholarship_request (text, nullable) — extra info when an applicant
--      selects the scholarship tier. Captures demonstrated need OR public
--      benefit / non-profit / student academic work context.
--
-- 2. COHORT-1 ("Cohort 1: Practice") gets renamed to "Spring 2026 Cohort"
--    in display title. Slug stays `cohort-1` so foreign keys (lessons,
--    enrollments, applications.cohortSlug, payments.cohortId) keep
--    resolving correctly. Status flips to 'completed'.
--
-- 3. COHORT-2 row is inserted as the Summer 2026 Cohort with
--    six lesson placeholders (one per class, 2 classes per "week" /
--    movement). status='enrolling' so /apply works against it immediately.
--    Lesson titles encode the Learn/Vibe/Build movement structure so they
--    surface usefully even before lesson content is authored.
--
-- After this lands:
--   - api.ts POST /api/applications must read the currently-enrolling
--     cohort instead of hardcoding 'cohort-1' (see src/routes/api.ts)
--   - stripe.ts PRICING_TIERS gains additive Summer-2026 tier entries
--     (sliding_low/mid/high, alumni, scholarship). Legacy Spring 2026
--     entries (standard/discounted/sponsor) are preserved so old records
--     still resolve to the right amounts.

-- ===== 1. Schema additions =====
ALTER TABLE applications ADD COLUMN referred_by TEXT;
--> statement-breakpoint
ALTER TABLE applications ADD COLUMN scholarship_request TEXT;
--> statement-breakpoint

-- ===== 2. Rename Cohort 1 → Spring 2026 Cohort + mark complete =====
UPDATE cohorts
SET title = 'Spring 2026 Cohort',
    status = 'completed',
    end_date = COALESCE(end_date, '2026-05-25')
WHERE slug = 'cohort-1';
--> statement-breakpoint

-- ===== 3. Create Summer 2026 Cohort =====
-- Note: Drizzle's $defaultFn(() => new Date().toISOString()) on created_at
-- runs at the JS layer only; raw SQL INSERTs must set the column explicitly.
INSERT INTO cohorts (
  slug, title, description, start_date, end_date,
  weeks, price_cents, status, is_public, created_at
) VALUES (
  'cohort-2',
  'Summer 2026 Cohort',
  'Three weeks, in person in Boulder. Six classes — Mondays and Wednesdays 6–8pm. Office hours Tuesdays 1–3pm. Sliding scale $250 / $500 / $750. Includes Regen Hub co-working benefits.',
  '2026-06-22',
  '2026-07-08',
  3,
  50000,
  'enrolling',
  0,
  '2026-06-06T00:00:00.000Z'
);
--> statement-breakpoint

-- ===== 4. Lesson placeholders for Summer 2026 =====
-- Six lessons, two per movement. weekNumber 1-6 = class 1-6 (preserves
-- MCP get_lesson(weekNumber) lookup semantics). The movement grouping
-- (LEARN / VIBE / BUILD) is encoded in the lesson title so it surfaces
-- whether or not contentMarkdown has been written yet.

INSERT INTO lessons (cohort_id, week_number, title, description, date, status, sort_order, created_at, updated_at)
SELECT id, 1,
  'Class 01 — Learn: Conversation & Context',
  'Three relationships: with yourself, with AI, with each other. Naming intention, asking questions before answers. Starting your living context document — Parachute as the tool.',
  '2026-06-22',
  'draft',
  1,
  '2026-06-06T00:00:00.000Z',
  '2026-06-06T00:00:00.000Z'
FROM cohorts WHERE slug = 'cohort-2';
--> statement-breakpoint

INSERT INTO lessons (cohort_id, week_number, title, description, date, status, sort_order, created_at, updated_at)
SELECT id, 2,
  'Class 02 — Learn: Connectors & Memory',
  'AI with hands. Connecting Claude to your tools and data. Setting up Parachute as your persistent knowledge graph that travels across conversations and AIs.',
  '2026-06-24',
  'draft',
  2,
  '2026-06-06T00:00:00.000Z',
  '2026-06-06T00:00:00.000Z'
FROM cohorts WHERE slug = 'cohort-2';
--> statement-breakpoint

INSERT INTO lessons (cohort_id, week_number, title, description, date, status, sort_order, created_at, updated_at)
SELECT id, 3,
  'Class 03 — Vibe: Clarify with AI',
  'The two-loop pattern. Loop 1 — clarify what you''re actually trying to make. The art of the one-pager that becomes the seed for everything else.',
  '2026-06-29',
  'draft',
  3,
  '2026-06-06T00:00:00.000Z',
  '2026-06-06T00:00:00.000Z'
FROM cohorts WHERE slug = 'cohort-2';
--> statement-breakpoint

INSERT INTO lessons (cohort_id, week_number, title, description, date, status, sort_order, created_at, updated_at)
SELECT id, 4,
  'Class 04 — Vibe: Design & Iterate',
  'Loop 2 — Claude Design. Prototype, iterate, push back with specificity. Read it back to yourself. Watch for smooth defaults. Taste is the practice.',
  '2026-07-01',
  'draft',
  4,
  '2026-06-06T00:00:00.000Z',
  '2026-06-06T00:00:00.000Z'
FROM cohorts WHERE slug = 'cohort-2';
--> statement-breakpoint

INSERT INTO lessons (cohort_id, week_number, title, description, date, status, sort_order, created_at, updated_at)
SELECT id, 5,
  'Class 05 — Build: From Design to Live',
  'Claude Code in the Claude desktop app. The four moves of prompting code. From prototype to GitHub Pages — your site live on the open internet.',
  '2026-07-06',
  'draft',
  5,
  '2026-06-06T00:00:00.000Z',
  '2026-06-06T00:00:00.000Z'
FROM cohorts WHERE slug = 'cohort-2';
--> statement-breakpoint

INSERT INTO lessons (cohort_id, week_number, title, description, date, status, sort_order, created_at, updated_at)
SELECT id, 6,
  'Class 06 — Build: Engineering Principles + Demos',
  'Engineering principles for builders who don''t consider themselves engineers. Supabase as the deeper-cut backend. Demos, reflection, what comes next.',
  '2026-07-08',
  'draft',
  6,
  '2026-06-06T00:00:00.000Z',
  '2026-06-06T00:00:00.000Z'
FROM cohorts WHERE slug = 'cohort-2';
