# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Run the server:** `npm start` (executes `node app.js`)
- **No tests, lint, or build step exist.** `npm test` is a placeholder that errors out.
- The server boots Express on `PORT` (default 3000), connects to MongoDB, starts the Agenda job processor, and registers a node-cron schedule.

## High-level architecture

Agendify is an AI-driven X/Twitter promotion engine. The end-to-end flow has two HTTP endpoints split by stage so the user can review AI-generated replies before they post:

1. **`POST /api/twitter/promote`** (`controllers/promoteController.js`) — discover + classify + draft.
   `BotManager.fetchTweets` → `twitterController.fetchTweets` (calls `GET /2/tweets/search/recent`) → `classifyTweetsInJSON` → `generateResponseCommentsForNegativeTweetsBatch`. Returns reply suggestions; nothing is posted yet.
2. **`POST /api/twitter/postToX`** (`promoteController.postToXHandler`) — schedule the approved replies through Agenda, **3 seconds apart**, via `agendaInstance.schedule(when, "post-reply-to-tweet", …)`.
3. **`agenda/jobs/postReplyJob.js`** — Agenda worker that actually calls `twitterController.postReplyToTweet` (OAuth 1.0a `POST /2/tweets`).

### Bot pool (`services/botManager.js`)

Multiple Twitter developer apps are stored as `Bot` documents (one per X dev account). `BotManager` round-robins across them with **automatic lock-on-cap**:

- On `UsageCapExceeded` (Monthly) it sets `nextFetchReset`/`nextReplyReset` to `bot.monthlyReset` (seeded from a CSV).
- On `x-rate-limit-reset` headers (short-window cap) it sets the next-reset to that timestamp.
- On 401/403/503 it skips to the next bot.
- `loadBots()` filters bots whose lock has not expired and matches `role` (`all`/`fetch`/`reply`/`track`).

**Important quirk:** `agenda/jobs/postReplyJob.js` does **not** use `BotManager.postReplyToTweet`. It hard-codes `Bot.findOne({ plan: "basic" })` — replies always post through the single bot whose `plan === "basic"`. The round-robin reply path in BotManager exists but is unused by the production flow.

### Gemini AI (`services/aiService.js`)

Single entry point `generateGeminiDescription(prompt)` with a model fallback chain: `gemini-2.0-flash` → `gemini-2.5-flash` → `gemini-2.5-flash-lite`. Per model: 3 attempts with exponential backoff on 429/503; any other error breaks to the next model. Used for search-query generation, sentiment classification, reply drafting, and trending-topic titling — all in `controllers/twitterController.js`.

### Auth flows (two unrelated systems)

- **App users**: JWT + bcrypt + Google OAuth via `controllers/authController.js`.
- **X user OAuth 2.0 PKCE login**: implemented inline in `server.js` (`/auth/twitter` and `/api/auth/twitter/callback2`), stores access/refresh tokens via `controllers/tokenStore.js` (which persists the access token to `controllers/user_token.txt`).
- **Bot posting**: OAuth 1.0a, signed per-request in `twitterController.postReplyToTweet` using each bot's stored `apiKey/apiSecret/accessToken/accessTokenSecret`.

### Mixed module systems

`models/Bot.js` uses **ESM** (`import mongoose from 'mongoose'; export default …`) while every other file uses CommonJS. Consumers handle this with `const Bot = BotModule.default || BotModule;`. Don't "fix" Bot.js to CommonJS without updating all consumers.

## API tier constraint (critical)

The X API Free tier does **not** include `/2/tweets/search/recent` — the endpoint `twitterController.fetchTweets` calls. Discovery requires Basic tier ($200/month) or higher. On Free tier the request fails with `403 client-not-enrolled`. `POST /2/tweets` (replies) does work on Free.

## Scheduling

- `server.js` sets `process.env.TZ = 'Asia/Jerusalem'` and registers `cron.schedule('30 13,20 * * *', …)` to exec `./scripts/update_engagement_metrics.js`. Note: the actual script in `scripts/` is named `update_views_DB.js` — verify the filename before relying on the cron job.
- Agenda config (`agenda/agendaInstance.js`): `processEvery: "10 seconds"`, `maxConcurrency: 5`, jobs collection `agendaJobs` (separate from the `Agenda` Mongoose model — same word, unrelated).

## Repo hygiene notes

- The repo contains many macOS iCloud duplicate files with a ` 2` suffix (`README 2.md`, `agenda/loadJobs 2.js`, `services/botManager 2/`, etc.). These are not real source — ignore them and don't edit. The canonical files are the un-suffixed versions.
- `.env` is gitignored and **must not** be re-added. Earlier commits in history still contain leaked secrets; if you spot any tokens/keys in source files, flag them — they should be in env vars only.
- `package.json` declares an unused `crypto` dependency (Node has it built in) and both `bcrypt` and `bcryptjs` — `authController.js` is what determines which is actually used.
