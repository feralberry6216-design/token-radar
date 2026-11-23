// Token Launch Radar — the entry program (Node 22, standard library only).
//
// Reads the sealed snapshot (--input <file|dir>, default /input/snapshot.json), scores every
// pre-token protocol with the model in lib/model.ts, and writes the deliverables to the output
// directory (--output, else $MAKEFUN_OUTPUT_DIR, else /output):
//
//   board.json    the ranked board the gate scores
//   data.js       the dashboard's dataset, written beside dashboard/ as the starter layout does
//   dashboard/    a copy of this repository's static page (no framework, no network)
//   screenshots/  a copy of this repository's three dashboard captures
//   dossier.json  the judge's summary, written last with the vendored buildDossier — the scorer
//                 rebuilds it from the same output and compares bytes, so it is never edited
//
// The program is deterministic: no clock, no randomness, total sort orders everywhere, so the
// grader's two runs write identical bytes.
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The gate's caps, as the scorer states them (reference/gate.json via RULES.txt). */
const TEXT_MAX_BYTES = 65_536;
const DOSSIER_MAX_BYTES = 1_572_864; // 1.5 MiB
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token launch radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile} — pass --input <snapshot.json|directory>`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (err) {
  fail(`cannot read the snapshot: ${(err as Error).message}`);
}

const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model produced a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files (dot-names skipped) into `to`; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashFiles.includes('index.html')) fail('dashboard/ holds no index.html');
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images — hand in 3 or 4`);
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: names are letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier goes last: it summarises the dashboard and screenshots now in the output.
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
if (dossier.length > DOSSIER_MAX_BYTES) fail(`dossier.json would be ${dossier.length} bytes, over the 1.5 MiB cap — shrink the screenshots`);
writeFileSync(join(out, 'dossier.json'), dossier);

const top = board[0]!;
process.stdout.write(
  `token launch radar: scanned ${radar.scanned} protocols (${radar.pre_token} pre-token), watchlist ${radar.watchlist_size}/${radar.watchlist_size} covered, ${board.length} rows ranked\n` +
    `token launch radar: #1 ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')} implied; wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length}), dossier.json (${dossier.length} bytes) to ${out}\n`,
);
