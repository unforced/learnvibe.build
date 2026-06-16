// Server-side slide-deck renderer.
//
// renderDeckHtml(deck) -> a complete standalone HTML page (NOT Layout-wrapped:
// decks are full-screen presentation surfaces with their own chrome). Slides
// render server-side on a fixed 1920x1080 stage; public/deck.js only handles
// presentation behavior (scale-to-fit, navigation, hash sync, speaker notes,
// print). The design tokens + slide CSS are lifted from the Week 6 reference
// deck so decks look identical to the hand-built originals.
//
// Text handling (the whole XSS story lives in fmt/fmtBlock below):
//   1. HTML-escape everything.
//   2. [[accented text]] -> <span class="a">accented text</span>
//   3. newline -> <br>, in heading/sub fields only.
// No raw HTML passthrough — decks are admin-authored, but defense in depth.

import type {
  Deck, Slide, TitleSlide, StatementSlide, ArcSlide, CardsSlide,
  PromptSlide, ListSlide, TwoColSlide, ClosingSlide,
} from './deck-schema'

export interface RenderDeckOptions {
  /** Inline the runtime source instead of <script src="/deck.js"> — used by
   *  build-time previews that need to work as a single file off-origin. */
  inlineRuntimeJs?: string
}

// ===== TEXT HANDLING =====

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape + accent. The (?!\]) lookahead lets authors keep literal square
 *  brackets inside an accent — [[[your text]]] accents "[your text]". */
function fmt(s: string): string {
  return esc(s).replace(/\[\[(.+?)\]\](?!\])/g, '<span class="a">$1</span>')
}

/** fmt + newline -> <br>. For heading/sub fields where authors line-break. */
function fmtBlock(s: string): string {
  return fmt(s).replace(/\n/g, '<br>')
}

// ===== SLIDE RENDERERS =====
// Each returns the inner HTML of its <section class="slide ...">. Class names
// and structure mirror the reference deck so its CSS applies unchanged.

function renderTitle(s: TitleSlide): string {
  return `
    <div class="week">${fmt(s.kicker)}</div>
    <h1 class="display">${fmtBlock(s.heading)}</h1>
    <div class="sub">${fmtBlock(s.sub)}</div>
    <div class="meta">${fmt(s.meta)}</div>`
}

function renderStatement(s: StatementSlide): string {
  return `
    <div class="kicker">${fmt(s.kicker)}</div>
    <h2 class="title">${fmtBlock(s.heading)}</h2>
    ${s.lead ? `<p class="lead">${fmt(s.lead)}</p>` : ''}`
}

function renderArc(s: ArcSlide): string {
  const chips = s.items.map(item => `
      <div class="c${item.now ? ' now' : ''}"><div class="n">${fmt(item.num)}</div><div class="name">${fmt(item.name)}</div></div>`)
  return `
    <div class="kicker">${fmt(s.kicker)}</div>
    <h2 class="title smaller">${fmtBlock(s.heading)}</h2>
    <div class="arc">${chips.join('\n      <div class="arrow">→</div>')}
    </div>
    ${s.note ? `<div class="note">${fmt(s.note)}</div>` : ''}`
}

function renderCards(s: CardsSlide): string {
  const cards = s.cards.map(card => `
      <div class="card">
        <div class="label">${fmt(card.label)}</div>
        <h3>${fmt(card.heading)}</h3>
        <p>${fmt(card.body)}</p>
      </div>`).join('')
  return `
    <div class="kicker">${fmt(s.kicker)}</div>
    <h2 class="title smaller">${fmtBlock(s.heading)}</h2>
    <div class="card-grid cols-${s.cards.length}">${cards}
    </div>`
}

function renderPrompt(s: PromptSlide): string {
  // With a filename the heading gets the head-row treatment (smaller title +
  // filename on the right); without one it's a plain section heading.
  const head = s.filename
    ? `
    <div class="head">
      <h2 class="title">${fmtBlock(s.heading)}</h2>
      <div class="filename">${fmt(s.filename)}</div>
    </div>`
    : `
    <h2 class="title smaller">${fmtBlock(s.heading)}</h2>`
  const paras = s.paragraphs.map(p => `
        <p>${fmt(p)}</p>`).join('')
  return `
    <div class="kicker">${fmt(s.kicker)}</div>${head}
    <div class="prompt-block">
      <div class="bar">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        ${s.barLabel ? `<span class="lbl">${fmt(s.barLabel)}</span>` : ''}
      </div>${paras}
    </div>
    ${s.footnote ? `<div class="footnote">${fmt(s.footnote)}</div>` : ''}`
}

function renderList(s: ListSlide): string {
  const rows = s.items.map(item => `
      <li>
        <div class="n">${item.num ? fmt(item.num) : ''}</div>
        <div class="name">${fmt(item.name)}${item.sub ? `<span class="sub">${fmt(item.sub)}</span>` : ''}</div>
        <div class="desc">${fmt(item.desc)}</div>
      </li>`).join('')
  return `
    <div class="kicker">${fmt(s.kicker)}</div>
    <h2 class="title smaller">${fmtBlock(s.heading)}</h2>
    <ol class="rows">${rows}
    </ol>
    ${s.footnote ? `<div class="footnote">${fmt(s.footnote)}</div>` : ''}`
}

function renderTwoCol(s: TwoColSlide): string {
  const cols = s.cols.map(col => {
    const kv = col.kv?.length
      ? `
        <ul>${col.kv.map(row => `
          <li><span class="k">${fmt(row.k)}</span>${fmt(row.v)}</li>`).join('')}
        </ul>`
      : ''
    return `
      <div class="col-card${col.pinned ? ' pinned' : ''}">
        <div class="label">${fmt(col.label)}</div>
        <h3>${fmt(col.heading)}</h3>
        ${col.body ? `<p>${fmt(col.body)}</p>` : ''}${kv}
      </div>`
  }).join('')
  return `
    <div class="kicker">${fmt(s.kicker)}</div>
    <h2 class="title smaller">${fmtBlock(s.heading)}</h2>
    <div class="two-col">${cols}
    </div>`
}

function renderClosing(s: ClosingSlide): string {
  const items = s.items?.length
    ? `
    <ol class="six">${s.items.map(item => `
      <li><div class="n">${fmt(item.num)}</div><div class="w">${fmt(item.name)}</div><div class="d">${fmt(item.desc)}</div></li>`).join('')}
    </ol>`
    : ''
  const mantras = s.mantras?.length
    ? `
    <div class="mantras">${s.mantras.map(m => `
      <div class="m">${fmt(m)}</div>`).join('')}
    </div>`
    : ''
  return `
    <div class="kicker">${fmt(s.kicker)}</div>
    <h2 class="title">${fmtBlock(s.heading)}</h2>${items}${mantras}
    ${s.signoff ? `<div class="signoff">${fmt(s.signoff)}</div>` : ''}`
}

/** section class list per layout — mirrors the reference deck's slide classes
 *  (.top = content flows from the top; default = vertically centered). */
function slideClasses(slide: Slide): string {
  switch (slide.layout) {
    case 'title': return 'slide title-slide'
    case 'statement': {
      const bg = slide.dark ? ' dark' : slide.surface ? ' surface' : ''
      return `slide statement-slide${bg}`
    }
    case 'arc': return 'slide surface arc-slide top'
    case 'cards': return 'slide cards-slide top'
    // filename implies the signature-prompt treatment: surface bg, head row,
    // denser prompt type. Without it, the lighter check-in treatment.
    case 'prompt': return `slide prompt-slide${slide.filename ? ' has-file' : ''} top`
    case 'list': return 'slide list-slide top'
    case 'twoCol': return 'slide twocol-slide top'
    case 'closing': return 'slide closing-slide top'
  }
}

function renderSlideBody(slide: Slide): string {
  switch (slide.layout) {
    case 'title': return renderTitle(slide)
    case 'statement': return renderStatement(slide)
    case 'arc': return renderArc(slide)
    case 'cards': return renderCards(slide)
    case 'prompt': return renderPrompt(slide)
    case 'list': return renderList(slide)
    case 'twoCol': return renderTwoCol(slide)
    case 'closing': return renderClosing(slide)
  }
}

// ===== PAGE CSS =====
// Design tokens + slide styles, adapted from the Week 6 reference deck.
// Stage is a fixed 1920x1080 canvas; deck.js scales it to the viewport.

const DECK_CSS = `
  :root {
    /* Surfaces */
    --bg:            #fafaf8;
    --surface:       #f3f1ed;
    --white:         #ffffff;
    --border:        #e5e2db;
    /* Ink */
    --text:          #1a1a1a;
    --text-secondary:#555555;
    --text-tertiary: #999999;
    /* Accent — the only chromatic color in the system */
    --accent:        #e8612a;
    /* Dark surfaces */
    --dark:          #111111;
    --dark-text:     #aaaaaa;
    /* Type */
    --font-display: 'Space Grotesk', sans-serif;
    --font-body:    'Inter', sans-serif;
    --font-mono:    'JetBrains Mono', monospace;
    /* Stage padding */
    --pad-x: 180px;
    --pad-y: 120px;
  }

  html, body { margin: 0; padding: 0; background: #000; height: 100%; overflow: hidden; }

  /* The 1920x1080 stage. deck.js positions + scales it to fit the viewport. */
  .deck-stage {
    position: absolute;
    top: 0; left: 0;
    width: 1920px;
    height: 1080px;
    transform-origin: 0 0;
    background: var(--bg);
  }
  .deck-stage section.slide { position: absolute; inset: 0; visibility: hidden; }
  .deck-stage section.slide.active { visibility: visible; }

  section.slide {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--pad-y) var(--pad-x);
    -webkit-font-smoothing: antialiased;
    box-sizing: border-box;
  }
  section.slide.dark { background: var(--dark); color: #fff; }
  section.slide.surface { background: var(--surface); }
  section.slide.top { justify-content: flex-start; padding-top: 110px; padding-bottom: 90px; }
  /* flex items in column layout default to content width; force stretch */
  section.slide > * { align-self: stretch; }

  /* shared type */
  .kicker {
    font-family: var(--font-mono);
    font-size: 22px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 28px;
  }
  h1.display {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 200px;
    line-height: 1;
    letter-spacing: -0.04em;
    margin: 0;
  }
  h2.title {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 96px;
    line-height: 1.05;
    letter-spacing: -0.03em;
    margin: 0;
    max-width: 1500px;
  }
  h2.title.smaller { font-size: 76px; }
  .a { color: var(--accent); }
  p.lead {
    font-family: var(--font-body);
    font-weight: 300;
    font-size: 36px;
    line-height: 1.45;
    color: var(--text-secondary);
    max-width: 1300px;
    margin: 36px 0 0;
  }
  .dark p.lead { color: var(--dark-text); }
  .footnote {
    margin-top: 36px;
    font-family: var(--font-mono);
    font-size: 20px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  /* === layout: title === */
  .title-slide { align-items: flex-start; }
  .title-slide .week {
    font-family: var(--font-mono);
    font-size: 24px;
    color: var(--accent);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 56px;
  }
  .title-slide .sub {
    margin-top: 56px;
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 48px;
    line-height: 1.3;
    color: var(--text-secondary);
    letter-spacing: -0.02em;
    max-width: 1400px;
  }
  .title-slide .meta {
    font-family: var(--font-mono);
    font-size: 22px;
    color: var(--text-tertiary);
    margin-top: 110px;
    letter-spacing: 0.02em;
  }

  /* === layout: statement === */
  .statement-slide { align-items: flex-start; }

  /* === layout: arc === */
  .arc-slide { align-items: flex-start; }
  .arc {
    margin-top: 72px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0;
  }
  .arc .c {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 28px 36px 28px 36px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: #fff;
    min-width: 220px;
  }
  .arc .c.now {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .arc .c .n {
    font-family: var(--font-mono);
    font-size: 16px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin-bottom: 8px;
  }
  .arc .c.now .n { color: rgba(255,255,255,0.7); }
  .arc .c .name {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 32px;
    letter-spacing: -0.02em;
    color: var(--text);
  }
  .arc .c.now .name { color: #fff; }
  .arc .arrow {
    font-family: var(--font-mono);
    font-size: 28px;
    color: var(--text-tertiary);
    padding: 0 14px;
  }
  .arc-slide .note {
    margin-top: 64px;
    font-family: var(--font-body);
    font-weight: 300;
    font-size: 32px;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 1500px;
    border-top: 1px solid var(--border);
    padding-top: 36px;
  }

  /* === layout: cards (2 or 3) === */
  .cards-slide { align-items: flex-start; }
  .card-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 28px;
    margin-top: 72px;
  }
  .card-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .card-grid .card {
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 44px 40px;
    display: flex;
    flex-direction: column;
  }
  .card-grid .card .label {
    font-family: var(--font-mono);
    font-size: 16px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 24px;
  }
  .card-grid .card h3 {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 40px;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin: 0 0 22px;
    color: var(--text);
  }
  .card-grid .card p {
    font-size: 24px;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
  }

  /* === layout: prompt === */
  .prompt-slide { align-items: flex-start; }
  .prompt-slide.has-file { background: var(--surface); }
  .prompt-slide .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 48px;
    width: 100%;
    max-width: 1560px;
  }
  .prompt-slide .head h2.title { font-size: 64px; max-width: 1100px; }
  .prompt-slide .filename {
    font-family: var(--font-mono);
    font-size: 18px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }
  .prompt-block {
    margin-top: 56px;
    background: var(--dark);
    color: #eaeaea;
    border-radius: 14px;
    padding: 44px 56px;
    font-family: var(--font-mono);
    font-size: 30px;
    line-height: 1.55;
    max-width: 1500px;
    position: relative;
  }
  .prompt-slide.has-file .prompt-block { margin-top: 40px; font-size: 24px; max-width: 1560px; }
  .prompt-block .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-bottom: 24px;
    border-bottom: 1px solid #2a2a2a;
    margin-bottom: 28px;
  }
  .prompt-block .bar .dot {
    width: 12px; height: 12px; border-radius: 999px;
    background: #2f2f2f;
  }
  .prompt-block .bar .lbl {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 14px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #888;
  }
  .prompt-block p {
    margin: 0 0 22px;
    color: #eaeaea;
  }
  .prompt-block p:last-child { margin-bottom: 0; }
  .prompt-slide.has-file .footnote { margin-top: 28px; font-size: 18px; letter-spacing: 0.06em; }

  /* === layout: list === */
  .list-slide { align-items: flex-start; }
  .list-slide .rows {
    margin: 64px 0 0;
    padding: 0;
    list-style: none;
    max-width: 1560px;
  }
  .list-slide .rows li {
    display: grid;
    grid-template-columns: 80px 360px 1fr;
    gap: 40px;
    align-items: baseline;
    padding: 32px 0;
    border-bottom: 1px solid var(--border);
  }
  .list-slide .rows li:first-child { border-top: 1px solid var(--border); }
  .list-slide .rows li .n {
    font-family: var(--font-mono);
    font-size: 20px;
    letter-spacing: 0.06em;
    color: var(--accent);
  }
  .list-slide .rows li .name {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 38px;
    letter-spacing: -0.02em;
    color: var(--text);
    line-height: 1.15;
  }
  .list-slide .rows li .name .sub {
    display: block;
    font-family: var(--font-mono);
    font-size: 16px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    font-weight: 400;
    margin-top: 8px;
  }
  .list-slide .rows li .desc {
    font-size: 24px;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  /* === layout: twoCol === */
  .twocol-slide { align-items: flex-start; }
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    margin-top: 72px;
  }
  .col-card {
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 48px 44px;
    display: flex;
    flex-direction: column;
  }
  .col-card.pinned { border-left: 3px solid var(--accent); }
  .col-card .label {
    font-family: var(--font-mono);
    font-size: 16px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 24px;
  }
  .col-card h3 {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 44px;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin: 0 0 22px;
  }
  .col-card p {
    font-size: 24px;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0 0 20px;
  }
  .col-card ul {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }
  .col-card ul li {
    font-family: var(--font-mono);
    font-size: 18px;
    letter-spacing: 0.04em;
    color: var(--text);
    padding: 14px 0;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: baseline;
    gap: 18px;
  }
  .col-card ul li .k {
    color: var(--text-tertiary);
    text-transform: uppercase;
    font-size: 14px;
    letter-spacing: 0.08em;
    width: 110px;
    flex: 0 0 auto;
  }

  /* === layout: closing === */
  .closing-slide { align-items: flex-start; }
  .closing-slide h2.title { font-size: 60px; max-width: 1500px; }
  .closing-slide .six {
    margin: 40px 0 0;
    padding: 0;
    list-style: none;
    max-width: 1600px;
  }
  .closing-slide .six li {
    display: grid;
    grid-template-columns: 70px 220px 1fr;
    gap: 32px;
    align-items: baseline;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .closing-slide .six li .n {
    font-family: var(--font-mono);
    font-size: 18px;
    letter-spacing: 0.06em;
    color: var(--accent);
  }
  .closing-slide .six li .w {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 28px;
    letter-spacing: -0.02em;
    color: var(--text);
  }
  .closing-slide .six li .d {
    font-size: 22px;
    color: var(--text-secondary);
    line-height: 1.45;
  }
  .closing-slide .mantras {
    margin-top: 36px;
    display: flex;
    gap: 56px;
    flex-wrap: wrap;
  }
  .closing-slide .mantras .m {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 38px;
    letter-spacing: -0.02em;
    color: var(--text);
    line-height: 1.2;
  }
  .closing-slide .signoff {
    margin-top: 32px;
    font-family: var(--font-mono);
    font-size: 20px;
    color: var(--text-tertiary);
    letter-spacing: 0.04em;
  }
`

// ===== PAGE ASSEMBLY =====

/**
 * Render a validated deck into a complete standalone HTML page string.
 * Callers are expected to have run validateDeck() first — this function
 * trusts the deck's shape.
 */
export function renderDeckHtml(deck: Deck, opts: RenderDeckOptions = {}): string {
  const sections = deck.slides.map((slide, i) => {
    // data-screen-label feeds presenter chrome; default to "NN layout".
    const label = slide.label || `${String(i + 1).padStart(2, '0')} ${slide.layout}`
    return `  <section class="${slideClasses(slide)}" data-screen-label="${esc(label)}">${renderSlideBody(slide)}
  </section>`
  }).join('\n\n')

  // Speaker notes: one entry per slide, 1:1 by index ('' = no notes). Escape
  // "<" so a note containing "</script>" can't break out of the JSON block.
  const notesJson = JSON.stringify(deck.slides.map(s => s.notes || ''))
    .replace(/</g, '\\u003c')

  const runtime = opts.inlineRuntimeJs
    ? `<script>\n${opts.inlineRuntimeJs}\n</script>`
    : `<script src="/deck.js"></script>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(deck.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<style>${DECK_CSS}</style>
</head>
<body>
<div class="deck-stage" id="deck-stage" data-width="1920" data-height="1080">

${sections}

</div>
<script type="application/json" id="speaker-notes">${notesJson}</script>
${runtime}
</body>
</html>
`
}
