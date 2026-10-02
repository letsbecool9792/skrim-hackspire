# lib/vault — the token vault

**Workstream 3.** The single most security-sensitive directory in the repo.

## What this is

A map from PII tokens to the real values they replaced.

```
<PII:EMAIL:1>  ->  suparno@example.com
```

The server plans over tokens and hands them back in actions. This module resolves them so
the client can type the real string into the real field. That is what makes redaction
*referential* rather than destructive, and it is the clause most teams skim past
(brief §4.3 and §6).

## The rules

**IN-MEMORY ONLY.** A plain `Map` in the side panel's memory, where the agent loop runs
(`lib/agent/loop.ts` creates one per task). No `chrome.storage`,
no `localStorage`, no `IndexedDB`, no cache, no writing to disk under any circumstances.
`pnpm check` fails the build if you try. This is the whole claim.

**Scoped to one task.** The vault is created when a task starts and wiped when it ends, is
cancelled, or the side panel closes. A token from a previous task must not resolve.

**Never serialise it.** Not into a log, not into a message to the dashboard, not into an
error. If you need to show the vault's state, send counts and categories — never values.

**Never send it anywhere.** It does not go to the server. It does not go to the dashboard.
It does not leave the side panel, except as the one resolved value a `type` action types.

## What good looks like

- `set(category, realValue) -> PiiToken` — allocates the next index for that category
- `resolve(token) -> string | undefined` — returns undefined for unknown tokens, never throws
- `clear()` — called on task end, tab close, and cancel
- `stats() -> { EMAIL: 2, PHONE: 1 }` — counts only, safe to log and display

Reuse the same token for the same value within a task. If an email appears in three fields,
all three should be `<PII:EMAIL:1>` — the server can then reason that they are the same
thing, which it genuinely needs to do on forms.

Use `formatPiiToken()` from `@skrim/schema`. Never build the token string by hand.

## The demo depends on this working

Beat 4 is: open devtools, show the outgoing request body containing `<PII:EMAIL:1>`, then
show the real email correctly filled on the page. Lossless redaction, demonstrated rather
than asserted. If resolution is flaky, that beat dies.
