# Phase 5A Rollback Plan

## Purpose

This plan defines how AHIN would respond if a future Phase 5B preview or micro-transfer review detects unsafe behavior. Phase 5A does not perform live rollback because no live action is executed.

## Immediate Stop Conditions

Stop and rollback planning activates if any of these occur:

```text
unexpected transaction object appears
signing prompt appears outside approved scope
transfer or burn instruction appears unexpectedly
protocol execution flag changes to true
root ahin.io changes unexpectedly
oracle exposes raw upstream payloads
secret or API key appears in response or logs
wallet allowlist mismatch
amount exceeds approved cap
```

## Rollback Actions

```text
pause workflow
record run URL and commit SHA
preserve logs without secrets
disable preview action if needed
restore readonly/mock flags
confirm root ahin.io still serves AHIN Cognitive Network
confirm Cloudflare preview remains isolated
open incident note
require multisig re-approval before retry
```

## Domain Rollback

Root `ahin.io` must not be modified during Phase 5A. If a later phase touches routing, rollback must include:

```text
previous DNS records
previous Cloudflare routing state
previous Pages/Workers bindings
cache purge plan
verification curl commands
operator confirmation
```

## Oracle Rollback

If readonly oracle behavior regresses:

```text
disable deploy path
restore last known readonly commit
verify POST returns 405
verify invalid params return 400
verify no secret exposure
verify no transaction object exposure
```

## Communication

Every rollback note must include:

```text
what changed
what was observed
what was not executed
root domain status
asset movement status
next safe action
```
