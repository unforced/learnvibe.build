// Slide-deck JSON model + validator.
//
// Decks live in lessons.slides_json (one deck per lesson) and are rendered
// server-side into a standalone presentation page by src/lib/deck-render.ts.
// Authoring happens through the admin_upsert_deck MCP tool, which runs every
// write through validateDeck() — so error messages here are written for the
// Claude session doing the authoring, not for end users.
//
// Text handling contract (enforced at render time, documented here because
// authors see this file's vocabulary via the MCP tool description):
//   - Every text field is HTML-escaped. No raw HTML passthrough, ever —
//     decks are admin-authored but we keep defense in depth against XSS.
//   - [[accented text]] renders as an orange accent span.
//   - Newlines become <br> in heading/sub fields.

// ===== TYPES =====

interface SlideBase {
  /** Speaker notes — shown in the presenter overlay ('n' key), never on screen. */
  notes?: string
  /** Short screen label like "05 Signature Prompt" (data-screen-label). */
  label?: string
}

/** Opening slide — giant display heading; meta is the mono footer line. */
export interface TitleSlide extends SlideBase {
  layout: 'title'
  kicker: string
  heading: string
  sub: string
  meta: string
}

/** One big statement, vertically centered. dark/surface switch the background. */
export interface StatementSlide extends SlideBase {
  layout: 'statement'
  kicker: string
  heading: string
  lead?: string
  dark?: boolean
  surface?: boolean
}

/** Sequence of chips (e.g. the six C's) with one highlighted "now" chip. */
export interface ArcSlide extends SlideBase {
  layout: 'arc'
  kicker: string
  heading: string
  items: Array<{ num: string; name: string; now?: boolean }>
  note?: string
}

/** 2 or 3 cards in a grid — the grid adapts to the count. */
export interface CardsSlide extends SlideBase {
  layout: 'cards'
  kicker: string
  heading: string
  cards: Array<{ label: string; heading: string; body: string }>
}

/** Dark terminal-style prompt block. filename adds the surface background +
 *  filename header treatment (and a denser type size for longer prompts). */
export interface PromptSlide extends SlideBase {
  layout: 'prompt'
  kicker: string
  heading: string
  filename?: string
  barLabel?: string
  paragraphs: string[]
  footnote?: string
}

/** Numbered editorial rows — num + name (with optional mono sub) + description. */
export interface ListSlide extends SlideBase {
  layout: 'list'
  kicker: string
  heading: string
  items: Array<{ num?: string; name: string; sub?: string; desc: string }>
  footnote?: string
}

/** Exactly two column cards. kv renders mono key/value rows; pinned adds the
 *  orange left edge to call out the more important column. */
export interface TwoColSlide extends SlideBase {
  layout: 'twoCol'
  kicker: string
  heading: string
  cols: Array<{
    label: string
    heading: string
    body?: string
    kv?: Array<{ k: string; v: string }>
    pinned?: boolean
  }>
}

/** Closing slide — compact numbered recap + display-size mantras + signoff. */
export interface ClosingSlide extends SlideBase {
  layout: 'closing'
  kicker: string
  heading: string
  items?: Array<{ num: string; name: string; desc: string }>
  mantras?: string[]
  signoff?: string
}

export type Slide =
  | TitleSlide
  | StatementSlide
  | ArcSlide
  | CardsSlide
  | PromptSlide
  | ListSlide
  | TwoColSlide
  | ClosingSlide

export interface Deck {
  title: string
  slides: Slide[]
}

export type DeckValidation =
  | { ok: true; deck: Deck }
  | { ok: false; errors: string[] }

// ===== VALIDATION =====

export const DECK_LAYOUTS = [
  'title', 'statement', 'arc', 'cards', 'prompt', 'list', 'twoCol', 'closing',
] as const

const MAX_SLIDES = 40
const MAX_TEXT = 4000 // generous per-field cap; decks are slides, not essays

/** Check a single text field on an object: required (or optional) string
 *  within the length cap. Pushes author-readable errors and returns the
 *  running validity so callers can chain. */
function checkText(
  errors: string[], where: string, obj: any, field: string, required: boolean,
): void {
  const v = obj?.[field]
  if (v === undefined || v === null) {
    if (required) errors.push(`${where}: missing required field "${field}"`)
    return
  }
  if (typeof v !== 'string') {
    errors.push(`${where}: "${field}" must be a string (got ${typeof v})`)
    return
  }
  if (v.length > MAX_TEXT) {
    errors.push(`${where}: "${field}" is too long (${v.length} chars, max ${MAX_TEXT})`)
  }
}

function checkBool(errors: string[], where: string, obj: any, field: string): void {
  const v = obj?.[field]
  if (v !== undefined && typeof v !== 'boolean') {
    errors.push(`${where}: "${field}" must be a boolean (got ${typeof v})`)
  }
}

/** Validate items-style arrays: must be an array of plain objects within a
 *  count range. Returns the array when shaped right, null otherwise. */
function checkArray(
  errors: string[], where: string, obj: any, field: string,
  opts: { required: boolean; min: number; max: number },
): any[] | null {
  const v = obj?.[field]
  if (v === undefined || v === null) {
    if (opts.required) errors.push(`${where}: missing required field "${field}"`)
    return null
  }
  if (!Array.isArray(v)) {
    errors.push(`${where}: "${field}" must be an array (got ${typeof v})`)
    return null
  }
  if (v.length < opts.min || v.length > opts.max) {
    errors.push(`${where}: "${field}" must have ${opts.min}–${opts.max} entries (got ${v.length})`)
    return null
  }
  return v
}

function validateSlide(errors: string[], slide: any, index: number): void {
  const at = `slides[${index}]`
  if (typeof slide !== 'object' || slide === null || Array.isArray(slide)) {
    errors.push(`${at}: each slide must be an object`)
    return
  }
  const layout = slide.layout
  if (typeof layout !== 'string' || !DECK_LAYOUTS.includes(layout as any)) {
    errors.push(
      `${at}: unknown layout ${JSON.stringify(layout)} — must be one of: ${DECK_LAYOUTS.join(', ')}`,
    )
    return
  }
  const where = `${at} (${layout})`

  // Shared optional fields
  checkText(errors, where, slide, 'notes', false)
  checkText(errors, where, slide, 'label', false)

  // Every layout has a kicker + heading
  checkText(errors, where, slide, 'kicker', true)
  checkText(errors, where, slide, 'heading', true)

  switch (layout) {
    case 'title':
      checkText(errors, where, slide, 'sub', true)
      checkText(errors, where, slide, 'meta', true)
      break

    case 'statement':
      checkText(errors, where, slide, 'lead', false)
      checkBool(errors, where, slide, 'dark')
      checkBool(errors, where, slide, 'surface')
      if (slide.dark && slide.surface) {
        errors.push(`${where}: pick at most one of "dark" / "surface"`)
      }
      break

    case 'arc': {
      const items = checkArray(errors, where, slide, 'items', { required: true, min: 2, max: 8 })
      items?.forEach((item, i) => {
        checkText(errors, `${where} items[${i}]`, item, 'num', true)
        checkText(errors, `${where} items[${i}]`, item, 'name', true)
        checkBool(errors, `${where} items[${i}]`, item, 'now')
      })
      checkText(errors, where, slide, 'note', false)
      break
    }

    case 'cards': {
      const cards = checkArray(errors, where, slide, 'cards', { required: true, min: 2, max: 3 })
      cards?.forEach((card, i) => {
        checkText(errors, `${where} cards[${i}]`, card, 'label', true)
        checkText(errors, `${where} cards[${i}]`, card, 'heading', true)
        checkText(errors, `${where} cards[${i}]`, card, 'body', true)
      })
      break
    }

    case 'prompt': {
      checkText(errors, where, slide, 'filename', false)
      checkText(errors, where, slide, 'barLabel', false)
      const paras = checkArray(errors, where, slide, 'paragraphs', { required: true, min: 1, max: 8 })
      paras?.forEach((p, i) => {
        if (typeof p !== 'string') {
          errors.push(`${where}: paragraphs[${i}] must be a string (got ${typeof p})`)
        } else if (p.length > MAX_TEXT) {
          errors.push(`${where}: paragraphs[${i}] is too long (max ${MAX_TEXT})`)
        }
      })
      checkText(errors, where, slide, 'footnote', false)
      break
    }

    case 'list': {
      const items = checkArray(errors, where, slide, 'items', { required: true, min: 1, max: 8 })
      items?.forEach((item, i) => {
        checkText(errors, `${where} items[${i}]`, item, 'num', false)
        checkText(errors, `${where} items[${i}]`, item, 'name', true)
        checkText(errors, `${where} items[${i}]`, item, 'sub', false)
        checkText(errors, `${where} items[${i}]`, item, 'desc', true)
      })
      checkText(errors, where, slide, 'footnote', false)
      break
    }

    case 'twoCol': {
      const cols = checkArray(errors, where, slide, 'cols', { required: true, min: 2, max: 2 })
      cols?.forEach((col, i) => {
        const colWhere = `${where} cols[${i}]`
        checkText(errors, colWhere, col, 'label', true)
        checkText(errors, colWhere, col, 'heading', true)
        checkText(errors, colWhere, col, 'body', false)
        checkBool(errors, colWhere, col, 'pinned')
        const kv = checkArray(errors, colWhere, col, 'kv', { required: false, min: 1, max: 8 })
        kv?.forEach((row, j) => {
          checkText(errors, `${colWhere} kv[${j}]`, row, 'k', true)
          checkText(errors, `${colWhere} kv[${j}]`, row, 'v', true)
        })
      })
      break
    }

    case 'closing': {
      const items = checkArray(errors, where, slide, 'items', { required: false, min: 1, max: 8 })
      items?.forEach((item, i) => {
        checkText(errors, `${where} items[${i}]`, item, 'num', true)
        checkText(errors, `${where} items[${i}]`, item, 'name', true)
        checkText(errors, `${where} items[${i}]`, item, 'desc', true)
      })
      const mantras = checkArray(errors, where, slide, 'mantras', { required: false, min: 1, max: 5 })
      mantras?.forEach((m, i) => {
        if (typeof m !== 'string') {
          errors.push(`${where}: mantras[${i}] must be a string (got ${typeof m})`)
        }
      })
      checkText(errors, where, slide, 'signoff', false)
      break
    }
  }
}

/**
 * Validate an unknown value against the deck model. Returns the typed deck
 * on success, or every problem found (not just the first) on failure —
 * authors fix a whole deck in one round-trip that way.
 */
export function validateDeck(value: unknown): DeckValidation {
  const errors: string[] = []

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['deck must be an object: { title, slides }'] }
  }
  const deck = value as any

  checkText(errors, 'deck', deck, 'title', true)

  if (!Array.isArray(deck.slides)) {
    errors.push('deck: missing required field "slides" (array of slide objects)')
  } else if (deck.slides.length === 0) {
    errors.push('deck: "slides" must contain at least one slide')
  } else if (deck.slides.length > MAX_SLIDES) {
    errors.push(`deck: too many slides (${deck.slides.length}, max ${MAX_SLIDES})`)
  } else {
    deck.slides.forEach((slide: any, i: number) => validateSlide(errors, slide, i))
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, deck: deck as Deck }
}
