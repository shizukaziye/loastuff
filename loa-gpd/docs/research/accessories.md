# Accessories — support upgrade steps

Research note for the accessory rows of the GPD chart. Everything here comes from
the accessory calculator at `loastuff/lost-ark-accessories` (`METHODOLOGY.md`,
`accessory_value.py`, in parity with `index.html`). No model or app code was
changed.

Parity check run first, all green:

```
$ python accessory_value.py verify
...
OVERALL: PASS
```

---

## 1. What was assumed, and why

**Line sets.** "high/mid" names two lines, so each rung is spelled out in full.
The ladders use the calculator's own `SUP_PRIMARY` order, which is also the order
`ref_sets()` uses to define the pricing baseline:

| Slot | first (better) primary | second primary |
|---|---|---|
| Necklace | `Stigma %` (brand) | `Gauge Gain %` |
| Ring | `Ally Dmg Buff %` | `Ally Atk Buff %` |
| Earring | `Weapon Attack Power %` | — (only one support primary) |

So "high/mid" on the necklace means **Stigma high + Gauge Gain mid**, and on the
ring **Ally Dmg high + Ally Atk mid**.

**The third line.** Every real accessory has three lines. Both ladders name two,
so the third is assumed **junk** — one of `Max MP+`, `Debuff Duration %`,
`HP Recovery+`, or a DPS-only line. All of these score exactly 0 for a support,
and the `hpAsWp` toggle is off by default, so `Max HP+` is junk too. The one line
that would *not* be junk is `Weapon Attack Power+`, the single support flat; see
§5.

**Main-stat quintile: min (the bottom of the roll range).** Reasons:

- The calculator's two real market anchors (neck support high/mid 250,000g and
  high/high 1,200,000g) are *defined* at min main stat. Quoting any other
  quintile prices the ladder above the only prices the model is tied to.
- The chart plots a *line* step. Main stat is a separate axis; folding it in
  would double-count against the honing row, which already moves main stat.
- It costs almost nothing on the damage side: main stat only reaches the party
  through the `ap` channel, and for the neck and ring it cancels out of the step
  entirely (see §6). On the earring the step moves by 0.0001 across the whole
  quintile range.

The mid-quintile numbers are in §6 as a sensitivity.

**Party size.** Not applied here. Every `Q` and `ΔQ` below is the party damage a
support hands to **one** dealer. The chart's ×3 belongs on the gold axis only.

---

## 2. Necklace — brand high → high/low → high/mid → high/high

`Q = 100·ln(ap·brand·identity)` above a support wearing no accessory, from
`support_quality("neck", 15178, lines)`, defaults untouched.

| Rung | Lines | Q | ΔQ (step) | Model gold | Step gold | Gold / 1% dmg (×3) |
|---|---|---|---|---|---|---|
| start | Stigma high | 0.9564 | — | **0** | — | — |
| 1 | Stigma high + Gauge low | 1.0643 | **+0.1079** | 13,962 | +13,962 | 43,100 |
| 2 | Stigma high + Gauge mid | 1.1990 | **+0.1347** | 250,000 | +236,038 | 584,000 |
| 3 | Stigma high + Gauge high | 1.3605 | **+0.1614** | 1,200,000 | +950,000 | 1,961,700 |

Rungs 2 and 3 are the calculator's anchors, so those two prices are hand-picked
market prices, not model output.

Split of the total, for reference (`ms = 0`, so lines only): Stigma high on its
own is worth **0.6974**, and the necklace's min main stat adds **0.2590**. Per
point: brand 0.0872, gauge gain 0.0674.

---

## 3. Ring — high single → high/low → high/mid → high/high

From `support_quality("ring", 10962, lines)`.

**Reading A (recommended): "high single" = `Ally Dmg Buff %` high.** This is the
better primary in the model (1.0127 against 0.7626 for ally-atk at ms = 0) and it
is what the calculator itself treats as the ring's baseline.

| Rung | Lines | Q | ΔQ (step) | Model gold | Step gold | Gold / 1% dmg (×3) |
|---|---|---|---|---|---|---|
| start | Ally Dmg high | 1.2001 | — | **0** | — | — |
| 1 | Ally Dmg high + Ally Atk low | 1.4077 | **+0.2076** | 87,688 | +87,688 | 140,800 |
| 2 | Ally Dmg high + Ally Atk mid | 1.6608 | **+0.2531** | 474,718 | +387,031 | 509,700 |
| 3 | Ally Dmg high + Ally Atk high | 1.9668 | **+0.3060** | 2,276,999 | +1,802,280 | 1,963,500 |

The ring is not anchored directly — its `(a, pmin)` are derived from the neck
anchor by the damage-above-baseline ratio, so all three prices are model output.
`2,276,999` matches the stored reference `sup_ring_hh`.

**Reading B: "high single" = `Ally Atk Buff %` high.** Worth knowing because it
changes the shape badly. The first step becomes free in the model, since
ally-atk-high plus ally-dmg-low still scores below the ring's baseline once you
credit only what sits above ally-dmg-high alone:

| Rung | Q | ΔQ | Model gold | Step gold |
|---|---|---|---|---|
| Ally Atk high | 0.9541 | — | 0 | — |
| + Ally Dmg low | 1.2251 | +0.2711 | 0 | +0 |
| + Ally Dmg mid | 1.5629 | +0.3378 | 289,532 | +289,532 |
| + Ally Dmg high | 1.9668 | +0.4039 | 2,276,999 | +1,987,467 |

Both readings end at the same piece. Reading A is the one to chart.

Per point (ms = 0): ally-dmg 0.1350, ally-atk 0.1525. These match METHODOLOGY's
quoted 0.136 / 0.150.

---

## 4. Earring — mid weapon power → high weapon power

From `support_quality("earring", 11806, lines)`. One step, and it is the problem
child.

| Rung | Lines | Q | ΔQ | Model gold | Step gold |
|---|---|---|---|---|---|
| start | WP% mid | 0.4336 | — | **0** | — |
| 1 | WP% high | 0.5868 | **+0.1531** | **0** | **+0** |

The damage is real and solid: **+0.1531** for the step, and it barely moves with
main stat (+0.1532 at the mid quintile). The gold is not. The model prices this
step at **zero**, and §5 explains why. **Do not chart the earring step on
modelled gold.** Use a live listing.

If the ladder may continue past a high WP% line, the only support line left on an
earring is the `Weapon Attack Power+` flat, and the model does price those — they
are the earring's own anchor set:

| Rung | Q | ΔQ | Model gold | Step gold | Gold / 1% dmg (×3) |
|---|---|---|---|---|---|
| WP% high | 0.5868 | — | 0 | — | — |
| WP% high + WP+ low | 0.5967 | +0.0099 | 10,217 | +10,217 | 343,500 |
| WP% high + WP+ mid | 0.6112 | +0.0145 | 113,231 | +103,014 | 2,370,900 |
| WP% high + WP+ high | 0.6355 | +0.0244 | 289,507 | +176,276 | 2,411,100 |

Those steps are tiny — a high weapon-power flat is worth 0.0494, a twentieth of a
high ally-dmg line — and they get expensive fast.

---

## 5. Mismatches between the ladders and the model

**(a) The model's zero point is exactly where every ladder starts.** The pricing
baseline is *better primary at high, nothing, nothing, min main stat*, credited at
0 gold. That is, word for word, "high brand" on a necklace, "high single" on a
ring, and "high weapon power" on an earring. So:

- The neck and ring first rungs are 0g **by construction**, not by measurement.
- The earring's whole requested step, mid → high, runs from below the baseline to
  exactly the baseline: 0 → 0.
- Cross-checked on the DPS side too — a bare high-WP% earring also prices at 0 in
  the DPS market, because the DPS baseline for an earring is a bare high
  `Attack Power %` line and the two score almost the same. So no second market
  rescues it. The model simply says one good line and nothing else is free.

This is a deliberate choice inside the accessory calculator, where the question is
"what can I sell this cut for". It is the wrong zero for the chart, where the
question is "what do I pay to move up one rung". Anything below the second line is
invisible to the model.

**(b) The pheon tax swallows the bottom rungs.** Every price is net of a flat
60,000g, floored at zero. The neck's first step is 13,962g at min main stat but
36,268g at the mid quintile — the whole difference is main-stat quality dragging
the piece back over the tax line. Read the sub-100k numbers as "roughly free",
not as prices.

**(c) The neck ladder rides on an approximation the model itself flags.** Every
step after rung 0 is a `Gauge Gain %` line, and METHODOLOGY calls its treatment
"modelled here as half-effective uptime, an acknowledged approximation" —
`seren = 0.15·(1+ally_dmg)·(1+spec_eff)·(1 + 0.5·gain)`. The gauge line is a
meter-generation input turned into a buff by a factor of one half. The neck row of
the chart is only as good as that 0.5.

**(d) The chart's support gear is not the calculator's support gear.**
`model/gear.js` builds the support's weapon power and main stat from honing level;
the accessory calculator uses fixed `baseWP = 250,000`, `baseMS = 750,000` for
both the support and the dealer. That fixed pair sits around +22 honing. It
matters only for the `ap` channel — the ring's ally-atk line and the earring's
weapon power. With the dealer held at 250k/750k and the support's gear swept:

| Support gear | Neck steps | Ring steps | Earring step |
|---|---|---|---|
| +11 (ms 595k, wp 181k) | +0.1079 +0.1347 +0.1614 | +0.1684 +0.2054 +0.2484 | +0.1243 |
| +18 (ms 704k, wp 220k) | +0.1079 +0.1347 +0.1614 | +0.1932 +0.2357 +0.2849 | +0.1426 |
| +25 (ms 822k, wp 261k) | +0.1079 +0.1347 +0.1614 | +0.2180 +0.2658 +0.3213 | +0.1608 |
| calculator default | +0.1079 +0.1347 +0.1614 | +0.2077 +0.2532 +0.3061 | +0.1532 |

The necklace never moves — brand and identity do not touch the support's gear.
The ring and earring swing about a quarter from one end of the honing track to the
other. If the chart wants one number per row, the calculator default is a fair
middle. If it wants the accessory row to sit honestly beside the honing row, feed
`gear.js` stats through `Support.contribution` and let the accessory numbers
follow the same character.

**(e) `gear.js` already spends the earrings.** Its defaults carry
`earringWpPct: 0.06` (two high WP% earrings) and `accessoryMainStat: 71429` (every
accessory at a max roll). A chart that also plots an earring weapon-power step
counts that line twice unless the honing row's baseline drops to mid weapon power.

**(f) One accessory or two.** Every number above is per slot. The player wears two
earrings and two rings.

---

## 6. Sensitivity: mid main-stat quintile

Damage steps for the neck and ring are **exactly** unchanged — main stat only
enters through `ap`, and neither ladder's lines touch `ap`, so it cancels in the
log difference. Only the gold moves.

| Ladder | Step | min-stat gold | mid-stat gold |
|---|---|---|---|
| Neck | → high/low | +13,962 | +36,268 |
| Neck | → high/mid | +236,038 | +272,495 |
| Neck | → high/high | +950,000 | +1,094,310 |
| Ring | → high/low | +87,688 | +103,694 |
| Ring | → high/mid | +387,031 | +411,599 |
| Ring | → high/high | +1,802,280 | +1,893,872 |

Mid stat lifts the top rung by about a sixth and the bottom rung by 160%. Another
reason to price at min: the bottom of the ladder is not robust to it.

---

## 7. Gold basis — modelled or live?

**Recommendation: live auction-house listings, with the model as the cross-check —
except at the top of the neck ladder, where the model *is* the market.**

Where each rung stands:

| Rung | Basis of the modelled price |
|---|---|
| Neck high/mid, high/high | **Real hand-picked market prices**, entered as anchors |
| Neck high/low | Model, deep in the pheon-tax floor |
| All three ring rungs | Model, derived from the neck anchor by damage ratio |
| Earring mid → high | Model gives **nothing** — the step straddles the zero point |

So the model is trustworthy exactly where the chart needs it least (the top rungs,
which are anchored) and blind exactly where the ladders start. The Pareto demand
curve is fitted to two points; it interpolates well and floors badly.

A practical split, if a live feed is not wired up yet:

- **Necklace and ring** — modelled prices are usable. They come from real anchors
  and the shape between them is sensible. Chart them, and mark the first rung as a
  floor rather than a price.
- **Earring** — the modelled price is unusable. It needs a live listing, or the
  row waits until there is one.

**What could be checked live, and what could not.** The loa-buddy market API works
fine server-side — `marketdata-api.yrzhao1068589.workers.dev/v1/prices/latest`
returned `destiny-destruction-stone` at 542g on `nae` — but it only covers the
**Market**: materials, consumables, engraving books. The baked item list in
`loastuff/loa-deal-finder/index.html` holds 193 items across battle / craft /
engraving / fusion / gather / honing / meal / tool, and not one accessory. Cut
accessories trade on the **Auction House**, which that API does not reach.

The right source is Smilegate's own OpenAPI, `POST /auctions/items`, which takes an
`ItemTier` / `CategoryCode` plus `EtcOptions` — exactly the line-and-tier filter
these ladders need. It wants a developer API key:

```
$ curl -s -o /dev/null -w "%{http_code}" -X POST \
    https://developer-lostark.game.onstove.com/auctions/items -d '{"CategoryCode":200010}'
401
$ curl -s https://developer-lostark.game.onstove.com/auctions/options
{"Message":"Authorization has been denied for this request."}
```

No key sits anywhere under `loastuff`, `loa-gpd` or `loa-bracelet-calc` — the OAuth
app noted for the astrogem and bracelet tools is the roster login, a different
credential. A key is free from the developer portal, and the
`loa-crafting-calculator/worker.js` CORS-proxy pattern ports straight across: same
worker shape, different upstream, plus an `authorization: bearer <key>` header held
as a worker secret. That is the one piece of plumbing the accessory row needs.

Web search turned up no free machine-readable NAEU accessory feed either; the
trackers that exist (loalarm and its like) are client-rendered pages with no public
endpoint.

---

## 8. Does the earring need a rung between mid and high?

**No.** There is nothing to put there.

- Lines roll at three tiers only — low 6.3%, mid 3.0%, high 0.7%. There is no tier
  between mid and high.
- The other support-relevant earring line, `Weapon Attack Power+`, cannot bridge
  the gap. Its high tier is worth 0.0494, while mid → high weapon power is 0.1531.
  Even WP% mid **plus** a high weapon-power flat scores 0.4580, still well under
  WP% high at 0.5868.
- Main-stat quality does not bridge it either. WP% mid at the max quintile scores
  0.4692; WP% high at the min quintile scores 0.5868. The ranges do not overlap.

If the earring row wants more than one point, extend it **upwards** with the
weapon-power flats from §4 — the same pair the calculator uses for the earring's
own anchor. For a point below, WP% low → WP% mid is +0.1285.

---

## 9. Reproducing

```
cd loastuff/lost-ark-accessories
python accessory_value.py verify
python accessory_value.py value --type ring --main-stat 10962 \
    --line "Ally Dmg Buff %" high --line "Ally Atk Buff %" mid
```

Or from Python:

```python
import sys; sys.path.insert(0, "loastuff/lost-ark-accessories")
import accessory_value as A
q = A.support_quality("neck", 15178, [("Stigma %", "high"), ("Gauge Gain %", "mid")])
g = A.value_at("neck", q, "support")      # 1.1990, 250,000
```

`A.ms_levels(slot)` gives the five quintile marks; index 0 is min, 2 is mid.
