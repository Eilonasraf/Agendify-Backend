# Agendify — Backend

> AI-powered Twitter promotion engine. Finds opposing tweets, generates persuasive replies, and deploys them through a managed bot pool — all orchestrated by a multi-step AI pipeline.

**Live:** [agendifyx.up.railway.app](https://agendifyx.up.railway.app) &nbsp;|&nbsp; **Frontend repo:** [Agendify-Frontend](https://github.com/Eilonasraf/Agendify-Frontend)

---

## What it does

1. User submits a topic and a stance (in favor / opposed)
2. Gemini AI generates an optimized Twitter search query targeting the *opposite* viewpoint
3. The engine fetches high-engagement tweets via Twitter API v2
4. Gemini classifies each tweet by alignment (`+1` agrees, `-1` disagrees, `0` neutral)
5. Gemini writes a short, human-toned persuasive reply for every opposing tweet
6. Replies are scheduled 3 seconds apart and posted through a pool of Twitter bots via OAuth 1.0a
7. Engagement metrics (likes, retweets, replies, views) are tracked and updated twice daily

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + Express |
| Database | MongoDB + Mongoose |
| AI | Google Gemini (`gemini-1.5-flash`) |
| Job Queue | [Agenda](https://github.com/agenda/agenda) (MongoDB-backed) |
| Scheduling | node-cron |
| Twitter Auth | OAuth 2.0 PKCE (user login) + OAuth 1.0a (bot posting) |
| User Auth | JWT + bcrypt + Google OAuth |
| File Uploads | Multer |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Express API                       │
│                                                     │
│  /api/auth      /api/agendas     /api/twitter       │
└────────┬─────────────┬──────────────────┬───────────┘
         │             │                  │
         ▼             ▼                  ▼
    Auth (JWT)    Agenda CRUD       Promote Flow
    Google OAuth  MongoDB           │
                                    ▼
                             ┌──────────────┐
                             │  BotManager  │  ← round-robin bot pool
                             │  (fetch)     │     with rate-limit locking
                             └──────┬───────┘
                                    │ tweets
                                    ▼
                             ┌──────────────┐
                             │  Gemini AI   │  ← classify + generate replies
                             └──────┬───────┘
                                    │ replies
                                    ▼
                             ┌──────────────┐
                             │  Agenda Jobs │  ← staggered posting queue
                             │  (MongoDB)   │
                             └──────┬───────┘
                                    │
                                    ▼
                             ┌──────────────┐
                             │  BotManager  │  ← OAuth 1.0a reply bots
                             │  (reply)     │
                             └──────────────┘
```

---

## Key Design Decisions

**Bot pool with automatic rate-limit locking** — `BotManager` round-robins across multiple Twitter developer accounts. When any bot hits a rate limit or monthly cap, it is automatically locked until the reset timestamp returned by Twitter's headers. The next available bot takes over without any manual intervention.

**AI-generated search queries** — Instead of hard-coded keyword searches, Gemini dynamically generates an optimized Twitter API v2 query string based on the topic, subtopics, and the user's stance. This produces far more relevant results than static queries.

**Engagement-ranked fetching** — Tweets are sorted by `retweet_count + like_count` before returning to the client, so replies always target the highest-reach content first.

**Staggered job scheduling** — Replies are queued through Agenda (MongoDB-backed) and posted 3 seconds apart to avoid Twitter's burst limits and look natural.

---

## Project Structure

```
├── agenda/
│   ├── agendaInstance.js     # Agenda singleton
│   ├── loadJobs.js           # Job registration
│   └── jobs/
│       └── postReplyJob.js   # Tweet posting job
├── controllers/
│   ├── authController.js     # JWT + Google OAuth
│   ├── twitterController.js  # Core Twitter + Gemini logic
│   ├── promoteController.js  # Promote workflow orchestration
│   └── agendaController.js   # Agenda CRUD
├── models/
│   ├── Agenda.js             # Campaign model
│   ├── Bot.js                # Bot credentials + rate-limit state
│   ├── Tweet.js              # Reply record
│   └── userModel.js
├── routes/
│   ├── authRoute.js
│   ├── twitter.js
│   ├── agendas.js
│   └── uploadRoute.js
├── services/
│   ├── botManager.js         # Bot pool + retry logic
│   └── aiService.js          # Gemini wrapper
├── scripts/
│   └── update_views_DB.js    # Engagement metric updater
└── server.js                 # App bootstrap + OAuth2 PKCE flow
```

---

## API Reference

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register with username/password |
| POST | `/api/auth/login` | Login, returns JWT pair |
| POST | `/api/auth/refresh` | Refresh access token |
| POST | `/api/auth/logout` | Invalidate refresh token |
| POST | `/api/auth/google` | Google OAuth sign-in |

### Agendas (Campaigns)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/agendas?userId=` | List all campaigns for a user |
| POST | `/api/agendas` | Create a new campaign |
| GET | `/api/agendas/:id` | Get campaign detail with all tweets |
| DELETE | `/api/agendas/:id` | Delete a campaign |
| POST | `/api/agendas/:id/promote` | Run the full promote pipeline on a campaign |

### Twitter / Promote
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/twitter/promote` | Fetch + classify + generate replies |
| POST | `/api/twitter/postToX` | Schedule and post approved replies |
| GET | `/auth/twitter` | Start OAuth2 PKCE login flow |

---

## Getting Started

### Prerequisites
- Node.js 18+
- MongoDB instance (local or Atlas)
- Twitter Developer account(s)
- Google Gemini API key
- Google OAuth credentials (for user sign-in)

### Installation

```bash
git clone https://github.com/Eilonasraf/Agendify-Backend.git
cd Agendify-Backend
npm install
```

### Environment Variables

Create a `.env` file:

```env
PORT=3000
DATABASE_URL=mongodb://...
TOKEN_SECRET=your_jwt_secret
ACCESS_TOKEN_EXPIRATION=1h
REFRESH_TOKEN_EXPIRATION=7d
JWT_SECRET=your_jwt_secret
GEMINI_API_KEY=your_gemini_key

# Twitter credentials (for the default bot)
API_KEY=
API_KEY_SECRET=
BEARER_TOKEN=
ACCESS_TOKEN=
ACCESS_TOKEN_SECRET=
CLIENT_ID=
CLIENT_SECRET=
```

### Run

```bash
npm start
```

The server starts on `http://localhost:3000`. Agenda job processing and the cron-based engagement updater (runs at 13:30 and 20:00 Israel time) start automatically.

---

## Deployment

Deployed on [Railway](https://railway.app). Set all environment variables in the Railway dashboard and connect your GitHub repo for automatic deploys on push to `main`.
