// Magic-link token management — passwordless sign-in (Clerk replacement).
//
// Flow: request → createMagicToken (store hash, email raw link) → user clicks
// → consumeMagicToken (verify hash, expiry, single-use) → find-or-create user
// → setSession. Raw tokens live only in the emailed link; the DB holds the
// SHA-256 hash so a DB read can't mint a login.

import { and, eq } from 'drizzle-orm'
import type { getDb } from '../db'
import { magicTokens } from '../db/schema'
import { generateOpaqueToken, sha256Hex } from './oauth'

type Db = ReturnType<typeof getDb>

const TOKEN_TTL_SECONDS = 20 * 60 // 20 minutes

export interface MagicTokenData {
  email: string
  name: string | null
  redirectTo: string | null
}

/**
 * Create a magic-link token for an email. Returns the RAW token (only place
 * it ever exists in cleartext) — caller emails it inside the verify link.
 */
export async function createMagicToken(
  db: Db,
  args: { email: string; name?: string | null; redirectTo?: string | null },
): Promise<string> {
  const rawToken = generateOpaqueToken('lvb-magic', 32)
  const tokenHash = await sha256Hex(rawToken)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString()

  await db.insert(magicTokens).values({
    tokenHash,
    email: args.email.trim().toLowerCase(),
    name: args.name?.trim() || null,
    redirectTo: args.redirectTo || null,
    expiresAt,
    used: 0,
  })

  return rawToken
}

/**
 * Consume a magic-link token. Verifies it exists, is unused, and unexpired,
 * marks it used (single-use), and returns the associated data — or null if
 * invalid/expired/already-used.
 */
export async function consumeMagicToken(db: Db, rawToken: string): Promise<MagicTokenData | null> {
  if (!rawToken || !rawToken.startsWith('lvb-magic_')) return null

  const tokenHash = await sha256Hex(rawToken)
  const row = await db.select().from(magicTokens).where(eq(magicTokens.tokenHash, tokenHash)).get()

  if (!row) return null
  if (row.used) return null
  if (new Date(row.expiresAt) < new Date()) return null

  // Atomic single-use claim: the UPDATE itself is the gate. WHERE used = 0
  // means only ONE of two concurrent clicks (e.g. an email-scanner prefetch
  // racing the real click) can flip it — the loser updates zero rows and is
  // rejected. A plain check-then-update keyed only on id would let both win.
  const claimed = await db.update(magicTokens)
    .set({ used: 1 })
    .where(and(eq(magicTokens.id, row.id), eq(magicTokens.used, 0)))
    .returning({ id: magicTokens.id })
  if (claimed.length === 0) return null

  return {
    email: row.email,
    name: row.name,
    redirectTo: row.redirectTo,
  }
}
