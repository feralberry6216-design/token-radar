# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/feralberry6216-design/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/feralberry6216-design/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot and ranks 198 pre-token protocols by an implied launch value computed only from the snapshot's own figures — TVL × a per-category multiple × a 7-day growth factor × a maturity factor × a chain-breadth factor. The multiples are calibrated, not asserted: for every category with at least five tokenised peers in the snapshot, the multiple is the median market cap per $1 of TVL those launched peers actually trade at (lending 0.132×, DEXs 0.342×, yield 0.191×, RWA 0.275×, basis trading 0.654×); categories with fewer peers keep an estimated multiple. One business type is priced by its own rule: vault curators and capital allocators, whose reported TVL is third-party assets under management sitting inside host protocols (and counted in those hosts' TVL too). A curator's own business is the management/performance fee stream on that AUM, so curator rows are priced as asset managers at 0.264× TVL — twice the lending median — via the curator categories plus a short named list of curator businesses filed under other categories. Every protocol on the snapshot's watchlist is covered, wrapped/staked/bridged products of already-trading tokens are excluded, and protocols whose token already trades appear only in a separate calibration view with their real market caps. Each ranked protocol carries a concrete five-step farm plan with costs and time estimates, and the dashboard is sortable, filterable and searchable, with a detail view per protocol.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
