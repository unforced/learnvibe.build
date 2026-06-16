import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { Layout } from '../components/Layout'
import { getDb } from '../db'
import { applications, cohorts, enrollments } from '../db/schema'
import { formatCents, getApplicationAmount, getApplicationLabel, getTiersForCohort } from '../lib/stripe'
import { getCohortCapacity, getCapacityLabel } from '../lib/access'
import type { AppContext } from '../types'

const pages = new Hono<AppContext>()

// ===== CURRICULUM PAGE =====
pages.get('/curriculum', (c) => {
  const user = c.get('user')

  // Three movements, two classes each. Each movement carries the
  // accumulated lineage from prior cohorts but reads as one arc.
  const movements = [
    {
      num: 1,
      title: 'Learn',
      tagline: 'Conversation, context, and connectors — AI as your learning partner',
      classes: [
        {
          n: 1,
          date: 'Mon · June 22',
          title: 'Conversation & Context',
          summary: 'The three relationships — with yourself, with AI, with each other. Naming intention. Asking questions before answers. Building the seed of your living context document.',
        },
        {
          n: 2,
          date: 'Wed · June 24',
          title: 'Connectors & Memory with Parachute',
          summary: 'AI with hands — connecting Claude to your tools and data. Setting up Parachute as your persistent knowledge graph that travels across conversations and across AIs.',
        },
      ],
      description: 'We start where every good practice starts: by getting clear on the relationship. With yourself, with AI, with the people you\'re learning alongside. The first two classes build the foundation — context, conversation moves, and the connectors that give AI hands in your world. By the end of Week 1 you\'ve got a Claude that knows you, plus an early Parachute vault that travels with you across tools.',
      youll_learn: [
        'How to talk to AI as a creative partner, not a search engine',
        'The three relationships — with self, with AI, with each other',
        'What context actually is, and how to maintain it across conversations',
        'Connectors and MCPs — giving AI access to your real tools and data',
        'Parachute as a persistent personal knowledge system (introduced this week, woven through the cohort)',
      ],
      youll_build: 'A living context document that any AI can know you through, a Claude Project connected to the tools most alive for you, and the early shape of a Parachute vault.',
      tools: 'Claude, Connectors / MCPs, Parachute',
    },
    {
      num: 2,
      title: 'Vibe',
      tagline: 'Prototype, design, experiment — taste as the practice',
      classes: [
        {
          n: 3,
          date: 'Mon · June 29',
          title: 'Clarify with AI',
          summary: 'Loop 1 — using conversation to clarify what you\'re actually trying to make. The one-pager as the seed that grows into everything else.',
        },
        {
          n: 4,
          date: 'Wed · July 1',
          title: 'Design & Iterate',
          summary: 'Loop 2 — Claude Design. From one-pager to interactive prototype. Iteration, taste, pushback with specificity. Reading what AI made back to yourself.',
        },
      ],
      description: 'Week 2 is about making real attempts. Not finished products — real attempts. We use the two-loop pattern: first clarify in conversation what you\'re trying to make, then hand that clarity to Claude Design and start building. The whole week is iteration practice. Pushing back with specificity. Watching for smooth defaults. Bringing your taste forward.',
      youll_learn: [
        'The two-loop pattern — clarify first, then build',
        'Claude Design — prototyping at the speed of conversation',
        'The art of pushback — specific, embodied, taste-forward',
        'Watching for "smooth defaults" and bringing your unique voice forward',
        'Sharing what you\'ve made and using the gap between intention and reception as fuel',
      ],
      youll_build: 'A working prototype of something useful to you — website, tool, brochure, app — built with AI as a creative partner, iterated to a point where you can show someone and have a real conversation about it.',
      tools: 'Claude.ai, Claude Design, Parachute',
    },
    {
      num: 3,
      title: 'Build',
      tagline: 'From design to live on the open internet',
      classes: [
        {
          n: 5,
          date: 'Mon · July 6',
          title: 'From Design to Live',
          summary: 'Claude Code in the Claude desktop app. The four moves of prompting code. Taking your design to GitHub Pages — your site live on the open internet.',
        },
        {
          n: 6,
          date: 'Wed · July 8',
          title: 'Engineering Principles + Demos',
          summary: 'Engineering principles for builders. Supabase as the deeper-cut backend. Demos, reflection, what comes next.',
        },
      ],
      description: 'Week 3 takes you the last mile — from prototype to a real site at a real URL. We don\'t use a terminal. Claude Code lives right inside the Claude desktop app, and we teach the four moves that make prompting code different from prompting chat. By the end you have something live on the open internet that you can keep growing, plus the engineering principles to grow it responsibly. We close with demos and a real send-off into the ongoing community.',
      youll_learn: [
        'Claude Code in the Claude desktop app — no terminal required',
        'The four moves of prompting code — plan-then-do, name files specifically, run-and-see loop, CLAUDE.md as memory',
        'GitHub and GitHub Pages — your site live, driven from inside Claude',
        'Engineering principles for non-engineers — when to be careful, when to bring in an expert',
        'Supabase as the deeper-cut backend for sites that need auth and a database',
      ],
      youll_build: 'A real website at a real URL on the open internet — your Week 2 design, now live, hosted on infrastructure you understand enough to keep growing.',
      tools: 'Claude desktop app (Code tab), GitHub, GitHub Pages, Supabase (deeper cut), Parachute',
    },
  ]

  return c.html(
    <Layout
      title="Curriculum — Learn, Vibe, Build"
      description="Three weeks, three movements — Learn, Vibe, Build. Six classes total, in person in Boulder. A community of practice for building with AI."
      user={user}
    >
      <style dangerouslySetInnerHTML={{ __html: `@media (max-width: 600px) { .curriculum-detail-grid { grid-template-columns: 1fr !important; } }` }} />
      <div class="page-section" style="max-width: 800px; margin: 0 auto;">
        <a href="/" style="font-size: 0.85rem; color: var(--text-tertiary); text-decoration: none;">&larr; Home</a>

        <p class="section-label" style="margin-top: 2rem;">The Curriculum</p>
        <h2><span class="accent">Learn. Vibe. Build.</span></h2>
        <p class="lead">
          Three weeks. Three movements. Six classes total, two per movement. We start with conversation and context, move into design and prototyping, then take what you've made and ship it &mdash; live on the open internet, yours to keep growing.
        </p>
        <p style="margin-top: 1rem; color: var(--text-secondary); line-height: 1.6;">
          Parachute &mdash; the personal knowledge system Aaron and Jon have been building &mdash; is woven through the cohort as a tool you can use to set up your own AI memory and interfaces. Not the focus, but a demonstration thread.
        </p>

        <div style="margin-top: 3rem;">
          {movements.map((m) => (
            <div style="margin-bottom: 2.5rem; padding: 2rem; background: var(--white); border: 1px solid var(--border); border-radius: 12px;">
              <div style="display: flex; align-items: baseline; gap: 1rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
                <span style="font-family: var(--font-mono); font-size: 0.7rem; font-weight: 500; color: var(--accent); letter-spacing: 0.03em; text-transform: uppercase;">Week {m.num} &middot; Classes {m.classes[0].n}&ndash;{m.classes[1].n}</span>
                <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary);">{m.tools}</span>
              </div>
              <h3 style="font-family: var(--font-display); font-weight: 600; font-size: 1.6rem; letter-spacing: -0.02em; margin-bottom: 0.25rem;">{m.title}</h3>
              <p style="font-size: 0.95rem; color: var(--accent); font-weight: 500; margin-bottom: 1rem;">{m.tagline}</p>
              <p style="color: var(--text-secondary); line-height: 1.7; margin-bottom: 1.5rem;">{m.description}</p>

              <div style="margin-bottom: 1.5rem;">
                <h4 style="font-family: var(--font-mono); font-size: 0.7rem; font-weight: 500; color: var(--text-tertiary); letter-spacing: 0.03em; text-transform: uppercase; margin-bottom: 0.75rem;">The classes</h4>
                <div style="display: flex; flex-direction: column; gap: 0.85rem;">
                  {m.classes.map((cls) => (
                    <div style="padding: 0.85rem 1.1rem; background: var(--surface); border-radius: 8px;">
                      <div style="display: flex; gap: 0.85rem; align-items: baseline; flex-wrap: wrap;">
                        <span style="font-family: var(--font-mono); font-size: 0.7rem; font-weight: 600; color: var(--accent); letter-spacing: 0.05em;">Class {cls.n}</span>
                        <span style="font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-tertiary);">{cls.date}</span>
                      </div>
                      <p style="font-weight: 600; font-size: 0.95rem; margin: 0.35rem 0 0.25rem;">{cls.title}</p>
                      <p style="font-size: 0.88rem; color: var(--text-secondary); line-height: 1.55; margin: 0;">{cls.summary}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div class="curriculum-detail-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                <div>
                  <h4 style="font-family: var(--font-mono); font-size: 0.7rem; font-weight: 500; color: var(--text-tertiary); letter-spacing: 0.03em; text-transform: uppercase; margin-bottom: 0.75rem;">What you'll learn</h4>
                  <ul style="list-style: none; padding: 0; margin: 0;">
                    {m.youll_learn.map((item) => (
                      <li style="padding: 0.3rem 0 0.3rem 1.25rem; position: relative; font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5;">
                        <span style="position: absolute; left: 0; color: var(--accent);">&rarr;</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 style="font-family: var(--font-mono); font-size: 0.7rem; font-weight: 500; color: var(--text-tertiary); letter-spacing: 0.03em; text-transform: uppercase; margin-bottom: 0.75rem;">What you'll build</h4>
                  <p style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5; padding: 0.75rem 1rem; background: var(--surface); border-radius: 6px;">{m.youll_build}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style="text-align: center; padding: 3rem 0;">
          <a href="/enroll" style="display: inline-flex; align-items: center; gap: 0.5rem; background: var(--accent); color: white; font-size: 1rem; font-weight: 500; padding: 0.875rem 2rem; border-radius: 8px; text-decoration: none;">
            Apply for Summer 2026
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </a>
          <p style="margin-top: 1rem; font-size: 0.85rem; color: var(--text-tertiary); line-height: 1.7;">
            Mondays &amp; Wednesdays 6&ndash;8pm MT &middot; Office hours Tuesdays 1&ndash;3pm MT &middot; June 22 &ndash; July 8, 2026<br />
            <strong>In person only at <a href="https://regenhub.xyz" target="_blank" style="color: var(--accent);">Regen Hub</a>, Boulder</strong> &mdash; sessions recorded, no live remote &middot; capped at 20
          </p>
          <p style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-tertiary);">
            Sliding scale $250 / $500 / $750 &middot; Spring 2026 alumni $125 &middot; scholarships available for demonstrated need or public-benefit / non-profit / student academic work &mdash; cost should never be a barrier.
          </p>
          <p style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-tertiary);">
            Includes discounted Regen Hub Cooperative membership + free co-working day passes during the cohort.
          </p>
        </div>
      </div>
    </Layout>
  )
})

// ===== CU BOULDER COURSE PAGE — ATLS 4519/5519 =====
// Landing page + print flyer for the Fall 2026 CU class. One route serves
// both: the screen view is the full-bleed hybrid (dark hero + warm body);
// the @media print block flips the hero to printer-friendly white, drops
// the chat card / long bio / bottom CTA, and collapses to a single page so
// Ctrl-P (or "Save as PDF") produces the flyer Mark can share. /atls4519
// and /fall are 301 aliases to /cu (see redirects below).
const CU_COURSE = {
  code: 'ATLS 4519 / 5519',
  codeUgrad: 'ATLS 4519',
  codeGrad: 'ATLS 5519',
  title: 'Learn Vibe Build',
  catalogTitle: 'Advanced Special Topics: Learn, Vibe, Build',
  sectionTitle: 'Learn, Vibe, Build',
  section: '005',
  classNbr: '39152',
  credits: '3 credits',
  meets: 'Wednesdays · 5:05–7:35 PM',
  location: 'ATLAS room 104, CU Boulder',
  term: 'Fall 2026',
  open: 'Open to all majors · no prerequisites',
  instructor: 'Aaron G Neyer',
  instructorEmail: 'aaron.neyer@colorado.edu',
  url: 'learnvibe.build/cu',
}

const CU_MOVEMENTS = [
  {
    name: 'Learn',
    line: 'Talk to AI as a creative partner — and build a personal knowledge system that travels with you across every conversation.',
  },
  {
    name: 'Vibe',
    line: 'Take an idea you care about, clarify it in conversation, and prototype it — design at the speed of thought.',
  },
  {
    name: 'Build',
    line: 'Ship it. A real project at a real URL on the open internet, plus the judgment to keep growing it responsibly.',
  },
]

pages.get('/cu', (c) => {
  const user = c.get('user')
  const cu = CU_COURSE

  return c.html(
    <Layout
      title={`${cu.code} — ${cu.title} at CU Boulder`}
      description="A hands-on, semester-long course at CU Boulder's ATLAS Institute, Fall 2026. Build real things with AI as a creative partner and ship them to the open internet. Open to all majors, no coding experience required."
      user={user}
      fullWidth
    >
      <style dangerouslySetInnerHTML={{ __html: `
        .cu-wrap { max-width: 920px; margin: 0 auto; padding: 0 1.5rem; }

        /* ---- HERO (dark band, full-bleed) ---- */
        .cu-hero {
          background: #111;
          color: #fafaf8;
          padding: 4.5rem 0 4rem;
          position: relative;
          overflow: hidden;
        }
        .cu-hero::before {
          content: '';
          position: absolute; inset: 0;
          background:
            radial-gradient(circle at 15% 0%, rgba(232,97,42,0.22) 0%, transparent 38%),
            radial-gradient(circle at 90% 100%, rgba(232,97,42,0.10) 0%, transparent 42%);
          pointer-events: none;
        }
        .cu-hero .cu-wrap { position: relative; }
        .cu-eyebrow {
          font-family: var(--font-mono);
          font-size: 0.72rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--accent);
          display: inline-flex; align-items: center; gap: 0.55rem;
          margin-bottom: 1.5rem;
        }
        .cu-pulse {
          width: 7px; height: 7px; border-radius: 999px; background: var(--accent);
          box-shadow: 0 0 0 0 rgba(232,97,42,0.6);
          animation: cuPulse 2.2s infinite;
        }
        @keyframes cuPulse {
          0% { box-shadow: 0 0 0 0 rgba(232,97,42,0.55); }
          70% { box-shadow: 0 0 0 7px rgba(232,97,42,0); }
          100% { box-shadow: 0 0 0 0 rgba(232,97,42,0); }
        }
        .cu-h1 {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: clamp(2.6rem, 7vw, 4.6rem);
          line-height: 0.98;
          letter-spacing: -0.03em;
          margin: 0 0 1.1rem;
          color: #fff;
        }
        .cu-h1 .slash { color: var(--accent); font-weight: 500; }
        .cu-sub {
          font-size: clamp(1.05rem, 2.2vw, 1.35rem);
          color: rgba(250,250,248,0.82);
          max-width: 30ch;
          line-height: 1.4;
          margin: 0 0 1.75rem;
        }
        .cu-metarow {
          display: flex; flex-wrap: wrap; gap: 0.5rem 1.1rem;
          font-family: var(--font-mono);
          font-size: 0.8rem;
          color: rgba(250,250,248,0.72);
          margin-bottom: 2rem;
        }
        .cu-metarow .sep { color: var(--accent); }
        .cu-cta-row { display: flex; flex-wrap: wrap; gap: 0.75rem; }
        .cu-btn {
          display: inline-flex; align-items: center; gap: 0.5rem;
          font-weight: 600; font-size: 0.95rem;
          padding: 0.85rem 1.6rem; border-radius: 999px;
          text-decoration: none; transition: transform 0.15s, background 0.15s;
        }
        .cu-btn-primary { background: var(--accent); color: #fff; }
        .cu-btn-primary:hover { background: #fff; color: #111; transform: translateY(-1px); }
        .cu-btn-ghost { color: #fafaf8; border: 1px solid rgba(255,255,255,0.28); }
        .cu-btn-ghost:hover { border-color: #fff; transform: translateY(-1px); }

        /* chat / session card */
        .cu-chat {
          margin-top: 2.75rem;
          background: #0b0b0b;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 14px;
          padding: 1rem 1.15rem 1.25rem;
          font-family: var(--font-mono);
          font-size: 0.86rem;
          max-width: 540px;
          box-shadow: 0 20px 50px -25px rgba(0,0,0,0.8);
        }
        .cu-chat-bar { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.9rem; }
        .cu-dot { width: 10px; height: 10px; border-radius: 999px; }
        .cu-chat-label {
          margin-left: 0.6rem; font-size: 0.62rem; letter-spacing: 0.18em;
          text-transform: uppercase; color: rgba(250,250,248,0.4);
        }
        .cu-chat-line { line-height: 1.7; color: rgba(250,250,248,0.86); }
        .cu-chat-line .who { color: var(--accent); }
        .cu-chat-line .ai { color: #7fb2ff; }
        .cu-chat-ship { color: #6ee787; }
        .cu-cursor {
          display: inline-block; width: 7px; height: 1em; background: var(--accent);
          vertical-align: -2px; margin-left: 2px; animation: cuBlink 1.1s steps(2) infinite;
        }
        @keyframes cuBlink { 0%,50% { opacity: 1; } 50.01%,100% { opacity: 0; } }

        /* ---- BODY ---- */
        .cu-body { padding: 3.5rem 0 1rem; }
        .cu-blurb { font-size: 1.12rem; line-height: 1.65; color: var(--text); max-width: 60ch; }
        .cu-movements { display: grid; gap: 1rem; margin: 2.5rem 0 0; }
        .cu-move {
          display: grid; grid-template-columns: auto 1fr; gap: 1.1rem; align-items: baseline;
          padding: 1.1rem 1.35rem; background: var(--white);
          border: 1px solid var(--border); border-radius: 12px;
        }
        .cu-move-name {
          font-family: var(--font-display); font-weight: 600; font-size: 1.25rem;
          letter-spacing: -0.01em; color: var(--accent);
        }
        .cu-move-num {
          font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-tertiary);
          display: block; margin-top: 0.15rem;
        }
        .cu-move p { margin: 0; font-size: 0.96rem; line-height: 1.55; color: var(--text-secondary); }

        .cu-panel {
          margin-top: 2.5rem; padding: 1.75rem 2rem;
          background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
        }
        .cu-panel h3 { margin: 0 0 1.1rem; font-size: 1.05rem; font-family: var(--font-display); }
        .cu-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem 2rem; }
        .cu-fact { display: flex; flex-direction: column; gap: 0.15rem; }
        .cu-fact dt {
          font-family: var(--font-mono); font-size: 0.66rem; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--text-tertiary);
        }
        .cu-fact dd { margin: 0; font-size: 0.98rem; font-weight: 500; color: var(--text); }

        .cu-register { margin-top: 1.5rem; }
        .cu-register ol { margin: 0.5rem 0 0; padding-left: 1.25rem; line-height: 1.85; color: var(--text-secondary); }
        .cu-register code {
          font-family: var(--font-mono); font-size: 0.9em; background: var(--white);
          border: 1px solid var(--border); border-radius: 5px; padding: 0.1rem 0.4rem; color: var(--text);
        }
        .cu-tbd {
          font-family: var(--font-mono); font-size: 0.78rem; color: var(--accent);
          background: rgba(232,97,42,0.08); border: 1px dashed var(--accent);
          border-radius: 5px; padding: 0.1rem 0.45rem;
        }
        .cu-instructor {
          margin-top: 2.5rem; padding-top: 2rem; border-top: 1px solid var(--border);
          color: var(--text-secondary); line-height: 1.7;
        }
        .cu-instructor strong { color: var(--text); }

        .cu-print-only { display: none; }

        @media (max-width: 600px) {
          .cu-facts { grid-template-columns: 1fr; }
          .cu-move { grid-template-columns: 1fr; gap: 0.35rem; }
        }

        /* ---- PRINT: the flyer (one page, printer-friendly) ---- */
        @media print {
          /* Uniform shrink so the whole flyer scales to one page; all the
             spacing below is in rem, so this scales it proportionally. */
          html { font-size: 13.5px; }
          .nav, footer, .cu-noprint, .cu-cta-row { display: none !important; }
          .cu-screen-only { display: none !important; }
          .cu-print-only { display: block !important; }
          @page { margin: 0.45in; }
          body { background: #fff; }
          .cu-hero {
            background: #fff !important; color: #111 !important;
            padding: 0 0 0.4rem !important; overflow: visible;
          }
          .cu-hero::before { display: none !important; }
          .cu-eyebrow { margin-bottom: 0.55rem !important; }
          .cu-h1 { color: #111 !important; font-size: 2.3rem !important; margin-bottom: 0.4rem !important; }
          .cu-sub { color: #333 !important; max-width: 100%; font-size: 0.98rem !important; margin-bottom: 0.7rem !important; }
          .cu-metarow { color: #333 !important; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; padding: 0.45rem 0; margin-bottom: 0 !important; font-size: 0.74rem !important; }
          .cu-wrap { max-width: 100% !important; padding: 0 !important; }
          .cu-body { padding: 0.9rem 0 0 !important; }
          .cu-blurb { font-size: 0.9rem !important; line-height: 1.45 !important; max-width: 100%; margin-bottom: 0 !important; }
          .cu-movements { gap: 0.4rem !important; margin-top: 0.9rem !important; }
          .cu-move { padding: 0.45rem 0.8rem !important; break-inside: avoid; }
          .cu-move-name { font-size: 1.05rem !important; }
          .cu-move-num { margin-top: 0 !important; }
          .cu-move p { font-size: 0.83rem !important; line-height: 1.35 !important; }
          .cu-panel { margin-top: 0.9rem !important; padding: 0.9rem 1.15rem !important; background: #f7f7f5 !important; break-inside: avoid; }
          .cu-panel h3 { margin-bottom: 0.6rem !important; font-size: 0.98rem !important; }
          .cu-facts { gap: 0.45rem 1.5rem !important; }
          .cu-fact dd { font-size: 0.88rem !important; }
          .cu-register { margin-top: 0.85rem !important; }
          .cu-register ol { line-height: 1.5 !important; font-size: 0.88rem !important; }
          .cu-register p { font-size: 0.88rem !important; margin-top: 0.6rem !important; }
          a { color: #111 !important; text-decoration: none; }
          .cu-register a, .cu-fact dd a { text-decoration: underline; }
        }
      `}} />

      {/* ===== HERO ===== */}
      <section class="cu-hero">
        <div class="cu-wrap">
          <span class="cu-eyebrow"><span class="cu-pulse cu-noprint"></span>{cu.code} · CU Boulder · {cu.term}</span>
          <h1 class="cu-h1">Learn <span class="slash">/</span> Vibe <span class="slash">/</span> Build</h1>
          <p class="cu-sub">Build real things with AI as a creative partner — and ship them to the open internet.</p>
          <div class="cu-metarow">
            <span>{cu.meets}</span><span class="sep">·</span>
            <span>{cu.location}</span><span class="sep">·</span>
            <span>{cu.credits}</span><span class="sep">·</span>
            <span>All majors, no prereqs</span>
          </div>
          <div class="cu-cta-row">
            <a class="cu-btn cu-btn-primary" href="https://buffportal.colorado.edu" target="_blank" rel="noopener">
              Register on Buff Portal
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
            <a class="cu-btn cu-btn-ghost" href={`mailto:${cu.instructorEmail}?subject=ATLS%204519%2F5519%20%E2%80%94%20Learn%20Vibe%20Build`}>Email the instructor</a>
          </div>

          <div class="cu-chat cu-noprint" aria-hidden="true">
            <div class="cu-chat-bar">
              <span class="cu-dot" style="background:#ff5f57"></span>
              <span class="cu-dot" style="background:#febc2e"></span>
              <span class="cu-dot" style="background:#28c840"></span>
              <span class="cu-chat-label">learn-vibe-build · session</span>
            </div>
            <div class="cu-chat-line"><span class="who">you ›</span> i want to build something for my senior project</div>
            <div class="cu-chat-line"><span class="ai">ai ›</span> what should it do first?</div>
            <div class="cu-chat-line"><span class="who">you ›</span> log sensor readings, flag the anomalies</div>
            <div class="cu-chat-line"><span class="ai">ai ›</span> here's a working prototype →</div>
            <div class="cu-chat-line"><span class="cu-chat-ship">✓ shipped</span> · live at a real url<span class="cu-cursor"></span></div>
          </div>
        </div>
      </section>

      {/* ===== BODY ===== */}
      <section class="cu-body">
        <div class="cu-wrap">
          <p class="cu-blurb cu-screen-only">
            A hands-on, semester-long course in building with AI &mdash; not as a search engine, but as a creative partner you direct. Across three movements you'll go from your first real conversation with an AI to a working project live on the internet, yours to keep growing. Whatever you're studying &mdash; mechanical engineering, design, music, business &mdash; the skill that's becoming universal is knowing how to <em>lead</em> the work with AI. This course is that skill, practiced on something you actually care about. <strong>No coding experience required.</strong>
          </p>
          <p class="cu-blurb cu-print-only">
            A hands-on, semester-long course in building with AI as a creative partner you direct &mdash; not a search engine. Across three movements you'll go from your first real AI conversation to a working project live on the internet, yours to keep growing. Whatever your major, the universal new skill is knowing how to <em>lead</em> the work with AI &mdash; practiced here on something you actually care about. <strong>No coding experience required.</strong>
          </p>

          <div class="cu-movements">
            {CU_MOVEMENTS.map((m, i) => (
              <div class="cu-move">
                <div>
                  <span class="cu-move-name">{m.name}</span>
                  <span class="cu-move-num">0{i + 1}</span>
                </div>
                <p>{m.line}</p>
              </div>
            ))}
          </div>

          <div class="cu-panel">
            <h3>The details</h3>
            <dl class="cu-facts">
              <div class="cu-fact"><dt>Course</dt><dd>{cu.code} <span style="font-weight:400;color:var(--text-tertiary)">(cross-listed)</span></dd></div>
              <div class="cu-fact"><dt>Section / Class #</dt><dd>Section {cu.section} &middot; #{cu.classNbr}</dd></div>
              <div class="cu-fact"><dt>Catalog title</dt><dd>{cu.catalogTitle}</dd></div>
              <div class="cu-fact"><dt>Meets</dt><dd>{cu.meets}</dd></div>
              <div class="cu-fact"><dt>Location</dt><dd>{cu.location}</dd></div>
              <div class="cu-fact"><dt>Credits</dt><dd>{cu.credits}</dd></div>
              <div class="cu-fact"><dt>Term</dt><dd>{cu.term}</dd></div>
              <div class="cu-fact"><dt>Eligibility</dt><dd>{cu.open}</dd></div>
              <div class="cu-fact"><dt>Instructor</dt><dd>{cu.instructor}</dd></div>
            </dl>

            <div class="cu-register">
              <h3 style="margin-bottom:0.25rem;">How to register</h3>
              <ol>
                <li>Sign in to <a href="https://buffportal.colorado.edu" target="_blank" rel="noopener">Buff Portal</a> &rarr; <strong>Search Classes</strong>, term <strong>Fall 2026</strong>.</li>
                <li>Search <code>{cu.codeUgrad}</code> (undergraduate) or <code>{cu.codeGrad}</code> (graduate). It's a Special Topics number with several sections &mdash; pick the one titled <strong>&ldquo;{cu.sectionTitle}&rdquo;</strong> (<strong>Section {cu.section}</strong>). Fastest: in Buff Portal use <strong>&ldquo;add by class number&rdquo;</strong> &rarr; <code>{cu.classNbr}</code>.</li>
                <li>Want to look first? View the class on the public <a href="https://classes.colorado.edu" target="_blank" rel="noopener">CU class search</a> &mdash; no login needed.</li>
              </ol>
              <p style="margin-top:1rem;">
                Questions, or not sure if it's right for you? Email Aaron at <a href={`mailto:${cu.instructorEmail}`}>{cu.instructorEmail}</a> &mdash; happy to talk it through.
              </p>
              <p style="margin-top:0.6rem;font-weight:500;color:var(--text);">
                Full details &amp; latest updates: <a href="https://learnvibe.build/cu" style="color:var(--accent);">{cu.url}</a>
              </p>
            </div>
          </div>

          <div class="cu-instructor cu-noprint">
            <p>
              <strong>Taught by {cu.instructor}</strong> &mdash; founder of <a href="https://parachute.computer" target="_blank" rel="noopener" style="color:var(--accent)">Parachute</a>, an ATLAS Institute alum, and founding member of the <a href="https://regenhub.xyz" target="_blank" rel="noopener" style="color:var(--accent)">Regen Hub Cooperative</a>. He's spent the last year building with AI every day and running <a href="/" style="color:var(--accent)">Learn Vibe Build</a> as a community cohort in Boulder &mdash; this is that practice, given a full semester.
            </p>
          </div>

          <div class="page-section cu-noprint" style="text-align:center;padding:3rem 0 4rem;">
            <a class="cu-btn cu-btn-primary" href="https://buffportal.colorado.edu" target="_blank" rel="noopener" style="background:var(--accent);">
              Register on Buff Portal
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
            <p style="margin-top:1rem;font-size:0.85rem;color:var(--text-tertiary);">{cu.code} &middot; {cu.title} &middot; {cu.term} &middot; CU Boulder ATLAS Institute</p>
          </div>
        </div>
      </section>
    </Layout>
  )
})

// ===== /connect — public guide to the Learn Vibe Build MCP connector =====
// /mcp is the JSON-RPC endpoint (machine-readable). This is the human-readable
// page that walks people through hooking it up to Claude.
pages.get('/connect', (c) => {
  const user = c.get('user')
  return c.html(
    <Layout
      title="Connect Claude to Learn Vibe Build"
      description="Add Learn Vibe Build as a Claude connector so your AI can read your lessons, transcripts, and projects."
      user={user}
    >
      <div class="page-section" style="max-width: 720px; margin: 0 auto;">
        <a href="/" style="font-size: 0.85rem; color: var(--text-tertiary); text-decoration: none;">&larr; Home</a>

        <p class="section-label" style="margin-top: 2rem;">Connector setup</p>
        <h2>Hook Claude up to Learn Vibe Build</h2>
        <p class="lead">
          The LVB connector lets your Claude read your lesson plans, transcript summaries, projects, and discussions &mdash; and submit artifacts back on your behalf. Once it's installed you can ask Claude things like <em>"what did we cover in Week 3?"</em> or <em>"interview me about my learning journey"</em> and it can pull from the actual course material instead of guessing.
        </p>

        <div style="margin-top: 2.5rem; padding: 1.5rem 1.75rem; background: var(--surface); border: 1px solid var(--border); border-radius: 10px;">
          <h3 style="font-family: var(--font-display); font-size: 1.1rem; font-weight: 600; margin: 0 0 1rem;">Setup &mdash; in Claude</h3>
          <ol style="margin: 0; padding-left: 1.25rem; line-height: 1.8; color: var(--text-secondary);">
            <li>Open <strong>Claude.ai</strong> (web or desktop app)</li>
            <li>Go to <strong>Settings &rarr; Connectors</strong></li>
            <li>Click <strong>Add custom connector</strong></li>
            <li>Paste this URL:
              <pre style="background: var(--dark); color: #e0e0e0; padding: 0.75rem 1rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem; overflow-x: auto; font-family: var(--font-mono);">https://learnvibe.build/mcp</pre>
            </li>
            <li>Name it whatever you want (<em>LVB</em>, <em>Learn Vibe Build</em>, <em>class</em> &mdash; your call)</li>
            <li>Click <strong>Connect</strong>. You'll get sent through an OAuth flow &mdash; sign in with the same account you use for LVB, click <strong>Approve</strong>, and you'll land back in Claude with a green check.</li>
          </ol>
        </div>

        <h3 style="margin-top: 2.5rem; font-family: var(--font-display); font-size: 1.1rem; font-weight: 600;">Try it</h3>
        <p style="color: var(--text-secondary); line-height: 1.7;">Open a new Claude chat and paste:</p>
        <pre style="background: var(--dark); color: #e0e0e0; padding: 1rem 1.25rem; border-radius: 8px; margin-top: 0.5rem; font-size: 0.9rem; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;">
{`List the cohorts on Learn Vibe Build, then pull the lesson summaries for the one I'm enrolled in.`}
        </pre>
        <p style="margin-top: 0.85rem; color: var(--text-secondary); line-height: 1.7;">
          Claude will ask permission to call the LVB tool. Approve once and watch it read.
        </p>

        <h3 style="margin-top: 2.5rem; font-family: var(--font-display); font-size: 1.1rem; font-weight: 600;">What it can do</h3>
        <ul style="color: var(--text-secondary); line-height: 1.8; padding-left: 1.25rem;">
          <li>List and read lessons, including transcript summaries</li>
          <li>Pull full transcripts when you want verbatim quotes</li>
          <li>List, submit, and update your project artifacts</li>
          <li>Read and post in cohort discussions</li>
          <li>Update your profile</li>
          <li>(Admins) Author and edit lesson content directly from Claude</li>
        </ul>

        <h3 style="margin-top: 2.5rem; font-family: var(--font-display); font-size: 1.1rem; font-weight: 600;">A signature prompt to come back to</h3>
        <p style="color: var(--text-secondary); line-height: 1.7;">
          Designed to be re-run periodically &mdash; once at the end of the cohort, again in 4 weeks, again in 8:
        </p>
        <pre style="background: var(--dark); color: #e0e0e0; padding: 1rem 1.25rem; border-radius: 8px; margin-top: 0.5rem; font-size: 0.9rem; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;">
{`I just finished Learn Vibe Build. Use the Learn Vibe Build connector to
pull the lesson plans and transcript summaries for the cohort I'm enrolled
in.

Then interview me. Ask me 5-7 questions about where I'm at — what I built,
what's stuck, what's alive, where I'm curious, where I'm resistant. Push
back where I'm vague.

Then suggest 3 specific things to grow into over the next month, grounded
in what the lessons actually covered, and a simple way to check in with
myself in 4 weeks.`}
        </pre>

        {user && (
          <p style="margin-top: 2.5rem; padding: 1rem 1.25rem; background: var(--surface); border-radius: 8px; font-size: 0.9rem; color: var(--text-secondary);">
            Want an API key for CLI / scripted use instead of OAuth? <a href="/settings" style="color: var(--accent);">Generate one in your settings &rarr;</a>
          </p>
        )}

        <p style="margin-top: 2.5rem; font-size: 0.85rem;">
          <a href="/" style="color: var(--text-tertiary);">&larr; Back to homepage</a>
        </p>
      </div>
    </Layout>
  )
})

// ===== LEGACY REDIRECTS =====
// /apply → /enroll. Renamed when direct signup replaced the apply-review-
// approve flow (sliding-scale + alumni land at Stripe immediately; only
// scholarship still goes through review). Old links from closing emails
// and external bookmarks resolve cleanly.
pages.get('/apply', (c) => {
  const qs = c.req.url.split('?')[1]
  return c.redirect(`/enroll${qs ? '?' + qs : ''}`, 301)
})
pages.get('/apply/success', (c) => c.redirect('/enroll/success', 301))
pages.get('/apply/status', (c) => c.redirect('/dashboard', 301))
pages.post('/apply/status', (c) => c.redirect('/dashboard', 303))

// CU course page aliases → /cu (memorable URLs for the flyer / email)
pages.get('/atls4519', (c) => c.redirect('/cu', 301))
pages.get('/fall', (c) => c.redirect('/cu', 301))

pages.get('/enroll', async (c) => {
  const error = c.req.query('error')
  const db = getDb(c.env.DB)
  const user = c.get('user')

  // Check whether any cohort is currently `enrolling` — if not, render a
  // graceful "applications aren't open" state pointing at the interest
  // list instead of the form. Cohorts cycle: Spring 2026 wrapped, Summer
  // 2026 is currently enrolling, future cohorts will toggle through here.
  const enrollingCohort = await db.select().from(cohorts).where(eq(cohorts.status, 'enrolling')).get()

  if (!enrollingCohort) {
    return c.html(
      <Layout
        title="Applications closed for now — Learn Vibe Build"
        description="Applications aren't open right now. Join the interest list to be notified when the next cohort opens."
        user={c.get('user')}
      >
        <div class="page-section" style="max-width: 640px; margin: 0 auto;">
          <p class="section-label">Enroll</p>
          <h2>Enrollment isn't open right now</h2>
          <p class="lead">
            We're between cohorts at the moment. Drop your email on the interest list and we'll be in touch as the next one takes shape.
          </p>
          <div style="margin-top: 1.5rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
            <a href="/interest" style="display: inline-flex; align-items: center; gap: 0.4rem; background: var(--accent); color: white; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 500;">
              Join the interest list →
            </a>
            <a href="/" style="color: var(--text-secondary); text-decoration: none; font-size: 0.95rem;">← Back to homepage</a>
          </div>
        </div>
      </Layout>
    )
  }

  // Auth-required: applying now requires a Clerk account so we can link
  // applications.user_id from the start. Closes the loop on the
  // "approved-but-no-account" / "applied with different email than they
  // signed up with" diagnostic states. Legacy applications keep working
  // and their status surfaces on the dashboard once signed in.
  if (!user) {
    return c.html(
      <Layout
        title="Apply — create your account first"
        description={`Apply for Learn Vibe Build ${enrollingCohort.title} — 3 weeks in person in Boulder, June 22–July 8, 2026. Sliding scale $250 / $500 / $750.`}
        user={null}
      >
        <div class="page-section" style="max-width: 640px; margin: 0 auto;">
          <p class="section-label">Enroll</p>
          <h2>{enrollingCohort.title}</h2>

          {/* Summary of what they're signing up for — so the spec survives
              the account-creation gate. Without this, visitors lose all
              cohort context between the homepage CTA and the form. */}
          <div style="margin-top: 1.5rem; padding: 1.25rem 1.5rem; background: var(--surface); border: 1px solid var(--border); border-radius: 10px;">
            <p style="margin: 0; color: var(--text-secondary); line-height: 1.7; font-size: 0.95rem;">
              <strong>June 22 &ndash; July 8, 2026</strong> &middot; 3 weeks, in person at <a href="https://regenhub.xyz" target="_blank" style="color: var(--accent);">Regen Hub</a> in Boulder<br />
              Mondays &amp; Wednesdays 6&ndash;8pm MT &middot; office hours Tuesdays 1&ndash;3pm MT<br />
              Capped at 20 &middot; sliding scale $250 / $500 / $750 &middot; scholarships available
            </p>
            <p style="margin: 0.85rem 0 0; color: var(--text-tertiary); font-size: 0.85rem; line-height: 1.6;">
              Calls recorded, but no live remote &mdash; this one's about being in the room together. Includes discounted Regen Hub Cooperative membership + free co-working day passes during the cohort.
            </p>
          </div>

          <h3 style="font-family: var(--font-display); font-weight: 600; font-size: 1.1rem; margin: 2rem 0 0.5rem;">One step before you sign up</h3>
          <p class="lead" style="margin-top: 0;">
            Enrolling starts with creating a Learn Vibe Build account &mdash; that way your spot is linked to you from the moment you sign up, and you land in the cohort immediately after payment with no extra steps.
          </p>
          <div style="margin-top: 1.25rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
            <a href="/sign-up?redirect_url=/enroll" style="display: inline-flex; align-items: center; gap: 0.4rem; background: var(--accent); color: white; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 500;">
              Create account &rarr;
            </a>
            <a href="/sign-in?redirect_url=/enroll" style="color: var(--text-secondary); text-decoration: none; font-size: 0.95rem;">Already have one? Sign in &rarr;</a>
          </div>
        </div>
      </Layout>
    )
  }

  // Tiers + alumni detection — drives the pricing UI below. Alumni rate
  // is only shown when we can verify the applicant has a prior enrollment;
  // the api.ts POST handler enforces the same rule server-side.
  const tiers = getTiersForCohort(enrollingCohort.slug)
  const userEnrollments = await db.select({ cohortId: enrollments.cohortId })
    .from(enrollments)
    .where(eq(enrollments.userId, user.id))
    .all()
  const isAlumni = userEnrollments.some(e => e.cohortId !== enrollingCohort.id)

  // Capacity check — if the cohort is full to direct-signup but a
  // scholarship slot might still be available, we still render the form
  // with scholarship-only options. Otherwise full = closed-state.
  const capacity = await getCohortCapacity(c.env.DB, enrollingCohort.slug)
  const capacityLabel = getCapacityLabel(capacity)

  const errorMessages: Record<string, string> = {
    missing_fields: 'Please fill out all required fields.',
    invalid_email: 'Please enter a valid email address.',
    invalid_amount: 'That contribution amount or tier isn\'t available — please pick from the options.',
    too_long: 'One or more fields are too long. Please shorten and try again.',
    server_error: 'Something went wrong. Please try again.',
    already_applied: 'You\'ve already submitted an application — see status below.',
    cohort_full: 'The cohort just filled up while you were applying. You can still apply for a scholarship slot, or join the interest list for the next cohort.',
  }

  // Tier descriptors for the radio UI. Order matters: sliding scale low →
  // high, then alumni (if applicable), then scholarship at the bottom
  // (different shape: requires extra info).
  const slidingTiers = tiers.filter(t => t.tier.startsWith('sliding_'))
  const scholarshipTier = tiers.find(t => t.tier === 'scholarship')
  const alumniTier = tiers.find(t => t.tier === 'alumni')

  return c.html(
    <Layout
      title="Apply"
      description="Apply for Learn Vibe Build Summer 2026 Cohort — 3 weeks in person in Boulder, June 22–July 8. Sliding scale $250 / $500 / $750."
      user={user}
    >
      <div class="page-section">
        <p class="section-label">Enroll</p>
        <h2>Sign up for the {enrollingCohort.title}</h2>
        <p class="lead">
          Three weeks of building with AI as a creative partner. Mondays &amp; Wednesdays 6&ndash;8pm MT, office hours Tuesdays 1&ndash;3pm MT. <strong>June 22 &ndash; July 8, 2026 &middot; in person at <a href="https://regenhub.xyz" target="_blank" style="color: var(--accent);">Regen Hub</a> in Boulder.</strong> Capped at 20. Sliding scale $250 / $500 / $750 &mdash; pick what fits your current level of abundance. Scholarships available for folks who need them.
        </p>
        <p style="font-size: 0.95rem; color: var(--text-secondary); margin-top: 0.85rem;">
          Membership at the Regen Hub Cooperative is included &mdash; discounted rates and free co-working day passes alongside the cohort.
        </p>

        {capacityLabel && (
          <div style={`margin-top: 1rem; padding: 0.85rem 1.1rem; background: ${capacity.isFull ? 'var(--surface)' : 'rgba(232, 97, 42, 0.08)'}; border: 1px solid ${capacity.isFull ? 'var(--border)' : 'var(--accent)'}; border-radius: 8px; font-size: 0.95rem; font-weight: 500; color: ${capacity.isFull ? 'var(--text-secondary)' : 'var(--accent)'};`}>
            {capacity.isFull
              ? <>The cohort is full. Scholarship applications are still considered &mdash; or join the <a href="/interest" style="color: var(--accent);">interest list</a> for the next cohort.</>
              : <>⚡ {capacityLabel} &mdash; with a hard cap of 20, sign up soon to claim your spot.</>}
          </div>
        )}

        {error && errorMessages[error] && (
          <div class="form-error">
            {errorMessages[error]}
          </div>
        )}

        {/* Account info — applying with the signed-in user's email. We
            disable the email field so applicant can't submit a different
            address than their account, which was the source of half the
            "no account / orphan enrollment" diagnostic states. */}
        <div style="margin: 1.5rem 0; padding: 0.85rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
          <span>
            <span style="font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase; color: var(--text-tertiary); letter-spacing: 0.05em; margin-right: 0.5rem;">Applying as</span>
            <strong>{user.name || user.email}</strong>
            {user.name && <span style="color: var(--text-tertiary); margin-left: 0.4rem; font-family: var(--font-mono); font-size: 0.85rem;">&lt;{user.email}&gt;</span>}
            {isAlumni && (
              <span style="display: inline-block; margin-left: 0.6rem; font-size: 0.75rem; padding: 0.15rem 0.5rem; background: var(--accent); color: white; border-radius: 999px; font-weight: 600;">Alumni</span>
            )}
          </span>
          <a href="/sign-out" style="font-size: 0.8rem; color: var(--text-tertiary); text-decoration: none;">Switch account</a>
        </div>

        <form method="post" action="/api/applications" class="apply-form">
          <div class="form-group">
            <label for="name">Full name</label>
            <input type="text" id="name" name="name" required autocomplete="name" value={user.name || ''} />
          </div>

          <div class="form-group">
            <label for="background">Tell us about yourself</label>
            <textarea
              id="background"
              name="background"
              rows={5}
              required
              placeholder="What do you do? What are you interested in? What's your relationship with technology?"
            ></textarea>
          </div>

          <div class="form-group">
            <label for="project_interest">What do you want to build?</label>
            <textarea
              id="project_interest"
              name="project_interest"
              rows={5}
              required
              placeholder="An idea, a project, a tool — whatever excites you. No wrong answers."
            ></textarea>
          </div>

          <div class="form-group">
            <label for="referral_source">How did you hear about Learn Vibe Build?</label>
            <input type="text" id="referral_source" name="referral_source" required placeholder="An event, a search, a friend…" />
            <p style="margin-top: 0.4rem; font-size: 0.85rem; color: var(--text-tertiary); line-height: 1.5;">
              If a person referred you, name them here &mdash; they'll earn a $50 Regen Hub credit when you enroll.
            </p>
          </div>

          <div class="form-group" style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border);">
            <p style="font-weight: 600; font-size: 1rem; margin-bottom: 0.5rem;">Financial</p>
            <p style="color: var(--text-secondary); font-size: 0.95rem; line-height: 1.5; margin-bottom: 1rem;">
              Pick what matches your current level of abundance. Cost should never be a barrier &mdash; if none of these work, apply for a scholarship below.
            </p>
            <div style="display: flex; flex-direction: column; gap: 0.6rem;">
              {slidingTiers.map(t => {
                const subtitle =
                  t.tier === 'sliding_low' ? 'For folks where this feels like a stretch.' :
                  t.tier === 'sliding_mid' ? 'Suggested rate.' :
                  t.tier === 'sliding_high' ? 'Helps subsidize sliding-scale and scholarship spots.' :
                  ''
                return (
                  <label style="display: flex; gap: 0.6rem; align-items: flex-start; padding: 0.75rem 0.95rem; border: 1px solid var(--border); border-radius: 6px; cursor: pointer;">
                    <input type="radio" name="pricing_tier" value={t.tier} required onchange="lvbHideScholarship()" style="margin-top: 0.2rem;" />
                    <span>
                      <strong>{formatCents(t.amountCents)}</strong>
                      {subtitle && <span style="display: block; color: var(--text-secondary); font-size: 0.85rem; font-weight: 400;">{subtitle}</span>}
                    </span>
                  </label>
                )
              })}
              {isAlumni && alumniTier && (
                <label style="display: flex; gap: 0.6rem; align-items: flex-start; padding: 0.75rem 0.95rem; border: 1px solid var(--accent); border-radius: 6px; cursor: pointer; background: rgba(232, 97, 42, 0.04);">
                  <input type="radio" name="pricing_tier" value="alumni" onchange="lvbHideScholarship()" style="margin-top: 0.2rem;" />
                  <span>
                    <strong>{formatCents(alumniTier.amountCents)} &mdash; Alumni rate</strong>
                    <span style="display: block; color: var(--text-secondary); font-size: 0.85rem; font-weight: 400;">For Learn Vibe Build alumni who want to keep diving deeper.</span>
                  </span>
                </label>
              )}
              {scholarshipTier && (
                <label style="display: flex; gap: 0.6rem; align-items: flex-start; padding: 0.75rem 0.95rem; border: 1px solid var(--border); border-radius: 6px; cursor: pointer;">
                  <input type="radio" name="pricing_tier" value="scholarship" onchange="lvbShowScholarship()" style="margin-top: 0.2rem;" />
                  <span>
                    <strong>Apply for a scholarship</strong>
                    <span style="display: block; color: var(--text-secondary); font-size: 0.85rem; font-weight: 400;">Limited slots, for demonstrated need or public-benefit / non-profit / student academic work.</span>
                  </span>
                </label>
              )}
            </div>
            {scholarshipTier && (
              <div id="scholarship-box" style="display: none; margin-top: 1rem; padding: 1.25rem 1.5rem; background: var(--surface); border: 1px solid var(--accent); border-radius: 8px;">
                <label for="scholarship_request" style="display: block; font-size: 0.95rem; font-weight: 600; margin-bottom: 0.35rem;">
                  Tell us about your situation
                </label>
                <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0 0 0.6rem; line-height: 1.5;">
                  We're prioritizing folks with demonstrated need, public-benefit / non-profit work, or student academic context. A paragraph or two is plenty &mdash; what's the work you're doing, what makes this the right moment, and why a scholarship would help.
                </p>
                <textarea
                  id="scholarship_request"
                  name="scholarship_request"
                  rows={5}
                  maxlength={3000}
                  placeholder="Whatever feels true."
                  style="width: 100%;"
                ></textarea>
              </div>
            )}
          </div>

          <button type="submit" class="apply-btn">Continue &rarr;</button>
        </form>

        {/* Scholarship reveal — show the textarea and make it natively
            required when scholarship is selected, so the browser blocks an
            empty submit (and focuses the field) instead of the server
            bouncing the applicant back to a confusing reload. */}
        <script dangerouslySetInnerHTML={{ __html: `
          function lvbShowScholarship() {
            var box = document.getElementById('scholarship-box');
            var ta = document.getElementById('scholarship_request');
            if (box) box.style.display = 'block';
            if (ta) { ta.required = true; ta.focus(); }
          }
          function lvbHideScholarship() {
            var box = document.getElementById('scholarship-box');
            var ta = document.getElementById('scholarship_request');
            if (box) box.style.display = 'none';
            if (ta) ta.required = false;
          }
        ` }} />
      </div>
    </Layout>
  )
})

pages.get('/enroll/success', (c) => {
  const user = c.get('user')
  // Reaches here only on the scholarship path now — sliding-scale and
  // alumni land at /payment/checkout immediately after form submit (and
  // from there at /payment/success once they pay).
  return c.html(
    <Layout title="Application Received" user={user}>
      <div class="page-section success-message" style="max-width: 600px; margin: 0 auto;">
        <h2>Scholarship application received</h2>
        <p class="lead">
          Thank you for sharing your context with us. We review scholarship applications personally &mdash; typically within a few days &mdash; and we'll be in touch with a decision.
        </p>
        <p style="margin-top: 1rem; color: var(--text-secondary); line-height: 1.6;">
          Scholarship slots are limited, so we can't promise a yes, but we read every application carefully. Whatever the outcome, we appreciate you applying.
        </p>

        <p style="margin-top: 1.5rem; color: var(--text-secondary);">
          You can check your application status anytime from <a href="/dashboard" style="color: var(--accent);">your dashboard</a>.
        </p>
        <p style="margin-top: 2rem;">
          <a href="/">← Back to homepage</a>
        </p>
      </div>
    </Layout>
  )
})

// ===== APPLICATION STATUS =====
// The old email-entry "check your status" flow is gone — everyone who
// enrolls now has an account, so status lives on the dashboard (which
// shows pending/approved application states + enrollments and redirects
// signed-out visitors to sign-in). /enroll/status is kept only as a
// redirect so legacy links (old emails, bookmarks) resolve cleanly.
pages.get('/enroll/status', (c) => c.redirect('/dashboard', 301))
pages.post('/enroll/status', (c) => c.redirect('/dashboard', 303))

export default pages
