// Email-change token management — confirm a new account email by ownership.
//
// Flow: signed-in user requests change → createEmailChangeToken (store hash +
// userId + newEmail) → confirmation link emailed to the NEW address → user
// clicks (while signed in as that account) → consumeEmailChangeToken verifies
// hash, expiry, single-use → caller re-checks uniqueness + updates users.email.
// Raw token lives only in the emailed link; the DB holds the SHA-256 hash.

import { and, eq } from 'drizzle-orm'
import type { getDb } from '../db'
import { emailChangeTokens } from '../db/schema'
import { generateOpaqueToken, sha256Hex } from './oauth'

type Db = ReturnType<typeof getDb>

// 1 hour — longer than the sign-in link, since changing your email often
// means hopping to a different inbox/device to grab the confirmation.
const TOKEN_TTL_SECONDS = 60 * 60

export interface EmailChangeData {
  userId: number
  newEmail: string
}

/**
 * Create an email-change token. Returns the RAW token (only place it exists in
 * cleartext) — caller emails it inside the confirmation link to the new address.
 */
export async function createEmailChangeToken(
  db: Db,
  args: { userId: number; newEmail: string },
): Promise<string> {
  const rawToken = generateOpaqueToken('lvb-emailchange', 32)
  const tokenHash = await sha256Hex(rawToken)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString()

  await db.insert(emailChangeTokens).values({
    tokenHash,
    userId: args.userId,
    newEmail: args.newEmail.trim().toLowerCase(),
    expiresAt,
    used: 0,
  })

  return rawToken
}

/**
 * Consume an email-change token. Verifies it exists, is unused, and unexpired,
 * atomically claims it (single-use), and returns the associated change — or
 * null if invalid/expired/already-used. The caller is responsible for checking
 * the active session matches the returned userId and that newEmail is still
 * free before applying the change.
 */
export async function consumeEmailChangeToken(db: Db, rawToken: string): Promise<EmailChangeData | null> {
  if (!rawToken || !rawToken.startsWith('lvb-emailchange_')) return null

  const tokenHash = await sha256Hex(rawToken)
  const row = await db.select().from(emailChangeTokens).where(eq(emailChangeTokens.tokenHash, tokenHash)).get()

  if (!row) return null
  if (row.used) return null
  if (new Date(row.expiresAt) < new Date()) return null

  // Atomic single-use claim (WHERE used = 0). Same pattern as magic-link —
  // a plain check-then-update keyed only on id would let a prefetch race win.
  const claimed = await db.update(emailChangeTokens)
    .set({ used: 1 })
    .where(and(eq(emailChangeTokens.id, row.id), eq(emailChangeTokens.used, 0)))
    .returning({ id: emailChangeTokens.id })
  if (claimed.length === 0) return null

  return { userId: row.userId, newEmail: row.newEmail }
}
