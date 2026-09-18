# NOX-11622 evidence

## Widget route contract

| Widget | Double-tap result |
| --- | --- |
| Chores | `/chores` |
| Tasks | `/tasks` |
| Calendar | `/calendar` |
| Messages | `/messages` |
| Shopping | `/shopping` |
| Meals | `/meals` |
| Photos | `/photos` |
| Wishes | `/wishes` |
| Travel | `/travel` |
| Points | `/goals` (confirmed full Goals & Points page) |
| Birthdays | `/calendar` |
| Clock | No-op; no full-function page |
| Weather | No-op; no full-function page |
| Bus Tracker | No-op; repository has a widget and Settings section, but no standalone page |

The magnified-clone provider and its eight-second auto-collapse path are removed.

## Automated verification

- Widget route and gesture suites: **12/12 passed** across three suites.
- Exhaustiveness: every key in `WIDGET_REGISTRY` is present in `WIDGET_ROUTE_MAP` and is either a route or explicit `null`.
- Touch behavior: one tap preserves the widget control click; two nearby touch taps navigate once; pointer movement, separated taps, Clock/Weather/Bus no-ops, the Night Sky screensaver, and an active Ask NOX overlay do not navigate.
- TypeScript: `tsc --noEmit` passed.
- Production build: `next build` passed (existing repository warnings only).

## Accessibility and responsive verification

- “Back to board” is visible text with an accessible name, `/` target, keyboard focus, and the shared button focus ring.
- Real browser geometry with a coarse pointer at 1920×1080: **217×77 px** on Chores, Tasks, and Travel; no horizontal overflow.
- Source-token contrast for the header link: **17.87:1 light**, **15.85:1 dark** (WCAG 2.1 AA minimum is 4.5:1 for normal text).
- Mobile 390×844-equivalent browser check: no horizontal overflow. The desktop header return action is hidden because the mobile dashboard does not attach the double-tap route gesture; mobile keeps its existing navigation.
- Local preview screenshots are in `local/`. They intentionally exercise layout and focus chrome without production family data; missing local `DATABASE_URL` means they are not functional-data acceptance evidence.

## Kiosk evidence state

- Real-household kiosk captures are intentionally excluded from this public repository. The pre-change capture is retained only in the private Paperclip evidence store.
- Required post-deploy Chores and Tasks functional screenshot sequences remain a release gate. They must be captured from the real kiosk after NOX approves the exact PR head and the auth-wall deployment completes.
