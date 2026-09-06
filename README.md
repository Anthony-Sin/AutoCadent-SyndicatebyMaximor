# AutoCadent

**Engineering, in the loop.**

A self-improving **robot CAD + PCB studio**. You give it a hardware brief. Agents call **real CadQuery and KiCad tools**, measure the geometry, fail in public, write the reason into memory, and do not make the same thin wall twice.

This is **not** a chatbot that pastes a screenshot of a robot. Compiling a solid is not the same as designing one.

**[Open the live workspace](https://anthony-sin.github.io/AutoCadent-SyndicatebyMaximor/)** · [GitHub](https://github.com/Anthony-Sin/AutoCadent-SyndicatebyMaximor) · [Architecture](docs/ARCHITECTURE.md) · [Demo notes](docs/DEMO.md)

Built for **Syndicate by Maximor — Track 1: Automated Agent Engineering**.

---

## What this project is

| It is | It is not |
|---|---|
| Agents that use third-party CAD/PCB tools (MCP: CadQuery, KiCad) | Natural-language SolidWorks |
| An independent evaluator that **measures the B-rep**, not the spec | “The mesh compiled, so we’re done” |
| A reflection loop that stores heuristics (`RULE-THICKNESS`, …) in SQLite | A hardcoded list of fake “9 rules memorized” |
| Real exports: STEP, STL, CadQuery source, `.kicad_pcb`, Gerbers, DRC | A walking robot, motor controller, or print-certified part |

**One sentence:** AutoCadent is a studio where hardware agents get better at *using tools* over time — because they remember why the last board tray was 1.2 mm thick.

---

## What you will see

1. **Drop a brief** in Design Copilot (GLM-4.7-Flash on Tensormux, or local deterministic mode).
2. **Sub-agents** decompose, build CAD, route a signal-breakout board, verify constraints.
3. **Rev 1 can fail.** A valid solid with $t_{\text{wall}} = 1.2\,\text{mm}$ still fails the $2.4\,\text{mm}$ floor. That miss is the point.
4. **Reflection** writes causal rules into memory. **Rev 2** retrieves them.
5. **You take the engineering with you** — source, STEP/STL, KiCad bundle, measured report.

Recorded default run (educational rover **Rove-1**):

| Check | Rev 1 | Required | Rev 2 |
|---|---:|---:|---:|
| Chassis thickness | 1.2 mm | ≥ 2.4 mm | 2.4 mm |
| Tray side walls | 1.2 mm | ≥ 2.4 mm | 2.4 mm |
| Board-to-wall clearance | 0.1 mm | ≥ 0.8 mm | 0.8 mm |

Cold start: **3/6** checks. After memory: **6/6**. Four fixed benchmark cases; one passes initially, all four pass after the repair policy. KiCad 10.0.5 DRC on the exemplar board: **0 violations, 0 unconnected** (five default ignored checks kept in the report).

---

## Try it

### Live site (no install)

**https://anthony-sin.github.io/AutoCadent-SyndicatebyMaximor/**

That page is a **static explorer of a real recorded run**: orbit the CadQuery mesh, isolate parts, explode the assembly, inspect failed vs repaired revisions, download CAD and board bundles.

It does **not** run live agents in the browser. GitHub Pages cannot host OpenCASCADE or KiCad. The UI says this instead of faking geometry.

### Live generation (your machine)

```sh
uv sync --locked --python 3.12
uv run uvicorn autocadent.api:app --host 127.0.0.1 --port 8766
```

Open http://127.0.0.1:8766 — edit dimensions, enter a brief, submit. Local mode runs the real CAD kernel and a deterministic repair policy.

To dispatch a real AO worker:

```sh
AUTOCADENT_ENABLE_AO=1 uv run uvicorn autocadent.api:app --host 127.0.0.1 --port 8766
```

Jobs are serialized, kept in `.runs/jobs/`, and time out after 15 minutes.

### Designs in the browser

The Designs tab is **localStorage only** — no account, no upload. Import/export `*.autocadent.json` bundles. Drafts without CAD are labeled `LOCAL DRAFT`. Live rebuilds still need the local runner.

---

## What’s in the box (honest scope)

**Rove-1** is an educational rover *assembly exemplar*: printable chassis, vent slots, M3 holes, board tray, sensor mast. Length 120–180 mm, width 80–110 mm, mast 35–75 mm. Board envelope 60 × 40 mm.

Wheels, hubs, headers, and sensors are **envelopes**, not validated hardware. There are no modeled motors, axles, fasteners, retention clips, or a working drive.

The KiCad board is a **signal breakout** (two 1×4 headers, four nets, four mounting holes) — **not** a motor controller. The Schematic tab is a net-derived connectivity diagram, not a native `.kicad_sch`.

The evaluator measures B-rep bounding boxes, planar wall offsets, and minimum solid distance. It is **not** a global min-wall analysis, collision audit, printability cert, or structural sim.

---

## How it is built

```
Brief → Orchestrator → CAD (CadQuery / OpenCASCADE)
                     → PCB (KiCad / pcbnew)
                     → Verifier (independent B-rep + DRC)
                     → Reflection → SQLite heuristics → next revision
```

- **CadQuery 2.6.1** builds real solids. Tests swap the solid while leaving the spec unchanged so measurements cannot cheat.
- **Repair policy** only lifts failed thickness / tray-wall / clearance to the required floor (max 3 iterations). Unsupported failures stay failures.
- **MCP:** AutoCadent CAD server + KiCad MCP. The model gets live tool schemas — not a keyword dictionary.
- **Memory:** episodic traces (tool, latency, tokens, pass/fail) + inspectable heuristics. The studio shows which rule fired.
- **UI:** ivory workspace, Three.js Motion Lab (no iframe), vendored Three.js, FastAPI runner on loopback.

Reproduce:

```sh
uv run python -m autocadent.pipeline --output .runs/example
uv run python -m scripts.benchmark
uv run pytest -q --disable-warnings
uv run python scripts/check_artifacts.py
# KiCad 9/10 + pcbnew (verified 10.0.5):
/usr/bin/python3 scripts/board.py
uv run python scripts/mcp_probe.py autocadent-cad --call inspect_spec
uv run python scripts/mcp_probe.py kicad --call get_version
```

Evidence and hashes: [docs/EVIDENCE.md](docs/EVIDENCE.md). MCP setup: [docs/MCP.md](docs/MCP.md).

---

## Hosting

Push to `main` deploys `web/` to GitHub Pages. The runner is a separate local service (loopback, bounded numeric inputs, never executes user prose as code). No public live CAD runner and no credentials are shipped with this repo.

---

## License / submission

Hackathon project for Syndicate by Maximor, Track 1. See the repo for source. Names, demo video, and Devpost roster are submission tasks — they are not invented here.
