# V1 Field Technician and Offline Behavior

## Goal

Keep the field experience fast on a phone even when connectivity is weak.

The first build is a responsive/PWA-capable web experience; it does not require separate native iOS/Android code.

## Field navigation

Primary bottom/compact navigation:

- Today
- Route
- Time
- Tickets
- Profile

Opening a route stop takes the technician directly to the job surface.

## Job card priorities

Always-visible information:

- customer/location name
- address
- access instructions
- safety flags
- Industry Pack asset summary
- service type
- expected duration
- special notes
- primary action

Do not expose office-only notes or unnecessary billing data.

## Field actions

Supported:

- en route
- start
- pause
- complete
- skip
- flag issue/needs return
- add note
- add photo/file
- submit checklist/form
- capture signature
- record materials
- collect payment when allowed
- open ticket

## Offline-tolerant operations

Queue locally when network is unavailable:

- status transitions that are safe to reconcile
- notes
- checklist/form responses
- photo metadata/upload intents
- mileage/time events
- material usage
- ticket draft/comments

Each queued mutation receives:

- local client operation ID
- entity ID
- expected prior state/version when relevant
- local timestamp

## Reconciliation

On reconnect:

1. send queued operations in causal order
2. server validates authorization/current state
3. idempotency prevents duplicate application
4. success removes local queue item
5. conflict surfaces a clear technician resolution state

Do not silently overwrite office changes.

## Conflict examples

If office cancels a job while technician was offline and technician later attempts completion:

- do not automatically convert canceled -> completed
- preserve technician evidence/draft
- show conflict
- allow authorized office review

## Media

When offline:

- capture photo locally
- associate with local queued operation
- upload when online
- mark job completion as pending sync when required proof has not reached server

UI clearly distinguishes:

- completed on device, syncing
- fully synced
- sync failed

## Time tracking

Clock in/out should work with local event queue when disconnected.

Server records:

- device-reported timestamp
- server-received timestamp
- source
- any detected anomaly

Managers can review unusual long-offline corrections.

## Route cache

Before/while route is available, cache enough information for assigned work:

- ordered stops
- addresses
- relevant customer/location details
- access/safety notes
- forms
- service instructions

Sensitive cached data should be limited to currently assigned work and cleared/expired appropriately.

## PWA

V1 should be installable as a PWA where browser support permits:

- app manifest
- appropriate icons/placeholders
- service worker/offline shell
- mobile viewport
- standalone display behavior

Native push notification support is optional; outbound SMS/email is sufficient for V1 communication requirements.
