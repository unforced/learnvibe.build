-- Migration 0026 — email-change tokens
--
-- Backs the "change my account email" flow. A request stores the SHA-256 hash
-- of a random token + the requested new email; the raw token goes out only in
-- a confirmation link emailed to the NEW address. Confirming requires both the
-- link (proves control of the new inbox) AND an active session for the same
-- user (prevents a mistyped/hostile address from hijacking an account), then
-- updates users.email. Single-use, 1-hour TTL. See src/lib/email-change.ts.

CREATE TABLE `email_change_tokens` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  -- SHA-256 hex of the raw token. Raw token only lives in the emailed link.
  `token_hash` text NOT NULL,
  -- The account whose email will change (numeric users.id).
  `user_id` integer NOT NULL,
  -- The requested new email (normalized lowercase).
  `new_email` text NOT NULL,
  -- Single-use guard. 0 = unused, 1 = consumed.
  `used` integer NOT NULL DEFAULT 0,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_change_tokens_token_hash_unique` ON `email_change_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `email_change_tokens_user_idx` ON `email_change_tokens` (`user_id`);
