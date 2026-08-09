# Chrome Web Store submission kit

True one-click install ("Add to Chrome") only exists through the Web Store —
Chrome blocks every other install path. Publishing also gets users automatic
updates, which retires the zip + reload dance for good.

## One-time setup (only you can do this)

1. Register as a Chrome Web Store developer (uses your Google account,
   one-time $5): https://chrome.google.com/webstore/devconsole
2. **New item** → upload the zip (`hotkeys-extension.zip`, built from this
   folder — it already contains the required icons).
3. Paste the listing text below, answer the privacy questions as listed,
   submit for review. A tiny extension like this typically clears review in
   1–3 days.
4. When it's live, swap the advisor's download section for the store link —
   the button becomes real one-click.

## Listing text

**Name:** Astrogem Advisor Hotkeys

**Summary (132 chars max):**
Global hotkeys for the loseii.com Astrogem Advisor — read your screen and get
advice without alt-tabbing out of Lost Ark.

**Description:**
Companion to the free Astrogem Calculator at www.loseii.com/loa-astrogem-calc.

Adds two system-wide hotkeys that work while Lost Ark keeps focus:
• Ctrl+Shift+1 — Read screen now (grab a frame from the shared game screen,
  parse it, show advice)
• Ctrl+Shift+2 — Get advice (solve the current Processing window)

Each press flashes its result at the top of the advisor page, and the
advisor's buttons show the current key bindings. Rebind the keys at
chrome://extensions/shortcuts.

You still click "Share game screen" once per session — browsers require a
real click to start a screen share; everything after that is hotkey-only.

Open source: https://github.com/shizukaziye/loastuff/tree/main/loa-astrogem-calc/hotkeys-extension

**Category:** Tools · **Language:** English

## Privacy tab answers

- **Single purpose:** Trigger two buttons on the loseii.com Astrogem Advisor
  page via global keyboard shortcuts.
- **Permission justifications:**
  - `scripting` + host permissions: press the advisor page's own Read/Get
    advice buttons when a hotkey fires. The extension runs on no other sites.
  - `commands (global)`: the hotkeys must work while the game has focus —
    that is the entire point of the extension.
- **Data use:** collects nothing, stores nothing, transmits nothing. All
  checkboxes "no". No remote code.

## Assets the store asks for

- Icon 128×128: `icons/icon128.png` (in the zip)
- At least one 1280×800 screenshot: take the advisor page with the hotkey
  toast showing (press a hotkey, screenshot within 2s).
