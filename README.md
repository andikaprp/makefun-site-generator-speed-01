# makefun-site-generator-speed-01

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/andikaprp/makefun-site-generator-speed-01/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/andikaprp/makefun-site-generator-speed-01/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in replacement for make.fun's own makefun-site 1.0.0 static site generator. `solve.js` is a dependency-free ES module whose `run(input)` returns, for every case's input, exactly the output tree makefun-site 1.0.0's build returns - every page's index.html, the index and tag pages, build-report.txt and each static file, byte for byte - written from scratch as a single-pass implementation (compiled templates, one-parse Markdown, per-call slug memoisation) so the same answers cost measurably less CPU time. `main.ts` is the harness driver: it reads every case from /input/cases.json, answers each with run, and writes /output/answers.json.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=mpexab2s&utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
