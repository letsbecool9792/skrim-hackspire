# Skrim on a phone

Skrim runs on Android today, in Firefox. This is what we built, why this route, and what the
other routes would take.

## What works

**Firefox for Android, the same add-on as on a computer.** One codebase, one manifest
(`gecko_android` in `apps/extension/wxt.config.ts`), built with `pnpm --filter @skrim/extension build:firefox`.
Tried on a phone on 2026-10-03 (Firefox 157): installed, opened from the menu, and ran a task
on Wikipedia through the hosted planner.

The one difference is where the chat lives. A computer has a sidebar next to the page; Firefox
for Android has none. So on a phone the toolbar button (Firefox menu → Extensions → Skrim)
opens Skrim as **a tab of its own**, and that tab works on **the tab it was opened from**: the
address carries it, `sidepanel.html?tab=<id>` (`lib/agent/panel-target.ts`). You type the goal
in the Skrim tab, switch to the page to watch, and come back to see each step. If the page's
tab is closed, Skrim says so instead of acting on another tab.

Everything else is unchanged: the page is read, personal data is found and swapped for
placeholders, and the models run on the phone (names, text in images, faces, all WebAssembly,
87 MB). The planner is the hosted one, since the phone cannot reach a laptop's `localhost`.

**Known limit on a phone.** Text that exists only as pixels (a canvas, an image) is read with
OCR from a photo of the screen, and Firefox only photographs the tab on screen, which on a phone
is the Skrim tab while a task runs. So that text is not read, and therefore not sent either:
nothing leaks, the planner just knows less.

## How to install it

- **For testing (no signing):** over USB with `web-ext run -t firefox-android`
  ([`testing.md`](testing.md) section 10). It lasts until Firefox restarts.
- **For anyone:** Firefox for Android installs only add-ons signed by Mozilla. With free AMO API
  keys set as repository secrets ([`deploy.md`](deploy.md) section 3), every release carries a
  signed `skrim-firefox.xpi`, installed from the file (Settings → Install add-on from file). Next
  step: publish it as a listed add-on on addons.mozilla.org, which makes it a one-tap install
  from Firefox's own add-on list.

## Why Firefox, and the other routes

| Route | What it takes | Verdict |
|---|---|---|
| **Firefox for Android extension** | The add-on we already had, plus the panel opening as a tab | **Built.** The only mainstream phone browser that installs any extension |
| Chrome for Android | Chrome on phones runs no extensions at all; Google's extension work on Android targets Chromebooks and tablets | Not possible today |
| Edge for Android | Takes extensions since 2025, but only from a hand-picked list of about 20 | Not open to us |
| Safari on iOS | Safari web extensions, the same WebExtension code, wrapped in an App Store app | Possible later; needs a Mac and Apple's paid developer account |
| An Android app over the accessibility tree | An app can read and act on any app's screen through Android's accessibility service, and that tree has the same shape as our element graph (role, label, text, position, clickable) | Strongest reach (every app, not only the browser), but Google Play bans accessibility apps that plan and act on their own, so it could only be sideloaded |
| A library for agent makers | The pipeline (read the screen's structure, find personal data, swap in placeholders, plan, act) is not tied to a browser: it already runs in Node for the eval and the agent tests | The realistic way to every phone agent: whoever builds the agent builds Skrim in |

"Why does a user have to use Firefox?" On a computer they don't: Skrim is a Chrome extension
too, and Chrome extensions should run in Edge and Brave (untried). On a phone, Firefox is the only browser that
lets anyone install one. That is Google's and Apple's choice, and it is why the core is meant to
be a library as well as an extension.
