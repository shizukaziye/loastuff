# DP extractor — turning the astrogem cut into an exact finished-gem distribution

Design note, 2026-08-15. Read-only study of
`~/loastuff/loa-astrogem-calc` (`MODEL_SIG 12u9hug`). Nothing in that repo was
changed, and nothing here has been built yet.

**The goal.** Today `tools/arkgrid-account.js` gets its gems by rolling dice:
`cutOneGem` walks one gem turn by turn, asking the solver what to do at each
turn, at about 19 ms a gem (measured: 200 gems, warm solver, 3,883 ms). We want
the same answer without the dice — for a given
(baseline, goldPerDamage, rosterBound, axis, baseCost, effect pair, maxTurns),
the exact probability of every finished gem, plus the exact expected gold.

**The verdict up front.** It is feasible, and not marginally so. The answer set
is 3,750 finished configs plus one "dismantled unprocessed" atom. The dominant
term in the exact pass is about six seconds for a nine-turn epic cell and about
a second and a half for a seven-turn rare one — the cost of a few hundred
sampled gems, where the tail bands need half a million. Two things make the job
hard rather than routine, and both are in §3 and §5: the game's draw law is
**not** the law the DP's own value function assumes, and the forward pass needs
a quantity the DP never had to compute.

---

## 0. Map of the code

| what | where |
|---|---|
| outcome rate table, costs, pools, scoring | `model/astrogem.js` |
| the value function `W` and the `Solver` | `model/dp.js` |
| `applyOutcome`, the real 4-outcome draw, `calculateGemValue` | `model/nested.js` |
| the rollout the study actually runs | `tools/lib/cut-engine.js` |
| the consumer | `~/loa-gpd/tools/arkgrid-account.js` |

`arkgrid-account.js:41-43` rewrites `A.RARITY.epic` in place before requiring
the DP, so "epic" means 9 turns / 3 rerolls, "rare" 7 / 2, "uncommon" 5 / 1, and
`cut-engine.js:19` reads the same live object. `arkgrid-account.js:96` pins
`rosterBound = true`; `:111` builds one `DP.Solver` per snapped grade band
(`:86-91`) and gpd; `:335-339` is the whole consumption: `res.spent`,
`res.processes > 0`, `res.cfg`.

---

## 1. The DP's state space as implemented

### 1.1 What `W` is

`dp.js:6-22`:

```
W(config,t,r,cm) = E_{4 outcomes O}[ max(
    COMPLETE: gemValue(config),
    PROCESS (t>=1): -procCost(cm) + (1/4)·Σ_{o∈O} W(apply(config,o), t-1, r_o, cm_o),
    REROLL  (r>=1, t<maxTurns): -rerollCost(r) + W(config, t, r-1, cm)
)]
```

`t` = turns remaining including the current one, `r` = rerolls remaining,
`cm` = process-cost multiplier. The value is **net gold**: terminal gem value
minus everything spent from here on. `Solver.prototype.W` (`dp.js:527-529`) is a
thin read of `_node` (`dp.js:540-594`), which returns the record
`{ v, act, expScore, pAbove, expSpend }`.

**Reset is not in `W`.** `_node` ranks three actions only. Reset exists solely at
the top level (`dp.js:746-760`) and in the rollout (`cut-engine.js:108-120`),
each grafting a one-level `-20000 + W(fresh)` option onto a value function that
itself never resets. The extractor must reproduce that hybrid, not repair it.

### 1.2 What identifies a node

Four fields, and the memo key is built from them by string concatenation at
`dp.js:547`:

```
configKey(config, axis) + "#" + t + "#" + r + "#" + cm
```

`configKey` (`dp.js:115-124`) is **not** the config. It is

```
willpowerLevel | orderLevel | (classA:levelA) | (classB:levelB)
```

with the two effect slots sorted so `{e1,e2}` and `{e2,e1}` collide, and with
each effect replaced by its **class** — `Math.round(effectScore(e,1) * 1e6)` on
the active axis (`dp.js:92-109`). Base cost and gem type are absent by design
(`dp.js:111-114`): one Solver never crosses base costs.

The class collapse is aggressive. Measured at every base cost:

| base cost | pool | DPS classes | support classes |
|---|---|---|---|
| 8 | Additional Damage, Attack Power, Brand Power, Ally Damage Enh. | 59287, 32386, 0, 0 | 0, 0, 14567, 7133 |
| 9 | Boss Damage, Attack Power, Ally Damage Enh., Ally Attack Enh. | 81268, 32386, 0, 0 | 0, 0, 7133, 19533 |
| 10 | Boss Damage, Additional Damage, Brand Power, Ally Attack Enh. | 81268, 59287, 0, 0 | 0, 0, 14567, 19533 |

On the support axis the two DPS effects of every pool share class 0, so
`W` cannot tell "Boss Damage 4" from "Additional Damage 4". That is right for
the value and wrong for us: the chart wants named finished gems.

> **Rule for the extractor.** Carry the *true* config as your own state
> identity; call `solver.W` for values. Never key your own tables on
> `configKey`.

### 1.3 The reachable ranges

Measured on a cold epic solve (support axis, roster-bound, grade-80 baseline,
gpd 1 M, base cost 10): **199,447 memo nodes, 9.1 s**.

| field | range | why |
|---|---|---|
| `willpowerLevel`, `orderLevel`, both effect levels | 1..5 | `applyOutcome` clamps (`nested.js:136-145`) |
| effect pair | the 6 unordered pairs of the base cost's pool | `change_side_option` excludes both current effects (`nested.js:147-149`), so the two names never coincide |
| `t` | 0..maxTurns | only Process decrements it |
| `r` | 0..3+2·(maxTurns−t), i.e. 0..19 at maxTurns 9 | `+1`/`+2` reroll outcomes, `clampReroll` floors at 0 (`dp.js:522`) |
| `cm` | **{−100, 0, +100} only** | the only cost outcomes are ±100 (`astrogem.js:191-192`) and `clampCm` (`dp.js:206`) closes the set |

The memo dump confirms all three: `r` 0..19, `cm` −100/0/100, nodes by `t`
= {1: 67800, 2: 54300, 3: 39776, 4: 23716, 5: 10216, 6: 2988, 7: 580, 8: 70,
9: 1}.

True configs, un-collapsed: 5 × 5 × (6 pairs × 5 × 5) = **3,750**. That number
is also exactly the size of the answer (§4).

### 1.4 What `rosterBound` changes

`dp.js:243`:

```js
Solver.prototype.procCost = function (cm) { return this.rb ? 0 : procCost(cm); };
```

Processing alone is free, and only *inside the decision*. Rerolls stay paid
(`dp.js:244`, `:722`) and Reset stays paid (`dp.js:755`). But
`cut-engine.js:70` defines the ledger cost with no roster test at all:

```js
function procCostAt(cm) { return Math.max(0, Math.round(A.COSTS.processBase * (1 + cm / 100))); }
```

and `cutOneGem` charges it unconditionally (`cut-engine.js:170-171`). So for a
roster-bound gem the DP decides as if processing were free while the ledger
bills 900·(1+cm/100) a turn. That is deliberate — `arkgrid-account.js:92-95`
says so in as many words — and it has two consequences the extractor must obey:

- **Gold uses `procCostAt`, never `solver.procCost`.** The DP's own `expSpend`
  (`dp.js:584`) is built from `solver.procCost` and therefore *undercounts*
  roster-bound gold by the whole processing bill.
- **A roster-bound gem is never dismantled unprocessed.** At `t = maxTurns`
  Complete is pinned to 0 (`dp.js:553`, `cut-engine.js:79`), Reroll and Reset
  are illegal, and Process is worth `0 + E[W(child)] ≥ 0`, so Process wins the
  tie. Measured P(processed) = 1.0000 at every band. Turn it off and the atom
  dominates: at grade 80, paid, P(processed) = **0.0047**.

Measured, epic, base cost 10, gpd 1 M, 4,000 gems a row:

| band | roster P(proc) | processes | rerolls | resets | E[gold] | paid P(proc) | paid E[gold] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1.0000 | 13.30 | 4.19 | 0.554 | 26,344 | 1.0000 | 26,322 |
| 70 | 1.0000 | 10.25 | 2.75 | 0.168 | 13,290 | 1.0000 | 6,608 |
| 80 | 1.0000 | 8.96 | 2.18 | 0.000 | 8,135 | 0.0047 | 18 |
| 90 | 1.0000 | 8.95 | 2.20 | 0.000 | 8,050 | 0.0000 | 0 |

(Processes above 9 come from resets, which hand back a full turn budget.)

### 1.5 The per-turn outcome table

`astrogem.js:1057-1085`. Every row of `OUTCOME_RATES` (`:162-197`) carries a
base weight and an `excludeIf`. The rule is **exclude, then renormalise**:
drop every row whose condition fires, sum the survivors' base weights, and set
`prob = base / sumBase` (`:1080`). The state it reads is only

```js
{ willpower, order, effect1, effect2, costMult, turnsRemaining }   // :1062-1069
```

— four **levels**, the multiplier, and the turn count. Effect *names* are never
read. Exclusions: a line at level 5 loses its `+1`, at 4 loses `+2`, at 3 loses
`+3`, at 2 loses `+4`, at 1 loses `−1`; `cost` and `reroll` rows vanish when
`turnsRemaining <= 1`; a `cost` row vanishes at its own clamp.

So the possibility vector depends on the triple

> **draw class** κ = (four levels, cm, `turnsRemaining <= 1`)

and nothing else. At most 5⁴ × 3 × 2 = 3,750 classes exist; 2,250 occur in a
cost-10 epic run. Measured sizes:

| state | n |
|---|---:|
| 1/1/1/1, cm 0, t ≥ 2 | 23 |
| 1/1/1/1, cm 0, t = 1 | 19 |
| 3/3/3/3, cm 0, t ≥ 2 | 19 |
| 2/2/2/2, cm −100, t ≥ 2 | 22 |
| 5/5/5/5, cm 0, t ≥ 2 | 11 |
| 5/5/5/5, cm 0, t = 1 | 7 |

**n never falls below 7 and never rises above 23.** The `< 4` padding branches
(`cut-engine.js:52`, `dp.js:407-412`) are dead code in practice.

### 1.6 The draw of 4, and the 25% pick

This is the part that decides whether the whole project works.

**What the game and the simulator do.** `nested.js:66-94` (and its verbatim twin
`cut-engine.js:39-54`) draw four *distinct* possibilities one at a time,
renormalising over the survivors after each pick:

```js
while (sel.length < 4 && pool.length > 0) {
  total = Σ pool[i].prob;             // renormalise over what is left
  r = rand() * total;                 // pick one
  sel.push(...); pool.splice(idx, 1); // and remove it
}
```

That is **sequential-proportional** sampling without replacement. `cutOneGem`
then applies a uniformly random one of the four (`cut-engine.js:172`) — the 25%
step — and `change_side_option` picks its replacement effect uniformly from the
pool minus both current effects (`:174-181`).

**What the DP assumes.** `Solver._emax` defaults to `expectedMaxOfDrawWoR`
(`dp.js:230`, `:404-520`), which models the 4-subset as **conditional
Bernoulli**, P(O) ∝ Π_{i∈O} p_i. That is a different distribution, and dp.js
says so: `:29-31` calls it "the conditional-Bernoulli vs true
sequential-proportional gap", and `verify-dp.js:36-42` widens the acceptance
band for it.

Measured on a representative 23-possibility vector:

| quantity | gap |
|---|---:|
| total variation between the two 4-subset laws | **0.0508** |
| worst per-subset relative gap | **45.1%** |
| worst per-possibility inclusion gap P(i∈O) | **8.29%** |

The `"iid"` alternative (`dp.js:307-403`) draws with replacement, is about twice
as fast, and compounds to 4–7% over a nine-turn cut; `dp.js:32-35` keeps it only
as a fallback.

**The consequence for us.** The forward pass has to choose a law and say which.
Two runs are wanted, for two different jobs — see §3.5 and §7.

---

## 2. The decision function, exactly

`cut-engine.js:74-129`. `decide(solver, cfg, t, r, cm, outcomes, resetUsed)`
returns `"process" | "reroll" | "complete" | "reset"`.

```js
var fresh = (t === maxTurns);                                        // :76
var complete = fresh ? 0 : solver.gemValue(cfg);                     // :79
```

**Fresh means zero processes.** Only Process decrements `t`, so `t === maxTurns`
is exactly "nothing has been processed yet" (`dp.js:231-235`). On a fresh gem
Complete is worth 0 — that *is* the dismantle, not a keep.

```js
var process = -Infinity;                                             // :82
if (t >= 1 && outcomes && outcomes.length > 0) {
  var pc = solver.procCost(cm);                                      // :84  (0 if roster-bound)
  for each of the 4 outcomes:
    brs = DP.outcomeBranchesActual(cfg, outcomes[i]);                // :87
    bv  = Σ_b w_b · solver.W(b.config, t-1, clampR(r+b.dRerolls), clampCm(cm+b.dCm));   // :92
  process = -pc + (1/4)·Σ bv;                                        // :98
}
```

The sub-branch average is taken **before** the max, so a `change_side_option`
outcome enters the decision as the mean over its candidate replacements
(`dp.js:840-842` sets `w = 1/candidates.length`).

```js
var reroll = -Infinity;                                              // :102
if (r >= 1 && t >= 1 && !fresh)                                      // :103
  reroll = -(r === 1 ? A.COSTS.finalReroll : 0) + solver.W(cfg, t, r - 1, cm);   // :104
```

Reroll is **greyed out on a fresh gem** — confirmed in game, `dp.js:717-719`.
It does not touch the config, the turn count or the multiplier: it buys one
fresh set of four at the same node. Only the last one costs gold, 3,800
(`astrogem.js:133`, `dp.js:79-81`), and because `+1`/`+2` outcomes can refill
the counter, a single gem can pay it more than once.

```js
var reset = -Infinity;                                               // :108
if (!resetUsed && !fresh) {                                          // :109
  var completeWouldWin = complete >= process && complete >= reroll;  // :110
  if (t === 1 || completeWouldWin)                                   // :111
    reset = -A.COSTS.reset + solver.W(freshCfg, maxTurns, EPIC.maxRerolls, 0);   // :118
}
```

Reset costs 20,000 (`astrogem.js:135`), is available once per gem, is illegal on
a fresh gem, and returns the gem to **all levels 1, full turns, full rerolls,
cm 0, keeping the current effect pair** (`:112-117`, and the same construction
at `:152-157`). Keeping the pair matters: after a `change_side_option` the gem
resets onto its *new* pair, so a run has up to six distinct fresh anchors. This
is the "same-pair assumption" of `cut-engine.js:8-9`; the advisor separately
prices every other pair the reset could land on (`dp.js:776-800`), but the
rollout does not use that.

**The gate is the subtle part.** Away from the last turn, Reset is not even
*evaluated* unless Complete would win. So a state where Reset is worth more than
Process can still Process, because Process beating Complete switches Reset off.
The policy is therefore not a plain argmax over four numbers, and the extractor
has to replay the gate literally.

```js
var act = "process", best = process;                                 // :123
if (reroll   > best) { act = "reroll";   best = reroll; }            // :124
if (complete > best) { act = "complete"; best = complete; }          // :125
if (reset    > best) { act = "reset";    best = reset; }             // :126
if (!isFinite(best)) act = "complete";                               // :127
```

Every comparison is strict `>`, walked in the order Process → Reroll → Complete
→ Reset. **Ties go to the earlier action**: Process beats Reroll, Reroll beats
Complete, Complete beats Reset. Inside `cutOneGem`'s loop `t >= 1` and
`outcomes.length === 4` always, so `process` is always finite and line 127 never
fires.

### 2.1 The rollout

`cutOneGem` (`cut-engine.js:132-190`) starts at all levels 1,
`t = solver.maxTurns`, `r = EPIC.maxRerolls`, `cm = 0`, and
`resetUsed = !allowReset` (`:139-141`). Then `while (t > 0)`:

| action | effect | gold |
|---|---|---|
| complete | break | 0 |
| reset | levels → 1, `t` → maxTurns, `r` → maxRerolls, `cm` → 0, `resetUsed` = true (`:149-160`) | 20,000 |
| reroll | `r--`, same turn (`:162-167`) | 3,800 if `r === 1` before the decrement, else 0 |
| process | apply a uniform one of the four, then `cm` or `r` update, then `t--` (`:170-185`) | `procCostAt(cm)` |

Order inside a Process matters: `applyOutcome` first, then
`cm = clampCm(cm + change)` **or** `r += change` (never both, `:183-184`), then
`t--`. Note `cut-engine.js:183` updates `cm` whether or not the gem is
roster-bound, where `nested.js:203` updates it only when it is not — a small
divergence between the two engines, visible only through which `cost` rows the
table excludes.

Falling out of the loop at `t === 0` is a forced Complete, matching
`dp.js:543-546`.

---

## 3. The forward propagation

### 3.1 State and notation

σ = (c, t, r, m, u) — true config, turns left, rerolls left, multiplier,
`resetUsed`. Write

- **p(κ)** — the normalised possibility vector of σ's draw class κ (§1.5);
- **D(κ)** — the law over 4-subsets O ⊂ {1..n} (§1.6);
- **v_i(σ)** — the branch-averaged continuation
  `Σ_b w_b · solver.W(cfg_b, t−1, clampR(r+dR_b), clampCm(m+dCm_b))`, exactly
  `cut-engine.js:87-97`;
- **S_O = Σ_{i∈O} v_i**, and **P(O) = −pc + S_O/4** with `pc = solver.procCost(m)`;
- **C, R, Z** — Complete, Reroll and the Reset candidate, all independent of O.

### 3.2 The decision collapses to one threshold

Only Process depends on the drawn set, and only through the scalar S_O. So for
fixed σ the action is a step function of S_O. Reading the gate and the tie-break
chain of §2 case by case:

| situation | Process taken iff | otherwise |
|---|---|---|
| Reset unavailable (`u = 1` or `t = maxTurns`) | P ≥ max(R, C) | R ≥ C → reroll, else complete |
| `t = 1`, Reset available | P ≥ max(R, C, Z) | Z > max(R,C) → reset; else R ≥ C → reroll, else complete |
| `t > 1`, Reset available, C < R | P ≥ R | reroll |
| `t > 1`, Reset available, C ≥ R, Z > C | P **>** C | reset |
| `t > 1`, Reset available, C ≥ R, Z ≤ C | P ≥ C | C > R → complete, else reroll |

So: one threshold **T = 4·(θ + pc)** on the *set sum*, one strictness flag, and
one constant fallback action α. Row 4 is the gate's non-monotonicity written
out — Process wins above C even though Reset is worth more, because Process
winning is what switched Reset off.

The strictness flag only bites at exact equality `P = C`, which for
floating-point gold is a coincidence, but it is free to carry so carry it.

### 3.3 What the forward pass needs from the draw layer

For each σ, two things:

```
F   = P( S_O ▷ T )                          ← the probability Process is taken
G_i = P( i ∈ O  ∧  S_O ▷ T )   for each i   ← per-possibility, restricted
```

and then the **applied-outcome law** is `q_i = G_i / 4`, with `Σ_i q_i = F`
(each of the four slots is picked with probability ¼, `cut-engine.js:172`).

`F` is the same family of object dp.js already computes — `expectedMaxOfDrawWoR`
returns `K + (ES>T − T·P>T)/4` with `T = 4(K + proc)` (`dp.js:413`, `:519`), so
`P>T` **is** `F`. `G_i` is new. The DP never needed it, because a value only
needs the expectation, not which outcome landed.

**Is the exact marginalisation tractable?** Yes, and comfortably, because of one
fact from §1.5: *the subset law depends only on the draw class, never on the
values*. So build D(κ) once per class and reuse it for every σ in that class.

Measured, worst class (n = 23):

- exact sequential-proportional law by depth-4 recursion with renormalisation —
  212,520 ordered leaves collapsing to **8,855 subsets, 16 ms**, mass 1.000000000000;
- the per-state threshold sweep over that flattened law — **56.5 µs**, i.e.
  157 M subset-touches a second with typed arrays.

Mean n over a real epic run is 16.8, so the mean class has 2,724 subsets and the
mean state costs about 17 µs.

**The tempting shortcut, and why it is not good enough.** If Process wins for
*every* possible set, then `q_i = π_i = P(i ∈ O)/4` — a pure function of the
class, no values needed. It is very tempting to go further and use the raw
analytic `p_i` from `outcomeProbabilities`. Do not. Measured, always-process
nine-turn sweep, cost 10, the pair Boss Damage / Additional Damage:

| | raw `p_i` | exact `π_i` | gap |
|---|---:|---:|---:|
| mean supportDamage | 0.11072 | 0.11255 | +1.65% |
| mean support grade | 42.286 | 42.625 | +0.34 pts |
| P(grade ≥ 70) | 0.03786 | 0.04365 | **+15.3%** |
| P(grade ≥ 80) | 0.00504 | 0.00619 | **+22.8%** |
| P(grade ≥ 86.7) | 0.00065 | 0.00094 | **+44.8%** |
| P(grade ≥ 90) | 0.00029 | 0.00045 | **+52.3%** |
| P(grade ≥ 93.3) | 0.00014 | 0.00021 | **+55.7%** |

Total variation between the two finished-config distributions: 0.0423.

The reason is plain once seen. Drawing 4 of ~20 and then picking one is not the
same as picking one of ~20. A rare outcome gets four chances to make the board
and only then a 25% pick, so `π_i > p_i` for small `p_i` and `π_i < p_i` for
large ones — worst gap 10.7% per possibility, on the same 23-possibility vector
used above. The finished tail is built out of the rare `+3`/`+4` jumps, so the
error compounds straight into the bands the chart is about. The 4-unique layer
is not a detail; it is worth half the S-band.

> **Rule.** Model the draw layer exactly. `π_i` where Process always wins,
> `q_i = G_i/4` everywhere else. Never `p_i`.

### 3.4 The sweep order

Three edge kinds leave a state:

| edge | target | notes |
|---|---|---|
| process | (child config, `t−1`, r±, m±, u) | strictly decreases `t` |
| reroll | (c, `t`, `r−1`, m, u) | **same `t`** |
| reset | (fresh(pair), maxTurns, maxRerolls, 0, **u = 1**) | jumps `t` back up |

Reroll makes a within-layer edge, and reset makes a backward one. Both are tamed
without iteration:

1. **`u` splits the graph into two acyclic halves.** Reset is the only edge that
   flips `u` from 0 to 1, and it is unavailable once `u = 1`. So run phase A
   over `u = 0`, accumulating all reset outflow into at most six buckets — one
   per effect pair — at (fresh(pair), maxTurns, maxRerolls, 0, u = 1); then run
   phase B over `u = 1` seeded from those buckets.
2. **Within a phase, sweep `t` from maxTurns down to 0; within a turn, sweep `r`
   from its ceiling `maxRerolls + 2·(maxTurns − t)` down to 0.** Reroll is the
   only within-layer edge and it strictly decreases `r`, so one pass resolves it.

Nothing else creates a cycle: `cm` and the config never change without spending
a turn.

### 3.5 The algorithm

```
INPUT  baseline, gpd, rosterBound, axis, baseCost, startPair, maxTurns, allowReset, drawLaw
solver = new DP.Solver(baseline, gpd, rosterBound, { axis, maxTurns })

mass[σ]  : Float64Array over (configIdx, t, r, m, u)
gold[σ]  : Float64Array, mass-weighted gold spent so far   (and gold2[σ] for variance)
final[c] : Float64Array over the 3,750 configs      + finalGold[c], finalGold2[c]
dismantled, dismantledGold

seed: mass[fresh(startPair), maxTurns, maxRerolls, 0, allowReset ? 0 : 1] = 1

for phase u in (0, 1):
  for t = maxTurns .. 1:
    for r = rCeil(t) .. 0:
      group the live states by draw class κ, build/fetch D(κ)
      for each live σ:
        v_i   = branch-averaged solver.W over σ's possibilities        # cut-engine.js:87-97
        C,R,Z = the three constants                                    # §3.2
        T, ▷, α = the threshold, strictness and fallback               # §3.2 table
        F, G  = one linear sweep over D(κ)                             # §3.3
        # process
        for each possibility i, for each sub-branch b:
          push (G_i/4)·w_b of mass to (cfg_b, t−1, r_b, m_b, u),
              carrying gold + procCostAt(m)
        # fallback, weight (1 − F)
        α = reroll   -> push to (c, t, r−1, m, u), gold + 3800·[r == 1]
        α = complete -> t == maxTurns ? dismantled : final[c]
        α = reset    -> push to the phase-A reset bucket for c's pair, gold + 20000
  absorb everything still alive at t = 0 into final[c]
```

Two implementation notes that matter for speed and for trust:

- **Index the state space densely.** configIdx = wp(5) × ord(5) × pairSlot(6) ×
  levelA(5) × levelB(5) = 3,750; times `t` (0..maxTurns), `r` (0..19), `m` (3),
  `u` (2) is 4.5 M slots — 36 MB per Float64Array. String keys are the wrong
  tool here; `dp.js:547` rebuilds and hashes a string per node, and at ~5.6 M
  `W` lookups per epic cell that alone would rival the whole draw layer.
- **Do not re-derive `W`.** Fill a dense `W` cache by *calling* `solver.W`, so
  the values are dp.js's own, bit for bit. Re-implementing the recursion to make
  it fast is how the extractor and the shipped advisor quietly drift apart.

### 3.6 The reroll branch, precisely

Reroll changes the config not at all. `cut-engine.js:162-167` decrements `r`,
adds the gold, and `continue`s — the loop redraws four outcomes at the top of
the next iteration from the *same* `(cfg, t, cm)`. So in the forward pass it is
a pure move along the `r` axis, and the fresh set of four is supplied by the
target state's own draw. This is also why sweeping `r` downward inside a turn
layer is exact rather than an approximation.

---

## 4. Absorbing outcomes and the gold ledger

Three sinks, and they are not interchangeable:

| sink | when | what the consumer gets |
|---|---|---|
| **finished gem** | Complete at `t < maxTurns`, or falling out at `t = 0` | the full config: wp, order, both effect names and levels |
| **dismantled unprocessed** | Complete at `t = maxTurns` | no gem. `arkgrid-account.js:339` reads this as `res.processes > 0 ? res.cfg : null` |

The finished-gem support is exactly the 3,750 true configs of §1.3 (a
9-turn always-process sweep reaches all 3,750, total mass 1.000000000000). So
the whole answer is **3,751 atoms**: a Float64Array of 3,750 plus one scalar.
That is small enough to cache to JSON per cell and sample from in O(log n).

**Gold decomposes by action, at the ledger prices, not the decision prices:**

| component | price | source |
|---|---|---|
| process | `max(0, round(900·(1 + cm/100)))` = 0 / 900 / 1800 for cm = −100 / 0 / +100 | `cut-engine.js:70`, `astrogem.js:132` |
| final reroll | 3,800, charged when `r === 1` at the moment of the reroll (so `r` 3→2 and 2→1 are free, and a refilled counter can charge it again) | `cut-engine.js:163`, `astrogem.js:133` |
| reset | 20,000, always, roster-bound or not | `cut-engine.js:150`, `astrogem.js:135` |

Fusion (`astrogem.js:134`) is the caller's business, not the cut's:
`arkgrid-account.js:360` adds it separately.

**Carry gold as moments beside the mass.** Propagate `(mass, mass·gold,
mass·gold²)` through every edge, adding the action's price to the gold term.
Then `E[gold]`, `Var[gold]`, and — because the accumulators land in `final[c]` —
`E[gold | finished config c]`. That last one is what keeps the account
simulation honest: gold and the finished gem are correlated (a gem that reset
carries 20,000 and a different level history), and drawing the config from the
exact distribution while taking gold from an unconditional mean would break the
correlation the trace depends on. Three arrays, no extra passes.

If the consumer wants the full joint law, gold takes values on a lattice of
900/1800/3800/20000 and could be bucketed — but the two-moment version is
enough for everything `arkgrid-account.js` does with `res.spent`.

---

## 5. Complexity — measured, not estimated

Cost 10, support axis, roster-bound, grade-80 baseline, gpd 1 M.

| | epic (9 turns, 3 rerolls) | rare (7 turns, 2 rerolls) |
|---|---:|---:|
| DP memo, cold solve | 199,447 nodes, 9.1 s | 63,698 nodes, 2.6 s |
| forward-reachable (true config, t, r, cm, u), **no** policy pruning | 1,122,987 | — |
| **policy-reachable** | **472,795** | **173,901** |
| of which absorbing (`t = 0`) | 137,968 | 77,851 |
| non-absorbing states to sweep | 334,827 | 96,050 |
| mean n | 16.8 | 16.3 |
| total C(n,4) subset-touches | **911.7 M** | **241.9 M** |
| threshold sweep at 157 M touches/s | **≈ 5.8 s** | **≈ 1.5 s** |

The one-off cost of the draw laws is small and shared: at most 3,750 classes,
16 ms for the worst (n = 23) and ~3 ms for the mean, so **~11 s to build every
class that exists** — and because a class depends only on levels, cm and the
turn flag, that build serves *every* baseline, gpd, base cost, effect pair and
rarity in the study. Memory: mean 2,724 subsets × 16 B ≈ 44 KB a class,
~163 MB for all 3,750; the worst class is 142 KB. If that is unwelcome, group
the sweep by class and keep a bounded LRU — the sweep order of §3.4 already
visits states class by class.

**So exact set-marginalisation is feasible.** The draw layer is the dominant
term at ~6 s a nine-turn cell; add the `W` table and the mass bookkeeping and
budget a small multiple of that. Against 19 ms a Monte-Carlo gem, the exact
answer costs what a few hundred to a couple of thousand sampled gems cost — and
it returns P(grade ≥ 93.3) ≈ 2·10⁻⁴ with no error bar at all, where the Monte
Carlo needs ~5·10⁵ gems, two and a half hours, to pin the same number to 10%.

Two shortcuts are worth having but neither is load-bearing:

- **The always-Process test.** If `−pc + (mean of the 4 *smallest* v)` already
  clears the threshold, `F = 1` and `q = π`, and the C(n,4) sweep can be skipped
  for that state — the `v` values are still needed to run the test, so this
  saves the draw layer, not the `W` lookups. It fires on 38,252 of 334,827 epic
  states (11%) by *attainability*, which is the pessimistic reading: it is
  decided by the worst four outcomes, and those carry almost no mass. Two
  comparisons; test it.
- **Mass pruning.** Dropping states below 10⁻¹² keeps 298,270 of 309,894 in the
  always-process sweep, below 10⁻⁹ keeps 250,532, below 10⁻⁶ keeps 128,691. Not
  a big win at safe tolerances; use it as a guard rail with the dropped mass
  reported, not as a speed plan.

### 5.1 What the bracelet repo already solved

`~/loa-bracelet-calc` did the same job for the bracelet reroll DP, and
`tools/rank-match.mjs:15-19` states the doctrine: *"NO MONTE CARLO. The model's
own DP returns the EXACT distribution of finished line scores … Exact
throughout, and it runs in a second."* Four patterns transfer directly:

1. **Enumerate the without-replacement draw, do not approximate it.**
   `bracelet.js:1424-1427` — *"Draws are sequential without replacement and every
   step renormalises over the survivors, so orderings must be walked in full"* —
   and `:1429-1463` walks them, `prob * a.weight / mass` per step, collapsing
   into a map keyed by a canonical order-independent code. That is exactly the
   depth-4 recursion of §3.3, and the canonical code is our 4-bit mask.
2. **Sort the outcomes by continuation value once, keep prefix sums.**
   `buildF` (`:1467-1483`) turns the keep-or-replace comparison into a binary
   search (`upperBound`, `:1486-1490`). Our threshold on S_O is the same move
   one dimension up.
3. **Sweep mass forward layer by layer, grouped by the policy.**
   `forwardDistribution` (`:1917-1964`) walks `r = R..1`, groups states by their
   cached policy, and does one sorted sweep per group instead of a dense
   |states|² matrix (`:1884-1887`). Our §3.4 sweep is the same shape with `u`
   splitting the graph.
4. **Build the self-check into the machinery.** `maskDistribution`
   (`:1979-1993`) reproduces the headline distribution exactly when it is forced
   onto the optimal action — *"Forcing the OPTIMAL mask therefore reproduces
   finalScore exactly — a verify check"* (`:1976-1977`). §7.1 is our version,
   and it is stronger.

One pattern to take with care: `distToCdf` (`:1897-1915`) thins a long cdf to
~160 rungs, merging probability into the next kept rung so every `cum` stays
exact. We do not need it — 3,750 atoms is not long — but the merge-never-drop
discipline is the right one if the gold lattice ever gets bucketed.

---

## 6. Traps

Collected in one place, because each one is a silent wrong answer.

1. **Gold uses `procCostAt`, not `solver.procCost`.** §1.4. Roster-bound is the
   default in `arkgrid-account.js:96`, and getting this backwards makes every
   epic cut look free.
2. **`W` has no Reset.** §1.1. The rollout resets against a value function that
   assumes it never will. Reproduce, do not repair.
3. **Reset is only *priced* when Complete would win.** §2, §3.2 row 4. A plain
   four-way argmax gives a different policy.
4. **Reset keeps the current pair.** `cut-engine.js:112-117`. After a
   `change_side_option` the fresh anchor moves, so phase B has up to six seeds.
   Note that `decide` *prices* Reset whenever the gate opens, whether or not it
   takes it, and every new pair it prices costs a whole fresh subtree: measured,
   200 Monte-Carlo gems at grade 80 — where Reset is never chosen, 0.000 resets
   a gem — still grew the memo from 199,447 to 287,688 nodes.
5. **The memo key collapses effect names.** §1.2. Never key the extractor's own
   tables on `configKey`.
6. **Do not validate against `expScore` / `pAbove`.** `dp.js:576-583` weights
   the child diagnostics by the raw `dist.probs[i]` — the `p_i` of §3.3 — and
   applies them to all the node's mass rather than to the Process branch only.
   They are cheap diagnostics with a known different weighting, and the
   extractor supersedes them.
7. **Ties go to the earlier action** in the order Process, Reroll, Complete,
   Reset (`cut-engine.js:123-126`), whereas `dp.js:572`'s `max(K, P4)` inside
   `_emax` gives ties to `K`. The two differ only at exact equality, but §7.1's
   identity is exact, so match `_emax` for that run and `decide` for the rest.
8. **`A.RARITY.epic` is mutated in place** by `arkgrid-account.js:42-43`, and
   `cut-engine.js:19` holds a live reference. The extractor must read
   `solver.maxTurns` and `EPIC.maxRerolls` the same way, after the mutation.
9. **`cm` moves even when roster-bound** in `cut-engine.js:183`, but not in
   `nested.js:203`. Follow cut-engine — it is what the study runs.
10. **`change_gold_cost` is re-derived, not passed through.**
    `dp.js:824` maps it to `outcome.change > 0 ? 100 : -100`, where
    `cut-engine.js:183` uses `pick.change` directly. Identical today because the
    only rates are ±100 (`astrogem.js:191-192`); it would silently diverge if a
    ±50 row ever appeared.

---

## 7. Validation plan

### 7.1 The exact identity — do this one first

There is a no-noise check available, and it exercises the draw layer, the
threshold logic, the transitions and the gold ledger at once. Run the extractor
in **DP-mirror mode**:

- draw law = conditional Bernoulli (dp.js's `"wor"`),
- `allowReset = false` (start in phase B),
- fallback rule = `reroll if R ≥ C else complete`, matching `dp.js:585`,
- Process taken iff `P4 > K` where `K = max(C, R)` — ties to `K`, matching
  `max(K, P4)` in `_emax`,
- gold priced with `solver.procCost` (0 when roster-bound), not `procCostAt`.

Then, by the tower property, for every start state:

```
Σ_c  P(c)·solver.gemValue(c)  −  E[gold]   ==   solver.W(fresh, maxTurns, maxRerolls, 0)
```

to floating-point. Anything worse than ~1e-9 relative is a bug in the extractor,
not a modelling question. Run it across the same battery `verify-dp.js` uses —
base costs 8/9/10 × rarities × a few baselines × both axes — before a single
Monte-Carlo comparison.

Two cheap companions:

- **Mass conservation.** Every phase must end with total mass 1 (finished +
  dismantled). The probes above hit 1.000000000000 on a nine-turn sweep.
- **`Σ_i q_i == F`** at every state, and `Σ_i π_i == 1` for every class.

### 7.2 Against the Monte Carlo

Now switch to **game mode**: sequential-proportional draw law, `allowReset =
true`, `decide`'s tie order, gold at `procCostAt`. Compare against
`cutOneGem` over N gems from the same start state.

| quantity | MC estimator | sd (measured, epic c10, band 80, roster) | N for a 1%-of-the-mean standard error |
|---|---|---:|---|
| E[gold] | mean `res.spent` | 2,459 on a mean of 8,154 | ~900 |
| mean supportDamage of finished gems | mean over `processes > 0` | 0.0491 on a mean of 0.1189 | ~1,700 |
| P(processed) | share of `processes > 0` | binomial | trivial when p ≈ 1; at p = 0.0047 (paid, band 80) needs ~2·10⁶ |
| P(grade ≥ band) | share above the cut | binomial at p ≈ 0.044 / 0.006 / 0.0005 | 2·10⁵ / 1.6·10⁶ / 2·10⁷ |

Tolerance rule, borrowed from `verify-dp.js:22-27` because it is the right
shape: a quantity passes if

```
|Δ| ≤ max( REL_TOL·|MC| , K_SIGMA·MCstderr , ABS_FLOOR )
```

with `REL_TOL = 0.02`, `K_SIGMA = 4`, and an absolute floor per quantity (gold
50; probability 2·10⁻⁵). Report the σ-distance alongside the percentage — a
"20% miss" on a 5·10⁻⁴ band at N = 10⁵ is 0.7σ and means nothing.

Practical battery: N = 2·10⁵ gems (about 65 minutes) per cell, over

- bands 0 / 70 / 80 / 90 (0 exercises Reset — 0.554 resets a gem — and 80+
  exercises none),
- roster-bound **and** paid (paid at band 80 is the dismantle atom, P = 0.0047),
- base costs 8 / 9 / 10, all six pairs at one cost,
- maxTurns 9 and 7.

The tail bands (≥ 90) will not resolve to 1% at any affordable N. Hold them to
3σ and lean on §7.1, which has no error bar.

### 7.3 The distributional check

Beyond the four scalars, compare the whole thing: bucket the MC's finished
configs into the same 3,750 atoms and run a χ² over every atom with an expected
count of 20 or more, pooling the rest into one bin. This catches a mis-wired
transition that happens to preserve the mean — the failure mode the scalar
checks are blind to.

### 7.4 The draw-law regression

Run the extractor under both laws on one cell and report the gap. Expect the §1.6
numbers to show through: a total variation of ~0.05 per draw compounding over
nine turns. If the game-mode run matches the MC and the DP-mirror run matches
`W`, and the two disagree with each other by roughly that much, every piece is
where it should be.

---

## 8. Open decisions for the owner

1. **Which law is "the answer"?** Recommendation: sequential-proportional, since
   that is the game and the simulator, with conditional Bernoulli kept as the
   DP-mirror mode for §7.1. It means the published distribution is exact for the
   game while the *policy* it follows is still the one the shipped advisor
   computes from a conditional-Bernoulli value function — a faithful copy of
   what a player using the site actually gets, which is the right thing for a
   gold-per-damage chart.
2. **How much of the gold law to carry.** Two moments per finished config is
   cheap and preserves the correlation the account trace needs. A full joint
   lattice is possible and probably not worth it.
3. **Where the extractor lives.** It reads dp.js and cut-engine but writes
   nothing back. A `tools/dp-extract.js` in *this* repo keeps the astrogem
   calculator untouched, matching how §5's numbers were gathered.
4. **What the consumer swaps to.** `arkgrid-account.js:335-339` wants one gem at
   a time, so the drop-in is a cached table per
   (snapped band, gpd, base cost, pair, rarity) holding `final[3750]`,
   `finalGold[3750]`, `pDismantled` and a prefix-sum for sampling. The call
   becomes a binary search plus a gold read, and the six-second build is paid
   once per cell instead of 19 ms per gem — the account loop cuts thousands of
   gems per budget, so it pays for itself inside one account. Whether the trace
   should keep sampling at all, rather than carrying the exact distribution
   through the packer, is a bigger question and out of scope here.
