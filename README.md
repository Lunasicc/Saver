# Saver

**A private, local-first budgeting app that shows you where your money goes.**

Saver runs entirely on your own computer. Your transactions live in a database
file on your machine; nothing is uploaded to a server, and there is no account
to sign up for. It can sync automatically with any New Zealand bank through
[Akahu](https://www.akahu.nz), import CSV statements from anywhere, or you can
enter everything by hand.

## Features

- **Overview**: this month's spending with a budget pace bar, money in / net /
  net worth, alerts for uncategorized spending and over-budget categories,
  spending by category and by business, a 12-month cash-flow chart and
  upcoming bills.
- **Automatic categorization**: more than 100 built-in keyword rules for
  common NZ businesses (supermarkets, fuel, power, telcos, streaming and more).
  When you re-categorize a transaction, Saver learns it for next time.
- **Transactions**: a searchable feed you can filter by month, category or
  account, with inline re-categorizing, CSV import with column mapping, and a
  rules editor.
- **Planning**: monthly budgets (with suggestions based on your own history),
  recurring bill detection and a subscription audit.
- **Accounts**: net worth over time, and one-click bank sync.

## Getting started

### 1. Install Node.js

Download and install the **LTS** version of Node.js (22 or newer) from
[nodejs.org](https://nodejs.org). This is the only prerequisite.

### 2. Download Saver

Either click **Code → Download ZIP** on this page and unzip it, or clone it:

```bash
git clone https://github.com/Lunasicc/Saver.git
```

### 3. Start it

- **Windows**: double-click **`Start Saver.cmd`**.
- **macOS / Linux**: in a terminal, run `./start.sh` from the Saver folder.
- **Or, from any terminal**: `npm install` (first time only), then `npm start`.

The first start installs dependencies, which takes a minute or two. Saver then
opens in your browser at **http://localhost:4000**. Keep the terminal window
open while you use it; close it (or press `Ctrl+C`) to stop Saver.

## Connecting your bank (New Zealand)

Saver uses [Akahu](https://www.akahu.nz), NZ's open-banking platform, to read
balances and transactions from ASB, ANZ, BNZ, Westpac, Kiwibank and others.
Each person uses their own free Akahu **personal app**, so your bank data goes
straight from Akahu to your computer.

1. Create an account at **[my.akahu.nz](https://my.akahu.nz)** and connect
   your bank accounts.
2. Open the **Developers** page, accept the developer terms and set up
   two-factor authentication. Akahu then shows you an **App ID Token**
   (`app_token_…`) and a **User Access Token** (`user_token_…`).
3. In Saver, open **Accounts**, paste both tokens into **Bank connection** and
   click **Connect and sync**.

Saver checks the tokens with Akahu, saves them on your computer and imports
the last 12 months of transactions. After that, use **Sync bank** in the top
bar whenever you want to catch up. Re-syncing is always safe: duplicates are
skipped and your own categories are never overwritten. **Disconnect** on the
Accounts page removes the saved tokens.

> Akahu personal apps are free and limited to your own Akahu account, which is
> exactly what a self-hosted app needs. See the
> [Akahu personal app docs](https://developers.akahu.nz/docs/personal-apps).

Outside NZ, or if you'd rather not connect your bank, add an account on the
**Accounts** page and use **Transactions → Import** to upload CSV statements
exported from your internet banking.

## Your data and privacy

- All data is stored in `server/data/budget.sqlite`. **Back up this file** to
  keep your history; delete it to start over.
- Saver only listens on `127.0.0.1`, so other devices on your network can't
  reach it. It also rejects requests from other websites.
- Akahu tokens you paste in are stored in the same local database. They are
  never sent anywhere except to Akahu, and never shown again in the browser.

## Customizing

### Your own local businesses

Built-in rules cover national chains. To teach Saver your local cafe, gym or
dairy up front, create `server/data/custom-rules.json` (see
[`server/custom-rules.example.json`](server/custom-rules.example.json)):

```json
[
  { "pattern": "Riverside Gym", "merchant": "Riverside Gym", "category": "Health" }
]
```

A rule matches any transaction whose description contains the pattern
(ignoring case, spaces and punctuation). These rules are loaded when Saver
starts. You can also just re-categorize a transaction in the app, and Saver
will remember it.

### Settings

Copy `server/.env.example` to `server/.env` to change the port, the database
location, or to supply Akahu tokens there instead of in the app. To rename the
app, create `client/.env.local` with `VITE_APP_NAME=My Budget`.

## Development

```bash
npm install
npm run dev:server   # API on http://127.0.0.1:4000, restarts on changes
npm run dev:client   # UI with hot reload on http://localhost:5173
```

```bash
npm test             # server API, categorization and insight tests
npm run build        # type-check and production build of the UI
npm run lint         # oxlint
npm run smoke        # every page in a real browser (dev servers must be running)
```

`node client/scripts/smoke.mjs --shots` also saves desktop and mobile screenshots to
`client/scripts/shots/`. The smoke test drives an installed Microsoft Edge or
Google Chrome.

**Stack**: Node.js, Express and better-sqlite3 on the server; React, Vite,
TypeScript, Framer Motion, Recharts and Phosphor icons on the client.

```
server/   Express API, SQLite schema, categorization, insights, Akahu sync
client/   React UI (pages, components, styles)
scripts/  npm start launcher
```

## License

[MIT](LICENSE)
