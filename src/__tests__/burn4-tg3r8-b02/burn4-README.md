# Controlled speech input panel

`Burn4SpeechInputPanel` is an independently mountable client component for the interim chip and voice-language preference described in `docs/features/global-input-system.md` lines 310-311 and 683-684. It imports only React, ReactDOM and its new pure model. It does not mount itself in the application.

```tsx
<Burn4SpeechInputPanel
  visible={true}
  activeTarget={inputElement}
  activeSessionId={sessionId}
  feedback={sessionId ? {
    sessionId,
    target: inputElement,
    isListening: true,
    interimText: partialTranscript,
  } : null}
  language={language}
  languages={[
    { tag: 'en-US', label: 'English' },
    { tag: 'es-MX', label: 'Español' },
  ]}
  onLanguageChange={setLanguage}
  onStop={stopSession}
/>
```

The caller owns the logical input target even while a panel control has focus. Supply a fresh nonempty session ID of at most 128 code units for each utterance. `activeSessionId` is independent of the feedback event; matching it as well as the target prevents delayed results from an older utterance appearing on the same field. Do not reuse IDs during a mounted instance. Pass null while idle. The panel does not construct a recognizer, request microphone access, insert final or interim text, persist settings, or cancel recognition on unmount. The caller handles recognition lifecycle and insertion.

Supply 1 to 100 language choices, each with a valid Intl language tag of 1 to 64 code units and a trimmed nonempty label of at most 80 Unicode code points. Tags canonicalize before uniqueness/selection checks; duplicate canonical tags and a missing selected choice produce a value-free configuration error. Invalid session IDs also produce a configuration error. The native select is disabled while a current session is present; idle changes emit only a different allowed canonical tag. The caller must update the controlled preference to show it.

Feedback is a polite atomic live status and remains plain text. Display is limited to 2000 Unicode code points, with an ellipsis when clipped; controls are stripped except newline and tab. The original transcript is not attached to attributes or saved. Empty partials show a Listening status. Password, unsupported input types, read-only/disabled/inert/hidden targets, and disconnected targets are suppressed. No target discovery, settings reads, browser-language inference, environment-value reads or network requests occur.

The portal uses the supplied target's owner document. Geometry prefers above the target with 8px gap/margins and a maximum width of 360px, falls below when needed, and constrains tall content to a scrollable height. Invalid/offscreen/zero-size geometry is hidden. ResizeObserver, captured scroll and window resize update position; MutationObserver removes feedback when target eligibility changes. Missing ResizeObserver falls back to scroll/resize and content-prop changes. Queued frames, observers and listeners are disposed on hide, replacement and unmount. The component changes no global stylesheet or scroll position.

Stop has a native button, pointer focus retention and Escape support while focus belongs to the target/panel. It calls `onStop(sessionId)` at most once per session, including rapid interactions and hiding/restoring the same session. It does not stop an engine itself. Native controls retain browser focus indicators. No animation requires a reduced-motion override.

Only these explicit synthetic offline suites run. The owned Jest, TS and ESLint configs import no existing repository setup or config. TypeScript checks runtime and tests with strict and noUncheckedIndexedAccess; skipLibCheck is limited to installed declaration files.

```sh
timeout 90s node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r8-b02/burn4-jest.config.cjs --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r8-b02/burn4-model.test.ts src/__tests__/burn4-tg3r8-b02/burn4-panel.test.tsx src/__tests__/burn4-tg3r8-b02/burn4-lifecycle.test.tsx src/__tests__/burn4-tg3r8-b02/burn4-accessibility.test.tsx
timeout 60s node node_modules/typescript/bin/tsc --noEmit --project src/__tests__/burn4-tg3r8-b02/burn4-tsconfig.json
timeout 60s node node_modules/eslint/bin/eslint.js --no-config-lookup --no-ignore --config src/__tests__/burn4-tg3r8-b02/burn4-eslint.config.mjs --max-warnings 0 src/components/input/Burn4SpeechInputPanel.tsx src/components/input/burn4SpeechInputPanelModel.ts src/__tests__/burn4-tg3r8-b02/burn4-model.test.ts src/__tests__/burn4-tg3r8-b02/burn4-panel.test.tsx src/__tests__/burn4-tg3r8-b02/burn4-lifecycle.test.tsx src/__tests__/burn4-tg3r8-b02/burn4-accessibility.test.tsx src/__tests__/burn4-tg3r8-b02/burn4-fixtures.ts src/__tests__/burn4-tg3r8-b02/burn4-jest.config.cjs src/__tests__/burn4-tg3r8-b02/burn4-eslint.config.mjs
```

The suites render React with synthetic DOM targets and use fake rectangles, observers and animation frames. Direct/ancestor hidden and aria-readonly privacy cases also deliver real DOM MutationObserver callbacks without resize or scroll events. They cover plain-text status, Unicode limits, explicit languages, target/session fences, native controls, focus, stop latching, SSR, geometry and complete owned cleanup. No microphone, browser runner, service or application hook is exercised. A browser visual review, app integration, recognizer and persisted `speech.language` remain future integration work. These scope limits are not defect/KNOWN GAP claims.
