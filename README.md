# CST

A clean [Next.js](https://nextjs.org) (App Router) starter wired up with
Tailwind CSS, MongoDB Atlas via Mongoose, and PWA support.

## Stack

| Concern    | Choice                                             |
| ---------- | -------------------------------------------------- |
| Framework  | Next.js 16 (App Router)                            |
| Styling    | Tailwind CSS v4 (`@tailwindcss/postcss`)           |
| Database   | MongoDB Atlas                                      |
| ODM        | Mongoose 9                                         |
| Auth       | JWT (`jose`) in an httpOnly cookie, `bcryptjs` hashing |
| Validation | `zod`                                              |
| PWA        | `@serwist/next` (Workbox successor) + native manifest |

## Getting started

```bash
npm install
cp .env.example .env.local   # then set MONGODB_URI, JWT_SECRET, SUPER_ADMIN_*, SECRET_ENCRYPTION_KEY
npm run seed:super-admin     # create the first super admin
npm run dev                  # http://localhost:3000
```

## Scripts

| Command                    | Description                                          |
| -------------------------- | --------------------------------------------------- |
| `npm run dev`              | Dev server. The service worker is disabled here.    |
| `npm run build`            | Production build (`--webpack`, required by Serwist).|
| `npm start`                | Serve the production build.                         |
| `npm run lint`             | ESLint.                                             |
| `npm run seed:super-admin` | Create / verify the initial super admin (idempotent). |
| `node scripts/generate-icons.mjs` | Regenerate `public/icons/*`.                 |

## Project structure

```
proxy.js                Edge/route proxy (Next 16 "middleware") — route guards & redirects
app/
  _components/          LoginForm / RegisterForm / LogoutButton / AuthShell /
                         SidebarNav / AddEmployeeForm / ShippingCompaniesManager (all .jsx)
  _components/orders/   CreateOrder / ShippingCompanySelector / OzonOrderForm /
                         QuickLivraisonOrderForm / OrderBaseFields / CitySelect / shared.jsx
  api/
    auth/login|logout|me|register/route.js
    employees/route.js            GET (list own) / POST (create) — merchant only
    shipping-companies/route.js   GET (list own) / POST (upsert) — merchant only
    health/route.js               DB connectivity check
  login/page.jsx         Single login form (all roles)
  register/page.jsx      Merchant-only registration
  dashboard/
    layout.jsx            Auth gate + sidebar chrome for the whole /dashboard/* subtree
    page.jsx              Protected — shows name / email or username / role
    employees/
      page.jsx              Employees list (merchant only)
      new/page.jsx          Add Employee form (merchant only)
    shipping-companies/
      page.jsx              Ozon Express / Quick Livraison configuration (merchant only)
    orders/
      page.jsx              Orders list (UI only) — merchant + employee
      new/page.jsx          Create Order: pick a provider, then its form — merchant + employee
  layout.js              Root layout + PWA / metadata / viewport
  manifest.js            Web App Manifest -> /manifest.webmanifest
  sw.js                  Serwist service worker source
lib/
  mongodb.js             Cached Mongoose connection helper
  employees.js           toEmployeeSummary() / listEmployeesForMerchant() / formatCommission()
  shipping-companies.js  toShippingCompanySummary() / listShippingCompanies()
  crypto/secret-box.js   AES-256-GCM encrypt/decrypt — shared by both features above
  auth/
    constants.js           Cookie name + lifetimes (edge-safe, no Node imports)
    jwt.js                 sign / verify session JWT (jose)
    session.js             httpOnly cookie read / set / clear
    current-user.js       getCurrentUser() — authoritative user from the DB
    roles.js               human-readable role labels
  validation/
    auth.js                zod request schemas for auth + employees
    shipping-companies.js  zod request schema for shipping-company config
models/
  User.js                super_admin | merchant | employee
  ShippingCompany.js     ozon_express | quick_livraison — one config each, per merchant
scripts/
  seed-super-admin.mjs   Idempotent super admin seed
  generate-icons.mjs     PWA icon generator (uses sharp)
```

## Authentication

Roles: `super_admin`, `merchant`, `employee`.

| Action              | super_admin | merchant     | employee |
| ------------------- | ----------- | ------------ | -------- |
| Public registration | ✗ (seed only) | ✓           | ✗ (created by their merchant) |
| Login identifier    | email       | email        | username |
| Login               | ✓           | ✓            | ✓        |
| Create employees    | ✗           | ✓ (own only) | ✗       |
| Configure shipping companies | ✗  | ✓ (own only) | ✗       |
| Create/view orders (Ozon Express, Quick Livraison) | ✗ | ✓ | ✓ |

- **One login form for everyone** (`/login`), one field labeled "Email or
  username". Merchants/super admins type their email; employees type their
  username — `User.findByIdentifier()` matches either. The role is always
  read from the stored `User` record after the password check, never sent by
  the client.
- **Registration (`/register`) is merchants only.** The route handler hard-codes
  `role: "merchant"`; `role` / `merchantId` are not in the accepted schema, so a
  client cannot register as `super_admin` or `employee`. On success the merchant
  is signed straight in.
- **Employees** are created by an authenticated merchant from the Merchant
  Dashboard (`/dashboard/employees/new` → `POST /api/employees`). `role` is
  forced to `"employee"` and `merchantId` to the caller's own id — the client
  cannot choose either, and cannot create a super admin.
- **Session** = a JWT signed with `JWT_SECRET` (HS256, 7-day expiry), stored in a
  `httpOnly`, `sameSite=lax`, `secure`-in-production cookie named `session`.
- **`getCurrentUser()`** verifies the cookie, then loads the user from MongoDB and
  returns a sanitized object (no password hash). Inactive accounts resolve to
  `null`, which kills the session. This is the authoritative check used by pages
  and API routes; `proxy.js` only does the fast token check + redirects.
- **Redirects**: anon → `/dashboard*` sends you to `/login?next=…`; an authenticated
  user hitting `/login` or `/register` is bounced to `/dashboard`; a role visiting a
  section it isn't authorized for (employees/super admins on
  `/dashboard/employees*` or `/dashboard/shipping-companies*`) is bounced to
  `/dashboard`; logout clears the cookie and returns you to `/login`.
- **`/` is never a real page** — it only ever redirects (`/dashboard` if
  authenticated, `/login` otherwise; every role shares the same
  `/dashboard`, which is already role-aware internally, so there's no
  separate merchant/employee/super-admin route to pick between). Handled at
  both layers, same "defense in depth" split as everything else: `proxy.js`
  redirects it at the edge (fast, token-only), and `app/page.jsx` is a
  server component doing the identical `getCurrentUser()`-based redirect as
  a fallback should the proxy ever stop covering it. Neither the old
  Next.js starter content nor any other implementation detail is reachable
  from `/`.

### Seeding the super admin

Set `SUPER_ADMIN_NAME`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (and
`MONGODB_URI`) in `.env.local`, then:

```bash
npm run seed:super-admin
# -> node --env-file=.env.local scripts/seed-super-admin.mjs
```

The password is hashed by the `User` model's `pre('save')` hook. Re-running the
seed with an email that already belongs to a super admin is a no-op, so it is
safe in CI / deploy pipelines.

### Opening the dev server from a phone / another device on the LAN

Next.js 16 blocks cross-origin requests to dev-only resources (the HMR
websocket, `/_next/*` chunks, …) by default — see
[`allowedDevOrigins`](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).
Without this, opening `next dev` from any device other than the machine
running it (e.g. a phone on the same Wi-Fi hitting this machine's LAN IP —
the realistic way to test "mobile" locally) gets its HMR handshake
rejected; the dev client then never finishes bootstrapping, so React never
hydrates and the page renders but is otherwise dead: no click handlers, no
auth, nothing interactive. `next.config.mjs` fixes this by computing
`allowedDevOrigins` from this machine's own network interfaces
(`os.networkInterfaces()`) at startup — never a hardcoded IP, so it keeps
working on whatever Wi-Fi/LAN the machine is on. This only affects `next
dev`; production (`next build`/`next start`) ignores the option entirely.

## Merchant employee management

`/dashboard` shows a sidebar; merchants get an **Employees** item, which
neither employees nor super admins see (and cannot reach directly — the page
itself checks the role server-side and redirects to `/dashboard`).

- **`/dashboard/employees`** — the merchant's own employees only
  (`User.find({ merchantId: currentUser.id, role: "employee" })`), name /
  username / phone / status / commission / creation date, with an empty
  state and an **Add Employee** link.
- **`/dashboard/employees/new`** — a form with three clearly separated
  sections: *Employee information* (name, username, phone, password,
  confirm password), *Commission* (threshold, commission below, commission
  at/above), *Quick Livraison* (optional, per-employee API key).
- **`GET /api/employees`** — same merchant-scoped list, for any future
  client-side use.
- **`POST /api/employees`** — creates the employee; `role` and `merchantId`
  are always set server-side, never accepted from the request body.
  Username uniqueness is **global** (one `unique+sparse` index on
  `User.username`, not scoped per merchant) — intentional, since employees
  log in via the same shared identifier lookup as merchants/super admins
  (`User.findByIdentifier`). A duplicate-key error from `User.create()` is
  only ever reported as "username already taken" after checking which field
  actually conflicted (`err.keyPattern`) — never assumed, since any other
  unique index on the collection (e.g. `email`) could in principle throw the
  same generic Mongo error code for an unrelated reason.
- **`GET`/`PATCH /api/employees/:id`** — one employee, always scoped to
  `{_id, merchantId: currentUser.id, role: "employee"}` together, so an id
  belonging to another merchant's employee 404s exactly like one that
  doesn't exist (never leaks which case it is). `PATCH` loads the document
  and calls `.save()` (not `findOneAndUpdate`) so the model's own
  `pre('save')` hooks — password re-hash, Quick key encryption — fire
  exactly as they do at creation; every field is optional, so a merchant
  edits only what they submit. Also accepts `ozonTrackingCounter` (≥ 1000,
  the field's own established floor) as a direct administrative override of
  `User.ozonTrackingCounter` — the same one and only live counter
  `lib/ozon/reserve-tracking-number.js` already uses, not a second system.
  `/dashboard/employees/[id]/edit` is the form (`EditEmployeeForm.jsx`),
  linked from each employee's card.
- **"Switch to employee" (impersonation)** — `POST /api/auth/impersonate`
  (merchant-only, employee id validated as `{merchantId, role: "employee",
  isActive: true}` before anything else) signs a brand-new, fully real
  employee session token carrying an extra `impersonatorId` claim (the
  merchant's own id — see `lib/auth/jwt.js`) and overwrites the session
  cookie with it; this is a genuine session swap, never a client-side role
  flag. `POST /api/auth/stop-impersonating` reads `impersonatorId` from the
  *current, cryptographically verified* session only (never anything the
  client sends) and re-signs a clean merchant token. `getCurrentUser()`
  surfaces `impersonatorId` on the returned user so `SidebarNav` can show the
  amber "Viewing as … — Return to merchant" banner
  (`ImpersonationBanner.jsx`).

### Commission

Stored as a small, explicit sub-document rather than a free-form object:

```json
{ "threshold": 60, "commissionBelowThreshold": 10, "commissionAtOrAboveThreshold": 15 }
```

All three values are whole numbers (DH) — validated with `Number.isInteger`
both in the Mongoose schema and the `zod` request schema, so there is no
floating-point drift. Every employee has their own values; nothing is
hardcoded.

## Shipping companies (per-merchant configuration)

`/dashboard/shipping-companies` — **merchant only**, same ownership model as
employees — lets a merchant configure the credentials used later by the
order/shipping system to send *their* orders to each provider. Two cards,
Ozon Express and Quick Livraison, each expands into its own form; clicking
**Configure**/**Edit** never pre-fills the API key.

- **`GET /api/shipping-companies`** — the authenticated merchant's own
  configured providers (0, 1 or 2), with a masked API key hint, never the
  real key. Always filtered by `merchantId: currentUser.id`.
- **`POST /api/shipping-companies`** — create-or-update, keyed by
  `(merchantId, provider)`. Sending an already-configured provider updates
  that one document instead of creating a duplicate (`{merchantId, provider}`
  has a unique compound index as a DB-level backstop, on top of the
  find-then-save logic in the route). `merchantId` is always the
  authenticated merchant — never accepted from the client. Body:
  - Ozon Express: `{ provider: "ozon_express", ozonId, apiKey }`
  - Quick Livraison: `{ provider: "quick_livraison", apiKey }`
  - `apiKey` is required the first time a provider is configured, optional on
    every update after that — omitting it keeps the currently-stored key, so
    the client is never asked to resend a secret it was never given back.

### Architecture decision — who may configure shipping companies

Each merchant configures their own shipping-provider credentials — the same
ownership model as their employees. `ShippingCompany.merchantId` is required,
always set server-side from the session, and every query/write is scoped to
it, so one merchant can never see or change another merchant's configuration
(verified end-to-end with two independent merchants — see Verification
below). Employees are explicitly excluded (they act on behalf of a merchant,
not as one); super admins are excluded too, since this is business
configuration belonging to a specific merchant's account, not a
platform-wide setting.

### How API keys are protected

- Encrypted at rest (AES-256-GCM, `lib/crypto/secret-box.js` — the same
  helper used for an employee's Quick Livraison key) via a `pre('save')`
  hook; the plaintext is only ever held in memory for the encrypt call.
- `apiKey` has `select: false` — a normal query never returns it, encrypted
  or not.
- Only the last 4 characters (`apiKeyLast4`, stored unencrypted — not
  sensitive on its own) are used to build a masked hint like
  `••••••••1234`; the real key is never sent to the browser, not even when
  editing an existing configuration.
- `ozonId` is not treated as a secret (it grants no access without the API
  key) and is returned/edited as plain text, matching the task's mockup.

## Orders (Ozon Express + Quick Livraison)

`/dashboard/orders` (list) and `/dashboard/orders/new` (create) are
available to **merchant and employee** (not super admin). Both shipping
providers are now fully integrated server-side — the browser never talks to
`api.ozonexpress.ma` or `clients.quicklivraison.ma` directly, and never sees
either provider's API key.

### Browsing (`/dashboard/orders`): provider tabs + merchant filters

`ProviderTabs.jsx` shows exactly one provider's orders at a time — never
both stacked — and is built so a third provider is just one more entry in
its list, nothing else provider-specific. A merchant additionally gets
`OrderFilters.jsx` (an employee picker + `MonthSelect`), driving three
different data sources depending on the choice, all reusing existing,
proven pieces rather than a new one per case:

- **"My own orders"** or **one specific employee** — the existing LIVE
  per-provider fetch (`OzonOrdersList`/`QuickOrdersList`, unchanged),
  now optionally pointed at a different actor: `GET /api/orders/{ozon,quick}`
  accept `?employeeId=`, validated as `{merchantId, role: "employee"}` before
  anything else (`lib/employees.js#findOwnedEmployee`, the one ownership
  check every "merchant acts on one of their employees" endpoint shares),
  and use that employee's own tracking prefix/counter instead of the
  caller's. Same freshness/correctness guarantees as before — zero
  duplicated fetch logic.
- **"All employees"** — live-fetching every employee's sequence one by one
  would be slow, so this reads the local `Order` mirror instead:
  `GET /api/orders` (new), merchant-only, server-paginated and filtered
  (`provider` required, `employeeId`/`period` optional, same anchored
  `numericTrackingNumber` regex convention `lib/commission/report.js`
  already uses for "which month"). Rendered as cards (`OrdersBrowser.jsx`),
  matching the existing Ozon/Quick card style rather than introducing a
  table. Same "aggregate views read the DB, never the provider live" rule
  already applied to the dashboard stats and Commission.

An employee's own Orders page is unchanged in substance — provider tabs, no
employee/month filter (they have nothing to filter by), their own live view.

### Status filter — Tous / Livré / Progress / Retour

`StatusFilter.jsx`, next to the provider tabs, everyone (not just
merchants). Combines with whichever employee/month/provider filter is also
active. One classification, `lib/orders/status-groups.js`, reused
everywhere a status needs bucketing (this filter, the Dashboard's Livré/
Retour cards):

- **Livré** — `isDeliveredDisplayStatus(provider, status)` (provider-aware —
  Ozon's "Livré" vs. Quick's "DELIVERED", see `lib/commission/status.js`).
- **Retour** — `annulé`/`refusé`/`retourné` (+ English equivalents),
  normalized (case/accent-insensitive) so "ANNULE"/"annulé"/"Annulé" all
  match — `isReturnStatus()`.
- **Progress** — neither of the above.

Filtered **server-side**, not by hiding already-downloaded rows:
`GET /api/orders/{ozon,quick}` accept `?status=` and skip non-matching
orders before they're ever sent to the browser (Ozon: before `writeLine` in
the stream; Quick: filtering the final array, since status there is only
known after each order's own live status check). `GET /api/orders`
(the DB-backed "all employees" browser) turns it into a Mongo query —
`Livré` reuses `deliveredAt` (the same authoritative field the Dashboard/
Commission already treat as "was this ever delivered", never re-derived
from status text there), `Retour`/`Progress` match `lastKnownStatus`
against the exact same canonical token list via a case/accent-insensitive
**collation** (`{locale:"en", strength:1}`) — MongoDB's own Unicode-aware
equivalent of the JS normalization in `status-groups.js`, so there is
exactly one definition of "what counts as a return", not a second one
reimplemented in query syntax.

### Follow-up — a merchant's own manual reminder list

Not shipping tracking — Ozon/Quick tracking numbers and their status sync
are untouched. This is "the merchant wants to remember to call this
customer back", independent of the order's actual delivery status, and is
entirely **merchant-only** (the whole feature is merchant-framed end to
end — employees get no UI for it and every route 403s them).

- **Model**: `models/OrderFollowUp.js` — `{merchantId, orderId, employeeId,
  provider, note, createdAt, updatedAt}`. Deliberately does NOT snapshot
  descriptive order fields (receiver, phone, price, ...): orders in this
  app are immutable and never deleted, so every read simply populates the
  referenced `Order` live — one source of truth, not two that could drift.
  A unique `{merchantId, orderId}` index is the duplicate-prevention rule;
  `POST /api/order-followups` catches the resulting E11000 on a losing
  concurrent request and returns the winning request's record instead of
  erroring.
- **Identified by `{provider, trackingNumber}`**, not a raw database id —
  the same pair `Order`'s own unique index already treats as canonical
  identity, so "add to follow-up" works uniformly from a card on any of the
  three Orders-page listing surfaces (the live Ozon/Quick streams don't
  necessarily carry this app's internal `Order._id` per item; every card
  always knows its own tracking number). The server resolves and verifies
  ownership (`{merchantId: currentUser.id, provider, trackingNumber}`)
  before touching anything — an id/tracking number that isn't a real, owned
  order 404s exactly like one that doesn't exist (IDOR-safe).
- **`AddToFollowUpButton.jsx`** on every order card (all three listing
  surfaces) — "Add to Follow-up", or "Added to Follow-up" (disabled-style)
  once added, driven by one `GET /api/order-followups` fetched once at the
  Orders-page level (`OrdersPageClient.jsx`), not per card.
- **`NoteModal.jsx`** — the app's first modal (a `fixed inset-0` backdrop +
  centered/bottom-sheet panel, Escape/backdrop-click to close), reused
  as-is for both "add" and "edit note" rather than two dialogs.
- **`/dashboard/track`** (`FollowUpList.jsx`) — every follow-up item as a
  mobile-first card (never a table): receiver, phone, live-populated
  status/provider/price, the note, and three actions — **"Open Order"**
  links back to `/dashboard/orders` with `?provider=&employee=&phone=`
  pre-filled (reusing the Orders page's own existing filters/phone-search
  rather than a second order-details view), **"Edit Follow-up"** opens the
  same `NoteModal`, **"Remove from Follow-up"** (`DELETE /api/order-followups/[id]`)
  removes only the `OrderFollowUp` record — never the `Order`, its status,
  tracking data, or commission numbers.

```
Browser  →  our Next.js API  →  provider API
```

Creating an order is a two-step flow (`CreateOrder.jsx`): **1)** pick a
provider (`ShippingCompanySelector`), **2)** fill in that provider's own form
(`OzonOrderForm` / `QuickLivraisonOrderForm`), both built from a shared
`OrderBaseFields` (client name, phone, city, address, price, product) plus
their own extra field(s) — Ozon has an optional reference/SKU (not sent to
Ozon — it has no such parameter, kept purely as a local note); Quick has
quantity and an optional note (both genuinely required/used by Quick's API).
"Allow opening before paying" (Quick's `open`) is **not** a form field — it is
a fixed business rule, always forced to `true` server-side in
`app/api/orders/quick/route.js` regardless of anything the client sends.
Each provider's own city/district
combobox (`OzonCitySelect` / `QuickDistrictSelect`) fetches the real list
from our backend and submits the provider's numeric id, not the display
name — both APIs need an id, not free text.

### Backend routes

| Route | Purpose |
| --- | --- |
| `POST /api/orders/ozon` | Create an Ozon Express parcel |
| `GET /api/orders/ozon` | List the caller's own Ozon orders (live from Ozon) |
| `GET /api/orders/ozon/cities` | Proxy for Ozon's city list |
| `POST /api/orders/quick` | Create a Quick Livraison delivery |
| `GET /api/orders/quick` | List the caller's own Quick orders (from MongoDB, live status from Quick) |
| `GET /api/orders/quick/cities` | Proxy for Quick's district list |

Every route re-derives the caller (and, for an employee, their owning
merchant) from the session — `employeeId`/`merchantId`/tracking numbers sent
by the client are never trusted.

### Tracking-number format and isolation

```
fullTrackingNumber = prefix + period + "01" + counter
period             = YYYY + MM                  (the selected/current month)
"01"                = a FIXED literal — never today's real day of month
counter             = a monthly sequence, starting at 1000 EVERY month

e.g. "oussama202608011005"  (prefix "oussama", period "202608", counter 1005)
```

- **Prefix**: an employee's `username`. Merchants have no `username` (reserved
  for employees — see the `User` model), so theirs is derived from the local
  part of their email; this is a project decision, not a preserved external
  rule — see "Open decisions" below.
- **The two providers store their counters differently — this is deliberate,
  not an inconsistency:**
  - **Quick Livraison**: resets to 1000 every calendar month, independently
    per (owner, provider). Stored in **`models/TrackingCounter.js`** — one
    document per `(ownerId, provider, period)`, holding the *latest
    successfully used* counter for that owner+provider+month (the very first
    order of a month uses 1000, and the document only exists once that first
    order has actually succeeded, so "no document" cleanly means "no orders
    yet this month"). `lib/tracking/reserve-counter.js` holds the CAS
    reserve/release logic against it; `lib/quick/*` binds it to Quick.
  - **Ozon Express**: uses **`User.ozonTrackingCounter`** — a single,
    continuously-incrementing field, **never reset monthly** — as the
    authoritative live counter. An earlier task had migrated Ozon onto the
    same per-month `TrackingCounter` scheme as Quick; that was an explicit
    correction reverting Ozon specifically back onto this field (see
    `lib/ozon/reserve-tracking-number.js`'s module comment for the full
    history). Unlike `TrackingCounter`'s "latest used" convention, this field
    is **next-unused**: the stored value IS the number the next order will
    use; it becomes `value + 1` only after that order succeeds. The `period`
    segment of the tracking number is still always "today's real month" —
    it is generated fresh at creation/listing time and is *not* stored
    alongside the counter, so it is decoupled from the counter's own value
    (an order created in October still just continues wherever the counter
    left off in September; there is no monthly reset to align it to).
    `TrackingCounter` documents created for Ozon while the (now reverted)
    per-month scheme was active remain in the database, untouched, and are
    still used — read-only — for browsing a **past** month's Ozon history
    (see "Order listing" below); they are never consulted for new orders or
    for the current month.

### Concurrency and failure handling

Both providers reserve via compare-and-swap **before** calling the provider,
so two concurrent requests can never be handed the same number, with a
best-effort release on failure so a failed attempt never permanently
consumes one:

- **Quick Livraison**: CAS on the month's `TrackingCounter` document
  (`reserveNextCounter` in `lib/tracking/reserve-counter.js`, up to 5
  retries) — for a brand-new month, release deletes the just-created
  document instead of rewinding it, so the next attempt correctly restarts
  at 1000, not 1001.
- **Ozon Express**: CAS directly on `User.ozonTrackingCounter`
  (`lib/ozon/reserve-tracking-number.js`, up to 5 retries) — the same idea,
  scoped to one field instead of a per-month document.

In both cases: if the provider call then fails (network error, or the
provider's own response indicates rejection), the release only rewinds the
counter if nobody else has advanced it further meanwhile. A successful order
is mirrored locally (`Order` model) only after the provider confirms
success; a failed attempt never creates a local order and never advances the
counter.

### Order listing (per selected month)

Both `GET /api/orders/{ozon,quick}` routes accept `?period=YYYYMM` (defaulting
to the current month) and a `MonthSelect` dropdown in both `OzonOrdersList.jsx`
/ `QuickOrdersList.jsx` lets the user browse other months. The two providers'
routes use **different strategies**, deliberately:

- **Ozon Express** (`GET /api/orders/ozon`): Ozon's own API is rich enough to
  reconstruct the whole order, so the list is re-fetched **live from Ozon**,
  not from the local `Order` mirror (which stays audit-only). The starting
  point depends on which month is requested:
  - **Current month** (the default, or `?period=` explicitly matching it):
    starts at the LIVE `User.ozonTrackingCounter` value — the same
    authoritative counter order creation uses (`peekNextOzonCounter`).
  - **A past month**: starts at that month's stored `TrackingCounter`
    document (`peekOzonCounterForPeriod`) — the historical mechanism from
    when Ozon briefly used that scheme, preserved read-only.

  Either way the range walked is `[1000, startCounter]`, downward in small
  concurrent batches (default 5 orders at a time; each order costs 2 Ozon
  calls) — fully deterministic, not a gap-tolerant open-ended scan: no
  "consecutive misses" heuristic is needed, since the lower bound is always
  exactly 1000. An individual missing number inside that range is still
  tolerated (logged, not fatal — a release-on-failure race can rarely leave
  a small gap, and the current month's `startCounter` is itself always
  "next-unused", so it alone is expected to come back not-found) but the
  walk always continues down to and including 1000, then stops — never
  below it. If there is nothing to start from (a past month with no
  `TrackingCounter` document), the list is empty immediately (no Ozon calls
  at all).
  **The response streams as newline-delimited JSON** (`{"type":"meta",
  "period":...}` first, then one `{"type":"order",...}` per order the moment
  it's ready, then `{"type":"done","count":N}`) instead of one big JSON array:
  fetching even a modest history is many Ozon HTTP calls, and waiting for all
  of them before responding made the page feel frozen. `OzonOrdersList.jsx`
  reads the stream incrementally and renders each order as it arrives,
  re-sorting the visible list by each order's own numeric counter (attached
  server-side as `_numericTrackingNumber` — never re-derived from the display
  tracking string, since a merchant's derived prefix can itself end in digits
  and would corrupt any such parse) so the final order is always correct
  regardless of arrival order.
- **Quick Livraison** (`GET /api/orders/quick`): Quick's API does **not**
  expose enough customer/order detail to reconstruct a list from it, and
  tracking numbers are never scanned to discover orders. Instead, **MongoDB
  is the source of truth**: the local `Order` documents (`provider:
  "quick_livraison"`, scoped to the caller, filtered to the selected month via
  a `createdAt` range — an order's creation month always equals the period
  its tracking number was generated for, by construction) supply every
  customer/order field, and Quick's `getParcelDetails` is called per order
  **only** for its current live status, merged in as `{ ...localOrder,
  status }`. If that call fails or is inconclusive for a given order, the
  order still shows with its `lastKnownStatus` (persisted on the `Order`
  document the last time a live check succeeded) or, if none is stored yet,
  `statusUnavailable: true` — a Quick hiccup never hides or corrupts a local
  order.

### Credentials

Both providers' credentials come from the merchant's `ShippingCompany`
document (never the client): Ozon needs `ozonId` + `apiKey`; Quick needs
only `apiKey`. An employee's orders always use their **own** merchant's
credentials. Keys are decrypted server-side only, right before the provider
call, and never logged or returned in any API response.

### Open decisions / limitations

- **Merchant tracking prefix** (derived from their email's local part) is an
  assumption, not a documented requirement — confirm if merchants should get
  a chosen handle instead.
- **Quick Livraison's response shapes are not documented** for this
  integration (unlike Ozon Express, where an old, proven implementation's
  exact shapes were available). `lib/quick/parse.js` makes a best-effort,
  defensive guess at a few plausible key names for "did this succeed" /
  "does this parcel exist" / city list fields, and is the one place to fix
  once the real shape is confirmed against Quick's live API with real
  credentials — this has **not** been verified against the real Quick API,
  only against a local mock server built from this task's documented request
  format.

## Dashboard

`/dashboard` shows three order-performance cards for merchants and
employees (a merchant sees every order under their account, including
their employees'; an employee sees only their own — same scoping as
Commission below):

- **Livré** — count of orders with `deliveredAt` set (the same
  authoritative, set-once "was this ever delivered" signal the commission
  system uses — see `models/Order.js`).
- **Retour** — count of never-delivered orders whose `lastKnownStatus`
  classifies as a return (cancelled/refused/returned) via
  `lib/orders/status-groups.js#isReturnStatus`, the one reusable place this
  rule lives (normalizes case/accents so it isn't tripped up by how a
  status string happens to be capitalized). Ozon Express's own French
  statuses (`Annulé`/`Refusé`/`Retourné`, see `lib/ozon/status.js`) and
  their plain-English equivalents are both recognized.
- **Progress** — an SVG green/red ring (no charting library) showing
  Livré's share of `delivered + returned` (orders still in transit aren't
  counted in this ratio, since they have no outcome yet). Shows a neutral
  "No data yet" state when that sum is zero, rather than dividing by zero.

All of this reads only the local `Order` collection
(`lib/orders/dashboard-stats.js`) — opening the dashboard never calls
Ozon/Quick live, the same constraint already applied to Commission.

The header above the cards (`DashboardHeader.jsx`) is deliberately compact —
name, an active-status dot, and a notification bell — replacing what used to
be a full "Your account" card just for name/email/role. There is no
notifications backend in this app; the bell renders an honest "No
notifications yet" empty state rather than a fabricated unread badge.

## Settings

`/dashboard/settings` is one page/form for every role — which fields render
is decided entirely by what's present on the current user (`email` vs.
`username`), the same optional-field pattern the old account block used, not
a separate implementation per role. `SettingsForm.jsx` has two independent
sections:

- **Profile** — `PATCH /api/settings/profile`, always targets
  `getCurrentUser()`'s own id (never a client-supplied one); which submitted
  fields actually apply is decided server-side from the caller's own role
  (an employee can never set `email`, a merchant/super admin can never set
  `username` — the same rule `models/User.js` already enforces at the schema
  level).
- **Security** — `POST /api/settings/password` re-verifies the current
  password (`comparePassword`, against a freshly `.select("+password")`
  loaded document) before assigning and saving the new one, so the model's
  existing `pre('save')` hash hook does the actual hashing — no parallel
  hashing path, and the password is never logged or echoed back.

## Commission

`GET /api/commission?period=YYYYMM` returns commission for one calendar
month — see `/dashboard/commission` for the UI (shared by both roles below).
Two authorized callers, same endpoint, same calculation:

- **Merchant** — sees every one of their own employees (same authorization
  boundary as `/api/employees`).
- **Employee** — sees ONLY their own row. `merchantId` and `employeeId` are
  both read from the server-verified session (`getCurrentUser()`), never
  from any request parameter — there is no URL/query/body field that could
  change whose data comes back, so this isn't just permission-checked, it's
  structurally impossible for an employee to request another employee's
  commission.

Both branches call the exact same `computeCommissionReport()` — the
employee branch just passes one extra optional `employeeId` argument that
narrows the same query down to one person; nothing about the calculation
itself differs per caller. Calculation lives in `lib/commission/`:

- `status.js` — provider-aware "is this delivered?" (Ozon's "Livré" vs.
  Quick's `status === "DELIVERED"`).
- `sync-status.js` — opportunistic, fire-and-forget local cache: every time
  either provider's order-listing route re-checks a live status (which
  already happens on every Orders-page view — no new polling was added),
  this also writes `Order.lastKnownStatus` and, the first time a delivery is
  observed, `Order.deliveredAt` (a Mongo pipeline update, set once and never
  moved afterward). This is what lets commission be computed entirely from
  MongoDB, with **zero calls to Ozon/Quick from the commission page itself**.
- `calculate.js` — the business rules, preserved exactly as specified:
  price -> 1/2/3/4 commission units (`<350`, `>350 && <=500`,
  `>=550 && <=750`, `>750` — the gaps at exactly 350 and 501-549 are
  intentional and yield 0 units, not a bug), and a **non-progressive**
  threshold comparison (`totalUnits >= employee.commission.threshold` picks
  ONE rate for every unit that month, never a tiered split).
- `resolve-commission-period.js` — the SOLE source of "which month does
  this order belong to": the leading "YYYYMM" of `Order.numericTrackingNumber`
  (the tracking number, minus its prefix — see models/Order.js). Never
  `createdAt`, never `deliveredAt`. An order tracking-numbered for August
  that happens to be delivered in September still counts toward AUGUST's
  commission — the tracking number is authoritative for the month, full
  stop; `deliveredAt` only answers the separate question of whether an
  order counts AT ALL (delivered vs. not).
- `report.js` — the MongoDB query: an employee's orders for a selected
  month are the ones whose `numericTrackingNumber` starts with that exact
  period AND have ever been observed delivered (`deliveredAt` set to
  anything). Every order belongs to exactly one month (its own tracking
  number's), so an order can never appear in two different months' reports
  and can never be miscounted by when it happened to be observed delivered.

**Historical-order gap fixed 2026-09-08**: a new employee's real Ozon
activity often predates them being added to this app (created directly at
Ozon, or through an older tool) — but `user.ozonTrackingCounter` and
`TrackingCounter` (see lib/ozon/reserve-tracking-number.js) only ever learn
about a period once an order is actually created THROUGH cst, so such
orders were completely invisible to commission no matter how correct the
calculation was. Fixed generically (works for any employee, no username
ever hardcoded):

- `lib/ozon/discover-counter.js#discoverHighestOzonCounter()` — probes
  forward from the fixed monthly floor (1000) until a run of consecutive
  "not found" results, discovering the real counter ceiling for a
  (prefix, period) with no prior knowledge — the one piece this app
  couldn't previously do without an already-known starting counter.
- `lib/commission/sync-historical-orders.js#syncHistoricalOzonOrders()` —
  orchestrates: discover the ceiling, walk it with the existing
  `fetchOzonOrdersForMonth`, then mirror each order locally — reusing
  `lib/commission/sync-status.js` for anything that already exists (never
  duplicates), and `Order.create()` guarded by the same unique index for
  anything new (a losing create race under concurrent syncs throws and is
  caught, not a failure). Defaults to the current month plus the last 2
  (a bounded, adjustable lookback window — not a full unbounded history
  scan) when no explicit periods are given.
- `app/api/employees/route.js` — fires this in the background right after
  a new employee is created (never awaited, never blocks or can fail that
  response) — so a new employee's pre-existing history becomes correct
  automatically, with no page needing to be opened and no manual step.

**Bug fixed 2026-09-08**: `lib/ozon/history.js#findHistoryEntry()` used to
scan only numbered history keys `"2"`-`"19"` (a fixed loop bound). A parcel
rescheduled ("Reporté") enough times can have MORE than 19 steps — one real
case had 22, with its actual "Livré" entries at 20-22, entirely outside the
old range — so `findDeliveredAt()` silently returned `null` for a
genuinely-delivered order (no error, no warning), which excluded it from
commission. Fixed by scanning every numeric key actually present on the
order object, sorted numerically, instead of a hardcoded range — there is
no step-count this can exceed again.

A limitation worth knowing: because syncing is opportunistic (piggybacked on
Orders-page views rather than a background poller), an order that gets
delivered at the provider while nobody happens to view that employee's
Orders list for that month will not yet have a local `deliveredAt`, and so
will not yet appear in the commission report — it will appear as soon as
the Orders list is next viewed for that order's month. This mirrors the
existing architecture's own tradeoff (Quick's `lastKnownStatus` cache had
the same property before commission existed) rather than introducing a new
one. When Ozon does report a delivery, `deliveredAt` is set to the REAL
"Livré" event time from Ozon's own history (`lib/ozon/history.js#findDeliveredAt`),
not the moment the app happened to notice it — this matters for orders
observed several days late near a month boundary. Quick's API doesn't
expose a delivery timestamp, so it still falls back to "now" (the best
available signal there).

**Bug that made this show nothing for real data (found and fixed
2026-09-07)**: for this to work at all, a delivered order must already have
a local `Order` document to attach `deliveredAt` to — `syncOrderStatus`
only ever *updates* an existing document, it never creates one. This
merchant's account had real, already-delivered Ozon parcels (6 in
September, 56 more in August — 43 delivered) with no local `Order` mirror
at all (created before this app's own order-creation flow existed /
mirrored locally), so no amount of correct calculation logic could ever
surface them. They were backfilled once, by hand, using data read directly
from Ozon's own API (never fabricated) — see git history for the one-time
scripts. This is not a recurring gap: every order created going forward
through this app's own `POST /api/orders/{ozon,quick}` already gets its
local mirror at creation time, the same way it always has. The delivery
month is always the month the order was ACTUALLY delivered in, by
`deliveredAt` — some August-prefixed tracking numbers were delivered in
early September and correctly count toward September's commission, not
August's, exactly as `lib/commission/resolve-delivery-date.js` (the single
place that decides "the" delivery date for every commission code path)
intends.

## Database

`lib/mongodb.js` exports `connectToDatabase()`, which caches a single Mongoose
connection on `globalThis` so hot reloads and serverless invocations reuse it.
Call it at the top of any route handler or server action:

```js
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";

export async function GET() {
  await connectToDatabase();
  const users = await User.find().lean();
  return Response.json(users);
}
```

Required environment variables are documented in `.env.example`
(`MONGODB_URI`, `JWT_SECRET`, `SUPER_ADMIN_*`, `SECRET_ENCRYPTION_KEY`).
`MONGODB_DNS_SERVERS` is an optional escape hatch — see the comment above it
in `.env.example` — for networks where a `mongodb+srv://` SRV lookup gets
`querySrv ECONNREFUSED`.

## PWA

- **Manifest** is generated by `app/manifest.js` and linked from `app/layout.js`.
- **Service worker** source is `app/sw.js`; `@serwist/next` compiles it to
  `public/sw.js` during `next build` and registers it automatically. It is
  **disabled in `next dev`** so it never interferes with hot reloading.
- **Metadata** (`theme_color`, `apple-mobile-web-app-*`, icons) is set via the
  Next.js `metadata` / `viewport` exports in `app/layout.js`.
- **Installability**: after `npm run build && npm start`, load the site over
  `http://localhost:3000` (or HTTPS in production) and use the browser's
  "Install app" prompt.

`public/sw.js` and its variants are generated artifacts and are git-ignored.

### Mobile navigation

`SidebarNav.jsx` has four coordinated pieces, all built from the same
role-aware `navItemsFor(role)` list (so a nav item is never defined twice):
a desktop sidebar (`md:` and up, normal document flow), a sticky mobile top
bar (just the hamburger toggle), a mobile drawer, and `MobileBottomNav.jsx`
— a bottom tab bar for the first few items in that same list, with a "More"
tab that opens the drawer for everything else. `ImpersonationBanner.jsx`
renders above the page content, inside `<main>`, whenever
`user.impersonatorId` is set.

**The mobile drawer is a real overlay, not an in-flow panel.** It used to be
nested inside the top bar's own markup — a plain `<div>` that appeared
*below* the bar in normal document flow, pushing `<main>` down whenever it
opened instead of floating above it. Fixed by giving it its own `fixed
inset-y-0 left-0` positioning (taken out of flow entirely — it can neither
push nor be pushed by page content), a `w-72 max-w-[85vw]` cap so the panel
itself can never be a source of horizontal overflow, a `translate-x`
slide transition, and a dedicated `fixed inset-0` backdrop underneath it
(tapping it, the drawer's own close button, Escape, or any nav link all
close it — `<body>` scroll is frozen while it's open, the standard drawer
behavior). `h-dvh` (not `h-screen`) so its height respects the real, dynamic
mobile viewport rather than the browser chrome's resting size. Desktop is
untouched — entirely separate markup (`hidden md:flex`), not a responsive
variant of the drawer.

### Mobile-first tables

Data that's genuinely tabular gets a **dedicated mobile presentation**, not
a shrunk table — Commission (`CommissionTable.jsx`) is the concrete case:
one `employees` array/fetch, rendered as `EmployeeRows` (a `<table>`,
`hidden` below `sm:`) on desktop and `EmployeeCard` (`sm:hidden`) on mobile
— cards with a clear label/value stat list (Delivered / Units / Threshold /
Rate / Total, Total emphasized), a per-card month badge, and a "View
orders"/"Hide orders" toggle that expands a stacked list of compact order
rows instead of a nested table. Same data, same `expandedId` state, same
`lib/commission/report.js` numbers either way — only the JSX differs, so
there is exactly one source of truth for the calculation. The desktop
table itself still scrolls **inside its own container**, never the page,
with the employee-name column pinned (`sticky left-0`) and
`WebkitOverflowScrolling: touch`. Every other list in the app (Orders,
Employees) is already cards on every breakpoint, so this split doesn't
apply there.
