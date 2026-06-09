-- Migration 0027 — lesson slide decks
--
-- Adds lessons.slides_json: the slide deck for the week's live session,
-- stored as deck-model JSON (vocabulary defined in src/lib/deck-schema.ts).
-- Decks are authored through the admin_upsert_deck MCP tool, validated on
-- write, and rendered server-side into a standalone presentation page at
-- /cohort/:slug/week/:num/slides (src/lib/deck-render.ts + public/deck.js).
-- Replaces the old one-off Claude Design HTML decks. NULL = no deck yet.

ALTER TABLE `lessons` ADD COLUMN `slides_json` text;
