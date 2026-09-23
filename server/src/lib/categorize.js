// Turns a raw bank description into a matchable key: lowercase, alphanumeric only.
// Bank exports glue/space words inconsistently (e.g. "FRESH CHOICEPAPANUI"),
// so stripping everything except letters/digits makes substring matching reliable.
export function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Best-effort human-readable merchant name from a raw description, used when a
// user categorizes a transaction that doesn't already match a known rule.
export function deriveMerchantName(description) {
  let s = String(description || '')
    .replace(/^CARD \d+\s*/i, '')
    .replace(/^POS\s*/i, '')
    .replace(/^AP#\d+\s*/i, '')
    .replace(/^(EFTPOS|DEBIT|VISA)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = description;
  return s.length > 60 ? s.slice(0, 60) : s;
}

// Finds the best matching rule for a description: an exact normalized match
// wins first (these are learned from the user's own corrections), otherwise
// the longest matching "contains" rule (more specific patterns take priority).
export function findRuleMatch(rules, description) {
  const norm = normalizeForMatch(description);
  if (!norm) return null;

  const exact = rules.find((r) => r.match_type === 'exact' && r.pattern === norm);
  if (exact) return exact;

  let best = null;
  for (const rule of rules) {
    if (rule.match_type !== 'contains') continue;
    if (norm.includes(rule.pattern) && (!best || rule.pattern.length > best.pattern.length)) {
      best = rule;
    }
  }
  return best;
}

// Seed rules for common NZ merchants, grouped by target category name.
// Patterns are pre-normalized (lowercase, no spaces/punctuation).
export const DEFAULT_MERCHANT_RULES = [
  // Groceries
  { pattern: 'countdown', merchant: 'Countdown', category: 'Groceries' },
  { pattern: 'newworld', merchant: 'New World', category: 'Groceries' },
  { pattern: 'paknsave', merchant: "Pak'nSave", category: 'Groceries' },
  { pattern: 'woolworths', merchant: 'Woolworths', category: 'Groceries' },
  { pattern: 'freshchoice', merchant: 'Fresh Choice', category: 'Groceries' },
  { pattern: 'foursquare', merchant: 'Four Square', category: 'Groceries' },
  { pattern: 'supervalue', merchant: 'SuperValue', category: 'Groceries' },

  // Dining out
  { pattern: 'mcdonald', merchant: "McDonald's", category: 'Dining Out' },
  { pattern: 'burgerking', merchant: 'Burger King', category: 'Dining Out' },
  { pattern: 'kfc', merchant: 'KFC', category: 'Dining Out' },
  { pattern: 'subway', merchant: 'Subway', category: 'Dining Out' },
  { pattern: 'dominos', merchant: "Domino's", category: 'Dining Out' },
  { pattern: 'pizzahut', merchant: 'Pizza Hut', category: 'Dining Out' },
  { pattern: 'starbucks', merchant: 'Starbucks', category: 'Dining Out' },
  { pattern: 'wendys', merchant: "Wendy's", category: 'Dining Out' },
  { pattern: 'ubereats', merchant: 'Uber Eats', category: 'Dining Out' },
  { pattern: 'menulog', merchant: 'Menulog', category: 'Dining Out' },

  // Transport
  { pattern: 'zenergy', merchant: 'Z Energy', category: 'Transport' },
  { pattern: 'mobil', merchant: 'Mobil', category: 'Transport' },
  { pattern: 'caltex', merchant: 'Caltex', category: 'Transport' },
  { pattern: 'gullnz', merchant: 'Gull', category: 'Transport' },
  { pattern: 'uberrides', merchant: 'Uber', category: 'Transport' },
  { pattern: 'athop', merchant: 'AT HOP', category: 'Transport' },

  // Utilities
  { pattern: 'spark', merchant: 'Spark', category: 'Utilities' },
  { pattern: 'vodafone', merchant: 'Vodafone', category: 'Utilities' },
  { pattern: '2degrees', merchant: '2degrees', category: 'Utilities' },
  { pattern: 'contactenergy', merchant: 'Contact Energy', category: 'Utilities' },
  { pattern: 'genesisenergy', merchant: 'Genesis Energy', category: 'Utilities' },
  { pattern: 'mercuryenergy', merchant: 'Mercury Energy', category: 'Utilities' },
  { pattern: 'meridianenergy', merchant: 'Meridian Energy', category: 'Utilities' },
  { pattern: 'trustpower', merchant: 'Trustpower', category: 'Utilities' },
  { pattern: 'watercare', merchant: 'Watercare', category: 'Utilities' },

  // Entertainment
  { pattern: 'disneyplus', merchant: 'Disney+', category: 'Entertainment' },
  { pattern: 'neontv', merchant: 'Neon', category: 'Entertainment' },
  { pattern: 'skytv', merchant: 'Sky TV', category: 'Entertainment' },
  { pattern: 'steamgames', merchant: 'Steam', category: 'Entertainment' },
  { pattern: 'playstation', merchant: 'PlayStation', category: 'Entertainment' },
  { pattern: 'xboxlive', merchant: 'Xbox', category: 'Entertainment' },
  { pattern: 'eventcinemas', merchant: 'Event Cinemas', category: 'Entertainment' },
  { pattern: 'hoyts', merchant: 'Hoyts', category: 'Entertainment' },
  { pattern: 'ticketek', merchant: 'Ticketek', category: 'Entertainment' },

  // Subscriptions
  { pattern: 'netflix', merchant: 'Netflix', category: 'Subscriptions' },
  { pattern: 'spotify', merchant: 'Spotify', category: 'Subscriptions' },
  { pattern: 'youtubepremium', merchant: 'YouTube Premium', category: 'Subscriptions' },
  { pattern: 'icloud', merchant: 'iCloud', category: 'Subscriptions' },
  { pattern: 'googleone', merchant: 'Google One', category: 'Subscriptions' },
  { pattern: 'adobe', merchant: 'Adobe', category: 'Subscriptions' },
  { pattern: 'dropbox', merchant: 'Dropbox', category: 'Subscriptions' },
  { pattern: 'amazonprime', merchant: 'Amazon Prime', category: 'Subscriptions' },
  { pattern: 'openai', merchant: 'OpenAI', category: 'Subscriptions' },

  // Health
  { pattern: 'unichem', merchant: 'Unichem Pharmacy', category: 'Health' },
  { pattern: 'lifepharmacy', merchant: 'Life Pharmacy', category: 'Health' },
  { pattern: 'snapfit', merchant: 'Snap Fitness', category: 'Health' },
  { pattern: 'wwwsna', merchant: 'Snap Fitness', category: 'Health' },
  { pattern: 'lesmills', merchant: 'Les Mills', category: 'Health' },
  { pattern: 'anytimefitness', merchant: 'Anytime Fitness', category: 'Health' },
  { pattern: 'jetts', merchant: 'Jetts Fitness', category: 'Health' },
  { pattern: 'cityfitness', merchant: 'City Fitness', category: 'Health' },

  // Shopping
  { pattern: 'kmart', merchant: 'Kmart', category: 'Shopping' },
  { pattern: 'thewarehouse', merchant: 'The Warehouse', category: 'Shopping' },
  { pattern: 'briscoes', merchant: 'Briscoes', category: 'Shopping' },
  { pattern: 'farmers', merchant: 'Farmers', category: 'Shopping' },
  { pattern: 'mitre10', merchant: 'Mitre 10', category: 'Shopping' },
  { pattern: 'bunnings', merchant: 'Bunnings', category: 'Shopping' },

  // Travel
  { pattern: 'airnz', merchant: 'Air New Zealand', category: 'Travel' },
  { pattern: 'jetstar', merchant: 'Jetstar', category: 'Travel' },
  { pattern: 'bookingcom', merchant: 'Booking.com', category: 'Travel' },
  { pattern: 'airbnb', merchant: 'Airbnb', category: 'Travel' },

  // Insurance
  { pattern: 'amiinsurance', merchant: 'AMI Insurance', category: 'Insurance' },
  { pattern: 'stateinsurance', merchant: 'State Insurance', category: 'Insurance' },
  { pattern: 'tower', merchant: 'Tower Insurance', category: 'Insurance' },
  { pattern: 'aainsurance', merchant: 'AA Insurance', category: 'Insurance' },
  { pattern: 'southerncross', merchant: 'Southern Cross', category: 'Insurance' },

  // Loan repayments
  { pattern: 'loanrepayment', merchant: 'Loan Repayment', category: 'Loan Repayment' },
  { pattern: 'hpirepayment', merchant: 'Loan Repayment', category: 'Loan Repayment' },
  { pattern: 'personalloan', merchant: 'Loan Repayment', category: 'Loan Repayment' },

  // Investing, KiwiSaver, savings products & crypto
  { pattern: 'sharesies', merchant: 'Sharesies', category: 'Investments & Finances' },
  { pattern: 'kernelwealth', merchant: 'Kernel', category: 'Investments & Finances' },
  { pattern: 'hatchinvest', merchant: 'Hatch', category: 'Investments & Finances' },
  { pattern: 'investnow', merchant: 'InvestNow', category: 'Investments & Finances' },
  { pattern: 'simplicity', merchant: 'Simplicity', category: 'Investments & Finances' },
  { pattern: 'smartshares', merchant: 'Smartshares', category: 'Investments & Finances' },
  { pattern: 'superlife', merchant: 'SuperLife', category: 'Investments & Finances' },
  { pattern: 'kiwisaver', merchant: 'KiwiSaver', category: 'Investments & Finances' },
  { pattern: 'milfordasset', merchant: 'Milford', category: 'Investments & Finances' },
  { pattern: 'fisherfunds', merchant: 'Fisher Funds', category: 'Investments & Finances' },
  { pattern: 'generatewealth', merchant: 'Generate', category: 'Investments & Finances' },
  { pattern: 'boosterinvest', merchant: 'Booster', category: 'Investments & Finances' },
  { pattern: 'termdeposit', merchant: 'Term Deposit', category: 'Investments & Finances' },
  { pattern: 'easycrypto', merchant: 'Easy Crypto', category: 'Investments & Finances' },
  { pattern: 'swyftx', merchant: 'Swyftx', category: 'Investments & Finances' },
  { pattern: 'coinbase', merchant: 'Coinbase', category: 'Investments & Finances' },
  { pattern: 'binance', merchant: 'Binance', category: 'Investments & Finances' },

  // Internal transfers, bank fees & interest
  { pattern: 'mbtransfer', merchant: 'Bank Transfer', category: 'Transfers & Fees' },
  { pattern: 'fntransfer', merchant: 'Bank Transfer', category: 'Transfers & Fees' },
  { pattern: 'drint', merchant: 'Overdraft Interest', category: 'Transfers & Fees' },
  { pattern: 'loanadvanced', merchant: 'Loan Advance', category: 'Transfers & Fees' },
  { pattern: 'ird', merchant: 'IRD', category: 'Transfers & Fees' },

  // Cafe & takeaway chains
  { pattern: 'columbuscoffee', merchant: 'Columbus Coffee', category: 'Dining Out' },
  { pattern: 'hellpizza', merchant: 'Hell Pizza', category: 'Dining Out' },
  { pattern: 'muffinbreak', merchant: 'Muffin Break', category: 'Dining Out' },
  { pattern: 'robertharris', merchant: 'Robert Harris', category: 'Dining Out' },

  // Liquor
  { pattern: 'liquorland', merchant: 'Liquorland', category: 'Groceries' },
  { pattern: 'superliquor', merchant: 'Super Liquor', category: 'Groceries' },

  // Shopping
  { pattern: 'adidas', merchant: 'Adidas', category: 'Shopping' },
  { pattern: 'peteralexander', merchant: 'Peter Alexander', category: 'Shopping' },
  { pattern: 'platypusnz', merchant: 'Platypus', category: 'Shopping' },
  { pattern: 'pbtech', merchant: 'PB Tech', category: 'Shopping' },
  { pattern: 'perfumenz', merchant: 'Perfume NZ', category: 'Shopping' },
  { pattern: 'rebel', merchant: 'Rebel Sport', category: 'Shopping' },
  { pattern: 'onceit', merchant: 'Onceit', category: 'Shopping' },
  { pattern: 'sphydroflask', merchant: 'Hydroflask', category: 'Shopping' },

  // Transport (parking, fuel/vehicle admin, rideshare, public transport)
  { pattern: 'nztransportagency', merchant: 'NZ Transport Agency', category: 'Transport' },
  { pattern: 'aavehicletesting', merchant: 'AA Vehicle Testing', category: 'Transport' },
  { pattern: 'limeride', merchant: 'Lime', category: 'Transport' },
  { pattern: 'uber', merchant: 'Uber', category: 'Transport' },

  // Health, beauty & wellbeing
  { pattern: 'nzprotein', merchant: 'NZ Protein', category: 'Health' },
  { pattern: 'nutritionwarehouse', merchant: 'Nutrition Warehouse', category: 'Health' },
  { pattern: 'sportsfuel', merchant: 'Sportsfuel', category: 'Health' },

  // Entertainment
  { pattern: 'mylotto', merchant: 'MyLotto', category: 'Entertainment' },
  { pattern: 'steampurchase', merchant: 'Steam', category: 'Entertainment' },
  { pattern: 'gamepass', merchant: 'Xbox Game Pass', category: 'Entertainment' },
  { pattern: 'ticketmaster', merchant: 'Ticketmaster', category: 'Entertainment' },
  { pattern: 'humblebundle', merchant: 'Humble Bundle', category: 'Entertainment' },
  { pattern: 'chipmunks', merchant: 'Chipmunks Playland', category: 'Entertainment' },

  // Subscriptions
  { pattern: 'googleplay', merchant: 'Google Play', category: 'Subscriptions' },
  { pattern: 'appleservices', merchant: 'Apple', category: 'Subscriptions' },
  { pattern: 'microsoft365', merchant: 'Microsoft 365', category: 'Subscriptions' },

  // Telco (One NZ, the rebrand of Vodafone NZ)
  { pattern: 'onenz', merchant: 'One NZ', category: 'Utilities' },

  // Outdoor/shopping
  { pattern: 'kathmandu', merchant: 'Kathmandu', category: 'Shopping' },

  // Income
  { pattern: 'salary', merchant: 'Salary', category: 'Income' },
  { pattern: 'wages', merchant: 'Wages', category: 'Income' },
  { pattern: 'payroll', merchant: 'Payroll', category: 'Income' },
];
