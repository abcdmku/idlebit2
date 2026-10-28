import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type UIEvent, type WheelEvent } from 'react';

/** Native touch/trackpad scrolling, mouse dragging and keyboard paging, without a scrollbar. */
export function useQueueSlide(pageWidth: number) {
  const [page, setPage] = useState(0);
  const drag = useRef({ id: -1, x: 0, left: 0, moved: false });
  const finish = (e: PointerEvent<HTMLOListElement>) => {
    if (drag.current.id !== e.pointerId) return;
    drag.current.id = -1;
    const el = e.currentTarget;
    delete el.dataset.dragging;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  return {
    page,
    handlers: {
      onScroll: (e: UIEvent<HTMLOListElement>) => setPage(Math.floor(e.currentTarget.scrollLeft / pageWidth)),
      onPointerDown: (e: PointerEvent<HTMLOListElement>) => {
        drag.current.moved = false;
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        drag.current = { id: e.pointerId, x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
      },
      onPointerMove: (e: PointerEvent<HTMLOListElement>) => {
        const d = drag.current, el = e.currentTarget;
        if (d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 6) return;
        if (!d.moved) { d.moved = true; el.dataset.dragging = ''; el.setPointerCapture(e.pointerId); }
        el.scrollLeft = d.left - dx;
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onClickCapture: (e: MouseEvent<HTMLOListElement>) => {
        if (drag.current.moved) { e.preventDefault(); e.stopPropagation(); }
      },
      onWheel: (e: WheelEvent<HTMLOListElement>) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageWidth : 1);
      },
      onKeyDown: (e: KeyboardEvent<HTMLOListElement>) => {
        const el = e.currentTarget;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault(); el.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * pageWidth });
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault(); el.scrollLeft = e.key === 'Home' ? 0 : el.scrollWidth;
        }
      },
    },
  };
}
