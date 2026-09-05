# Track 1 implementation plan

1. Establish pinned CadQuery and KiCad MCP tools; retain real handshake and useful-call evidence.
2. Build a bounded parametric rover assembly, independent geometric checks, deterministic repair policy, and benchmark cases. Export source, STEP, STL, mesh, KiCad board, Gerbers/drill and measured reports.
3. Build an original ivory engineering workspace: agent activity, interactive 3D anatomy, files, schematic/layout, constraints, recorded-run inspection and configurable live runner.
4. Expose a local API with explicit deterministic and AO execution modes. AO mode dispatches a real worker through the AO CLI; never label a local algorithm or a recorded run as a live LLM agent.
5. Test geometry, failures, repairs, input/API boundaries, MCP and browser interactions. Push checkpoints, open PR, deploy static `web/` through GitHub Pages without merging.

Supported scope: parameterized educational rover chassis/tray/mast with wheel and sensor envelopes; connector breakout board. No claim of a walking robot, electrical motor control, general natural-language CAD, physical validation, global minimum-wall analysis, or fabrication certification.
