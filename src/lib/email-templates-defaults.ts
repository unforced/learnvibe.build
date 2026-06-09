// Default email templates — source of truth for both the seed migration
// (drizzle/migrations/0017_email_templates_and_log_body.sql) and the
// runtime fallback path in `renderEmailTemplate()`.
//
// When a DB row for a key is missing or `active=0`, the renderer falls back
// to the matching entry here. The 0017 migration also seeds these into the
// `email_templates` table on first apply, so DB-stored is the new default
// but behavior is unchanged at deploy time.
//
// Body sources are markdown with inline HTML — `marked` passes inline HTML
// through, so the existing CSS classes (`email-cta`, `email-highlight`,
// `email-divider`, `email-muted`) keep working. Variables are `{{name}}`
// style, substituted at send time before markdown render.
//
// The `variables` list is informational — the edit UI surfaces it as "this
// template uses: {{firstName}}, …" so admin knows what's safe to reference.

export interface EmailTemplateDefault {
  subject: string
  bodyMarkdown: string
  variables: string[]
}

export const DEFAULT_TEMPLATES: Record<string, EmailTemplateDefault> = {
  application_received: {
    subject: 'Application received — Learn Vibe Build',
    variables: ['firstName', 'cohortTitle'],
    bodyMarkdown: `<h2>Thanks for applying, {{firstName}}</h2>
<p>We've received your application for {{cohortTitle}}. We'll review it and get back to you soon — typically within a few days.</p>
<p>You can check your application status anytime from <a href="https://learnvibe.build/dashboard" style="color: #e8612a; text-decoration: none;">your dashboard</a>.</p>
<hr class="email-divider">
<p class="email-muted">Questions? Reply to this email or reach out at ag@unforced.dev.</p>`,
  },

  application_approved: {
    subject: "You're approved! — Learn Vibe Build {{cohortTitle}}",
    variables: ['firstName', 'tierLabel', 'amountFormatted', 'paymentUrl', 'cohortTitle'],
    bodyMarkdown: `<h2>You're in, {{firstName}}!</h2>
<p>Your application for {{cohortTitle}} has been approved. We're excited to have you.</p>
<div class="email-highlight">
  <p><strong>{{tierLabel}}</strong> — {{amountFormatted}}</p>
</div>
<p>Complete your payment to secure your spot:</p>
<a href="{{paymentUrl}}" class="email-cta">Pay {{amountFormatted}} & Enroll →</a>
<hr class="email-divider">
<p class="email-muted">If you haven't yet, also <a href="https://learnvibe.build/sign-up" style="color: #e8612a; text-decoration: none;">create your account</a> using <strong>this same email address</strong> — that way you can access the cohort site as soon as you're enrolled. We'll send more details as we get closer to the start. Questions? Just reply.</p>`,
  },

  application_approved_sponsored: {
    subject: "You're in! — Learn Vibe Build {{cohortTitle}}",
    variables: ['firstName', 'paymentUrl', 'cohortTitle'],
    bodyMarkdown: `<h2>Welcome, {{firstName}}!</h2>
<p>Great news — your application for {{cohortTitle}} has been approved, and your spot has been sponsored. No payment needed.</p>
<p>Complete your enrollment to get started:</p>
<a href="{{paymentUrl}}" class="email-cta">Complete Enrollment →</a>
<hr class="email-divider">
<p class="email-muted">We'll send you details as we get closer to the start. In the meantime, feel free to reply with any questions.</p>`,
  },

  application_rejected: {
    subject: 'Update on your application — Learn Vibe Build',
    variables: ['firstName', 'cohortTitle'],
    bodyMarkdown: `<h2>Hi {{firstName}},</h2>
<p>Thank you for applying to Learn Vibe Build {{cohortTitle}}. After careful consideration, we weren't able to offer you a spot in this cohort.</p>
<p>This isn't a reflection of your potential — our cohorts are small and we can only take a limited number of participants each round.</p>
<p>We'd love to see you apply again for a future cohort. We're always expanding what we offer, and there may be a better fit down the road.</p>
<hr class="email-divider">
<p class="email-muted">If you have any questions, feel free to reply to this email.</p>`,
  },

  application_price_changed: {
    subject: 'Your {{cohortTitle}} pricing has been updated — Learn Vibe Build',
    variables: ['firstName', 'tierLabel', 'oldAmountFormatted', 'newAmountFormatted', 'paymentUrl', 'cohortTitle'],
    bodyMarkdown: `<h2>Hi {{firstName}},</h2>
<p>We've updated the pricing on your {{cohortTitle}} enrollment.</p>
<div class="email-highlight">
  <p><strong>New price:</strong> {{tierLabel}} — {{newAmountFormatted}}<br>
  <span style="color: #6b7280; font-size: 0.9em;">(was {{oldAmountFormatted}})</span></p>
</div>
<p>If you haven't paid yet, the updated amount will apply when you do:</p>
<a href="{{paymentUrl}}" class="email-cta">Pay {{newAmountFormatted}} & Enroll →</a>
<hr class="email-divider">
<p class="email-muted">Questions or need a different arrangement? Just reply — cost should never be a barrier.</p>`,
  },

  application_price_changed_sponsored: {
    subject: 'Your {{cohortTitle}} spot is now sponsored — Learn Vibe Build',
    variables: ['firstName', 'paymentUrl', 'cohortTitle'],
    bodyMarkdown: `<h2>Good news, {{firstName}}!</h2>
<p>We've updated your enrollment — your spot in {{cohortTitle}} is now <strong>sponsored</strong>. No payment required.</p>
<p>Complete your enrollment to get started:</p>
<a href="{{paymentUrl}}" class="email-cta">Complete Enrollment →</a>
<hr class="email-divider">
<p class="email-muted">Questions? Reply to this email or reach out at ag@unforced.dev.</p>`,
  },

  enrollment_confirmed_no_account: {
    subject: 'Welcome to {{cohortTitle}} — Learn Vibe Build',
    variables: ['firstName', 'cohortTitle'],
    bodyMarkdown: `<h2>You're enrolled, {{firstName}}!</h2>
<p>You're officially part of {{cohortTitle}}. Welcome to the community.</p>
<div class="email-highlight">
  <p><strong>One last step:</strong> Create your account using <strong>this same email address</strong> so you can access the cohort site. Your enrollment will link automatically.</p>
</div>
<a href="https://learnvibe.build/sign-up" class="email-cta">Create Your Account →</a>
<hr class="email-divider">
<p class="email-muted">Already have an account? <a href="https://learnvibe.build/dashboard" style="color: #e8612a; text-decoration: none;">Go to your dashboard</a>.</p>`,
  },

  interest_received: {
    subject: 'On the list — Learn Vibe Build',
    variables: [],
    bodyMarkdown: `<h2>Thanks for joining the list —</h2>
<p>You're on the Learn Vibe Build interest list. We run cohorts a few times a year, and we'll be in touch as new dates and shapes come into focus. Applications are open intermittently &mdash; check <a href="https://learnvibe.build" style="color: #e8612a; text-decoration: none;">learnvibe.build</a> for what's current.</p>
<div class="email-highlight">
  <p style="margin: 0 0 0.5rem 0;"><strong>While you wait:</strong></p>
  <p style="margin: 0;">If you've got something you're trying to make with AI right now, reply to this email and tell us about it. We love hearing what people are working on, and the cohort design is shaped by what we learn from those conversations.</p>
</div>
<a href="https://learnvibe.build" class="email-cta">Visit the site</a>
<hr class="email-divider">
<p class="email-muted">You're on the list because you signed up at learnvibe.build. We'll keep these messages thoughtful and infrequent. Reply anytime — questions, ideas, pushback, all welcome.</p>`,
  },

  enrollment_confirmed_has_account: {
    subject: "You're enrolled in {{cohortTitle}} — Learn Vibe Build",
    variables: ['firstName', 'cohortTitle'],
    bodyMarkdown: `<h2>You're enrolled, {{firstName}}!</h2>
<p>You're officially part of {{cohortTitle}}. Welcome to the community.</p>
<div class="email-highlight">
  <p><strong>What's next:</strong> We'll send you session details as we get closer to the start date. You can access the cohort site anytime via your dashboard.</p>
</div>
<a href="https://learnvibe.build/dashboard" class="email-cta">Go to Your Dashboard →</a>
<hr class="email-divider">
<p class="email-muted">Questions? Just reply to this email.</p>`,
  },

  magic_link: {
    subject: 'Your Learn Vibe Build sign-in link',
    variables: ['magicLink'],
    bodyMarkdown: `<h2>Your sign-in link</h2>
<p>Welcome back to Learn Vibe Build. Tap the button below to sign in — no password required.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;"><tr><td align="center">
<a href="{{magicLink}}" style="display:inline-block; background:#e8612a; color:#ffffff !important; font-size:16px; font-weight:600; padding:14px 38px; border-radius:10px; text-decoration:none; box-shadow:0 2px 8px rgba(232,97,42,0.28);">Sign in to Learn Vibe Build &rarr;</a>
</td></tr></table>
<p class="email-muted" style="text-align:center;">This link expires in 20 minutes and works only once.</p>
<hr class="email-divider">
<p class="email-muted" style="margin-bottom:8px;">Button not working? Paste this link into your browser:</p>
<p style="background:#f6f5f2; border:1px solid #e5e2db; border-radius:8px; padding:12px 14px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; color:#555; word-break:break-all; margin:0;">{{magicLink}}</p>
<hr class="email-divider">
<p class="email-muted">Didn't request this? You can safely ignore this email — no one can sign in unless they open the link, and it expires shortly.</p>`,
  },

  email_change: {
    subject: 'Confirm your new Learn Vibe Build email',
    variables: ['confirmLink'],
    bodyMarkdown: `<h2>Confirm your new email</h2>
<p>Someone (hopefully you) asked to use this address for a Learn Vibe Build account. Confirm to make it your new sign-in email.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;"><tr><td align="center">
<a href="{{confirmLink}}" style="display:inline-block; background:#e8612a; color:#ffffff !important; font-size:16px; font-weight:600; padding:14px 38px; border-radius:10px; text-decoration:none; box-shadow:0 2px 8px rgba(232,97,42,0.28);">Confirm this email &rarr;</a>
</td></tr></table>
<p class="email-muted" style="text-align:center;">This link expires in 1 hour and works only once. You'll also need to be signed in to that account to finish.</p>
<hr class="email-divider">
<p class="email-muted" style="margin-bottom:8px;">Button not working? Paste this link into your browser:</p>
<p style="background:#f6f5f2; border:1px solid #e5e2db; border-radius:8px; padding:12px 14px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; color:#555; word-break:break-all; margin:0;">{{confirmLink}}</p>
<hr class="email-divider">
<p class="email-muted">Didn't request this? You can safely ignore this email — nothing changes unless you confirm while signed in.</p>`,
  },

  email_changed_notice: {
    subject: 'Your Learn Vibe Build sign-in email was changed',
    variables: ['newEmail'],
    bodyMarkdown: `<h2>Your sign-in email was changed</h2>
<p>The email for your Learn Vibe Build account was just changed to <strong>{{newEmail}}</strong>. You'll use that address to sign in from now on.</p>
<p>If you made this change, you're all set — no action needed.</p>
<hr class="email-divider">
<p class="email-muted">If this <strong>wasn't</strong> you, reply to this email right away and we'll help you secure your account.</p>`,
  },
}

/** Stable list of template keys, in display order for the admin templates page. */
export const TEMPLATE_KEYS: ReadonlyArray<keyof typeof DEFAULT_TEMPLATES> = [
  'application_received',
  'application_approved',
  'application_approved_sponsored',
  'application_rejected',
  'application_price_changed',
  'application_price_changed_sponsored',
  'enrollment_confirmed_no_account',
  'enrollment_confirmed_has_account',
  'interest_received',
  'magic_link',
  'email_change',
  'email_changed_notice',
]

/** Human-readable labels for each template key — used by admin UI. */
export const TEMPLATE_LABELS: Record<string, string> = {
  application_received: 'Application received',
  application_approved: 'Approved — paid tier',
  application_approved_sponsored: 'Approved — sponsored ($0)',
  application_rejected: 'Rejected',
  application_price_changed: 'Price changed — paid tier',
  application_price_changed_sponsored: 'Price changed — now sponsored',
  enrollment_confirmed_no_account: 'Enrollment confirmed — no account yet',
  enrollment_confirmed_has_account: 'Enrollment confirmed — account exists',
  interest_received: 'Interest list — confirmation',
  magic_link: 'Magic-link sign-in',
  email_change: 'Email change — confirm new address',
  email_changed_notice: 'Email change — notice to old address',
  // Logged template keys that don't have an editable template here — used
  // for label-only purposes on the email log table.
  broadcast: 'Broadcast',
  enrollment_confirmed: 'Enrollment (legacy)',
}
