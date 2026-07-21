# The Math Behind Accessories — Video Script

*Structured, energetic, grounded first-person voice. No dramatic metaphors. Lines
in `[BRACKETS]` are on-screen / B-roll directions, not spoken. Every number is
pulled from the calculator (`accessory_value.py` / `index.html`); show the tool on
screen as you say it.*

---

## COLD OPEN (0:00–0:50)

[VISUAL: Reddit / forum posts about whether cutting accessories is worth it.
Then the cutting UI with a naked accessory.]

> There's an argument going around about accessories right now. For the longest
> time the common wisdom has been that cutting your own accessories is a trap - you
> spend more gold cutting than the result is ever worth, so most people just don't
> bother and buy off the market instead. But lately I've seen a bunch of posts
> claiming the opposite - that cutting is actually profitable, and people are
> missing free gold by not doing it.
>
> So which is it? And more importantly, what's the math that settles it?

[VISUAL: A line on an accessory, "+2%", then a question mark where a gold price
would be.]

> Here's the thing. Figuring out how much damage an accessory gives you is the easy
> part - we can do that with some pretty basic math. The hard part, the part nobody
> seems to agree on, is turning that damage into a gold value. And that's the
> number that decides whether cutting is worth it.
>
> So I built a calculator that does exactly that, from the drop rates up. Let me
> walk you through how it works, and then we'll settle the argument.

[TITLE CARD: "The Math Behind Accessories"]

---

## PART 1 — A QUICK REFRESHER (0:50–2:40)

[VISUAL: The Ark Passive cutting screen.]

> Real quick on the system, then we'll get into the interesting stuff. Every relic
> accessory can be cut up to three times. Each cut reveals one effect at low, mid,
> or high, and then it's locked - no rerolls.

[VISUAL: Table of the three tiers and their rates appearing.]

> And here are the odds, straight from the Korean rate disclosures - this is worth
> knowing off the top of your head. For any single effect, a cut has a 6.3% chance
> to land low, 3.0% for mid, and just 0.7% for high. That's 10% per effect, ten
> effects in the pool, so it all adds up to a clean 100%.

[VISUAL: Highlight the primary lines per slot.]

> Each slot has two lines that carry your damage. Necklace is Outgoing and
> Additional Damage. Earring is Attack Power and Weapon Attack Power percent. Ring
> is Crit Damage and Crit Rate. There's also two flat lines - flat Attack Power and
> flat Weapon Attack Power - that are good on basically anything, and hold on to
> that, because they matter way more than people think later on.

[VISUAL: Max HP line highlighted.]

> One thing I want to flag - Max HP is actually really good, even though it's not a
> damage line. Being able to survive a hit you'd otherwise die to is worth a lot in
> practice. My calculator only prices damage, so it treats Max HP as zero, and
> that's a genuine blind spot to keep in mind - a Max HP roll is worth more than my
> numbers say.

[VISUAL: The damage-per-line table.]

> As for the damage itself - this is the easy part. With real stats plugged in, a
> high Outgoing line is worth about 2%, a high Additional about 1.9%, and the lower
> tiers scale down from there. Calculating roughly how much damage an accessory
> gives is basically a solved problem.
>
> So that's not the question. The question is: what is that damage actually worth in
> gold? How do you go from "this gives me 2% more damage" to "this should sell for
> X"? That's the whole game, and that's what the calculator is really for.

---

## PART 2 — HOW THE CALCULATOR WORKS (2:40–8:00)

### 2A — The ground rules (assumptions) (2:40–3:20)

[VISUAL: Clean bulleted list.]

> Before the math, let me put my assumptions on the table, because everything
> downstream depends on them.
>
> One - I'm pricing for a DPS. Two - I bake in the Pheon tax, about 60,000 gold per
> accessory, since the buyer pays Pheons on top of your listing and you effectively
> eat it. Three - cuts cost 1,200 gold each. And four - the big one - I model buyer
> demand with the Pareto principle, the 80/20 rule. I'll explain why in a minute.
>
> Quick note on supports - all my numbers today are DPS accessories. Supports are a
> whole separate pool, and I'm working those out in a follow-up. As a rule of thumb,
> expect them to be worth roughly a third of the DPS equivalent. The supply is the
> same - same drop rates - but only about a third of players are supports, so the
> demand is a third. Same item, third of the buyers, third of the price.

### 2B — It all comes down to supply and demand (3:20–3:50)

[VISUAL: A supply curve and a demand curve on the same axes.]

> Okay. To price anything - an accessory, a stock, a banana - you need two things:
> supply and demand. How much of it exists, and how badly people want it. Get those
> two curves and the price falls out where they meet. So the entire job is building
> an honest supply curve and an honest demand curve for accessories. Let's do supply
> first.

### 2C — Supply is just rarity (3:50–4:30)

[VISUAL: The cutting tree branching out.]

> The supply of accessories is really the probability of getting them. There are a
> handful of incredible rolls and an ocean of garbage ones, and the shape of that -
> how often the game hands out each quality of accessory - is your supply curve.
>
> A perfect double-high is vanishingly rare. A single high with junk around it is
> common. So "supply" here isn't about how many people are farming - it's baked into
> the drop rates themselves. The rarer the roll, the thinner the supply.

### 2D — The recursive math behind the supply (4:30–5:30)

[VISUAL: Animate one cut, the pool shrinking, then the next cut.]

> Now, how do I get that supply curve exactly. This is where it gets a little
> nerdy, so stick with me.
>
> Each cut depends on the cuts before it. Remember, once an effect is locked, it
> leaves the pool and everything renormalizes - so your second cut is out of 90%,
> your third out of 80%. That means I can't treat the cuts independently. I have to
> walk the tree.
>
> So the calculator does this recursively. Start at the first cut, branch into every
> possible result with its probability, then from each of those branch into every
> possible second cut conditioned on what's already locked, then again for the
> third. Three cuts, a small enough tree, so I don't simulate anything - I just
> enumerate every single path and its exact probability. No Monte Carlo, no sampling
> error. And I check it two independent ways that have to agree to twelve decimal
> places. They do.
>
> The result is the complete supply curve - for every possible accessory, exactly
> how often the game produces it.

### 2E — Demand is the demand for damage (5:30–6:50)

[VISUAL: An accessory's lines collapsing into a single "+X% damage" number.]

> Now demand. And here's the key idea - nobody actually wants an accessory. What
> they want is the damage it gives. So the demand for accessories is really the
> demand for damage, and every accessory just gets boiled down to a single number:
> how much damage does this add.
>
> So how much will people pay per point of that damage? This is where the Pareto
> principle comes in. Picture the buyers. There are tons of people who want a cheap,
> solid upgrade, and they'll pay a modest amount. But the people chasing a true
> best-in-slot - the ones pushing world-first, the hardcore min-maxers - there are
> very few of them, and they are not price sensitive at all. They will pay almost
> anything for that last sliver of damage.
>
> That's a power law. The gold people will pay per point of damage stays low across
> all the common rolls, and then it climbs incredibly steeply right at the top end.
> A little more damage when you're already near the ceiling is worth wildly more
> than the same damage down in the middle. That steep top end is the whole reason a
> double-high sells for millions while a near-miss sells for scraps - and the Pareto
> curve captures it naturally.

### 2F — Turning damage into gold (6:50–8:00)

[VISUAL: Two anchor prices being typed in, the curve fitting to them.]

> Last piece - actually putting a gold number on it. A couple details here, kept
> short.
>
> First, computing the damage number itself. Damage in this game is multiplicative,
> not additive - a 2% line multiplies you by 1.02, and lines stack by multiplying,
> not adding. So I do the math in log space, where multiplying turns into adding,
> which keeps it exactly correct. Main stat gets handled with the square-root
> scaling and the support dilution it actually has. You don't need to track any of
> that - just know the damage number is honest.
>
> Then I take that Pareto demand curve and pin it to reality. For each slot I
> calibrate it to two real listings - the cheapest high-mid and the cheapest
> high-high on the auction house right now. The model fits its two demand parameters
> to reproduce those exact prices, then fills in everything in between with the math.
> Integrate the price across the damage, subtract the Pheon tax, and that's your
> gold value. If your server's prices are different, you type your own two anchors
> in and the whole thing recalculates live.

---

## PART 3 — THE RESULTS (8:00–11:00)

> Alright. We've got a supply curve and a demand curve, which means we can price any
> accessory in the game. Let me show you what falls out.

### 3A — How rare a good one really is (8:00–9:00)

[VISUAL: The strategy-3 primary tier grid. Highlight high/high.]

> First, rarity. If you cut a necklace all the way, the chance both primaries come
> out high is 0.033%. Three in ten thousand. And even being generous - counting
> every decent outcome, high-high on down through the okay mixes - it's still only
> about 1.5% of full cuts. So around 98 and a half percent of the time, you finish a
> cut and end up with something the market doesn't really want.

[VISUAL: The catalog, sorted by value, scrolling down to the zeros.]

> And the value follows that rarity hard. A clean high-high with a junk third line
> is about 3 million gold. Drop to mid-mid and you're around 42 thousand. Anything
> missing one of the two primaries is basically zero. A high-high at max main stat
> is about 3.9 million; that same necklace at mid-mid is about 42 thousand - a 90
> times difference from two tier upgrades on the exact same item. That gap is far
> bigger than it looks scrolling the auction house, which is exactly why eyeballing
> prices burns people.

### 3B — The flats are the sleeper (9:00–10:15)

[VISUAL: Side-by-side of high/mid useless vs high/mid + high flat.]

> Now here's the part I really want you to take away, because almost nobody prices
> it right - the flat lines.
>
> Remember those boring flat Attack Power and Weapon Attack lines. Watch what they're
> worth depending on what they're sitting on. On a mid-mid necklace, adding a high
> flat takes you from about 42 thousand to about 100 thousand - so the flat is worth
> around 59 thousand. On a high-mid, it takes you from about 570 thousand to about
> 930 thousand - the flat is now worth around 360 thousand. And on a high-high, a
> high flat takes you from 3 million to nearly 6 million - that one flat line is
> worth almost 3 million gold by itself.
>
> Same line, completely different value, because the demand curve is so much steeper
> the higher you already are. The better your accessory, the more a flat is worth on
> top of it.
>
> And this leads to the single most underrated item in the game. The best accessory
> you can possibly get, short of a double-high, is a high-mid with a high flat. At
> around 930 thousand, it sits way above a plain high-mid at 570. It's the bridge
> item - the closest thing to a high-high that most people will ever own - so it
> commands a real premium that a normal high-mid just doesn't. If you've got one of
> these sitting in your bank priced like a regular high-mid, you are underselling it.

---

## PART 4 — IS CUTTING ACTUALLY WORTH IT? (10:15–12:45)

> Okay. Back to the argument we opened with. Is cutting a trap, or is it free money?
> Now we can actually answer it.

[VISUAL: The "EV of cutting a naked accessory" table.]

> The tool computes the expected value of cutting - your average gold per attempt,
> counting every jackpot and every whiff, minus what you spend cutting. And the
> answer depends almost entirely on two things: your main stat roll, and how you
> cut.
>
> If you take a low main stat necklace and just blindly cut all three every time,
> you lose about 560 gold per attempt on average. That's a real loss. So the people
> saying cutting is a trap? They're right - if you cut like that.

[VISUAL: The optimal-policy decision table.]

> But that's the worst way to do it. The calculator compares three approaches. One -
> blindly cut all three no matter what. Two - only commit if your first cut is a
> primary at mid or better. And three - the mathematically optimal policy, where at
> every single step it checks whether one more cut has positive expected value and
> stops the instant it doesn't.
>
> And here's the punchline. Under that optimal policy, cutting is positive even on a
> low main stat base - about plus 470 gold instead of minus 560. On a mid main stat
> it's around plus 900, and on a high main stat it's pushing 1,700 gold per attempt.
> So the posts saying cutting is profitable? They're also right - if you play it
> properly.
>
> The whole disagreement comes from people comparing different strategies and
> assuming there's one answer. There isn't. Blind cutting can absolutely lose money.
> Optimal cutting is positive across the board. The entire difference is whether you
> walk away from a bad start, and the optimal policy walks away constantly - most
> attempts, it stops after one or two cuts, because chasing a dead accessory is
> exactly how the trap-believers lost their gold in the first place.
>
> So the real answer: yes, cutting is worth it - but only with a good main stat base
> and a stopping rule. Cut blindly and the skeptics are right. Cut with discipline
> and you're making a small, steady profit on top of the occasional jackpot.

### 4B — The short version (12:45–13:15)

[VISUAL: Three points on a clean card.]

> If you remember nothing else - three things.
>
> One - value is way more skewed than it looks. A two-tier upgrade can be a 90 times
> jump, and a high flat on a great accessory can be worth millions on its own. Stop
> underselling your good rolls.
>
> Two - whether cutting is worth it depends on your main stat and your discipline,
> not on a blanket yes or no.
>
> Three - cut with a stopping rule. Walking away from a bad start early is what turns
> cutting from a loss into a profit.

---

## OUTRO (13:15–14:00)

[VISUAL: The live calculator, plugging in the viewer's own anchors and stats.]

> Everything I showed you is a calculator that runs in your browser. You put in your
> own server's prices and your own stats, and it reprices the whole game live. It's
> built straight from the drop rates and a demand model you're welcome to argue
> with - every formula is open, so if you think I got an assumption wrong, go change
> it and see what happens. Link's in the description.
>
> Go check what your roster is actually sitting on - I'd bet a few of you are
> underpricing your good accessories and overpaying to cut your bad ones.
>
> Supports, I haven't forgotten you - your numbers are coming in the follow-up. If
> this was useful a like genuinely helps, and let me know if you want the gem
> breakdown next. Thanks for watching, and good luck with your cuts.

[END CARD]

---

## APPENDIX — numbers cited, with sources

All reproducible from the repo (necklace, mid main stat unless noted):

| Claim | Value | How to reproduce |
|---|---|---|
| Tier base rates | low 6.3% / mid 3.0% / high 0.7% | `TIER_BASE_PROB` |
| Necklace high-line damage | Outgoing 2.00% / Additional 1.91% (high) | `value ...` |
| P(both primaries high, full cut) | 0.033% | `strategy neck`, high/high cell |
| Sum of "good" buckets (full cut) | 1.501% | `strategy neck`, sum highlighted |
| Clean high/high (useless 3rd) | ~2.98M (mid) / ~3.4M (max) | `report` |
| high/high net @ max MS | ~3.92M | `value --type neck --main-stat 17857 ...` |
| mid/mid necklace | ~42.5k | `report` |
| **Flat premium — mid/mid** | 42.5k → 101k (+59k) | computed |
| **Flat premium — high/mid** | 572k → 930k (+358k) | computed |
| **Flat premium — high/high** | 2.98M → 5.90M (+2.91M) | computed |
| **Best non-high/high (high/mid + high flat)** | ~930k vs ~572k plain | `report` |
| EV cut neck, min MS, blind (S3) | −561g | `report` |
| EV cut neck, min MS, optimal | +469g | `report` |
| EV cut neck, mid MS, optimal | +919g | `report` |
| EV cut neck, max MS, optimal | +1,744g | `report` |
| Pheon (sale) tax | 60,000g | `SALE_TAX` |
| Cut cost | 1,200g | `CUT_COST` |

*Recording notes:*
- *Anchor prices in the repo are placeholders (neck hm 500k / hh 2.7M). Update to
  current market before quoting absolute gold on camera, or frame as "with these
  example prices."*
- *Support multiplier (~1/3) is a stated rule of thumb pending the follow-up
  session's exact numbers — present it as an estimate, not a computed result.*
- *Max HP is priced at 0 by the damage-only model; flagged on camera as a known
  limitation.*
