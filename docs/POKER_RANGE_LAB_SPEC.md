# Range Lab — the founder's specification (verbatim, received 2026-09-10)

> This is the specification as the founder wrote it, kept word for word so that the plan
> ([POKER_PLAN.md](POKER_PLAN.md) phase F) and the exploration report
> ([POKER_RANGE_LAB.md](POKER_RANGE_LAB.md)) can cite its sections (§4.2, §5.2, §6.1 …).
> Where implementation deviates from this text, the deviation is recorded in the plan step and
> in an ADR (ADR-027…029 in [POKER_DECISIONS.md](POKER_DECISIONS.md)), never silently. The
> decisions taken on 2026-09-10 (one Nuxt 4 app shell, server-side hand parsing, the `.bin`
> file kept out of git) are listed at the end of this file.

---

# Claude Code Implementation Prompt — "Range Lab" (FINAL)
### Range-thinking learning platform: stepped analyzer · weighted equity calculator · blocker analysis · pool-derived ranges · hand replayer

This document supersedes any earlier version.

---

## 0. How to use this prompt

Do **not** start writing application code immediately.

1. **Explore** my existing hand-analysis platform (hero hands + pool hands, ClickHouse-backed). Read the code, schema, API layer, and any existing frontend.
2. **Report back** in writing: the ClickHouse schema for hand histories, how a "node" (position + action sequence + street) is or can be represented, what query/API layer exists, the frontend stack and shared components already present, and the auth/session model.
3. **Propose** the integration surface: new endpoints, reusable existing queries, where the new packages live.
4. **Wait for my approval** before implementing Phase 1.

Then build in the phases in §14. Each phase ships working and tested before the next begins.

---

## 1. What we're building and why

I play NL2/NL5 6-max Rush & Cash on GGPoker/PokerOK. I already have a hand-analysis platform ingesting my own hand histories plus a pool database of ~9M anonymized GG Rush & Cash hands in ClickHouse. GG anonymizes opponents, so per-player reads are impossible — **aggregate pool statistics are my main edge**.

I want a **platform that trains me to think in ranges**, not another solver. The lesson it must teach: at every node, start from a preflop range, subtract the combos that would have taken a different action, bucket what survives, count nut combos on each side, check blockers, and decide from the distribution rather than from your own two cards.

What makes this different from GTO Wizard / Flopzilla / Equilab:

- **Stepped and pedagogical.** A fixed 9-step checklist drives every analysis, and at each step the user commits a prediction *before* the answer is revealed. Without that loop this is just another calculator.
- **Grounded in my real pool.** Empirical villain ranges, action frequencies and equity realization from my own database.
- **A persistent range library.** I import my existing preflop charts (Simple Preflop Holdem and others) once, and every situation thereafter shows my chart, the solver range and the pool range side by side.
- **Reusable everywhere.** The equity engine, range matrix, blocker panel, equity graph and replayer are standalone components usable from my other tools.

---

## 2. Existing solutions — what to learn from

| Project | License | Use it how |
|---|---|---|
| **PokerHandEvaluator / PHE** (`HenryRLee/PokerHandEvaluator`) | Apache-2.0 ✅ | **Use directly.** Perfect-hash 7-card evaluator, ~100KB tables, Cactus-Kev-compatible ranks (lower = stronger). WASM build published as `poker-hand-evaluator-wasm`; pure-JS port `phe`. Far faster than iterating 21 five-card combinations. |
| **PioSOLVER range syntax** | format, not code ✅ | Round-trip it so ranges move between tools. |
| **Flopzilla / Flopzilla Pro** | commercial, Windows-only | **UX reference only.** Its hand-class decomposition of a range against a board is the most intuition-building view in poker software. Reproduce the idea, write our own code. We are also replacing it for macOS. |
| **GTO Wizard** | commercial | **UX reference only.** Equity distribution graph, equity buckets, range comparison view. Our graph should be recognizably the same chart. |
| **Equilab / Power-Equilab** | freeware, Windows-only | UX reference for range notation shortcuts. |
| **WASM Postflop** (`b-inary/wasm-postflop`) | **AGPL-3.0 ❌** | **Do not use, vendor, copy, or derive from this source.** AGPL is incompatible with §3.1. You may use the *published web app* as a behavioural UX reference the way you'd use any commercial product; do not read its source with intent to reimplement. |

**Positioning:** we are not writing a solver. No CFR, no tree building. We compute equities, decompose ranges, analyse blockers, and surface empirical frequencies. When a strategy answer is needed, I bring it from GTO Wizard and the platform helps me reason about it.

---

## 3. Tech stack

- **Vue 3** (`<script setup>`, Composition API), **TypeScript strict**, **Vite**, **SPA** with **Vue Router**
- **Pinia** state · **Tailwind CSS** · **Chart.js** + `vue-chartjs` · **Comlink** (Worker RPC) · **Dexie** (IndexedDB) · **fflate** or **pako** (zlib, for binary range import)
- **Vitest** unit tests, **Playwright** smoke E2E
- Backend: extend my existing platform's API in its existing language and framework. Do not introduce a second backend stack.

### 3.1 Licensing — hard constraint

**Every dependency must be free for use in commercial, closed-source software.**

- **Allowed:** MIT, Apache-2.0, BSD-2/3-Clause, ISC, Unlicense, CC0, Zlib. MPL-2.0 is acceptable only for unmodified dependencies (file-level copyleft) — flag it for my review before adding.
- **Forbidden:** GPL (any version), **AGPL (any version)**, LGPL, SSPL, BUSL, Elastic License, Commons Clause, CC-BY-NC, and any "source-available"/non-OSI licence.
- Before adding **any** dependency, check its licence and every transitive licence.
- Add a **CI license-audit step** (e.g. `license-checker-rseidelsohn` or `license-compliance`, both MIT) that fails the build on any licence outside the allowlist. Configure it in Phase 1, not later.
- Maintain `LICENSES.md` at repo root: every direct dependency, its licence, and why it's acceptable.
- All stack choices in §3 are verified permissive, but **re-verify at install time** — licences change.

### 3.2 Repo structure

```
packages/
  poker-core/        # pure TS, no Vue/DOM. Cards, ranges, parsers, evaluator, equity engine,
                     # blockers, metrics, hand classification. Fully unit-tested. Standalone.
  poker-workers/     # Comlink wrappers around poker-core, WASM loading
  poker-importers/   # range file importers (text formats + binary). Pure TS, no UI.
  poker-ui/          # reusable Vue 3 components. Depends on poker-core only.
apps/
  range-lab/         # the SPA: routes, stores, API client, 9-step flow, training, replayer
```

**Hard rule:** nothing in `poker-ui` may import from `apps/range-lab`. Components take data via props and emit events. If a component needs pool data, it receives it as a prop — the app fetches it.

---

## 4. Core domain model (`poker-core`)

### 4.1 Cards and combos

```ts
// Rank 0..12 => 2,3,4,5,6,7,8,9,T,J,Q,K,A
// Suit 0..3  => c,d,h,s   (order matters for canonical serialization)
type Card = number;        // 0..51, card = rank * 4 + suit
type ComboIndex = number;  // 0..1325

// For two distinct cards a < b:  comboIndex = b * (b - 1) / 2 + a
// Provide O(1) conversion both directions.
```

### 4.2 Weighted range

```ts
interface WeightedRange {
  weights: Float32Array;  // length 1326, indexed by ComboIndex. 0 = not in range.
  label?: string;
}
```

Weights are arbitrary non-negative floats. **Not guaranteed ≤ 1** — real exports contain `1.005`, `0.996`. Accept them, expose `normalize()`, show a non-blocking warning when any weight exceeds 1.

Required pure, tested operations: `totalCombos`, `weightedCombos`, `removeCards(cards)`, `intersect`, `union`, `subtract`, `scale`, `normalize`, `filterByPredicate`, `toHandClassMatrix()` (1326 combos → 13×13 cells with weighted-average weight and combo count per cell), `diff(a, b)` (per-cell and per-combo weight delta, for the range comparison view).

### 4.3 Range text formats — parse and serialize both

**Format A — combo-level, must round-trip byte-identically:**

```
2d2c: 1,2h2c: 1,2h2d: 1,...,Tc9d: 1.005,...,Jc4c: 0.996,...,AsAh: 1
```

- Comma-separated entries; whitespace tolerated anywhere.
- Combo = two concatenated cards, `<Rank><suit>`, rank ∈ `23456789TJQKA`, suit ∈ `cdhs`. Accept either case on input; emit uppercase rank, lowercase suit.
- **Canonical card order within a combo:** higher rank first; equal ranks → higher suit first, with suit order `c < d < h < s`. Gives `2d2c`, `3s3h`, `AsKh`, `Tc9d`.
- **Canonical entry order:** ascending `ComboIndex`.
- Weight optional, defaults to `1`.
- **Write the round-trip test first:** parse then serialize a 1326-entry fixture and assert byte equality.

**Format B — hand-class / PioSOLVER-Equilab notation:**

```
AA,KK,QQ:0.75,JJ,AKs,AKo:0.5,AQs+,A5s-A2s,JTs+,KQo,76s
```

Support pairs, suited, offsuit, unpaired-both (`AK`), plus-notation (`JJ+`, `AQs+`, `JTs+`), dash ranges (`A5s-A2s`, `99-66`), optional `:weight`.

**Auto-detect** format on paste. Provide `parseRange(text): { range, format, warnings }` and `serializeRange(range, format)`. Every paste box accepts either; every range view offers "copy as combo format" and "copy as class format".

---

## 5. Equity engine (`poker-core` + `poker-workers`)

### 5.1 Evaluator

```ts
interface HandEvaluator {
  rank7(c0,c1,c2,c3,c4,c5,c6: Card): number; // lower = stronger
  ready(): Promise<void>;
}
```

Back it with PHE via WASM. Ship a pure-TS fallback so tests run without WASM, and assert the two agree on a large random fixture.

### 5.2 Range-vs-range equity — use this algorithm

Naive `hero × villain × runouts` is far too slow. Implement sort-and-prefix-sum.

**For each runout** (990 on the flop, 44 on the turn, 1 on the river; Monte Carlo preflop):

1. Evaluate `rank7` once per non-conflicting hero combo and once per villain combo (~2 × 1176 evaluations, not 1176²).
2. Sort villain combos by rank; build a prefix sum of villain weights over sorted order.
3. For each hero combo, binary-search its rank to get, in O(log n), the total villain weight it beats / ties / loses to.
4. **Correct card removal exactly**: subtract villain combos sharing a card with this hero combo. Each hero combo conflicts with at most 2 × 46 = 92 villain combos — subtract them explicitly. **Do not approximate this.** Blocker effects are the thing we're teaching.
5. Accumulate `equity = win + 0.5 × tie`, weighted by `w_hero × w_villain`.

Per-combo equity: `Σ(w_v × result) / Σ(w_v)` over non-conflicting villain combos, aggregated across runouts. Range equity is the weight-weighted mean.

**Required outputs:**

```ts
interface EquityResult {
  heroEquity: number;
  villainEquity: number;
  perComboEquity: Float32Array;         // 1326, hero — drives graph + heatmap
  perComboEquityVillain: Float32Array;
  perComboWinTieLose: { win: Float32Array; tie: Float32Array; lose: Float32Array };
  exact: boolean;
  iterations?: number;
  confidence95?: number;                // ± percentage points, Monte Carlo only
}
```

### 5.3 Performance and UX

- Everything runs in a Web Worker via Comlink. The UI never blocks.
- **Progressive refinement:** fire a fast Monte Carlo pass (~50k iterations) for an instant answer, then exact enumeration, updating when it lands. Always show which is displayed.
- Targets on an M-series Mac: flop exact ≤ 1.5s, turn ≤ 100ms, river ≤ 20ms, preflop MC (100k) ≤ 500ms.
- Cache on `hash(heroRange, villainRange, board, deadCards)`.
- Support cancellation — the user will drag ranges and retrigger constantly. Debounce input, cancel superseded jobs.

### 5.4 Multiway

Design interfaces for N players (Rush & Cash has multiway pots). First release may implement heads-up exactly and fall back to Monte Carlo for 3+.

---

## 6. Blocker analysis module (`poker-core/blockers`) — first-class feature

Blockers are the least intuitive part of range thinking and the hardest to eyeball, so give them a dedicated engine and dedicated UI.

### 6.1 Definitions to implement

Given hero candidate combo `h`, and villain's range split into a continuing part `V_call` and a folding part `V_fold`:

```
blockedCall(h)  = Σ weight of V_call  combos sharing ≥1 card with h
blockedFold(h)  = Σ weight of V_fold  combos sharing ≥1 card with h

removalCall(h)  = blockedCall(h) / totalWeight(V_call)     // fraction of calls removed
removalFold(h)  = blockedFold(h) / totalWeight(V_fold)     // fraction of folds removed

bluffScore(h)   = removalCall(h) - removalFold(h)          // higher = better bluff
valueScore(h)   = removalFold(h) - removalCall(h)          // higher = better thin value
```

The intuition the UI must convey: **a good bluff blocks their calls and unblocks their folds; a good thin value bet does the opposite.**

### 6.2 Required computations

- **Per-combo blocker table** for every combo in hero's range: `removalCall`, `removalFold`, `bluffScore`, `valueScore`, sortable.
- **Card-level blocker heatmap**: for each of the 52 cards, how much of villain's range that single card removes — overall and per hand class. Render as a 4×13 card grid heatmap. This answers "what does holding the A♣ actually do here?"
- **Hand-class removal breakdown**: for hero's selected combo, show exactly which of villain's classes lost combos and how many (e.g. "villain's flush draws: 7 → 2").
- **Bluff candidate ranking**: given a bet size, rank hero's non-value combos by `bluffScore`, showing how many bluffs the size actually calls for (`bluffs/value = alpha/(1-alpha)`) versus how many hero has.
- **Unblocker analysis**: the inverse — which combos most *avoid* removing villain's folding range.
- **Board-card blocker effects**: how the board itself removes combos from each range, shown as before/after counts.

### 6.3 Where it appears

Dedicated `/blockers` route (standalone tool), plus embedded in analyzer Step 5 (card removal) and Step 8 (river bluff selection). Also surfaces in the training modes.

---

## 7. Grouped combo distribution (`poker-core/distribution`)

A dedicated, always-available panel answering "what is actually in this range?" with **counts at every grouping level**. Every number shown as: raw combo count, weighted combo count, and % of range.

### 7.1 Grouping axes (all required, user-switchable, combinable)

**Made-hand class** — straight flush, quads, full house, flush, straight, set, trips, two pair, overpair, top pair, second pair, third pair, weak/under pair, ace high, king high, no pair.

**Draw class** — flush draw, backdoor flush draw, open-ended straight draw, gutshot, backdoor straight draw, combo draw (pair+draw, two draws), no draw. A combo can appear in both a made-hand and a draw group; make that explicit rather than forcing one bucket.

**Strategic category** — value / bluff-catcher / draw / air, with user-configurable equity thresholds and the thresholds visibly stated.

**Equity bucket** — 0–20, 20–40, 40–60, 60–80, 80–100, with counts per bucket.

**Structural** — pocket pairs / suited / offsuit, with the reminder counts (6 / 4 / 12 per hand class before removal).

**Nut bucket** — share of range in the top N% of the board's equity distribution.

### 7.2 Presentation

- Collapsible **tree view** with counts at every level, expandable down to the individual combos in any group.
- Clicking any group **filters the `RangeMatrix`** to highlight exactly those combos.
- Side-by-side hero vs villain columns with a delta column.
- **Export to CSV** and copy-as-text.
- Counts must update live as dead cards, board cards or weights change, with a visible before → after delta when the board changes.

---

## 8. Metrics module (`poker-core/metrics`) — exact formulas

Each is a pure function with a unit test containing a hand-worked expected value.

**Pot odds and sizing**
```
MDF            = pot / (pot + bet)
alpha          = bet / (pot + bet)              // MDF + alpha = 1
requiredEquity = call / (pot + bet + call)      // general form
               = bet  / (pot + 2 * bet)         // when facing a bet of `bet` into `pot`
bluffBreakeven = bet / (pot + bet)              // how often a bluff must work
oddsRatio      = (pot + bet) : bet              // display form, e.g. "3.2 : 1"
```

**Implied odds** — accept an estimated additional amount won on later streets and recompute required equity. Label it clearly as an estimate.

**Rake adjustment** — GG takes ~5% with a low cap at micro stakes. Accept `{ rakePct, rakeCapBB }`, expose `effectivePot(pot)`. **Every pot-odds and EV figure shows both raw and rake-adjusted values.**

**Equity realization**
```
EQR = (EV / pot) / equity        equivalently   EQR = EV / (pot × equity)
EV  = equity × EQR × pot
```
EQR > 1 over-realizes, < 1 under-realizes. We have no solver, so EQR comes from two sources: user-entered EV from a GTO Wizard solution, and **empirically from pool data** (§10.4). Always label which.

**Range advantage** — weighted mean equity per range and the difference; median equity; equity buckets as opposed stacked bars.

**Nut advantage** — combined equity distribution across both ranges; nut threshold switchable between (i) equity ≥ cutoff (default 80%) and (ii) top N% of the combined distribution (default 5%). Output each range's weighted share and the **nut share split** (`hero 78% / villain 22%`). Make this prominent — it drives bet sizing.

**Hand classification** — classify every combo against the board into the §7.1 made-hand and draw classes. This function backs both the distribution panel and the blocker breakdown.

---

## 9. Hand replayer with table (`poker-ui` + app)

A visual replayer, because reading a hand history as text defeats the purpose of a learning tool.

### 9.1 Table component (`PokerTable`)

- 6-max oval table rendered in **SVG/CSS** (no external table library — none are permissively licensed and good).
- Seats with position labels (UTG, HJ, CO, BTN, SB, BB), player stacks in bb and chips, dealer button, blinds posted.
- Hole cards for hero (and any showdown-revealed villain), board cards, pot size, side pots, chips committed per street shown in front of each seat.
- Current actor highlighted; last action shown as a chip-and-label bubble.
- Fully responsive; readable at laptop width alongside another window.

### 9.2 Replayer controls (`HandReplayer`)

- Step forward/back one action, jump to street (preflop/flop/turn/river/showdown), play/pause with adjustable speed, jump to any node in the action log.
- **Action log panel** listing every action with pot size and stack after; clicking a line seeks to it.
- **Keyboard:** `←`/`→` step, `space` play/pause, `1–4` jump to street.

### 9.3 Binding to analysis

This is the point of the replayer: **as you step through the hand, every analysis panel rebinds to the current node.**

- The range matrices show each player's range *at that node*.
- Equity, blockers, distribution, pot odds, MDF all recompute for the current node.
- Pool frequency data for the current node loads automatically with its tier badge.
- A "analyze this node" button opens the 9-step analyzer pre-populated from the replayer's current state.

### 9.4 Loading hands

Three sources, all required: pick from my hero-hands database (with filters), pick from the pool database, or paste a raw hand history. Write a **hand-history parser** for the GGPoker/PokerOK format, tolerant of malformed input, with clear parse errors.

---

## 10. Pool data integration

### 10.1 Node identity

A canonical `NodeKey` shared by ClickHouse queries and the frontend:

```ts
interface NodeKey {
  stake: 'NL2' | 'NL5' | string;
  tableSize: number;               // 6
  effectiveStackBB: number;        // bucketed: 80-120 => "100"
  heroPosition: Position;          // UTG|HJ|CO|BTN|SB|BB
  villainPosition: Position;
  actionSequence: ActionStep[];    // [UTG raise 2bb, BTN 3bet 7bb, UTG call]
  street: 'preflop'|'flop'|'turn'|'river';
  boardTexture?: TextureTag[];
}
```

Bet sizes **must be bucketed** (preflop 2–2.5bb, 2.5–3bb, …; postflop 0–35%, 35–55%, 55–80%, 80–120%, >120% pot) or sample sizes are useless. Buckets configurable in one place.

### 10.2 Endpoints

```
GET /api/pool/node/frequencies?node=<NodeKey>
  -> { actions:[{action,sizeBucket,count,frequency}], sampleSize, dateRange }

GET /api/pool/node/showdown-range?node=<NodeKey>
  -> { combos:[{combo,count}], sampleSize, showdownBiasWarning:true }

GET /api/pool/node/estimated-range?node=<NodeKey>&prior=<rangeText>
  -> { range:<combo-format>, confidence:'high'|'medium'|'low',
       sampleSize, method, perBucketSampleSizes }

GET /api/pool/node/eqr?node=<NodeKey>
  -> { byHandClass:[{class,meanNetBB,equity,eqr,sampleSize}] }

GET /api/hero/hands?filter=...
GET /api/hero/hand/:id
GET /api/pool/hands?filter=...
```

Reuse the existing query layer. Do not duplicate ClickHouse access logic.

### 10.3 Range estimation — three honest tiers

**The UI must always show which tier a range came from, plus its sample size.**

**Tier 1 — Action frequencies (unbiased).** Every hand records the action taken, so `P(fold)`, `P(call)`, `P(raise)` at a node are directly observable with no selection bias. The workhorse.

**Tier 2 — Showdown-observed combos (biased).** Hole cards are visible only at showdown, so this over-represents strong and stubborn hands. Display it, label it explicitly as showdown-only, and **never present it as "villain's range at this node."**

**Tier 3 — Bayesian reconstruction (headline feature).**

```
P(combo | action) ∝ P(action | combo) × P(combo)
```

- `P(combo)` = prior range at the node (my imported chart, a solver baseline, or the parent node's estimate).
- `P(action | combo)` isn't observable per combo, so estimate it **per hand-class bucket** using showdown data, and apply that frequency to every combo in the bucket.
- Reweight the prior, renormalize.
- **Report sample size per bucket.** Below a configurable threshold (default 200), fall back to the prior for that bucket and grey it out rather than inventing a number.
- **Validation view:** does the reconstructed range's implied action frequency reproduce the Tier-1 observed frequency? Show the discrepancy if not.

### 10.4 Empirical equity realization

Per node, per hand-class bucket: `meanNetBB` = average chips won/lost from that point; `equity` from our engine against the estimated opposing range; `EQR = (meanNetBB / pot) / equity`. This gives EQR for *my actual pool*, which no commercial tool can. Display alongside solver EQR when available.

---

## 11. Range library and importers

### 11.1 Library model

```ts
interface StoredRange {
  id: string;
  name: string;                    // "UTG RFI 2bb 100bb"
  situation: NodeKey;              // structured, so it can be looked up automatically
  source: 'imported'|'drawn'|'solver'|'pool';
  sourceTool?: string;             // "Simple Preflop Holdem", "GTO Wizard", ...
  range: WeightedRange;
  tags: string[];
  version: number;
  createdAt: Date; updatedAt: Date;
}
```

- Stored server-side (so it survives across machines) with a Dexie cache for offline use.
- **Automatic lookup:** anywhere the app knows the current `NodeKey`, it offers the matching stored range with one click. The analyzer, replayer and trainers all use this.
- **Three-way comparison view** for any situation: **My chart | Solver range | Pool range**, rendered as three matrices plus a diff heatmap and a table of the biggest per-cell disagreements. This is the single most valuable screen in the app for me — build it well.
- Versioning: editing a range creates a new version; keep history and allow revert.
- Browse/search/filter by position, action, stack depth, tag, source.

### 11.2 Bulk import

- Drag a **folder** of range files onto the app; it imports all of them.
- **Filename-to-situation inference** with a review step: parse names like `UTG_RFI_100bb`, `BTN_vs_UTG_3bet`, `BB_defend_vs_CO_2.5x` into a `NodeKey`, show the inferred mapping in an editable table, and let me correct before committing. Never import silently.
- Import report: how many ranges, how many situations matched, what failed and why.

### 11.3 Importers (`poker-importers`)

Each importer is a pure function `(bytes|string) => ImportResult` with fixture-based tests.

| Source | Format | Priority |
|---|---|---|
| **Simple Preflop Holdem — text export** | text, combo or class notation | **P0 — primary path.** SPH can copy ranges to clipboard as text; this round-trips reliably. Make this the documented, guaranteed workflow. |
| **Simple Preflop Holdem — `.bin`** | proprietary binary (see Appendix A) | **P2 — best-effort R&D, non-blocking.** Container and header are decoded; per-node strategies are not. Do not let this block any other phase. |
| GTO Wizard | text export | P1 |
| PioSOLVER | `#Range0#...` config lines and plain range text | P1 |
| Equilab / Flopzilla | text notation | P1 |
| Generic CSV | `situation,range,weight` | P1 |
| Our own JSON | full `StoredRange[]` export/import | P0 — needed for backup |

Every importer reports warnings rather than failing silently, and shows a preview matrix before committing.

---

## 12. Reusable components (`poker-ui`)

Standalone Vue 3 SFCs; props in, events out; no store access, no API calls; each with a usage example in the package README and a demo page.

| Component | Key props | Emits |
|---|---|---|
| `RangeMatrix` | `range`, `mode`, `heatmap?`, `selection?`, `highlightCombos?` | `update:range`, `cellClick`, `cellHover` |
| `ComboDrilldown` | `handClass`, `range`, `board` | `update:range` |
| `RangeTextIO` | `range`, `format` | `update:range`, `formatChange` |
| `RangeDiffView` | `ranges: {label, range}[]` | `cellClick` |
| `EquityCalculator` | `ranges`, `board`, `deadCards`, `rakeConfig` | `result` |
| `EquityDistributionChart` | `heroEquities`, `villainEquities`, `weights` | — |
| `EquityBucketBars` | `heroBuckets`, `villainBuckets` | — |
| `RangeComparisonPanel` | `hero`, `villain`, `board` | — |
| `ComboDistributionPanel` | `range`, `board`, `groupBy`, `compareRange?` | `groupClick`, `export` |
| `BlockerPanel` | `heroRange`, `villainCall`, `villainFold`, `selectedCombo?` | `comboSelect` |
| `CardBlockerHeatmap` | `villainRange`, `board` | `cardHover` |
| `BoardSelector` | `board`, `deadCards` | `update:board`, `update:deadCards` |
| `CardRemovalPanel` | `range`, `deadCards` | `update:deadCards` |
| `PotOddsPanel` | `pot`, `bet`, `call`, `impliedExtra?`, `rakeConfig` | `update:*` |
| `MDFPanel` | `pot`, `bet`, `rakeConfig`, `range?`, `equities?` | `update:pot`, `update:bet` |
| `EQRPanel` | `equity`, `ev?`, `pot`, `poolEqr?` | — |
| `PokerTable` | `seats`, `board`, `pot`, `activeSeat`, `lastAction` | `seatClick` |
| `HandReplayer` | `hand`, `currentActionIndex` | `update:currentActionIndex`, `nodeChange` |
| `PoolDataBadge` | `tier`, `sampleSize`, `confidence` | — |
| `PredictionGate` | `question`, `answerType`, `tolerance` | `submit`, `reveal` |
| `StepperNav` | `steps`, `current`, `completed` | `navigate` |

`RangeMatrix` specifics: weighted cells render as **partial fill** (AKo at 15% = bottom 15% of the cell filled). Drag to paint, shift-drag to erase, weight brush (100/75/50/25/custom), optional heatmap overlay with legend, board-blocked combos visibly greyed.

---

## 13. UX requirements — the app must be obvious to use

This is a learning tool. If I have to work out how to drive it, it has failed. These are requirements, not suggestions.

**Progressive disclosure.** Each screen has one primary job and one primary action. Advanced controls (nut threshold definition, MC iteration count, rake config, bucket boundaries) live behind a clearly-labelled "Advanced" disclosure, with sensible defaults that work untouched.

**No unexplained jargon.** Every metric label (MDF, alpha, EQR, nut advantage, blocker score, range advantage) has a hover/tap tooltip giving a one-sentence plain-language definition plus the formula. Maintain these in one glossary module so they're consistent everywhere.

**Explain the number, not just show it.** Next to key outputs, render a plain-language sentence: "You hold 78% of the nutted combos here — that supports a larger bet size." Generate these from templates driven by the computed values.

**Teaching empty states.** Every empty screen says what it's for and offers a concrete way to start ("Load a hand from your database", "Paste a range", "Try an example"), not a blank panel.

**Sensible defaults everywhere.** The app should be usable end-to-end without opening a single settings screen.

**Visible state.** Always show whether a number is exact or Monte Carlo, which range source is loaded, and which pool tier is in use. Never show a bare number of unclear provenance.

**Undo/redo** for all range editing, with `Cmd+Z` / `Cmd+Shift+Z`.

**Keyboard shortcuts, discoverable.** A `?` overlay lists them. Range editing, card selection, stepper navigation and the replayer are all fully keyboard-operable.

**No modal traps.** Prefer inline panels and side sheets. Any modal is dismissable with `Esc` and never loses work.

**First-run guided tour** — short, skippable, resumable from the help menu. Plus a permanent "Examples" section with 3–5 pre-loaded analyses to explore.

**Fast feedback.** Anything over 200ms shows a progress indicator with what's happening. Never a frozen UI.

**Dark mode** (I study at night), and readable at laptop width beside another window.

**Errors are actionable.** "Couldn't parse range at entry 47: `AKx` isn't valid notation. Did you mean `AKs` or `AKo`?" — never a stack trace or a silent failure.

---

## 14. Implementation phases

Ship each phase working, tested and reviewable before starting the next.

**Phase 0 — Exploration.** The written report and integration plan from §0. No production code.

**Phase 1 — `poker-core` foundation + licence CI.** Card/combo model, `WeightedRange`, both parsers/serializers with the byte-identical round-trip test, evaluator binding + pure-TS fallback with agreement tests, hand-class classifier. Licence audit in CI and `LICENSES.md`. Full unit coverage. No UI.

**Phase 2 — Equity engine.** Sort-and-prefix-sum with exact card-removal correction, exact + Monte Carlo, Worker wrapper, caching, cancellation. Validate against a fixture file of ≥30 known spots with expected equities. Meet §5.3 targets; include a benchmark script.

**Phase 3 — Blockers + distribution engines.** §6 and §7 computations, fully tested, still headless.

**Phase 4 — Core UI.** `RangeMatrix`, `ComboDrilldown`, `RangeTextIO`, `BoardSelector`, `CardRemovalPanel`, `EquityCalculator`, `ComboDistributionPanel`, `BlockerPanel`, `CardBlockerHeatmap`, plus the demo page. **At the end of this phase the app must already be a usable Flopzilla + Equilab replacement on macOS**, with blockers they don't have.

**Phase 5 — Metrics and visualization.** MDF/pot odds/EQR/advantage panels, `EquityDistributionChart`, `EquityBucketBars`, `RangeComparisonPanel`, `RangeDiffView`.

**Phase 6 — Range library and importers.** Storage, situation lookup, bulk folder import with the filename-inference review step, text importers (P0/P1), three-way comparison view, JSON backup export.

**Phase 7 — Hand replayer.** `PokerTable`, `HandReplayer`, GG hand-history parser, node-bound analysis panels, loading from hero and pool databases.

**Phase 8 — Pool integration.** §10.2 endpoints, Tiers 1 and 2, `PoolDataBadge`, sample-size gating everywhere.

**Phase 9 — The 9-step analyzer.** `PredictionGate`, `StepperNav`, all nine steps (§15), analysis persistence, hand loading.

**Phase 10 — Tier 3 reconstruction + empirical EQR**, with the frequency-validation view.

**Phase 11 — Training modes**, progress tracking, spaced repetition, heuristic log.

**Phase 12 — UX polish pass** against §13 as a checklist, first-run tour, examples, glossary coverage audit.

**Backlog (non-blocking) — `.bin` importer R&D** per Appendix A.

---

## 15. The 9-step analyzer

Route `/analyze/:analysisId`. Each step is a component under a shared layout with `StepperNav`. State in Pinia, autosaved to Dexie, optionally persisted server-side. A hand loads from the replayer, the hero database, a pasted history, or a manually constructed node.

Every step: **context → user does the work → user commits a prediction via `PredictionGate` → reveal and compare → user writes a one-line takeaway, saved to the analysis.**

1. **Assign preflop ranges.** Select the node; for each player draw, paste, or pick from the range library. Pool opening/3-betting frequency shown *after* the prediction. Combo counts and % of hands displayed.

2. **Subtract.** For each preflop action, split the acting player's range into fold/call/raise by painting on the matrix. Show resulting frequencies against the pool's actual Tier-1 frequencies. Render a before → after range diff, making explicit what the call removed from the **top** and the **bottom**. Output is the condensed, capped range carried to the flop.

3. **Bucket both ranges on the board.** `BoardSelector`, then `ComboDistributionPanel` for both ranges side by side. Prediction gate on "what % of villain's range is top pair or better?"

4. **Count nut combos each side.** `RangeComparisonPanel` nut-share split with switchable threshold. Prediction gate on the split. Explicit callout linking the result to bet sizing.

5. **Card removal and blockers.** `CardRemovalPanel` + `BlockerPanel` + `CardBlockerHeatmap`. User enters their hand; app shows which of villain's combo groups became impossible and how many combos each lost. Prediction gate: "how many flush draws can villain have?"

6. **Frequency from range advantage, size from nut advantage.** Mean equity delta and nut share shown together with board texture tags. User commits a bet/check decision, frequency and size. Reveal shows pool data and, if pasted, GTO Wizard's strategy. **We structure the comparison; we do not generate a solver answer.**

7. **Place hero's hand inside hero's own range.** Matrix highlights hero's combo, its equity percentile within hero's own range, and its hand class. User classifies it as value / protection / semi-bluff / give-up; app shows where it actually sits.

8. **River: count own value vs own bluffs.** User marks their own range's value and bluff portions. App counts weighted combos in each, computes the implied ratio, compares to the balanced ratio for the chosen size (`bluffs/value = alpha/(1-alpha)`; pot-size → 1:2), and flags over/under-bluffing. Then ranks candidate bluffs by `bluffScore` from §6.

9. **MDF anchor, then pool deviation.** `MDFPanel` and `PotOddsPanel` for the baseline, then the pool's actual fold frequency with its badge. State the deviation plainly: theory says X, my pool folds Y, therefore bluff more/less. User writes the final heuristic; it saves to the heuristic log.

---

## 16. Training modes

Route `/train`. All modes use `PredictionGate` and write to one scoring store.

- **Equity trainer** — guess hero's equity; scored against tolerance (default ±3pp). Tiers: hand-vs-range → range-vs-range preflop → range-vs-range on a flop.
- **Combo counting trainer** — "how many combos of X does this range contain?", including card-removal variants.
- **Range drawing trainer** — draw a node's range from memory; scored against a reference with total absolute weight error plus a per-cell mistake heatmap.
- **Blocker trainer** — given hero's range, villain's calling range and a size, pick the best bluff candidate; scored against `bluffScore` ranking.
- **Nut/range advantage trainer** — predict which side has each and the nut share split.
- **Pot odds / MDF trainer** — quick-fire pot/bet → MDF, alpha, required equity, bluff breakeven, raw and rake-adjusted.

**Scoring store:** `{ mode, spotHash, prediction, actual, error, timestamp }` in Dexie. A `/progress` route charts accuracy per mode over time, and per hand class or texture where applicable. **Spaced repetition:** re-serve missed spots at increasing intervals.

**Heuristic log:** persistent list of step-9 takeaways, each linked to its analysis, tagged by texture/position/street, with a "still true?" review prompt after 14 days.

---

## 17. Non-functional requirements

- **Correctness over features.** Every §8 formula gets a unit test with a hand-worked expected value. Equity gets a fixture suite. I will make real money decisions from these numbers.
- **Never fabricate a pool number.** Below the sample threshold, show "insufficient data". Every pool value carries tier, sample size and confidence.
- **Offline-capable for pure calculation.** Equity calculator, range editor, blockers, distribution and trainers must work with no backend; only pool features need the API.
- **Keyboard-first** throughout.
- **No premature abstraction.** Build the concrete thing well; extract when the second use case appears.
- **Comment the non-obvious** — combo indexing, the card-removal correction in the equity loop, blocker score derivation, Bayesian reweighting, and anything decoded in Appendix A. I will read and modify this code.

---

## 18. Acceptance criteria

Done when I can:

1. Paste a 1326-entry combo-format range, edit it visually, copy it back, and get a byte-identical string.
2. Paste `AA,KK,QQ:0.75,AKs,AKo:0.5,A5s-A2s` and see correct partial-fill weighted cells.
3. Set a board and get exact range-vs-range equity in under 1.5s, with the equity distribution graph for both players.
4. See the grouped combo distribution for both ranges — counts by made-hand class, draw class, strategic category and equity bucket — and click any group to filter the matrix.
5. Enter my hand and see exactly which villain combos it kills, plus a ranked bluff-candidate table by blocker score.
6. See pot odds, required equity, MDF, alpha and bluff breakeven, raw and rake-adjusted, for any node.
7. Bulk-import my preflop charts from a folder, review the inferred situation mapping, and afterwards see **my chart, the solver range and the pool range side by side** for any situation.
8. Load a real hand from my database, step through it on a visual table, and watch every analysis panel rebind to the current node.
9. Run all 9 steps on that hand, committing a prediction at each, ending with a saved heuristic.
10. See, at any node, what my actual pool does — with tier, sample size and confidence on every number.
11. Train for 10 minutes and see my accuracy trend over the past month.
12. Import `EquityCalculator` and `RangeMatrix` into another app in my repo with a single import and no app-specific wiring.
13. Run `npm run license-check` and see a clean report with no copyleft dependencies.

---

## Appendix A — Simple Preflop Holdem `.bin` format (partial decode)

I reverse-engineered `6Max_Calculated_Preflop_Ranges.bin` (3,727,413 bytes). Everything below is **verified**; start from it rather than rediscovering it. Treat completing this as backlog R&D — text import is the guaranteed path.

### A.1 Container (fully decoded ✅)

```
offset 0   : magic  CA 9A 2D EC                (4 bytes)
offset 4   : repeated { uint32 LE compressedLength ; zlib stream (starts 78 9C) }
```

The sample file contains exactly two streams:

| Stream | Compressed | Decompressed | Contents |
|---|---|---|---|
| 0 | 1,557,846 | 18,656,418 | Game data — header, player ranges, node/strategy records |
| 1 | 2,169,555 | 13,023,995 | Serialized C++ object graph containing raw 64-bit pointers (tree structure/metadata) |

Parsing the length-prefixed chunks consumes the file exactly to EOF — the container structure is confirmed.

### A.2 Stream 0 header (fully decoded ✅)

```
uint32   106        // node / situation count (unconfirmed semantics)
float32  0.0        // ante
float32  5.0        // small blind, in chips
float32  10.0       // big blind, in chips
uint32   0          // unknown
uint32   6          // number of players
```

Blinds of 5/10 with a 1000 stack ⇒ **chips where BB = 10, stacks 100bb**.

### A.3 Player block (fully decoded ✅)

Immediately after the 24-byte header, repeated **6 times** (once per player, seat order unconfirmed):

```
float32[1326]   starting range weights   (all 1.0 in this file — full range)
float32         stack in chips           (1000.0 = 100bb)
```

Block size = 6 × 1327 × 4 = 31,848 bytes. Player data ends at byte **31,872**.

### A.4 Node / strategy section (NOT decoded ⚠️)

Begins at byte 31,872. What's established:

- Opens with 128 zero bytes, then a run of `1.0` float32 values.
- A whole-stream scan for contiguous runs of ≥1326 floats within `[0,1]` finds **exactly 6 runs — the six starting ranges and nothing else**. Per-node strategies are therefore **not** stored as plain contiguous 1326-float arrays.
- The section mixes probability values with metadata: common values include small integers (2.0, 3.0, 5.0, 25.0, 40.0, 85.0 — likely action codes and bet sizes in chips), 1000.0 and 2005.0 (stacks/pots), and values around 1e22–1e31 which are almost certainly 64-bit pointers reinterpreted as float32.

**Suggested approach if picking this up:** cross-reference stream 1 (the pointer graph) to recover the node tree, since strategies are probably stored as variable-length per-node records referenced from it. Determine the 1326-combo ordering empirically by decoding one known node (e.g. UTG RFI) and checking that AA is present and 72o absent under each candidate ordering.

**Do not let this block anything.** The P0 workflow is: export ranges from Simple Preflop Holdem as text, bulk-import the folder, review the inferred situation mapping.

---

## Decisions taken against this text (2026-09-10, founder)

| Spec says | Decision | Recorded in |
|---|---|---|
| §3 Vite SPA with Vue Router; §3.2 `apps/range-lab` | One **Nuxt 4 app in SPA mode** (`platform/web/apps/web`) hosts both the phase-D dashboard and the Range Lab routes; `packages/*` stay framework-free exactly as §3.2 | ADR-027, plan F.1/F.4 |
| §9.4 write a GG hand-history parser in TypeScript | **Server-side only**: `POST /v1/hands/parse` reuses the Python parser (pot-math checked on 9M hands); pasting a hand needs the API, pure calculators stay offline | ADR-029, plan F.7 |
| Appendix A sample file | `6Max Calculated Preflop Ranges.bin` stays **out of git** (`*.bin` ignored); a trimmed fixture is committed when the importer R&D starts | plan F.6, backlog |
| §0 "wait for approval before Phase 1" | The founder's instruction was "analyze, add to plan, start to implement"; Phase 1 started the same day after the four decisions above were confirmed | plan §6 log |
