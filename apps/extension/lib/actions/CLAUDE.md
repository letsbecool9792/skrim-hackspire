# lib/actions — executing the eight verbs

**Workstream 1.** Takes an `Action` from `@skrim/schema` and makes it happen in the page.

## The eight verbs

`click` `type` `scroll` `select` `navigate` `extract` `wait` `done`

**This list is closed.** Site-agnostic by design (brief §4.6). If a task seems to need a ninth
verb, it almost always decomposes into these. Adding one is a contract change in
`packages/schema` that four other people build against.

## The rules

**Resolve tokens before typing.** A `type` action's `value` may be `<PII:EMAIL:1>`. Look it
up in the vault and type the real string. If resolution fails, abort the step — never type
the literal token into a form. That failure mode is the single most visible way this project
can embarrass itself on stage.

**Enforce `isNavigationAllowed()`.** It is exported from `@skrim/schema`. The server is a
remote machine we do not control; letting it pick an arbitrary destination turns a redaction
bug into an exfiltration channel. Check every time, not once.

**Verify after acting.** The loop is observe → plan → act → **verify**. Did the page
actually change the way the action implied? Re-observe and confirm before the next cycle.
This is what survives unseen websites, and it is where most agents quietly fail — they
assume the click worked and plan the next step against a page that never changed.

**Report failure honestly.** A `StepRecord` with `verified: false` and a short note lets the
model recover. Silently continuing does not.

## Making clicks land

Scroll into view, wait for the element to be stable, dispatch trusted-ish events in the
order a real user produces them (`pointerdown`, `mousedown`, `focus`, `mouseup`, `click`).
Framework-managed inputs frequently ignore a bare `.value =` assignment — set the value and
dispatch `input` and `change` so React and friends notice.

Never dispatch on an element that is `disabled`, zero-size, or covered by an overlay. Check
first and fail the step with a note instead.
