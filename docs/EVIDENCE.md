# Evidence and checkpoints

All measurements below come from files in this repository or from commands run against this checkout. No runs have been simulated or described from memory.

## Implementation checkpoints

Branch `ao/autocadent-syndicatebymaximor-2/track-one` contains three implementation commits on top of the initial scaffold:

| Commit | Purpose |
|---|---|
| `b22f604` | Track 1 architecture and pinned CAD environment (CadQuery 2.6.1, MCP servers) |
| `29a29a8` | Evaluated rover CAD workspace and local AO runner (generator, evaluator, repair policy, exports, web workspace) |
| `693a418` | CI workflow and static Pages deployment of `web/` |

Implementation was performed in AO worker `autocadent-syndicatebymaximor-2`. A real runtime dispatch through the AO CLI completed in worker `autocadent-syndicatebymaximor-3`; the recorded file is `docs/evidence/ao-runtime.json`. No built-in subagents were used.

## Deterministic CAD evidence

The pipeline builds real CadQuery solids, measures them on the B-rep, and applies a bounded repair policy only to the failed thickness, tray-wall and clearance checks.

- `uv run python -m autocadent.pipeline --output .runs/example` creates 18 valid solids in each revision, retains the failed iteration, and finishes with a passing revision after two iterations (`.runs/example/report.json`, not committed).
- The evaluator is independent of the generator: `tests/test_cad.py::test_evaluator_measures_geometry_not_spec` swaps the base solid while leaving the specification unchanged and the measurement follows the geometry, not the spec.
- STEP export is re-imported and validated in `tests/test_cad.py::test_pipeline_exports_reimportable_solid_and_retains_failure`.
- Fixed regression corpus `web/artifacts/benchmark.json`: four cases; one passes initially and all four pass after the deterministic repair policy. These are real executions, not general LLM benchmark percentages.

Reproduce: `uv run python -m scripts.benchmark`, then `uv run python scripts/check_artifacts.py` (hashes, ZIP integrity, source syntax and recorded evidence verified).

## MCP verification

Project-scoped configuration is in `mcp.json`; the probes and this documentation are in `docs/MCP.md`. The retained handshake and useful-call evidence:

- `docs/evidence/cad-initialize.json` — AutoCadent CAD server (FastMCP), initialize + tools/list (2 tools) + a real `inspect_spec` call returning a failing measured result.
- `docs/evidence/kicad-initialize.json` — KiCad MCP server `0.20.1`, initialize + tools/list (109 tools) + `get_version`.
- `docs/evidence/kicad-board.json` — `get_board_info` on the generated board: 6 footprints, 4 traces, 4 nets, thickness 1.6 mm.

Reproduced in this session:

```sh
uv run python scripts/mcp_probe.py autocadent-cad --call inspect_spec
uv run python scripts/mcp_probe.py kicad --call get_version
```

## KiCad board evidence

`/usr/bin/python3 scripts/board.py` regenerates the board against the system KiCad 10.0.5 `pcbnew` binding and reports zero DRC violations and zero unconnected items in `web/artifacts/board/drc.json` (five default ignored checks retained). The bundle includes `.kicad_pcb`, Gerbers, drill, BOM, connectivity data, board SVG and a DRC report. The board is a fixed signal-breakout exemplar, not a motor controller; schematic parity and electrical function were not verified.

## Runtime AO execution

`docs/evidence/ao-runtime.json` records a supervised dispatch: `ao spawn` from supervisor session `autocadent-syndicatebymaximor-2`, processed by worker `autocadent-syndicatebymaximor-3`, which ran the real CAD pipeline (iterate 1 FAIL → repair → iterate 2 PASS) and returned artifacts with hashes. The live path is available locally with `AUTOCADENT_ENABLE_AO=1`; the published workspace is a static artifact explorer and does not run live agents.

## Verification in this session (2026-09-05)

Re-run after PR #1 was merged, against `main` at `c7172e2`; results match the earlier run on the feature branch.

| Command | Result |
|---|---|
| `uv sync --locked --python 3.12` | passed |
| `uv run python -m autocadent.pipeline --output .runs/example` | passed, 2 iterations |
| `uv run python -m scripts.benchmark` | wrote `web/artifacts/benchmark.json` |
| `uv run pytest -q --disable-warnings` | 13 passed |
| `uv run python scripts/check_artifacts.py` | verified |
| `/usr/bin/python3 scripts/board.py` | DRC clean (KiCad 10.0.5) |
| `node --check web/app.js` | passed |

Both GitHub Actions workflows (`Verify engineering workflow`, `Deploy workspace to Pages`) succeed on `ao/autocadent-syndicatebymaximor-2/track-one`. The deployed workspace is live at <https://anthony-sin.github.io/AutoCadent-SyndicatebyMaximor/> (index, `app.js`, `artifacts/benchmark.json`, CAD STEP and board SVG all served) and serves the merged workspace; the original plan to keep the branch unmerged was superseded by the merge recorded below.

## PR #1 approval and merge (2026-09-05)

PR #1 (<https://github.com/Anthony-Sin/AutoCadent-SyndicatebyMaximor/pull/1>, feature branch `ao/autocadent-syndicatebymaximor-2/track-one`) was approved and merged into `main` by `Anthony-Sin` on 2026-09-05 as merge commit `c7172e2` (merged 18:09 UTC). This supersedes the earlier plan (see `docs/PLAN.md`) to deploy through GitHub Pages without merging.

The live site serves the merged workspace. The `Deploy workspace to Pages` workflow deploys on pushes to the feature branch, so the deployment is built from the feature-head commit `7627023`; `web/` on `main` at `c7172e2` is byte-identical to that deployment (SHA-256 match for `index.html`, `app.js`, `artifacts/benchmark.json`, `artifacts/demo/final/rove-1.step` and `artifacts/board/board.svg`), and all of those paths return HTTP 200.

## Remaining submission tasks

Team roster names, the recorded 3–5 minute demo video (including the AO dashboard's total session count) and the Devpost submission remain team submission tasks. They are not recorded here and are not invented.