---
title: Skrim planner
colorFrom: green
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: isc
short_description: Plans browser actions from redacted pages. Sees no personal data.
---

The planning server for [Skrim](https://github.com/letsbecool9792/skrim-hackspire), a browser
agent that never shows the server your data. It receives a page's structure with every private
value replaced by a placeholder, and returns one action. It stores nothing and logs counts only.

`GET /` says which model plans. `POST /plan` is what the extension calls.
