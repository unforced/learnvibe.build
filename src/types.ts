import type { AuthUser } from './lib/auth'

export type Bindings = {
  DB: D1Database
  /** HMAC key for signing magic-link session cookies (wrangler secret). */
  SESSION_SECRET: string
  /** Cloudflare Email Service send binding (send_email in wrangler.toml). */
  EMAIL: SendEmail
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  EMAIL_FROM: string // e.g. "Learn Vibe Build <hello@learnvibe.build>"
  EMAIL_REPLY_TO?: string // optional override for the Reply-To header
}

export type Variables = {
  user: AuthUser | null
}

export type AppContext = {
  Bindings: Bindings
  Variables: Variables
}
