# Original User Request

## 2026-09-05T22:35:20Z

Build out AutoCadent into an end-to-end, production-ready robotics design studio: port and integrate the dynamic Tensormux LLM provider into the active preview branch, test synthesizing and modifying robot designs & PCBs from scratch, ensure Orion properly loads its PCB parts, isolate project workspaces in the Explorer, repair all dashboard visual assets, and replace the external simulator with a native Three.js Motion Lab featuring switchable realistic terrains and robot kinematics matching the app design system.

Working directory: /home/ANT/.ao/data/worktrees/autocadent-syndicatebymaximor-keepgoing/autocadent-syndicatebymaximor-keepgoing-8
Integrity mode: development

## Verification Resources
- Active web preview server: `http://127.0.0.1:3001/web/#/dashboard` (Host header: `ao-preview.mf2xi33dmfsgk3tufvzxs3tenfrwc5dfmj4w2ylynfww64rnnn.swk4dhn5uw4zznha.localhost:3001`)
- Local AO daemon: running on port 3001 (`ps -ef | grep ao`)
- Reference provider branch: `/home/ANT/.ao/data/worktrees/autocadent-syndicatebymaximor/autocadent-syndicatebymaximor-5`
- Tensormux API endpoint: `https://api.tensormux.com/v1/chat/completions` (model: `glm-4-7-flash`, key provided via `.env`)

## Requirements

### R1. Dashboard Asset Audit and Per-Project Workspace Isolation
- Inspect and fix all visual assets, thumbnails, and preview renderings across the dashboard and views so that zero broken image links, missing SVGs, or styling defects occur.
- Refactor the Explorer hierarchy (Files, Designs, Schematic, Layout) to be strictly scoped and isolated per project (Rove-1, Orion, custom designs) so switching active projects updates all tabs with that project's specific CAD, PCB, and build files without state cross-contamination.

### R2. Tensormux Provider Integration & Agent Orchestration
- Port the Tensormux backend provider and design validation models (`autocadent/provider.py`, `autocadent/design.py`, etc.) from the tensormux worktree into the active codebase.
- Ensure all API keys and configuration load dynamically from `.env` (`TENSORMUX_API_KEY`, `TENSORMUX_MODEL=glm-4-7-flash`, `TENSORMUX_BASE_URL=https://api.tensormux.com/v1`) with nothing hardcoded.
- Implement and verify end-to-end robot and PCB generation from scratch as well as iterative modification of existing designs (taking a design brief, generating parametric CAD + KiCad PCB signal breakout, evaluating constraints, and saving the build artifacts).
- Update the Orion assembly viewer to properly load and display its corresponding PCB parts and electrical integration, which are currently missing.
- Connect the Design Agent and `/` commands to the live Agent Orchestrator (`ao`) daemon and runner API so that design synthesis, PCB generation, and CAD compilation run dynamically.

### R3. Native Three.js Motion Lab with Switchable Terrains
- Replace the external MicroDuck iframe with an integrated, native Three.js robotics simulation environment that matches AutoCadent's minimalist visual aesthetic and theme.
- Replicate the walking/motion kinematics natively inside the canvas, allowing interactive camera controls (orbit, pan, zoom), playback controls, and real-time mesh inspection.
- Implement switchable realistic terrain environments (e.g. Martian regolith, lunar surface, test grid/proving ground, obstacle course) with dynamic shader/texture loading and smooth switching.

### R4. Automated Verification & End-to-End Test Suite
- Provide automated verification scripts checking: (1) HTTP 200 on all web assets and preview routes, (2) Tensormux provider connectivity and design schema validation with `glm-4-7-flash`, (3) End-to-end PCB generation & modification artifact creation, (4) Orion PCB part loading, (5) Three.js Motion Lab initialization and terrain switching without WebGL or console errors.

## Acceptance Criteria

### Visual & Dashboard Integrity
- [ ] All dashboard project cards, previews, and thumbnails render with valid images/SVGs and zero 404 HTTP errors.
- [ ] Switching between projects (Rove-1, Orion, new projects) updates the Explorer, Files, Schematic, and Layout tabs with that project's isolated files and artifacts.
- [ ] The Orion quadruped assembly renders its structural components along with its associated PCB parts and electronics.

### Provider & Orchestrator Connectivity
- [ ] Tensormux provider successfully executes chat completions via `https://api.tensormux.com/v1` using `glm-4-7-flash` and credentials from `.env`.
- [ ] No hardcoded API keys, tokens, or mock fallback secrets exist in tracked source code.
- [ ] The pipeline can synthesize a robot design and simple PCB from scratch, execute modifications on an existing design, evaluate constraints, and save generated artifacts.
- [ ] Design generation pipeline compiles valid CadQuery CAD models and KiCad PCB artifacts coordinated with the AO runner.

### Motion Lab Simulation
- [ ] The Motion Lab tab renders a native Three.js 3D viewport without external iframes.
- [ ] A terrain selector enables toggling between at least 3 distinct environments (e.g. Martian Surface, Lunar Surface, Proving Ground Grid) with responsive rendering.
- [ ] Robot motion kinematics animate smoothly within the 3D scene matching the application theme.

## 2026-09-06T02:29:25Z

Build an end-to-end self-improving multi-agent system integrated into AutoCadent (serving at http://127.0.0.1:8766) that automates hardware/CAD design workflows, actively learns and optimizes tool/MCP usage over successive runs through persistent memory and self-reflection, and exposes real-time sub-agent execution graphs, learning curves, and memory growth in the Explorer dashboard (`#/explorer`).

Working directory: /home/ANT/projects/AutoCadent-SyndicatebyMaximor
Integrity mode: demo

## Requirements

### R1. Self-Improving Agent Engine with Growing Memory & Reflection Loop
Implement an autonomous learning agent loop that manages the educational rover design workflow across revisions. The engine must:
- Record structured episodic traces of tool invocations, inputs, execution times, token costs, and outcomes (success/failure/validation errors).
- Implement a post-run self-reflection agent that analyzes failure modes (e.g., OpenCASCADE kernel geometry errors, KiCad trace clearance violations, out-of-bound mast heights) and synthesizes actionable procedural rules into a persistent memory store.
- Query and apply learned procedural rules in subsequent revisions to avoid repeat failures, reduce prompt token overhead, and increase first-pass check success.

### R2. Third-Party Tool & Domain Logic Learning (CadQuery, KiCad, MCP)
Integrate the agent with the CAD/hardware toolchain (CadQuery/OpenCASCADE for solid modeling, KiCad for PCB layout & DRC, and model provider/MCP endpoints):
- The agent must discover and internalize complex contextual logic from tool feedback (e.g., wall thickness thresholds, minimum trace spacing, fillet radii limits).
- Provide quantitative evidence that tool call efficiency (fewer failed attempts, faster convergence) improves over sequential runs.

### R3. Interactive Explorer Dashboard with Telemetry, Sub-Agents, and Learning Curves
Enhance the AutoCadent frontend at `#/explorer` and `#/dashboard` with rich visualization panels:
- **Sub-Agent Execution Graph**: Visual hierarchy showing agent roles (Orchestrator/Planner, CAD Specialist, PCB Specialist, Verifier, and Reflection Synthesizer) with live status and event logs.
- **Learning Curve Charts**: Interactive charts displaying revision-over-revision trends: error rate reduction, check pass rates, execution duration, and token cost-efficiency.
- **Memory & Heuristics Bank**: An inspectable memory explorer showing acquired domain rules, past mistakes, and contextual adaptation over time.

### R4. Automated Multi-Revision Benchmark Verification
Implement an automated benchmark script (`scripts/verify_learning_loop.py` or equivalent) that executes a multi-revision run, validates that the agent successfully learns from initial failure cases, verifies all 6/6 design checks pass, and outputs benchmark telemetry confirming cost-effectiveness and error reduction.

## Acceptance Criteria

### Learning & Memory Growth
- [ ] Multi-revision run logs show concrete evidence of memory growth and self-reflection between Revision 1 and Revision N.
- [ ] Benchmark verifies that error recovery and first-pass pass rate improve measurably on repeated tasks using the learned memory bank.
- [ ] Memory store persists acquired rules across sessions in structured format (SQLite/JSON).

### Toolchain Integration
- [ ] Solid geometry (CadQuery B-rep) and PCB routing (KiCad DRC) pass all design constraints (6/6 checks) upon final revision.
- [ ] Sub-agent tool executions, latency, and token metrics are captured accurately in run manifests.

### Explorer UI Telemetry
- [ ] AutoCadent Explorer UI (`#/explorer`) renders sub-agent activity flows, memory inspector, and learning charts without JavaScript errors.
- [ ] Telemetry displays clear comparisons demonstrating the agent getting faster, cheaper, and more accurate over time.
