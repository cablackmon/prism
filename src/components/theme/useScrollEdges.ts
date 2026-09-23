'use client';

import { useEffect, type RefObject } from 'react';

/** Measure only on content/size changes or scroll, never on animation frames. */
export function useScrollEdges(ref: RefObject<HTMLElement>, enabled: boolean, label: string) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    const cleanups: (() => void)[] = [];
    const attached = new Set<HTMLElement>();
    const attach = () => {
      root
        .querySelectorAll<HTMLElement>(
          '[data-radix-scroll-area-viewport], .overflow-auto, .overflow-y-auto, [data-board-scroll]'
        )
        .forEach((el) => {
          if (attached.has(el)) return;
          attached.add(el);
          const previous = {
            tab: el.getAttribute('tabindex'),
            role: el.getAttribute('role'),
            label: el.getAttribute('aria-label'),
          };
          el.classList.add('kyst-scroll');
          const update = () => {
            const overflows = el.scrollHeight > el.clientHeight + 1;
            el.dataset.moreBelow = String(
              overflows && el.scrollTop + el.clientHeight < el.scrollHeight - 2
            );
            el.tabIndex = overflows ? 0 : -1;
            if (overflows) {
              el.setAttribute('role', 'region');
              el.setAttribute('aria-label', label + ' — scroll for more');
            } else {
              el.removeAttribute('role');
              el.removeAttribute('aria-label');
            }
          };
          const resize = new ResizeObserver(update);
          resize.observe(el);
          // Observe child content too: viewport height can stay constant as lists grow.
          const observeChildren = () => {
            Array.from(el.children).forEach((child) => resize.observe(child));
            update();
          };
          const content = new MutationObserver(observeChildren);
          content.observe(el, { childList: true, subtree: true, characterData: true });
          observeChildren();
          el.addEventListener('scroll', update, { passive: true });
          cleanups.push(() => {
            resize.disconnect();
            content.disconnect();
            el.removeEventListener('scroll', update);
            el.classList.remove('kyst-scroll');
            delete el.dataset.moreBelow;
            for (const [key, value] of Object.entries({
              tabindex: previous.tab,
              role: previous.role,
              'aria-label': previous.label,
            })) {
              if (value === null) el.removeAttribute(key);
              else el.setAttribute(key, value);
            }
          });
        });
    };
    attach();
    const mutation = new MutationObserver(attach);
    mutation.observe(root, { childList: true, subtree: true });
    return () => {
      mutation.disconnect();
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [ref, enabled, label]);
}
