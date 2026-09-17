# GoodDayBus

GoodDayBus is a booking aggregator for intercity bus tickets from Ukraine to Europe. It is not a carrier - it collects and resells rides from a vetted carrier's schedule through that carrier's API.

## The problem

Passengers in this market traditionally book by phone, through a manager who checks a schedule and confirms a seat manually. GoodDayBus replaces that flow with a self-service site: search a route, compare rides, and book a seat without creating an account and without prepaying online. Payment is made to the driver at boarding (some fare types require prepayment - see Engineering decisions below).

## Tech stack

- **Runtime:** Node.js >=22
- **Server:** Express, with four runtime dependencies - `compression`, `cors`, `express`, `helmet`
- **Database:** `node:sqlite`, Node's built-in SQLite module - no ORM, no separate database server
- **Frontend:** vanilla JavaScript, no framework, no bundler. This is a deliberate choice: a large share of the target audience opens the site on older, low-end phones over slow mobile connections, and shipping less JavaScript keeps first load fast on that hardware.
- **Dev-only dependencies:** `terser` and `csso`, used solely by the build script to minify assets. They are not required to run the server.

## Architecture

```
Browser
  |
  |  static pages, /api/* JSON
  v
Express server (server.js)
  |                          \
  |  proxies searches and     \  writes orders/searches/visits
  |  bookings                  \
  v                             v
Contrabus API                SQLite (orders.db)
(carrier's booking system)
  |
  |  order/booking events
  v
Telegram bot -> manager's chat
```

The Express server does three jobs: it serves the static site, it proxies live schedule and booking requests to the Contrabus carrier API (the server holds the API credentials; the browser never talks to Contrabus directly), and it persists orders, searches, and visit counts to a local SQLite database. When a customer submits an order or a booking event happens, the server sends a Telegram message to the manager, including inline buttons for managing the request from the chat itself. Twelve SEO landing pages and the legal pages are not served dynamically - they are generated once at build time (see below) and shipped as static HTML.

## API surface

All endpoints are defined in `server.js`. Public, customer-facing:

| Endpoint | Purpose |
|---|---|
| `GET /api/cities` | City list for the search form (cached) |
| `POST /api/search` | Search rides for a route and date |
| `POST /api/suggest` | Search-box autocomplete/typo suggestions |
| `POST /api/discounts`, `POST /api/seats` | Discount and seat-map lookups for a ride |
| `POST /api/order` | Submit a booking request; may trigger an automatic Contrabus booking |
| `GET /api/booking/:token` | Booking status page data, by the token sent to the customer |
| `GET /api/booking/:token/ticket/:tid` | Ticket PDF for a confirmed booking |
| `POST /api/visit`, `POST /api/client-error` | Anonymous visit counter and client-side error reports |
| `GET /api/health` | Health check |

Admin-only (behind `requireAdmin`, gated by `ADMIN_KEY`): `GET /api/orders`, `GET /api/stats`, `GET /api/sales-report`, `GET /api/bookings`, `POST /api/bookings/:ticketId/cancel`, `GET /api/clients`, `GET /api/orders/export.csv`, `POST /api/analytics/reset`. These back the manager-facing `admin.html`/`stats.html` pages and are not meant to be reachable by ordinary visitors.

## Engineering decisions worth noting

**Static SEO pages generated from data.** `build-routes.js` reads `routes.json` (12 route entries) and the shared markup in `public/index.html`, and generates one static HTML page per route (e.g. `kyiv-krakiv.html`). This avoids maintaining 12 near-duplicate templates by hand while still giving each route its own indexable URL. The same script minifies `app.js`, `common.js`, and `styles.css` with `terser`/`csso` and fingerprints the output with a content hash, then calls `build-legal.js` to generate the legal pages from `legal/*.md`.

**Full functionality with localStorage blocked.** Some visitors arrive through in-app browsers or with strict privacy settings that throw on `window.localStorage` access rather than returning `undefined`. The frontend wraps storage access so that recent searches, city-list caching, and saved filters degrade to being simply unavailable for that session, instead of breaking the page.

**Bot protection with a soft fallback.** The booking form is protected by Cloudflare Turnstile, but only for requests that would trigger an automatic booking against the carrier - a plain inquiry to the manager does not require it. If Turnstile verification fails, is not configured, or the verification request errors out, the request is not rejected outright: it is simply downgraded from an automatic booking to a manual inquiry that a manager reviews.

**Two-minute search cache.** Identical route/date searches are cached in memory for 2 minutes. This absorbs latency from the upstream carrier API and reduces load during bursts of direct traffic, where many visitors search the same popular route around the same time.

**Telemetry for unknown vendor amenity codes.** The Contrabus API attaches a list of amenity codes to each ride (Wi-Fi, seat selection, pet policy, and so on), and the frontend maps each code to an icon and a Ukrainian label through a local dictionary, plus a small set of regex patterns for numbered variants like `16_noaccompany`/`18_noaccompany`. The carrier can introduce a new code at any time; when one matches neither the dictionary nor a pattern, the site does not render the raw, untranslated code to the visitor - it drops that chip and reports the unmapped code to `/api/client-error` (capped at 5 distinct codes per visit) so a translation can be added, instead of the gap going unnoticed until a customer asks about it.

**Per-IP rate limits plus a global circuit breaker.** Every public endpoint has its own per-IP rate limit (for example, 30 searches/minute, 5 order submissions per 10 minutes). On top of that, outbound requests to the Contrabus API share a single sliding-window ceiling: if the server sends more than a configured number of requests per minute (across all visitors combined), it stops sending further requests to Contrabus for 60 seconds and alerts the admin, instead of risking the shared agent account's API quota being exhausted by a bot attack.

**Re-verifying against fresh carrier data before booking.** The client only requests a booking; it does not get to dictate the outcome. Before an automatic booking is placed, the server re-searches the route against Contrabus and checks the requested ride against the freshest available data (price, carrier, seat availability, prepayment requirements) rather than trusting whatever the browser last displayed, since a search result can be seconds to minutes old by the time the customer submits the form.

**Bilingual interface - in progress.** An English-language version of the visitor-facing pages is being built (noindex, generated at build time from the same Ukrainian source of truth, so the production Ukrainian pages are never edited by hand for translation). See `docs/superpowers/specs/2026-09-17-english-locale-design.md` for the design. At the time of writing, only the Ukrainian interface (`lang="uk"`) is live.

## Repository layout

| Path | Role |
|---|---|
| `server.js` | Express app: routing, the Contrabus proxy, Telegram notifications, admin endpoints |
| `db.js` | SQLite access (`node:sqlite`): orders, searches, visits |
| `build-routes.js` | Generates the 12 SEO route pages from `routes.json`, minifies assets, then runs `build-legal.js` |
| `build-legal.js` | Generates the legal pages from `legal/*.md` |
| `public/` | The static site. `index.html` is the template the route pages are derived from; `app.js` is the client |
| `routes.json` | Data for the 12 generated route pages |
| `legal/*.md` | Source text for the legal pages (terms, privacy, refund, cookies) |
| `tests/smoke.test.js` | Smoke tests, run against an already-running dev server |

## Running locally

```bash
npm install
copy .env.example .env    # Windows; cp on macOS/Linux
# fill in API_LOGIN / API_PASSWORD so route search works, and a real ADMIN_KEY
npm start
```

`.env.example` documents every variable the server reads: carrier API credentials, the admin panel key, the optional Telegram bot token and chat id for notifications, an optional separate chat id for daily database backups, the public base URL used to build links back to the site, and flags that enable automatic booking and cap how many passengers a single automatic booking can cover. None of them are required for the process to start: `API_LOGIN`/`API_PASSWORD` default to empty strings and `ADMIN_KEY` defaults to `'change-me'`, and the server logs a warning for each and keeps running rather than refusing to boot. What actually breaks if you skip them: without `API_LOGIN`/`API_PASSWORD`, every search against the carrier API fails; without a real `ADMIN_KEY`, the admin panel is still gated by a key check, just with a publicly-known default key, which the server flags as a production security hole rather than blocking startup over.

The server listens on the port from the `PORT` environment variable, defaulting to 3000 locally; hosting platforms that inject their own `PORT` are supported without changes.

```bash
npm test
```

Tests in `tests/smoke.test.js` are smoke tests that run HTTP requests against an already-running server (`npm start` in another terminal first). They do not write anything to the live carrier API.

## Repository notes

Code comments and project documentation in this repository are written in Ukrainian and Russian - the author and the intended maintainers are Ukrainian speakers, and translating existing comments was judged not worth the risk of introducing mistakes into working code. This README is the English-language entry point for readers who do not read either language. The visitor-facing interface itself is currently Ukrainian only; an English locale is in progress (see above).
