# KYST board theme and rollback

`KYST_THEME=nox|classic` is read on the server for each request, via the dynamic
root layout. It is not a `NEXT_PUBLIC_*` build argument. The same built image
supports both themes. An unset flag selects `nox`; any unrecognized value selects
`classic`. Restart/redeploy the board process after changing its environment and
reload the board to receive the new configuration. Existing tabs keep their
current theme until navigation/reload.

The theme is scoped to the board AppShell. The saved layouts and their font scale,
member identifiers, settings routes, household authentication, and voice handlers
are retained. Classic uses the existing wallpaper and widget caps. NOX uses local
fonts from the approved mock, opaque gradient cards, full scrolling lists, and
two static SVG star layers animated only through CSS transform/opacity. Motion
pauses while the screensaver is active, while the document is hidden, and under
`prefers-reduced-motion: reduce`. Card fade masks depend on actual scroll bounds.

## Release gate

This branch is based on `feature/kyst-auth-wall`, the deployed KYST integration
branch. The repository uses `master` for upstream; it has no `main` ref in the
remote branch enumeration taken on September 11. Do not merge this work into or
deploy from upstream `master`: the household auth wall must remain present.
NOX reviews the final PR before merge and separately before production deployment.

Before merge, record the exact current auth-wall integration head and tag it:

```bash
git fetch origin feature/kyst-auth-wall
git rev-parse origin/feature/kyst-auth-wall
git ls-remote --tags origin refs/tags/pre-nox-theme
# Only if absent; never overwrite an existing rollback tag.
git tag -a pre-nox-theme origin/feature/kyst-auth-wall -m 'KYST before NOX theme'
git push origin refs/tags/pre-nox-theme
```

The task's phrase "tag on main" means the production integration base here. NOX
must verify that interpretation before creating the tag. No tag is created by
this draft. Record the tag SHA, release version, and auth-wall image digest in
the release review. Re-read live state immediately before cutover.

## Flag rollback (same reviewed auth-wall image)

Use the existing approved Fly credential channel and deployment config. `fly.toml`
below is the existing KYST board config, not a newly generated or upstream one.
Save the current image reference and releases before deploying:

```bash
flyctl image show -a kyst-board
flyctl releases -a kyst-board --image
```

Deploy the same reviewed auth-wall image with the desired runtime flag:

```bash
flyctl deploy -a kyst-board -c fly.toml --image "$KYST_REVIEWED_AUTH_WALL_IMAGE" \
  --env KYST_THEME=classic --strategy rolling
# Re-enable the approved theme after NOX review:
flyctl deploy -a kyst-board -c fly.toml --image "$KYST_REVIEWED_AUTH_WALL_IMAGE" \
  --env KYST_THEME=nox --strategy rolling
```

Keep the chosen flag in the deployment configuration for subsequent source deploys.
If a Fly secret named KYST_THEME is already configured, reconcile that source before
cutover so it cannot override the non-secret env flag. Do not rotate household
credentials as part of a theme rollback.

## Previous-image rollback

Use `flyctl releases -a kyst-board --image` to select the recorded previous
**auth-wall** image, then deploy it without modifying the database:

```bash
flyctl deploy -a kyst-board -c fly.toml --image "$KYST_PREVIOUS_AUTH_WALL_IMAGE" \
  --strategy rolling
```

Never use the historical vanilla `ghcr.io/sandydargoport/prism` rollback example
in the original household-auth document: it removes the household wall. The
installed CLI exposes releases as a list command, not `releases rollback`.

For either rollback, verify public health, 401 on unauthenticated household data,
200 on an authenticated read, and a read-only real-kiosk screenshot. No kiosk
configuration, browser, task, Windows, voice pipeline, or listener changes are
part of this release. Any board reload needed for a real-kiosk theme proof must
respect Cameron's permitted screenshot-only lane.

## Current implementation boundary

On September 12, Cameron selected **restyle existing widgets; defer extra panels**
in the board-scope interaction. This release preserves Calendar, Clock, Weather,
Tasks, Chores, Points, and Family Messages. Happening Now, separate schoolwork
lanes, and docked Ask NOX are deferred. Their 90px/156px mock geometry is not a
release target; saved grid geometry and fontScale=150 remain untouched.

The approved mock supplies the palette, fonts, cards, and scrolling treatment.
The NOX body scale uses 22px primary rows / 16px metadata at 1920px, scales
to 44px / 32px at 3840px for the hallway display, and uses 18px / 14px at
tablet widths. The existing mobile summary layout is preserved. Long content wraps into scrollable card bodies. Narrow weather cards scroll
vertically to retain all metrics. The 44px emblem/wordmark also appears above
the existing mobile summary cards.
Parker uses cyan and Sawyer pink for the existing avatar, task, goal, and agenda
indicators. This is a rendering-only mapping: original member IDs, colors, data,
filters, and edit payloads remain intact. Agenda lane names resolve through each event's group ID; unknown groups retain
the original source color. Family calendar markers use the mock brass token,
reserving amber for temporal emphasis. Classic retains its original palette and type scale.

Local browser screenshots and measurements are development evidence only. They
do not substitute for the required post-deploy real-kiosk evidence. The current `kiosk_agent.py` argparse commands do not include `screenshot`, but
the original mock brief documents the existing NoxAgent screenshot queue:
`{"cmd":"screenshot","file":"<unique-name>.png"}` in `C:/NoxAgent/queue/`, with the
result fetched from `C:/NoxAgent/media/`. Use only that screenshot lane; the generic
`deliver()` helper also reconciles old queue/media files, so it is not a strictly
screenshot-only operation.

The September 11 16:13:22 UTC capture through that lane succeeded and showed a
black Windows desktop with Recycle Bin, not the board. NOX must resolve the proof
path under the existing hold; no browser refresh/start, scheduled task, or Windows
change was attempted. The captured desktop is evidence of the observed screen,
not evidence about which processes are running.

## Kiosk overflow correction (September 13)

The NOX stretch dashboard uses fixed viewport insets and a flex-sized grid below
its header. This avoids multiplying a viewport-sized height by the saved layout
zoom again (at 150%, a 1440px viewport previously produced a 2160px board).
The saved `fontScale`, widget coordinates, type tokens, and card scroll regions
remain in use. Clock type is additionally bounded by its own card's width and
height so the time, including seconds, stays on one line. The fit rules apply
only to the NOX stretch dashboard and its explicitly sized measurement preview
at desktop/tablet widths. Classic, mobile, ordinary editing, and contain-mode
layouts retain their existing layout rules.

Run `scripts/check-kyst-viewport.mjs` against NOX and classic loopback instances
of the same build to verify 100% and 150% scaling at 1024, 1920, 2560, and 3840px.
The check recreates the server zoom wrapper explicitly: a disconnected preview
DB otherwise silently falls back to 100%. It checks every widget's visible
bounds and saved grid area, the longest clock time, keyboard scrolling, and
screensaver motion pause. Classic is a rendering regression check, not a claim
that its inherited zoom overflow was fixed.

Release v30 and the `pre-nox-theme` tag were executed by MAIN NOX on September 12.
Do not repeat that source operation. Any correction must use the existing
auth-wall integration path, with NOX review before merge and production release.
The latest observation disposition makes MAIN NOX the kiosk operator: Prism
supplies the reviewed release/digest, then NOX captures front, scrolled, and
screensaver-wake states through the existing lane. This does not grant Prism
kiosk control. Real-kiosk geometry, motion, frame-time, touch, and 3m legibility
remain acceptance evidence; local checks are development evidence.

The viewport scope is explicit. LayoutGridEditor's non-editable branch emits
`kyst-board-display-grid`; its measurement branch emits `kyst-board-measure-frame`
and `kyst-board-measure-grid`. The measurement frame supplies the flex sizing
chain for its nested grid, so preview intentionally shares the stretch board's
fit and clock treatment. Ordinary editing, contain-mode, classic and mobile
remain outside these additions. Every new clock/tablet/widget rule requires
one of those two grid markers and stretch mode.
`scripts/check-kyst-display-scope.mjs` uses synthetic parent/session fixtures on
loopback to exercise editor → measurement → chrome toggles → editor → Cancel
at 100%/150%, plus a portrait contain layout. It records actual bounds and
keyboard-operable exit controls and rejects all API writes.
