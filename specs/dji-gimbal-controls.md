# Spec: DJI phone gimbal controls

Status: draft
Owner: VTOKU Cam
Scope: app behavior (iOS/iPadOS). This repo is the website, so this file is an internal
design spec, not user-facing docs. When the feature ships, publish a `docs/` page and link
it from the nav, sitemap, and `llms.txt`.

## Summary

Let a supported DJI phone gimbal drive VTOKU Cam from its physical controls, so the operator
can start and stop a take, ride the lens, and recenter framing without touching the screen.
Adding a real hardware record button also lets us stop hijacking the volume buttons, which frees
them for their real job: riding the audio monitor level.

Two changes, one motivation:

1. Map the gimbal's buttons, joystick, and zoom control to app actions over Bluetooth.
2. Drop "volume buttons start and stop recording." Return the volume buttons to audio monitoring.

## Motivation

- VTOKU Cam is a handheld virtual-production camera. Operators already hold the phone on a
  gimbal for smooth motion. The gimbal moves the phone, ARKit tracks that motion, and the
  virtual camera follows. The gimbal's buttons are right under the operator's fingers and are
  currently doing nothing for us.
- The volume buttons were pressed into service as a record trigger because iOS has no real
  shutter on most devices. That conflicts with monitoring: when the operator listens to program
  or return audio (HDMI out with mic audio, VRL Link "Monitor PC audio", a return feed), they
  need the volume buttons to set the level. A dedicated gimbal record button removes the reason
  we borrowed the volume buttons in the first place.

## Goals

- Pair a supported DJI gimbal and receive its button, joystick, and zoom events.
- Map those events to the app's existing actions (record, lens/FOV, recenter, mode).
- Show gimbal connection state in the UI, and let the operator remap the two general-purpose
  buttons.
- Remove the volume-button record trigger and repurpose the volume buttons for monitoring.

## Non-goals

- Motorized camera moves driven *by the app*. The gimbal moves the phone physically and ARKit
  reads it. We are not commanding the motors to execute programmed moves in v1.
- Drone or Osmo camera support. This is phone gimbals only.
- Focus pulling to the gimbal wheel beyond mapping it to the existing FOCUS dial (see open
  questions).

## Supported hardware

Target the current Osmo Mobile / OM line that pairs to a phone over Bluetooth LE:

- Osmo Mobile 7 / 7P
- DJI OM 6
- DJI OM 5
- DJI OM 4 / OM 4 SE (best effort)

Older gimbals and non-DJI gimbals are out of scope for v1. The app should degrade cleanly: if a
connected gimbal reports a control we do not recognize, ignore that control rather than fail the
whole connection.

> Open question: exact model list depends on what DJI's SDK / Bluetooth profile exposes to a
> third-party app. Confirm against real hardware before we print a compatibility list on the
> site.

## Connection

- Transport: Bluetooth LE. Requires the `Bluetooth` permission (`NSBluetoothAlwaysUsageDescription`).
  Add it to the permissions list in `docs/getting-started.html` when this ships, worded like the
  others ("only used to connect a camera gimbal, nothing is sent to VTOKU").
- Pairing lives under Settings, likely a new `Settings > Gimbal` section: scan, connect, show
  battery and firmware, forget device. Reconnect automatically to a known gimbal on launch.
- State surfaces as a small gimbal glyph in the camera UI: disconnected, connected, low battery.
- Everything stays on device. No gimbal data leaves the phone. Keep this consistent with the
  privacy stance in `privacy.html`.

> Open question: DJI's third-party integration path for phone gimbals (SDK vs. documented BLE
> profile vs. partner program). This gates the whole feature. Resolve before committing an
> engineering estimate.

## Control mapping (v1 defaults)

| Gimbal control            | App action                                                    |
|---------------------------|---------------------------------------------------------------|
| Record / shutter button   | Start and stop recording a take. Long press: toggle streaming.|
| Zoom slider / side wheel  | Lens focal length / FOV (the existing **Lens** control).      |
| Trigger (front)           | Recenter framing. Double-press: re-anchor the avatar stage.   |
| M / mode button           | Cycle a user-set action (default: toggle the **FOCUS** dial). |
| Joystick                  | Pass through to the gimbal motors (physical move). No app map.|

Notes:

- Record button is the headline. It replaces the volume-button trigger and sits alongside the
  on-screen **Record** button and Apple's Camera Control (see `docs/recording.html`).
- The zoom control rides focal length, matching what the on-screen Lens control does. FOV stays
  derived from the device's camera intrinsics; the gimbal zoom just moves the same value.
- The joystick physically pans and tilts the rig. Because the virtual camera follows the phone
  through ARKit, no app-side mapping is needed for it to "move the camera." We only read buttons
  and the zoom control.
- The two general-purpose buttons (Trigger, M) are remappable in `Settings > Gimbal` from a fixed
  list of app actions: record, toggle streaming, recenter, re-anchor, toggle FOCUS, toggle Lens,
  cycle output, none.

## The volume-button change

Current design: pressing a hardware volume button starts and stops recording.

New design: remove that mapping. The volume buttons return to controlling the **audio monitor
level**, the return and program audio the operator is already listening to (HDMI out with mic
audio, VRL Link Monitor PC audio, an NDI/return feed). When there is nothing to monitor, they
pass through to normal iOS system volume.

Why:

- Operators monitoring audio need the volume buttons for their real purpose. A record trigger on
  the same buttons fights that.
- The gimbal record button, the on-screen button, and Camera Control already cover the trigger
  role, so the volume hijack is no longer worth the conflict.

Site impact: none today. The volume-as-record behavior was never documented on the site (grep of
the repo finds no mention of volume-button recording), so there is nothing public to remove. The
record triggers we do document are the on-screen button and Camera Control in
`docs/recording.html`; when the gimbal ships, add it there as a third trigger.

> Open question: should the volume buttons ride the monitor level whenever audio is being
> monitored, or only when the app is foregrounded and a monitor source is active? Default to
> "only while a monitor source is active, else system volume."

## UX summary

- New `Settings > Gimbal`: pair, status (battery, firmware), button remapping, forget.
- Camera UI: a gimbal status glyph next to the existing indicators.
- Haptic or on-screen confirmation when the gimbal record button starts and stops a take, since
  the operator's eyes may be on the subject, not the screen.
- Respect the orientation lock already described in `docs/recording.html`: a gimbal record start
  locks interface orientation for the take just like the on-screen button does.

## Open questions

1. DJI integration path and license terms for third-party phone gimbal control. Blocking.
2. Confirmed model list and which controls each model actually exposes.
3. Does the OM 6 / 7P side wheel map cleanly to FOCUS, or should it stay on zoom with FOCUS on a
   long-press? Decide after hands-on testing.
4. Monitor-level behavior when no monitor source is active (proposed: pass through to system
   volume).
5. Streaming toggle on record long-press, or a dedicated remappable button? Depends on how many
   free buttons a given model has.

## Rollout

- Gate behind a Settings toggle while in beta.
- Ship the volume-button change with, or just before, the gimbal support, so operators are not
  left without the volume trigger and without a gimbal at the same time. If the volume change
  lands first, the on-screen button and Camera Control still cover recording.
- When it ships: add a `docs/gimbal.html` page in the site style, link it from the docs index,
  nav where relevant, `sitemap.xml`, and `llms.txt`, and add the gimbal record button and the
  Bluetooth permission to `docs/recording.html` and `docs/getting-started.html`.
