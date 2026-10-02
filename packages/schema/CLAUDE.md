# packages/schema — THE CONTRACT

Imported by the extension, the server, and the eval harness. **Changing anything here
changes something four other people are building against.**

## Why this package exists

If the client and server disagree about the wire format, the failure mode is the agent typing
`<PII:EMAIL:1>` into a form on stage, or an action addressed at an element id that means
something else. Putting the contract in one typed place makes that a compile error instead.

## The rules

**Dependencies point inward.** This package may import `zod` and nothing else from the
workspace. No app imports, no `@skrim/shared`. `pnpm check` enforces it.

**No Node APIs in runtime code.** The extension imports this into a browser. `tsconfig.json`
sets `"types": []` deliberately; tests get Node types from `tsconfig.test.json`.

**Every change needs a test.** `src/contract.test.ts` is what stops a well-meaning refactor
from silently changing the wire format. If you add a field, add a case.

**Announce changes.** A PR touching this package should say so in the title and name what
downstream code needs updating. Do not slip a contract change into a feature PR.

## What lives here

| File | Contents |
|---|---|
| `pii.ts` | `PiiToken` (`<PII:EMAIL:1>`), categories, format/parse helpers |
| `element.ts` | `ScreenElement`, roles, states, bounding boxes, element ids |
| `graph.ts` | `ScreenGraph`, `SanitizedUrl`, `RedactionManifest`, `sanitizeUrl()` |
| `action.ts` | The eight verbs, `isNavigationAllowed()` |
| `protocol.ts` | `PlanRequest` / `PlanResponse` — the HTTP contract |
| `guard.ts` | `assertOutboundSafe()` — the last-resort PII tripwire |

## Two things that look small and are not

**`formatPiiToken()` is the only sanctioned way to build a token.** Hand-writing the string
somewhere means the format now lives in two places, and one of them will drift.

**`guard.ts` must never false-positive.** It throws, so a false positive breaks the demo just
as thoroughly as a leak. It only matches the unmistakable: emails, Luhn-valid cards, PAN,
international phone numbers. Bare 10- and 12-digit patterns are absent on purpose — they
collide with order numbers constantly. Catching everything is the detector's job in
`apps/extension/lib/pii`; this is the tripwire.

```powershell
pnpm --filter @skrim/schema test
```
