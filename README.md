# AutoCadent

**Engineering, in the loop.** A robot CAD workspace for Track 1: Automated Agent Engineering at Syndicate by Maximor.

[Open the workspace](https://anthony-sin.github.io/AutoCadent-SyndicatebyMaximor/) · [4-minute demo](docs/DEMO.md) · [Architecture and scope](docs/ARCHITECTURE.md) · [MCP setup](docs/MCP.md)

AutoCadent turns a bounded rover specification into real CadQuery solids, measures constraints, repairs failures, and exports the result. The ivory engineering workspace combines an agent activity panel, interactive assembly anatomy, files, board connectivity/layout, editable dimensions and measured evidence.

## Try it

The published workspace is a **static artifact explorer**: orbit the actual CAD mesh, isolate parts, explode the assembly, inspect the failed and repaired revisions, compare benchmark cases, and download the CAD and board bundles. It does not run live agents on GitHub Pages.

For live generation, install [uv](https://docs.astral.sh/uv/getting-started/installation/) and run:

```sh
uv sync --locked --python 3.12
uv run uvicorn autocadent.api:app --host 127.0.0.1 --port 8766
```

Open `http://127.0.0.1:8766`. Edit the dimensions, enter a brief, and submit. Local mode runs the real CAD kernel and a deterministic repair policy. The brief is recorded as intent; explicit dimension fields drive the fixed template. No LLM or arbitrary natural-language CAD capability is implied.

With AO installed, authenticated and this project registered, enable real worker dispatch:

```sh
AUTOCADENT_ENABLE_AO=1 uv run uvicorn autocadent.api:app --host 127.0.0.1 --port 8766
```

Use the connection menu to select **Supervisor → actual AO worker → evaluator**. The API calls `ao spawn`; that worker runs the CAD job and returns its real `AO_SESSION_ID`. The checked-in [AO runtime report](docs/evidence/ao-runtime.json) records a successful dispatch through worker `autocadent-syndicatebymaximor-3`. Jobs are serialized, retained in `.runs/jobs/`, and time out after 15 minutes. Timed-out AO sessions require inspection/termination in the AO dashboard.

## What you can build

Rove-1 is an educational rover **assembly/component exemplar**, with a rounded printable chassis, vent slots and M3 holes, a board tray, and a sensor mast. Length 120–180 mm, width 80–110 mm, mast 35–75 mm. Board envelope is fixed at 60 × 40 mm. Wheels, hubs, headers and sensors are assembly envelopes, not validated hardware. There are no modeled motors, axles, fasteners, board retention clips, or working drive system.

Downloadable outputs include executable CadQuery source with the exact spec, STL for the three structural parts, assembly STEP, mesh JSON, iteration reports and hashes. Run `generate.py` from the CAD ZIP in a CadQuery 2.6.1 environment to regenerate it.

The fixed KiCad signal-breakout board has two 1×4 headers, four routed nets and four mounting holes. Its bundle includes `.kicad_pcb`, Gerbers, drill, BOM, connectivity data, board SVG and actual DRC output. It is **not** a motor controller; no power regulation, pull-ups, MCU or electrical functional testing are included. The Schematic tab explicitly displays a net-derived connectivity diagram, not a KiCad schematic file.

## Measured evidence

The default run creates **18 valid solids** in both revisions. Geometric validity alone does not satisfy the design:

| Check | Initial | Repaired | Required |
|---|---:|---:|---:|
| Chassis thickness | 1.2 mm | 2.4 mm | ≥ 2.4 mm |
| Tray side walls | 1.2 mm | 2.4 mm | ≥ 2.4 mm |
| Board-to-sidewall clearance | 0.1 mm | 0.8 mm | ≥ 0.8 mm |

The evaluator measures B-rep bounding boxes, planar wall-face offsets and minimum solid distance. It also checks chassis length and tray edge margin. This is not a global minimum-wall analysis, assembly collision audit, printability certification or structural simulation.

The [fixed regression corpus](web/artifacts/benchmark.json) contains four cases: one passes initially; all four pass after the deterministic repair policy. These counts are real executions, **not general LLM benchmark percentages**. KiCad 10.0.5 reported zero DRC violations and zero unconnected items, with five default ignored checks retained in the report; schematic parity and electrical function were not verified.

## Reproduce and test

```sh
uv run python -m autocadent.pipeline --output .runs/example
uv run python -m scripts.benchmark
uv run pytest -q --disable-warnings
uv run python scripts/check_artifacts.py
# Requires KiCad 9/10 and its pcbnew Python binding; verified with KiCad 10.0.5:
/usr/bin/python3 scripts/board.py
# Actual MCP handshakes and calls:
uv run python scripts/mcp_probe.py autocadent-cad --call inspect_spec
uv run python scripts/mcp_probe.py kicad --call get_version
```

See [MCP.md](docs/MCP.md) for project-scoped configuration and official package sources. BCI was inspected read-only; no credentials or settings were copied.

## Hosting and privacy

`web/` is a self-contained static site with vendored Three.js (MIT). Google Fonts is optional; system fallbacks work offline. GitHub Actions deploys the feature branch to Pages; **the PR remains unmerged**. The runner remains a separately configured local service.

The runner binds to loopback by default, validates host/origin, accepts bounded numeric inputs, and never executes user prose as code. Cross-origin access requires both `AUTOCADENT_ORIGINS` (an exact comma-separated allowlist) and `AUTOCADENT_TOKEN`. Enter the token in the connection dialog; it stays in browser memory. For a hosted runner, terminate TLS and enforce authentication for **all paths** at a reverse proxy, set `AUTOCADENT_HOSTS`, and keep AO/CAD on a private worker. Job artifacts are shareable through opaque UUID paths; do not include secrets in briefs. No hosted live runner or public credentials are deployed by this project.

## Development evidence and submission

Implementation was performed in AO worker `autocadent-syndicatebymaximor-2`, with an actual runtime job in worker `autocadent-syndicatebymaximor-3`. [Evidence and checkpoints](docs/EVIDENCE.md) distinguish implementation, deterministic CAD, MCP verification and runtime AO execution. No built-in subagents were used.

Team roster, recorded demo video and Devpost submission remain team submission tasks; names and dashboard session totals are not invented.
