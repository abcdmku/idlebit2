import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'button:not(:disabled), summary, [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)';

const controls = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
  .filter(element => {
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS' && !parent.hasAttribute('open') && parent.querySelector(':scope > summary') !== element) return false;
    }
    return true;
  });

/**
 * Modal keyboard contract: focus moves into the dialog once on open, Tab is
 * contained, Escape closes, and focus returns to the opener on close.
 *
 * `onClose` is read through a ref so the effect runs exactly once per mount.
 * The sim re-renders ~100x a second; an effect keyed on a fresh callback would
 * yank focus back to the first control on every tick.
 */
export function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const initial =
      initialFocusRef?.current ?? (dialog && controls(dialog)[0]) ?? dialog;
    initial?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      const root = dialogRef.current;
      if (!root) return;
      // Only the topmost dialog handles keys; a nested one owns them while open.
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      if (dialogs.length > 0 && dialogs[dialogs.length - 1] !== root) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = controls(root);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
    // Mount-only by design; see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
