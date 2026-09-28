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

// Towns and suburbs NZ banks commonly append to card descriptions, often with no
// space ("ACME FUELSCHRISTCHURCH"). Stripped from place names so visits to the
// same business group together and read cleanly.
const PLACE_SUFFIXES = [
  'christchurch', 'auckland', 'wellington', 'hamilton', 'tauranga', 'dunedin', 'napier', 'hastings',
  'nelson', 'rotorua', 'palmerstonnorth', 'palmerston', 'newplymouth', 'whangarei', 'invercargill',
  'queenstown', 'wanaka', 'timaru', 'ashburton', 'blenheim', 'gisborne', 'whanganui', 'taupo', 'masterton',
  'porirua', 'lowerhutt', 'upperhutt', 'petone', 'takapuna', 'albany', 'manukau', 'newmarket', 'ponsonby',
  'lincoln', 'rolleston', 'halswell', 'riccarton', 'hornby', 'papanui', 'sydenham', 'addington', 'merivale',
  'shirley', 'kaiapoi', 'rangiora', 'wigram', 'belfast', 'northlands', 'sumner', 'ferrymead', 'woolston',
  'henderson', 'manurewa', 'papakura', 'botany', 'sylviapark', 'glenfield', 'northcote', 'onehunga', 'parnell',
  'mtwellington', 'karori', 'johnsonville', 'kilbirnie', 'tawa', 'paraparaumu', 'frankton', 'mosgiel', 'richmond',
];
const SMALL_WORDS = new Set(['the', 'and', 'of', 'for', 'at', 'on', 'in', 'to']);

function stripTrailingPlace(words) {
  const last = words[words.length - 1];
  const lower = last.toLowerCase().replace(/[^a-z]/g, '');
  if (words.length > 1 && PLACE_SUFFIXES.includes(lower)) return words.slice(0, -1);
  // A truncated town at the very end, e.g. "INVERCA" for Invercargill.
  if (words.length > 1 && lower.length >= 7 && PLACE_SUFFIXES.some((p) => p.startsWith(lower) && p !== lower)) {
    return words.slice(0, -1);
  }
  for (const place of PLACE_SUFFIXES) {
    if (lower.length > place.length + 2 && lower.endsWith(place)) {
      const kept = last.slice(0, last.length - place.length).replace(/[\s\-,.]+$/, '');
      if (/[a-z]{3}/i.test(kept)) return [...words.slice(0, -1), kept];
    }
  }
  return words;
}

/**
 * Readable business name for summaries like "Top places": drops reference
 * numbers, store codes and appended towns, removes a repeated payee
 * ("ASB Insurance ASBInsurance99…" → "ASB Insurance") and softens ALL CAPS.
 */
export function tidyPlaceName(raw) {
  const base = deriveMerchantName(raw);
  let words = base
    // Payment processors that front the real business name.
    .replace(/^(debitsuccess|ezidebit|windcave|paymark|paypal\s*\*|sq\s*\*|sp\s*\*)\s*/i, '')
    .split(' ')
    // Reference numbers and store codes: "ASBInsurance99…" → "ASBInsurance", "LEEMING3J" → "LEEMING".
    .map((w) => {
      if ((w.match(/\d/g) || []).length >= 5) {
        const lead = w.match(/^[a-z]+/i)?.[0] ?? '';
        return lead.length >= 4 ? lead : '';
      }
      return w.replace(/^([a-z]{4,})\d{1,3}[a-z]{0,2}$/i, '$1');
    })
    .filter(Boolean);
  if (words.length > 1) {
    const last = words[words.length - 1].toLowerCase();
    const before = normalizeForMatch(words.slice(0, -1).join(''));
    if (last.replace(/[^a-z0-9]/g, '') === before) words = words.slice(0, -1);
  }
  for (let i = 0; i < 2 && words.length > 0; i++) {
    const next = stripTrailingPlace(words);
    if (next === words) break;
    words = next;
  }
  let name = words.join(' ').trim();
  if (!name) return base;
  if (!/[a-z]/.test(name)) {
    // Short tokens stay as initials (BP, KFC, ASB); everything else becomes Title Case.
    name = name
      .split(' ')
      .map((w, i) => {
        const lower = w.toLowerCase();
        if (SMALL_WORDS.has(lower)) return i === 0 ? w.charAt(0) + lower.slice(1) : lower;
        if (w.length <= 3 && (i === 0 || !/[AEIOU]/.test(w))) return w;
        return w.charAt(0) + lower.slice(1);
      })
      .join(' ');
  }
  return name;
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
  { pattern: 'meridian', merchant: 'Meridian Energy', category: 'Utilities' },
  { pattern: 'slingshot', merchant: 'Slingshot', category: 'Utilities' },
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
  { pattern: 'asbinsurance', merchant: 'ASB Insurance', category: 'Insurance' },
  { pattern: 'westpacinsurance', merchant: 'Westpac Insurance', category: 'Insurance' },
  { pattern: 'kiwibankinsurance', merchant: 'Kiwibank Insurance', category: 'Insurance' },
  { pattern: 'anzinsurance', merchant: 'ANZ Insurance', category: 'Insurance' },
  { pattern: 'partnerslife', merchant: 'Partners Life', category: 'Insurance' },
  { pattern: 'fidelitylife', merchant: 'Fidelity Life', category: 'Insurance' },
  { pattern: 'nibnz', merchant: 'nib', category: 'Insurance' },
  { pattern: 'cignalife', merchant: 'Cigna', category: 'Insurance' },

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
  { pattern: 'whitcoulls', merchant: 'Whitcoulls', category: 'Shopping' },

  // Travel
  { pattern: 'rentalcars', merchant: 'Rentalcars.com', category: 'Travel' },

  // Income
  { pattern: 'salary', merchant: 'Salary', category: 'Income' },
  { pattern: 'wages', merchant: 'Wages', category: 'Income' },
  { pattern: 'payroll', merchant: 'Payroll', category: 'Income' },
];
