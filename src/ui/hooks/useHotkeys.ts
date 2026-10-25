import { useEffect, useRef } from "react";

export type HotkeyMap = Record<string, () => void>;

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Global single-key shortcuts. Keys are matched on `event.key` lowercased
 * (" " for Space). Ignored while typing, with modifiers held, or while a
 * modal dialog owns the keyboard. Space is skipped on focused buttons so it
 * keeps activating them.
 */
export function useHotkeys(map: HotkeyMap) {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat && event.key !== " ") return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;
      // Focused dialogs consume their Escape first. Keep a fallback for an
      // otherwise-unhandled Escape (including a window-level keyboard event).
      if (event.key !== "Escape" && document.querySelector('[aria-modal="true"]')) return;
      const key = event.key.toLowerCase();
      if ((key === " " || key === "enter") && event.target instanceof HTMLButtonElement) return;
      const handler = mapRef.current[key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
