import { getDb } from '../db'
import { emailLog } from '../db/schema'
import { emailWrapper } from './email-wrapper'
import { renderEmailTemplate, renderEmailTemplateFromSource, DEFAULT_TEMPLATES } from './email-templates'
import { renderMarkdown } from './markdown'

// Email now sends through the Cloudflare Email Service `send_email` binding
// (env.EMAIL) — no API keys. The `from` domain must be onboarded in the
// Cloudflare dashboard (Email → Email Sending) with DKIM/SPF/DMARC set up.
// `SendEmail` / `EmailAddress` are ambient globals from @cloudflare/workers-types.

/** Email is "configured" when the Worker has the EMAIL binding. */
export function isEmailConfigured(email: SendEmail | undefined): boolean {
  return !!email
}

/** Parse "Display Name <addr@domain>" into the EmailAddress shape the
 *  Cloudflare binding wants. Falls back to a bare address string. */
function parseFromAddress(from: string): EmailAddress | string {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (m && m[2]) {
    return { name: m[1].replace(/^["']|["']$/g, '').trim(), email: m[2].trim() }
  }
  return from.trim()
}

/** Best-effort HTML → plain text. Cloudflare (and good deliverability) wants
 *  a text/plain alternative alongside the HTML part. Not a full renderer —
 *  just enough to give a readable fallback from our wrapped HTML emails. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<a\b[^>]*href=(["'])([^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi, '$3 ($2)')
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n----------\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Re-export emailWrapper for backwards-compat — preview pages and other
// callers used to import it from here.
export { emailWrapper }

// ===== TEMPLATE PREVIEW HELPERS =====
// Used by /admin/email/preview to render preview cases. These wrap
// renderEmailTemplate but feed in placeholder vars so admin can see what
// the email looks like with sample data.
//
// We keep these as thin wrappers (subject/html only) so the preview page
// continues to work without DB access — they call into renderEmailTemplate
// with `db=undefined`, which routes straight to the hardcoded default.

export function applicationReceivedEmail(name: string): { subject: string; html: string } {
  const firstName = name.split(' ')[0]
  return previewTemplate('application_received', { firstName })
}

export function applicationApprovedEmail(
  name: string,
  paymentUrl: string,
  tierLabel: string,
  amountFormatted: string,
  isSponsored: boolean,
): { subject: string; html: string } {
  const firstName = name.split(' ')[0]
  if (isSponsored) {
    return previewTemplate('application_approved_sponsored', { firstName, paymentUrl })
  }
  return previewTemplate('application_approved', { firstName, paymentUrl, tierLabel, amountFormatted })
}

export function applicationPriceChangedEmail(
  name: string,
  oldAmountFormatted: string,
  newAmountFormatted: string,
  tierLabel: string,
  paymentUrl: string,
  isSponsored: boolean,
): { subject: string; html: string } {
  const firstName = name.split(' ')[0]
  if (isSponsored) {
    return previewTemplate('application_price_changed_sponsored', { firstName, paymentUrl })
  }
  return previewTemplate('application_price_changed', {
    firstName, oldAmountFormatted, newAmountFormatted, tierLabel, paymentUrl,
  })
}

export function applicationRejectedEmail(name: string): { subject: string; html: string } {
  const firstName = name.split(' ')[0]
  return previewTemplate('application_rejected', { firstName })
}

export function enrollmentConfirmedEmail(
  name: string,
  cohortTitle: string,
  alreadyHasAccount: boolean = false,
): { subject: string; html: string } {
  const firstName = name.split(' ')[0]
  return previewTemplate(
    alreadyHasAccount ? 'enrollment_confirmed_has_account' : 'enrollment_confirmed_no_account',
    { firstName, cohortTitle },
  )
}

// Synchronous helper for preview cases that don't have DB access at hand —
// renders directly from the hardcoded default. Equivalent to calling
// renderEmailTemplate(undefined, ...) but synchronous.
function previewTemplate(key: string, vars: Record<string, string>): { subject: string; html: string } {
  const tpl = DEFAULT_TEMPLATES[key]
  if (!tpl) throw new Error(`previewTemplate: unknown key "${key}"`)
  return renderEmailTemplateFromSource({ subject: tpl.subject, bodyMarkdown: tpl.bodyMarkdown }, vars)
}

// ===== BROADCAST EMAIL =====
// Broadcasts use a different flow — admin types the body markdown directly
// in the composer; there's no template key to look up. Keep the existing
// wrapper structure here.

export type BroadcastAudience = 'enrolled' | 'approved' | 'applicants' | 'generic'

function broadcastFooter(audience: BroadcastAudience): string {
  switch (audience) {
    case 'enrolled':
      return `You're receiving this because you're enrolled in a Learn Vibe Build cohort. <a href="https://learnvibe.build/dashboard" style="color: #e8612a; text-decoration: none;">View your dashboard</a>.`
    case 'approved':
      return `You're receiving this because your Learn Vibe Build application was approved. <a href="https://learnvibe.build/dashboard" style="color: #e8612a; text-decoration: none;">View your dashboard</a>.`
    case 'applicants':
      return `You're receiving this because you applied to Learn Vibe Build. <a href="https://learnvibe.build/dashboard" style="color: #e8612a; text-decoration: none;">View your dashboard</a>.`
    case 'generic':
    default:
      return `You're receiving this because you're part of the Learn Vibe Build community.`
  }
}

export function cohortBroadcastEmail(
  subject: string,
  markdownHtml: string,
  audience: BroadcastAudience = 'enrolled',
): { subject: string; html: string } {
  return {
    subject: `${subject} — Learn Vibe Build`,
    html: emailWrapper(`
      ${markdownHtml}
      <hr class="email-divider">
      <p class="email-muted">${broadcastFooter(audience)}</p>
      <p class="email-muted">To stop receiving these emails, just reply and let us know.</p>
    `),
  }
}

// ===== SEND FUNCTION =====

interface SendEmailParams {
  emailBinding: SendEmail
  from: string
  /** Single recipient. Array sends are deliberately unsupported — the
   *  Cloudflare binding would put every address in one visible To: header
   *  (recipients see each other) and a single bad address fails the whole
   *  send. Fan out one-per-recipient (see sendBroadcast) instead. */
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  /** Extra headers (whitelisted set only), e.g. List-Unsubscribe on bulk. */
  headers?: Record<string, string>
  db?: D1Database
  template?: string
}

async function logEmailSend(
  db: D1Database,
  to: string,
  subject: string,
  template: string,
  status: 'sent' | 'failed',
  error?: string,
  bodyHtml?: string,
) {
  try {
    const database = getDb(db)
    await database.insert(emailLog).values({
      to, subject, template, status,
      error: error || null,
      bodyHtml: bodyHtml || null,
    })
  } catch (e) {
    console.error('[Email] Failed to log email send:', e)
  }
}

export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; error?: string }> {
  const to = params.to

  if (!isEmailConfigured(params.emailBinding)) {
    console.error(`[Email] NOT SENT — no EMAIL binding: "${params.subject}" → ${to}`)
    // Record the skip so a misconfigured deploy is visible on /admin/emails
    // instead of vanishing into a console log. Still return success:true so
    // non-critical callers don't hard-fail; the auth path guards separately.
    if (params.db && params.template) {
      await logEmailSend(params.db, to, params.subject, params.template, 'failed', 'EMAIL binding not configured', params.html)
    }
    return { success: true }
  }

  // Cloudflare wants a text/plain alternative; derive one from the HTML if
  // the caller didn't supply it.
  const text = params.text ?? htmlToText(params.html)

  try {
    // The Cloudflare binding THROWS on failure (Error with .code/.message) —
    // unlike Resend, which returned an { error } object. So success is the
    // path that doesn't throw; the catch handles + logs every failure.
    const result = await params.emailBinding.send({
      from: parseFromAddress(params.from),
      to,
      subject: params.subject,
      html: params.html,
      text,
      replyTo: params.replyTo || 'ag@unforced.dev',
      ...(params.headers ? { headers: params.headers } : {}),
    })

    console.log(`[Email] Sent: "${params.subject}" → ${to} (id=${result.messageId})`)
    if (params.db && params.template) {
      await logEmailSend(params.db, to, params.subject, params.template, 'sent', undefined, params.html)
    }
    return { success: true }
  } catch (err: any) {
    // Persist body_html on failure too, so admin can resend without
    // re-rendering — useful for "the recipient was bad, resend to a
    // corrected address" workflows. err.code is one of the E_* codes.
    const detail = [err?.code, err?.message].filter(Boolean).join(' ').trim() || String(err)
    console.error('[Email] Send failed:', detail)
    if (params.db && params.template) {
      await logEmailSend(params.db, to, params.subject, params.template, 'failed', detail, params.html)
    }
    return { success: false, error: detail }
  }
}

// ===== CONVENIENCE WRAPPERS =====
// These tie templates + send together. Each one routes through
// renderEmailTemplate(env.DB, key, vars) so DB-stored templates take
// precedence with a hardcoded fallback when missing.

export type EmailEnv = { EMAIL: SendEmail; EMAIL_FROM: string; EMAIL_REPLY_TO?: string; DB?: D1Database }

async function sendByTemplate(
  env: EmailEnv,
  to: string,
  templateKey: string,
  vars: Record<string, string>,
) {
  const { subject, html } = await renderEmailTemplate(env.DB, templateKey, vars)
  return sendEmail({
    emailBinding: env.EMAIL,
    from: env.EMAIL_FROM,
    replyTo: env.EMAIL_REPLY_TO,
    to,
    subject,
    html,
    db: env.DB,
    template: templateKey,
  })
}

export async function sendMagicLink(env: EmailEnv, email: string, magicLink: string) {
  return sendByTemplate(env, email, 'magic_link', { magicLink })
}

/** Confirmation link sent to the NEW address when a user changes their email. */
export async function sendEmailChange(env: EmailEnv, newEmail: string, confirmLink: string) {
  return sendByTemplate(env, newEmail, 'email_change', { confirmLink })
}

/** Heads-up sent to the OLD address after an email change lands (security). */
export async function sendEmailChangedNotice(env: EmailEnv, oldEmail: string, newEmail: string) {
  return sendByTemplate(env, oldEmail, 'email_changed_notice', { newEmail })
}

export async function sendApplicationReceived(env: EmailEnv, email: string, name: string, cohortTitle: string = 'the next cohort') {
  return sendByTemplate(env, email, 'application_received', { firstName: name.split(' ')[0], cohortTitle })
}

export async function sendApplicationApproved(
  env: EmailEnv,
  email: string,
  name: string,
  paymentUrl: string,
  tierLabel: string,
  amountFormatted: string,
  isSponsored: boolean,
  cohortTitle: string = 'the next cohort',
) {
  const firstName = name.split(' ')[0]
  if (isSponsored) {
    return sendByTemplate(env, email, 'application_approved_sponsored', { firstName, paymentUrl, cohortTitle })
  }
  return sendByTemplate(env, email, 'application_approved', { firstName, paymentUrl, tierLabel, amountFormatted, cohortTitle })
}

export async function sendApplicationPriceChanged(
  env: EmailEnv,
  email: string,
  name: string,
  oldAmountFormatted: string,
  newAmountFormatted: string,
  tierLabel: string,
  paymentUrl: string,
  isSponsored: boolean,
  cohortTitle: string = 'the cohort',
) {
  const firstName = name.split(' ')[0]
  if (isSponsored) {
    return sendByTemplate(env, email, 'application_price_changed_sponsored', { firstName, paymentUrl, cohortTitle })
  }
  return sendByTemplate(env, email, 'application_price_changed', {
    firstName, oldAmountFormatted, newAmountFormatted, tierLabel, paymentUrl, cohortTitle,
  })
}

export async function sendApplicationRejected(env: EmailEnv, email: string, name: string, cohortTitle: string = 'the cohort') {
  return sendByTemplate(env, email, 'application_rejected', { firstName: name.split(' ')[0], cohortTitle })
}

export async function sendEnrollmentConfirmed(
  env: EmailEnv,
  email: string,
  name: string,
  cohortTitle: string,
  alreadyHasAccount: boolean = false,
) {
  const firstName = name.split(' ')[0]
  const key = alreadyHasAccount ? 'enrollment_confirmed_has_account' : 'enrollment_confirmed_no_account'
  return sendByTemplate(env, email, key, { firstName, cohortTitle })
}

export interface BroadcastResult {
  sent: string[]
  failed: { email: string; error: string }[]
  total: number
}

export async function sendBroadcast(
  env: EmailEnv,
  emails: string[],
  subject: string,
  markdownHtml: string,
  audience: BroadcastAudience = 'enrolled',
): Promise<BroadcastResult> {
  // Throttle so a large broadcast doesn't trip Cloudflare's send rate
  // limit (E_RATE_LIMIT_EXCEEDED). Send in chunks of 4 with a 1.1s delay
  // between chunks so a 50-recipient broadcast takes ~13s instead of failing.
  const CHUNK_SIZE = 4
  const CHUNK_DELAY_MS = 1100

  // List-Unsubscribe (mailto form) on bulk mail — Gmail/Yahoo bulk-sender
  // guidance and a meaningful deliverability signal as the new domain warms
  // up. Pairs with the visible "reply to unsubscribe" line in the footer.
  // (One-click HTTPS unsubscribe is a future enhancement; mailto is fine at
  // our volume, well under the 5k/day One-Click threshold.)
  const unsubAddr = env.EMAIL_REPLY_TO || 'ag@unforced.dev'
  const broadcastHeaders = { 'List-Unsubscribe': `<mailto:${unsubAddr}?subject=Unsubscribe>` }

  const sent: string[] = []
  const failed: { email: string; error: string }[] = []

  for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
    const chunk = emails.slice(i, i + CHUNK_SIZE)
    const settled = await Promise.allSettled(
      chunk.map(email => {
        const tpl = cohortBroadcastEmail(subject, markdownHtml, audience)
        return sendEmail({
          emailBinding: env.EMAIL,
          from: env.EMAIL_FROM,
          replyTo: env.EMAIL_REPLY_TO,
          to: email,
          ...tpl,
          headers: broadcastHeaders,
          db: env.DB,
          template: 'broadcast',
        })
      })
    )
    settled.forEach((res, j) => {
      const email = chunk[j]
      if (res.status === 'fulfilled' && res.value.success) {
        sent.push(email)
      } else {
        const error = res.status === 'fulfilled'
          ? (res.value.error || 'Unknown error')
          : (res.reason instanceof Error ? res.reason.message : String(res.reason))
        failed.push({ email, error })
      }
    })
    // Wait between chunks so we don't bunch up against the rate limit.
    // Skip the wait after the final chunk.
    if (i + CHUNK_SIZE < emails.length) {
      await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS))
    }
  }

  return { sent, failed, total: emails.length }
}

// renderMarkdown is re-exported so admin route handlers that compose plain
// markdown into the broadcast wrapper (without a template lookup) keep
// working through the same import path.
export { renderMarkdown }
