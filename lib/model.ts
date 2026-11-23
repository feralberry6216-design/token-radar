// Token Launch Radar — the valuation model and farm-plan generator.
//
// Input: the sealed DefiLlama snapshot (758 protocols, ten fields each, plus the house watchlist).
// Output: a ranked board of pre-token protocols and everything the dashboard renders.
//
// A protocol counts as pre-token when the snapshot records no token for it (mcap_usd, gecko_id and
// symbol all null). Protocols that already trade are never ranked here; the dashboard shows the
// largest of them separately, with the market's own capitalisation, as a calibration strip.
//
// THE MODEL. Implied value (the fully-diluted value a launch would need to match the protocol's
// current record) is a product of five terms, every one derived from the snapshot's own figures:
//
//   implied = TVL x category multiple x growth factor x maturity factor x breadth factor
//
//   category multiple  what one dollar of TVL is worth as FDV for this kind of protocol, set from
//                      how tokenised peers of the same category trade: fee businesses whose value
//                      is not the deposits themselves (curators, allocators, launchpads) score
//                      high; pass-through wrappers (liquid staking) score low.
//   growth factor      clamp(1 + clamp(change_7d, -40, +60) / 100 x 1.8, 0.6, 2.1): a hot week is
//                      momentum, a cold week a discount, both damped so one week cannot dominate.
//   maturity factor    0.78 + 0.42 x min(age_days, 1460) / 1460: a protocol that has run for
//                      years with no token has a record a launch can be priced on; a two-week-old
//                      one does not. Unknown listing date counts as 365 days.
//   breadth factor     1 + 0.03 x min(chains - 1, 8): distribution across chains is worth a
//                      premium, capped at eight extra chains.
//
// No protocol name is special-cased anywhere: the same five terms score every row, and the board
// order is implied value descending, TVL descending, slug ascending — a total order, so two runs
// of the program write byte-identical output.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's knobs, exported so the dashboard can print the exact formula it runs. */
export const MODEL = {
  version: 'launch-radar-2',
  growth_weight: 1.8,
  growth_input_floor: -40,
  growth_input_cap: 60,
  growth_floor: 0.6,
  growth_cap: 2.1,
  maturity_base: 0.78,
  maturity_span: 0.42,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_extra_chains: 8,
  default_multiple: 1.0,
};

/** FDV per $1 of TVL by category: what a launch of this kind of protocol is priced against. */
export const CATEGORY_MULTIPLES: Record<string, number> = {
  'Chain': 3.0,
  'Launchpad': 2.6,
  'Prediction Market': 2.4,
  'Risk Curators': 2.2,
  'AI Agents': 2.2,
  'Decentralized AI': 2.0,
  'Derivatives': 1.8,
  'Onchain Capital Allocator': 1.8,
  'Dexs': 1.7,
  'Payments': 1.6,
  'Privacy': 1.6,
  'Options': 1.4,
  'RWA': 1.3,
  'Synthetics': 1.3,
  'Yield': 1.25,
  'Insurance': 1.2,
  'NFT Marketplace': 1.2,
  'Lending': 1.15,
  'Yield Aggregator': 1.0,
  'Basis Trading': 1.0,
  'CDP': 0.95,
  'Indexes': 0.9,
  'Stablecoin Issuer': 0.9,
  'Restaking': 0.85,
  'Bridge': 0.85,
  'Cross Chain Bridge': 0.85,
  'Leveraged Farming': 0.8,
  'Farm': 0.8,
  'Canonical Bridge': 0.8,
  'Dual-Token Stablecoin': 0.8,
  'Liquid Restaking': 0.75,
  'Algo-Stables': 0.7,
  'Staking Pool': 0.65,
  'Liquid Staking': 0.55,
};

/** Keyword fallbacks for categories the table does not name, checked in order. */
const MULTIPLE_HINTS: [string, number][] = [
  ['staking', 0.6],
  ['restak', 0.8],
  ['bridge', 0.85],
  ['lend', 1.15],
  ['dex', 1.7],
  ['deriv', 1.8],
  ['option', 1.4],
  ['yield', 1.15],
  ['stable', 0.85],
  ['rwa', 1.3],
];

/** The category multiple for one protocol: exact table first, then keyword hints, then the default. */
export function categoryMultiple(category: string | null): number {
  if (category !== null) {
    const exact = CATEGORY_MULTIPLES[category];
    if (exact !== undefined) return exact;
    const lower = category.toLowerCase();
    for (const [hint, value] of MULTIPLE_HINTS) if (lower.includes(hint)) return value;
  }
  return MODEL.default_multiple;
}

const DAY_MS = 86_400_000;

/** Whole days between the listing date and the snapshot date; null when either is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The five model terms for one protocol. */
export interface Factors {
  multiple: number;
  growth: number;
  maturity: number;
  breadth: number;
  age_days: number | null;
}

/** Score one pre-token protocol: its factors and its implied value in whole dollars. */
export function score(p: Protocol, asOf: string): { implied: number; factors: Factors } {
  const age = ageDays(asOf, p.listed_at);
  const multiple = categoryMultiple(p.category);
  const rawChange = p.change_7d === null ? 0 : p.change_7d;
  const change = Math.min(MODEL.growth_input_cap, Math.max(MODEL.growth_input_floor, rawChange));
  const growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, 1 + (change / 100) * MODEL.growth_weight));
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturity = MODEL.maturity_base + (Math.min(ageForModel, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_span;
  const extraChains = Math.max(0, Math.min(p.chains.length - 1, MODEL.breadth_max_extra_chains));
  const breadth = 1 + MODEL.breadth_per_chain * extraChains;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity * breadth));
  return { implied, factors: { multiple, growth, maturity, breadth, age_days: age } };
}

/** Whether the snapshot records no token for this protocol. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version marker: a name ending in a release number is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Exchange house products: names that open with an exchange's name are not independent launches. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Wrapped/staked product names: a wrapper of a traded asset is not a launch of its own. */
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Product categories, as the snapshot's own watchlist definition names them (input/README.md):
 * a bridge, canonical bridge, liquid (re)staking or restaked-BTC entry in DefiLlama's record is a
 * wrapped, staked or bridged product of an asset that already trades — WBTC and USDT0 are the
 * README's own examples — not a protocol awaiting a launch of its own. The first board run ranked
 * WBTC #3 on exactly this mistake, which is why the categories are excluded here in terms, not by
 * naming the offenders.
 */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/**
 * Whether a pre-token protocol may join the board beyond the watchlist floor: not an exchange
 * product, not a versioned pool, not a wrapper of a traded asset, not a product category, not a CEX.
 */
export function isRankable(p: Protocol): boolean {
  return (
    isPreToken(p) &&
    p.category !== 'CEX' &&
    !(p.category !== null && PRODUCT_CATEGORIES.has(p.category)) &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !WRAPPER_WORD.test(p.name)
  );
}

// ------------------------------------------------------------------ farm plans
//
// A plan is five steps: set up, act, repeat, boost, monitor. The words come from a playbook keyed
// by category; the numbers come from the protocol's own record — its main chain sets the gas cost,
// its TVL sets the suggested position, its age sets the qualifying window. No step is a slogan:
// each names an action, an approximate cost and a time commitment.

/** Approximate cost of one transaction on a chain, in dollars, by chain name. */
const GAS_USD: Record<string, number> = {
  Ethereum: 12, Bitcoin: 5, Solana: 0.3, Tron: 1.2, Avalanche: 0.8, Binance: 0.6, Polygon: 0.15,
};

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 0.9;
}

function money(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2).replace(/\.?0+$/, '')}`;
}

/** The chain the plan works on: the first the snapshot lists, else a neutral phrase. */
function mainChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Suggested position size, tiered by the protocol's own TVL. */
function positionFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 350;
  if (tvl >= 50_000_000) return 250;
  if (tvl >= 10_000_000) return 150;
  return 100;
}

/** Qualifying window in weeks, from the protocol's age: younger launches get a longer runway. */
function weeksFor(age: number | null): number {
  if (age === null) return 8;
  if (age < 180) return 10;
  if (age < 365) return 8;
  if (age < 730) return 6;
  return 5;
}

interface Playbook {
  act: (p: Protocol, chain: string, position: number) => string;
  weekly: string;
  boost: string;
}

const PLAYBOOKS: [string, Playbook][] = [
  ['curator', {
    act: (p, chain, pos) => `Deposit ${money(pos)} of USDC into one of ${p.name}'s curated vaults on ${chain}, choosing the vault with the deepest liquidity so entry and exit stay cheap`,
    weekly: 'rebalance into the vault the curator is featuring that week, or top the position up by a small amount',
    boost: 'Hold the vault shares in the same wallet for the whole window; curator points and any future distribution are counted on time-weighted balances, not on deposits alone',
  }],
  ['allocator', {
    act: (p, chain, pos) => `Allocate ${money(pos)} through ${p.name} on ${chain} into its flagship strategy and keep the strategy shares untouched`,
    weekly: 'add a small top-up or claim and restake the strategy rewards so the wallet shows continuous use',
    boost: 'Use one of the allocator\'s partner integrations (a lending market that accepts its shares as collateral) once, which is the pattern allocator airdrops usually reward',
  }],
  ['dex', {
    act: (p, chain, pos) => `Provide ${money(pos)} of liquidity to ${p.name}'s deepest pool on ${chain} (the highest-volume pair), in a range tight enough to earn fees but wide enough to survive a normal week`,
    weekly: 'route your swaps through the exchange and rebalance the position if it drifts out of range',
    boost: 'Keep the LP position open across the weekly fee snapshot and vote with any governance or veNFT position the pool issues',
  }],
  ['lend', {
    act: (p, chain, pos) => `Supply ${money(pos)} of USDC as collateral on ${p.name} (${chain}) and borrow about 30% of it back in the same asset, then re-supply the borrowed amount once`,
    weekly: 'check the health factor, repay and re-borrow a small amount so the wallet records genuine borrowing activity',
    boost: 'Hold both sides of the position (supplied and borrowed) for the full window; lending airdrops typically weight borrowers over passive suppliers',
  }],
  ['cdp', {
    act: (p, chain, pos) => `Open a vault on ${p.name} (${chain}) with ${money(pos)} of collateral and mint roughly 40% of its value in the protocol's stablecoin, keeping the liquidation price far below the market`,
    weekly: 'top up collateral or repay a slice of the minted debt so the vault shows active management',
    boost: 'Use the minted stablecoin inside the protocol\'s own ecosystem (its savings vault or a partner pool) rather than selling it, which counts as product usage on both sides',
  }],
  ['liquid staking', {
    act: (p, chain, pos) => `Stake ${money(pos)} of the native asset through ${p.name} on ${chain} and keep the liquid staking receipt in the farming wallet`,
    weekly: 'stake a small additional amount so the balance grows steadily instead of arriving in one lump',
    boost: 'Deploy the receipt token once in a partner money market or LP on the same chain; stacked usage is what separates farmers from passive holders in most distributions',
  }],
  ['restak', {
    act: (p, chain, pos) => `Restake ${money(pos)} worth of a liquid staking token through ${p.name} on ${chain} and pick the default operator set rather than a custom one`,
    weekly: 'claim and restake the rewards, and re-check the operator set for slashing or exit news',
    boost: 'Hold through at least one full points epoch without withdrawing; restaking distributions are counted on time-weighted restaked balances',
  }],
  ['staking', {
    act: (p, chain, pos) => `Stake ${money(pos)} of the chain's staking asset through ${p.name} on ${chain} and keep the staking receipt`,
    weekly: 'compound the staking rewards back into the same position',
    boost: 'Stay staked across the whole window; unstaking and restaking resets the holding period most snapshots measure',
  }],
  ['bridge', {
    act: (p, chain, pos) => `Bridge ${money(pos)} of USDC through ${p.name} to ${chain === 'Ethereum' ? 'a destination chain it serves' : chain} and put the bridged funds to work in one app on the far side`,
    weekly: 'bridge a smaller amount in the opposite direction or to a second destination chain the bridge serves',
    boost: 'Use the bridge\'s own front end rather than an aggregator for at least some transfers, and keep volume spread over weeks instead of one large crossing',
  }],
  ['derivative', {
    act: (p, chain, pos) => `Deposit ${money(pos)} of USDC as margin on ${p.name} (${chain}) and open one small hedged position (long and short legs of similar size) so volume accrues without directional risk`,
    weekly: 'roll the hedge and trade a small amount so the account records recurring volume, not a single spike',
    boost: 'Keep margin on the venue for the full window and use one extra product (a vault, an options leg or a different market) if the venue offers it',
  }],
  ['perpetual', {
    act: (p, chain, pos) => `Deposit ${money(pos)} of USDC as margin on ${p.name} (${chain}) and open one small hedged position (long and short legs of similar size) so volume accrues without directional risk`,
    weekly: 'roll the hedge and trade a small amount so the account records recurring volume, not a single spike',
    boost: 'Keep margin on the venue for the full window and try a second market on the same venue',
  }],
  ['option', {
    act: (p, chain, pos) => `Deposit ${money(pos)} into one of ${p.name}'s options vaults on ${chain}, or buy one small far-dated option if the venue is an order book`,
    weekly: 'let the vault roll into its next epoch and add a small top-up at the roll',
    boost: 'Stay through several consecutive epochs; options vault distributions favour wallets that survive multiple rolls',
  }],
  ['yield', {
    act: (p, chain, pos) => `Deposit ${money(pos)} of USDC into ${p.name}'s main vault on ${chain} and keep the vault shares in the farming wallet`,
    weekly: 'claim the harvest and redeposit it so the position compounds on the record',
    boost: 'Hold the shares across the weekly reward snapshot and avoid withdrawing in the same week as a deposit',
  }],
  ['rwa', {
    act: (p, chain, pos) => `Subscribe ${money(pos)} to ${p.name}'s yield asset on ${chain} (complete its onboarding or KYC step if the asset requires one) and hold the asset`,
    weekly: 'check the reported yield and add a small top-up if subscriptions are open',
    boost: 'Hold past at least one full distribution cycle; real-world-asset launches count completed cycles, not days',
  }],
  ['launchpad', {
    act: (p, chain, pos) => `Stake or hold ${money(pos)} in the asset ${p.name} uses for allocation tiers on ${chain} and register the wallet for the next sale round`,
    weekly: 'check the sale calendar and complete any whitelist or KYC task for the upcoming round while it is cheap',
    boost: 'Actually participate in one sale, even at the minimum allocation; participants rank above idle stakers in launchpad distributions',
  }],
  ['prediction', {
    act: (p, chain, pos) => `Fund a ${p.name} account with ${money(pos)} and take positions in two or three of its most liquid markets on ${chain}`,
    weekly: 'trade out of one position and into another so the account shows recurring, two-sided activity',
    boost: 'Hold at least one position to settlement; settled volume is the metric prediction venues can verify on-chain',
  }],
  ['chain', {
    act: (p, chain, pos) => `Bridge ${money(pos)} to ${p.name}'s chain and make it your active chain: hold the gas token, use two native apps and keep a balance there`,
    weekly: 'make a handful of ordinary transactions (a swap, a transfer, a contract interaction) so the wallet looks like a resident, not a tourist',
    boost: 'Use the chain\'s flagship native protocols (its main DEX and lending market) — chain launches weight their own ecosystem\'s users',
  }],
  ['insurance', {
    act: (p, chain, pos) => `Supply ${money(pos)} of underwriting capital to ${p.name} on ${chain}, or buy one cover policy for a position you actually hold`,
    weekly: 'check the pool\'s capacity and renew or extend the cover before it lapses',
    boost: 'Keep capital supplied across a full cover period; underwriting distributions count completed risk periods',
  }],
  ['index', {
    act: (p, chain, pos) => `Mint ${money(pos)} of ${p.name}'s index token on ${chain} through its own app and hold the token`,
    weekly: 'add a small mint or rebalance alongside the index so the wallet shows recurring use',
    boost: 'Hold through an index rebalance; holders at rebalance are the easiest cohort to snapshot',
  }],
  ['payment', {
    act: (p, chain, pos) => `Fund a ${p.name} balance with ${money(pos)} on ${chain} and route one real payment or transfer through it`,
    weekly: 'make one more payment or top-up so the account shows a pattern of use, not a single deposit',
    boost: 'Keep a balance on the platform between payments; payment launches reward retained balances and repeat senders',
  }],
  ['stable', {
    act: (p, chain, pos) => `Mint or deposit ${money(pos)} of the stable asset through ${p.name} on ${chain} and hold it in the farming wallet`,
    weekly: 'mint or deposit a small additional amount and use the stable asset in one partner integration',
    boost: 'Hold the stable asset across the monthly snapshot and keep some in the protocol\'s own savings wrapper if it has one',
  }],
];

const DEFAULT_PLAYBOOK: Playbook = {
  act: (p, chain, pos) => `Deposit ${money(pos)} of USDC into ${p.name}'s core product on ${chain} and keep the position open`,
  weekly: 'make one genuine product interaction (a deposit, a claim, a vote or a swap) so the wallet records recurring use',
  boost: 'Keep the position open for the whole window and use one secondary feature of the product as well as the main one',
};

function playbookFor(p: Protocol): Playbook {
  const c = (p.category ?? '').toLowerCase();
  for (const [hint, book] of PLAYBOOKS) if (c.includes(hint)) return book;
  return DEFAULT_PLAYBOOK;
}

/** Five concrete farm steps for one protocol, each 20–600 characters with cost and time stated. */
export function farmSteps(p: Protocol, age: number | null): string[] {
  const chain = mainChain(p);
  const gas = gasFor(chain);
  const position = positionFor(p.tvl_usd);
  const weeks = weeksFor(age);
  const book = playbookFor(p);
  const steps = [
    `Set up a fresh wallet for ${p.name} and fund it on ${chain} with about ${money(gas * 4)} of gas money plus ${money(position)} of capital; keep the seed phrase offline and never farm from an exchange account. Cost: about ${money(gas * 2)} in funding and approval transactions. Time: 20 minutes, once.`,
    `${book.act(p, chain, position)}. Cost: ${money(position)} of capital plus about ${money(gas)} of gas. Time: 15 minutes to set up, then hold for at least ${weeks} weeks.`,
    `Once a week, ${book.weekly}. Cost: about ${money(gas)} of gas per visit. Time: 10 minutes a week for ${weeks} weeks.`,
    `${book.boost}. Cost: no extra capital beyond step 2 in most cases, about ${money(gas)} of gas if it needs a transaction. Time: 10 minutes, once.`,
    `Each week, check ${p.name}'s official site and announcements for a points program, a snapshot date or a token announcement, and keep the position until one lands. Only ever claim through the protocol's own site, and never pay a claim fee or sign a token approval a stranger links you. Cost: nothing. Time: 10 minutes a week.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ------------------------------------------------------------------ the board

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  watchlist: boolean;
  implied_value_usd: number;
  model: { category_multiple: number; growth_factor: number; maturity_factor: number; breadth_factor: number };
  farm_steps: string[];
}

/** The dashboard's compact row: everything the page renders, farm plan included. */
export interface DashRow {
  r: number; // rank
  s: string; // slug
  n: string; // name
  c: string | null; // category
  ch: string[]; // chains
  t: number; // tvl_usd
  d: number | null; // change_7d
  i: number; // implied_value_usd
  m: number; // category multiple
  g: number; // growth factor
  u: number; // maturity factor
  b: number; // breadth factor
  a: number | null; // age_days
  l: string | null; // listed_at
  w: boolean; // on the house watchlist
  f: string[]; // farm steps
}

/** A protocol that already trades: shown for calibration, never ranked. */
export interface LiveRow {
  n: string;
  y: string | null; // symbol
  c: string | null;
  t: number; // tvl_usd
  k: number | null; // mcap_usd
}

/** Everything data.js carries. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  multiples: Record<string, number>;
  scanned: number;
  pre_token: number;
  watchlist_size: number;
  rows: DashRow[];
  live: LiveRow[];
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Build the ranked board: every watchlist slug, plus every other rankable pre-token protocol. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const { implied, factors } = score(p, snapshot.as_of);
    return { p, implied, factors };
  });
  scored.sort(
    (x, y) => y.implied - x.implied || y.p.tvl_usd - x.p.tvl_usd || (x.p.slug < y.p.slug ? -1 : x.p.slug > y.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.factors.age_days,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.factors.multiple,
      growth_factor: round3(s.factors.growth),
      maturity_factor: round3(s.factors.maturity),
      breadth_factor: round3(s.factors.breadth),
    },
    farm_steps: farmSteps(s.p, s.factors.age_days),
  }));
}

/** The largest already-trading protocols by market cap, for the dashboard's calibration strip. */
export function liveRows(snapshot: Snapshot, cap = 24): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, cap)
    .map((p) => ({ n: p.name, y: p.symbol, c: p.category, t: p.tvl_usd, k: p.mcap_usd }));
}

/** Board + dashboard data, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL.version,
    model: MODEL,
    multiples: CATEGORY_MULTIPLES,
    scanned: snapshot.protocols.length,
    pre_token: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    rows: board.map((r) => ({
      r: r.rank, s: r.slug, n: r.name, c: r.category, ch: r.chains, t: r.tvl_usd, d: r.change_7d,
      i: r.implied_value_usd, m: r.model.category_multiple, g: r.model.growth_factor,
      u: r.model.maturity_factor, b: r.model.breadth_factor, a: r.age_days, l: r.listed_at,
      w: r.watchlist, f: r.farm_steps,
    })),
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The data.js the dashboard loads: the whole dataset as one script, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** Parse and lightly validate the sealed snapshot; throws on a shape the model cannot score. */
export function parseSnapshot(text: string): Snapshot {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source string');
  if (typeof o.floor_usd !== 'number' || !(o.floor_usd > 0)) throw new Error('snapshot.json has no positive floor_usd');
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist');
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const protocols: Protocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error(`protocol ${i} lacks slug, name or tvl_usd`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board fails the gate, or null: coverage, ranks, order, farm steps, value sanity. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, outside 100..4000`;
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i} carries rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `${r.slug} outranks the row above it`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: not a ranking';
  }
  return null;
}
