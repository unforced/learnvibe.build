-- Migration 0025 — magic-link auth (Clerk replacement)
--
-- Adds the magic_tokens table that backs passwordless sign-in. We do NOT
-- touch the users table: clerk_id stays NOT NULL UNIQUE, but for magic-link
-- accounts we store a synthetic value (`magic_<random>`) so the unique
-- constraint is satisfied without a risky table rebuild. Auth keys on the
-- numeric users.id carried in the signed session cookie, not on clerk_id —
-- so clerk_id's value no longer matters for login, only its uniqueness.
--
-- Existing Clerk users keep their real clerk_id and continue to resolve;
-- on next sign-in they just get a fresh magic-link session (one-time).
--
-- Sessions themselves are stateless signed cookies (HMAC over {userId,iat}
-- with SESSION_SECRET) — no sessions table needed. Sign-out clears the
-- cookie.

CREATE TABLE `magic_tokens` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  -- SHA-256 hex of the raw token. Raw token only ever lives in the emailed
  -- link; we store the hash so a DB read can't mint a login.
  `token_hash` text NOT NULL,
  `email` text NOT NULL,
  -- Optional display name captured at request time (sign-up path).
  `name` text,
  -- Where to send the user after verifying (sanitized relative path).
  `redirect_to` text,
  -- Single-use guard. 0 = unused, 1 = consumed.
  `used` integer NOT NULL DEFAULT 0,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `magic_tokens_token_hash_unique` ON `magic_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `magic_tokens_email_idx` ON `magic_tokens` (`email`);
