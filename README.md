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
  common NZ businesses (supermarkets, fuel, power, telcos, streaming,
  investing and KiwiSaver platforms like Sharesies, and more).
  When you re-categorize a transaction, Saver learns it for next time.
- **Transactions**: a searchable feed you can filter by month, category or
  account, with inline re-categorizing, CSV import with column mapping, and a
  rules editor.
- **Planning**: monthly budgets (with suggestions based on your own history),
  recurring bill detection and a subscription audit.
- **Focus on one account**: with more than one account, the switcher in the
  top bar narrows Overview, Transactions and Planning to a single account (or
  back to all of them). Saver remembers your choice.
- **Accounts**: a bank connections hub (every connected bank, its health and
  when it last updated, with per-account include switches), net worth over
  time, and one place to add bank, CSV or hand-tracked accounts.

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

In Saver, open **Accounts → Add account → Connect a bank**. A short setup
guide walks you through it without leaving Saver:

1. **Akahu account**: create a free account at my.akahu.nz.
2. **Connect banks**: log in to your banks through Akahu.
3. **Link Saver**: on Akahu's **Developers** page, accept the developer terms
   and set up two-factor authentication, then copy the **App ID Token**
   (`app_token_…`) and **User Access Token** (`user_token_…`) into Saver.
4. **Choose accounts**: pick the accounts to track and how much history to
   bring in (3, 12 or 24 months).
5. **Import**: Saver imports and auto-categorizes your transactions.

Each Akahu step opens in a small popup window, and Saver notices when you're
done and moves on. Bank logins always happen on Akahu's own site: Saver never
sees your bank passwords, and banks don't allow their login pages to be
embedded in other apps. If your browser blocks the popup, allow popups for
`localhost`.

After setup, the **Bank connections** panel on the Accounts page shows:

- **Every connected bank**, marked **Active** or **Needs reconnecting** (with a
  link to fix it in Akahu), and how old the bank's data is.
- **An include switch on each account.** Switching one off stops syncing it
  and keeps the history you already have.
- **Connect another bank.** Saver spots the new accounts and offers to import
  them.
- **Refresh from bank.** This asks Akahu to fetch the latest data from your
  banks before syncing. Akahu limits how often it does this.
- **Sync now and Auto-sync.** When auto-sync is on, Saver catches up
  automatically when you open it, if it's been more than 6 hours, and tells
  you what's new. The **Sync bank** button in the top bar does the same any
  time.

Re-syncing is always safe: duplicates are skipped and your own categories are
never overwritten. **Disconnect** removes the saved tokens.

> Akahu personal apps are free and limited to your own Akahu account, which is
> exactly what a self-hosted app needs. See the
> [Akahu personal app docs](https://developers.akahu.nz/docs/personal-apps).

Outside NZ, or if you'd rather not connect your bank, use **Add account →
Import a statement** to upload CSV statements exported from your internet
banking, or **Track by hand** for cash and other accounts.

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
