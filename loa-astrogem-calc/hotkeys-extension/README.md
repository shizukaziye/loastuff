# Astrogem Advisor global hotkeys

Press hotkeys **while Lost Ark has focus** — no alt-tab:

| Key | Does |
|---|---|
| `Ctrl+Shift+1` | 📷 Read screen now (grab + parse + auto-advice) |
| `Ctrl+Shift+2` | Get advice (solve + save the reading) |

## Install (once, ~30 seconds)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this folder (`loa-astrogem-calc/hotkeys-extension`)

## Use

1. Open the advisor and click **🖥 Share game screen** once per session —
   the browser requires a real click in the focused tab to start a share,
   so this one step can't ride a hotkey. Pick the Lost Ark window.
2. Play. `Ctrl+Shift+1` each turn; the game keeps focus the whole time.

The extension's toolbar badge flashes feedback: **✓** fired · **⏳** busy
(solve already running) · **✗** no advisor tab open, or not sharing yet.

## Maintainer note

The site serves this folder as `../hotkeys-extension.zip` (linked from the
advisor's hotkeys section). After editing any file here, rebuild it:

```powershell
Compress-Archive -Path manifest.json,sw.js,announce.js,README.md,icons -DestinationPath ..\hotkeys-extension.zip -Force
```

For the one-click Chrome Web Store path, see `store/LISTING.md`.

## Notes

- Rebind the keys at `chrome://extensions/shortcuts` — Chrome only allows
  `Ctrl+Shift+<digit>` for **global** (works-when-unfocused) commands.
- The game never sees the keystroke — Chrome registers the hotkey with
  Windows, which intercepts it first.
- Works with the tab on a second monitor (recommended) or backgrounded.
- Also matches the local dev server (`localhost:8732`).
