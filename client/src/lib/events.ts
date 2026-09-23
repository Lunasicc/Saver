/**
 * Cross-page "data changed" signal. Bank sync lives in the top bar, so the page
 * underneath needs a way to know it should refetch.
 */
const EVENT = 'smm:data-changed';

export function notifyDataChanged() {
  window.dispatchEvent(new Event(EVENT));
}

export function onDataChanged(handler: () => void) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
