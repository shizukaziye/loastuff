# Hell Key Calculator (Lost Ark, Paradise Season 4)

Gold value of Hell keys and the decisions behind it: when to take the middle jump, whether to altar a key, what a season of keys is worth. All gold values editable.

Live: https://www.loseii.com/loa-hell-key-calc/

## Model

A run is a dynamic program over floor, descents left, jump streak, altar effects and (Netherworld) lives. You keep the best of the chests shown, plus the guaranteed chest; the same-jump bonus is paid inside the run. Netherworld keys add a stop action and the death rule. The page's "How it works" section has the details.

Reward quantities: sekwahar's data-mined Season 4 tables (via the Hell Reward Picker dump). Market prices: NA East robust 14-day price from the loa-buddy feed, refreshed every 6 hours by the monorepo's workflow.

## Files

- `index.html`, `styles.css`, `app.js`: the page. No build step, no dependencies.
- `model.js`: the pure model. `verify.py` mirrors it in Python and checks parity against numbers captured from the live page (`python verify.py`).
- `data.js` / `data/rewards.json`: reward tables, from `tools/build_data.py` and the picker dump.
- `prices.js`: baked market reference prices, from `fetch_prices.py`.
- `tools/ablation.js`, `tools/compare_sheet.js`: how much the bonus and middle jumps add; comparison with Ple0k's sheet.

## Sources

- https://sekwahar.github.io/loa_datamining/pages/hell_drops.html
- https://thejunglewalrus.github.io/hell-rewards-picker/
- KR Season 4 patch notes: https://lostark.game.onstove.com/News/Notice/Views/13542
- Altar outcome odds: https://www.inven.co.kr/board/lostark/4821/108631
