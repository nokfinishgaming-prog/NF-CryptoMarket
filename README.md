# NF CryptoMarket

A practice & market-research platform — real market data, fully simulated trading, and honesty about what it can and can't tell you. Single-page React app, built with Vite.

> **All trading is simulated. No real money, deposits, or withdrawals, ever.** Market data is for study only and is not financial advice.

---

## What works once it's running live

When you open this app from a real site origin (Netlify, Vercel, or `npm run dev` locally), the live data feeds load on their own:

- **Markets** — every Binance USDT market, with gainers / losers / volume tabs and overview stats (market cap, dominance, Fear & Greed)
- **Derivatives** — live perpetual-futures funding rates from Binance
- **Indicators** — live Fear & Greed Index and Bitcoin Dominance
- **Technicals** — a live RSI heatmap and the Technical Stance panel, computed from real candles
- **NF-Scan** — a rule-based scanner over live data
- **Terminal** — the full charting + 18-indicator + drawing + paper-trading workspace

The "SIM" badge in the top bar flips to "LIVE" automatically when the feeds connect.

These three data sources all allow cross-origin requests from a normal website, which is why they work when deployed but **not** inside the Claude preview iframe (that sandbox blocks outbound calls):

- Spot & funding — Binance (`api.binance.com`, `fapi.binance.com`)
- Global & dominance — CoinGecko (`api.coingecko.com`)
- Sentiment — alternative.me (`api.alternative.me`)

---

## Run locally

You need [Node.js](https://nodejs.org) 18+ installed.

```bash
npm install
npm run dev
```

Open the URL it prints (usually http://localhost:5173). The live data should load within a few seconds.

To make a production build:

```bash
npm run build      # outputs to the dist/ folder
npm run preview    # serve the built dist/ locally to check it
```

---

## Deploy to Netlify

**Option A — drag & drop (fastest):**

1. `npm install`
2. `npm run build`
3. Go to https://app.netlify.com/drop and drag the generated **`dist`** folder onto the page.

That's it — Netlify gives you a live `https://<name>.netlify.app` URL.

**Option B — connect a Git repo (auto-deploys on push):**

1. Push this folder to a GitHub repository.
2. In Netlify: **Add new site → Import an existing project** and pick the repo.
3. Netlify reads `netlify.toml` automatically (build command `npm run build`, publish dir `dist`). Click **Deploy**.

---

## Enabling the "Ask NF AI" assistant (Google Gemini)

The AI assistant in **NF-Scan** is powered by Google Gemini, through the serverless
function at `netlify/functions/ask.js`. Your Gemini API key stays on the server
(in Netlify's environment variables) and never touches the website code.

**Important:** serverless functions only deploy when the site is built by Netlify
— i.e. via a **Git-connected deploy** or the **Netlify CLI**. A manual drag-and-drop
of the `dist` folder serves the static site (all the market data works) but does
**not** run the function, so the AI won't answer. To turn the AI on, deploy from Git:

1. **Get a free Gemini key** at https://aistudio.google.com → "Get API key" →
   "Create API key". New keys start with `AQ.` — that is correct and current.
   (Don't paste it anywhere public; you'll enter it in Netlify only.)
2. **Put this project in a GitHub repo** (the browser uploader at github.com works —
   no Git install needed; just don't upload `node_modules`).
3. **In Netlify:** Add new site → Import an existing project → pick the repo. Netlify
   reads `netlify.toml` automatically (build `npm run build`, publish `dist`,
   functions `netlify/functions`).
4. **Set the key:** Netlify → Site configuration → Environment variables → Add a
   variable named exactly `GEMINI_API_KEY` with your `AQ...` key as the value.
5. **Deploy** (Netlify → Deploys → Trigger deploy → Deploy site). Open NF-Scan and
   ask the assistant a question — it now answers live.

The function uses Gemini's **native** API (required — `AQ.` keys are rejected by
OpenAI-compatible endpoints). The model is `gemini-2.5-flash` (free tier ≈ 10
requests/min, 500/day); change `MODEL` at the top of `netlify/functions/ask.js`
to use a different one.

> Test locally with the AI included: `npm install -g netlify-cli` then
> `netlify dev` (set `GEMINI_API_KEY` in a local `.env` file first).

---

## Enabling the News feed (CryptoPanic)

The **News** tab is powered by CryptoPanic through `netlify/functions/news.js`
(server-side, because CryptoPanic's API has no CORS). Same deal as the AI: it
needs a Git/CLI deploy and an environment variable.

1. **Get a free token** at https://cryptopanic.com/developers/api/keys (sign up
   first; your token shows in the dashboard).
2. **In Netlify** → Site configuration → Environment variables → add a variable
   named exactly `CRYPTOPANIC_TOKEN` with your token as the value.
3. **Redeploy.** Open the News tab — live headlines appear, with filter tabs
   (Latest / Hot / Rising / Bullish / Bearish). Each links to its original source.

Notes: CryptoPanic caches server-side and asks that you don't poll more than once
per ~30s; this function sends a 2-minute cache header. Headlines come straight
from CryptoPanic — the app attributes them and links out, and does not rebrand or
editorialise them.

---

## Project structure

```
nf-cryptomarket/
├── index.html              # HTML entry
├── package.json            # deps + scripts
├── vite.config.js          # Vite + React plugin
├── netlify.toml            # Netlify build + SPA redirect
├── public/
│   └── favicon.svg         # NF logo (also the browser tab icon)
└── src/
    ├── main.jsx            # entry; adds a localStorage shim so the paper
    ├── functions/
    │   ├── ask.js          # AI assistant (Gemini), server-side
    │   └── news.js         # news feed (CryptoPanic), server-side
    │
    src/main.jsx ... account persists when self-hosted
    └── App.jsx             # the entire app (one file)
```
