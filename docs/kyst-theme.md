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

The live default layout read from `/api/layouts` on September 11 contains Calendar,
Clock, Weather, Tasks, Chores, Points, and Family Messages. The approved mock also
shows a Happening Now hero, schoolwork lanes, and a docked Ask NOX panel. The current
auth-wall source does not implement these as widgets; the microphone is an overlay.
The draft preserves the live information architecture and implements the shared
visual foundation. NOX must reconcile that difference before this can claim mock
v2 acceptance, the 90px hero/156px strip geometry, or production readiness.

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
