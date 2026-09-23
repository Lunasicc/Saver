import { useCallback, useEffect, useRef, useState } from 'react';

export type PopupState = 'idle' | 'open' | 'returned' | 'blocked';

/**
 * Opens an Akahu page in a popup and reports when the person comes back.
 * Bank logins must happen on Akahu's own site, so the best we can do is keep
 * Saver in view and notice the moment they're done. "Back" means the Saver
 * window regained focus after losing it, or the popup closed while Saver has focus.
 */
export function useAkahuPopup() {
  const [state, setState] = useState<PopupState>('idle');
  const [url, setUrl] = useState('');
  const popupRef = useRef<Window | null>(null);
  const cleanupRef = useRef<() => void>(() => {});

  const stopWatching = useCallback(() => {
    cleanupRef.current();
    cleanupRef.current = () => {};
  }, []);

  useEffect(() => stopWatching, [stopWatching]);

  const open = useCallback(
    (target: string) => {
      stopWatching();
      setUrl(target);
      const width = Math.min(520, window.screen.availWidth - 40);
      const height = Math.min(760, window.screen.availHeight - 60);
      const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
      const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
      const popup = window.open(target, 'saver-akahu', `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
      if (!popup) {
        setState('blocked');
        return;
      }
      popupRef.current = popup;
      popup.focus();
      setState('open');

      let blurred = false;
      const markReturned = () => {
        stopWatching();
        setState('returned');
      };
      const onBlur = () => {
        blurred = true;
      };
      const onFocus = () => {
        if (blurred) markReturned();
      };
      const timer = window.setInterval(() => {
        if (popup.closed && document.hasFocus()) markReturned();
      }, 700);
      // Give up watching after 15 minutes; the manual "I'm done" button still works.
      const giveUp = window.setTimeout(() => stopWatching(), 15 * 60 * 1000);
      window.addEventListener('blur', onBlur);
      window.addEventListener('focus', onFocus);
      cleanupRef.current = () => {
        window.clearInterval(timer);
        window.clearTimeout(giveUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('focus', onFocus);
      };
    },
    [stopWatching]
  );

  const markDone = useCallback(() => {
    stopWatching();
    setState('returned');
  }, [stopWatching]);

  const reset = useCallback(() => {
    stopWatching();
    setState('idle');
  }, [stopWatching]);

  return { state, url, open, markDone, reset };
}
