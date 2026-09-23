export function formatMoney(value: number, currency = 'NZD') {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency }).format(value);
}

/** Whole-dollar money for headline figures where cents are noise. */
export function formatMoneyWhole(value: number, currency = 'NZD') {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

/** Compact axis labels: $1.2k, $15k. */
export function formatMoneyCompact(value: number) {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** Signed amount for transaction feeds: "+$120.00" for money in, "$45.00" for money out. */
export function formatSigned(value: number, currency = 'NZD') {
  const abs = formatMoney(Math.abs(value), currency);
  return value > 0 ? `+${abs}` : abs;
}

/**
 * Recharts passes tooltip values as `ValueType | undefined` (string | number | array),
 * so formatters must accept the loose type and coerce safely.
 */
export function formatMoneyValue(value: unknown) {
  const numeric = Array.isArray(value) ? Number(value[0]) : Number(value);
  return Number.isFinite(numeric) ? formatMoney(numeric) : '—';
}

export function formatDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(y, m - 1, d)
  );
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

/**
 * Today in the LOCAL calendar as YYYY-MM-DD.
 *
 * `toISOString()` returns UTC, which in New Zealand (UTC+12/+13) is still
 * yesterday for the whole morning — that made new transactions default to the
 * wrong day and reports open on the previous month on the 1st.
 */
export function today(now = new Date()) {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function currentMonth(now = new Date()) {
  return today(now).slice(0, 7);
}

export function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-NZ', { month: 'short', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

export function monthLong(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-NZ', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

export function monthShort(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-NZ', { month: 'short' }).format(new Date(y, m - 1, 1));
}

/** Calendar-safe month arithmetic on YYYY-MM strings (never overflows on the 31st). */
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** First and last day of a YYYY-MM month, for from/to query params. */
export function monthRange(month: string) {
  return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(month))}` };
}

/** "Today", "Yesterday", or "Mon 22 Sep" for grouping a transaction feed by day. */
export function dayLabel(iso: string, now = new Date()) {
  const todayIso = today(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (iso === todayIso) return 'Today';
  if (iso === today(yesterday)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === now.getFullYear();
  return new Intl.DateTimeFormat('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** "just now", "5 min ago", "3h ago", "2 days ago", then a date. */
export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'never';
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short' }).format(new Date(then));
}