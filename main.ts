// Entry driver for the makefun-site speed entry: reads every case from
// MAKEFUN_INPUT_DIR ?? /input (cases.json, a JSON array of {id, input}), answers
// each one alone with run() from solve.js, and writes answers.json (a JSON array
// of the answers, one per case and in the cases' order) to
// MAKEFUN_OUTPUT_DIR ?? /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8 flag tuning, set before solve.js is imported: a 64 MB semi-space (the
// default is far smaller) cuts scavenger work on this allocation-heavy single
// pass. A/B-measured on the practice set against the baseline's
// --no-incremental-marking and against plain defaults; this was never worse
// and usually a shade faster. The driver contract is otherwise the baseline's.
setFlagsFromString('--max-semi-space-size=64');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
