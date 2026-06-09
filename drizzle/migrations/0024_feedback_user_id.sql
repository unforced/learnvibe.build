-- Migration 0024 — link feedback to user accounts
--
-- The feedback table predates account-required flows: it stored a free-text
-- name + email with no link to the users table. Now that everyone who's
-- been through a cohort has an account, signed-in feedback should link to
-- the user so admin can connect it to the person (and we can pre-fill the
-- form instead of asking people to re-type what we already know).
--
-- Nullable so signed-out feedback (event attendees, pilot folks without
-- accounts) still works. Existing rows stay NULL.

ALTER TABLE feedback ADD COLUMN user_id INTEGER REFERENCES users(id);
