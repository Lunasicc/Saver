// Date helpers that work in the machine's LOCAL calendar.
//
// `new Date().toISOString()` returns UTC. In New Zealand (UTC+12/+13) that is the
// previous calendar day for the whole morning, which made new transactions default
// to yesterday, net-worth snapshots save under the wrong date, and reports open on
// the previous month on the 1st of each month.

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

/** Today in the local calendar as YYYY-MM-DD. */
export function todayLocal(now = new Date()) {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The current month in the local calendar as YYYY-MM. */
export function currentMonthLocal(now = new Date()) {
  return todayLocal(now).slice(0, 7);
}

/** Shifts a YYYY-MM string by `delta` months without any timezone involvement. */
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12;
  return `${pad(year, 4)}-${pad(monthIndex + 1)}`;
}

/** True when `value` is a real calendar date in YYYY-MM-DD form. */
export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

/** True when `value` is a YYYY-MM month string with a valid month number. */
export function isValidMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}
