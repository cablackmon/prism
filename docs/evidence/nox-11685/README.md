# NOX-11685 Phase 2 preview evidence

This evidence covers the board tap-to-talk implementation before deployment. The Pipecat
service stayed inactive and the live legacy service was not changed while these captures
were made.

## Visual baseline and after states

- Baseline: `../nox-11593/desktop-answer.png` and `../nox-11593/mobile-answer.png` show the
  prior upload-and-poll overlay.
- After, desktop Chromium at 1920x1080: `desktop-idle.png`, `desktop-listening.png`, and
  `desktop-answer.png`.
- After, phone Chromium at 390x844: `mobile-idle.png`, `mobile-listening.png`, and
  `mobile-answer.png`.

The capture uses deterministic local API, microphone, WebSocket, and audio fixtures. It
exercises the production UI state machine without opening the tailnet socket or changing a
deployed service. Run it against a local preview with:

```sh
PRISM_URL=http://127.0.0.1:33185 npx tsx scripts/capture-voice-v2.ts
```

## Accessibility and responsive results

- Desktop 1920x1080 and phone 390x844: 2/2 viewport audits passed.
- Persistent mic target: 56x56 CSS pixels in both test contexts, with a visible 4px focus
  ring. The existing responsive root sizing makes it larger on the coarse-pointer Acer
  layout.
- Close target: 44x44 CSS pixels.
- Answer contrast: 15.65:1 against the voice panel in both viewports (WCAG 2.1 AA pass).
- Live state: `role="status"`, `aria-live="polite"`, and `aria-atomic="false"` expose
  incremental transcript and answer text.
- Keyboard order: Close voice assistant -> Interrupt and ask NOX; reverse traversal returns
  to Close voice assistant.
- Motion: the established `motion-reduce` variants disable the mic pulse, meter transitions,
  and thinking animation.
- Mobile placement clears the bottom navigation/floating action area; desktop placement
  remains bottom-right and unobtrusive.

## Established tokens and patterns

The overlay reuses the existing `bg-primary`, `text-primary-foreground`, `bg-card`,
`text-card-foreground`, `text-muted-foreground`, `border-border`, and `ring-ring` theme
tokens. Spacing, radii, shadows, safe-area insets, and responsive breakpoints remain in the
existing Tailwind system; no new visual token or color was introduced.

## Automated verification

- Focused Jest: 12/12 passed across the same-origin ticket relay, WebSocket transport,
  PCM conversion, active-turn isolation, action/playback acknowledgements, live
  transcript/answer output, server-VAD auto-stop, silent-turn recovery, dismiss, and
  second-tap stop behavior.
- TypeScript: `npm run type-check` passed.
- Changed-file lint: passed with 0 warnings and 0 errors.
- Production build: `npm run build` passed. Existing repository-wide lint and Browserslist
  warnings remain outside this slice.

Real Acer, live tailnet, live speech latency, and Cameron phone acceptance are deliberately
not claimed here. They require the next gated deployment/activation step.
