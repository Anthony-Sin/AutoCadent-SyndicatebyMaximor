# Four-minute demo

Prerequisites: open the [published workspace](https://anthony-sin.github.io/AutoCadent-SyndicatebyMaximor/), keep AO dashboard visible, and start the local runner in advance. CAD dependencies are large; install before recording.

**0:00–0:40 — Intent to geometry.** Introduce Rove-1 as an educational rover assembly exemplar. Point out the recorded-build badge. Orbit the real CadQuery mesh, isolate the chassis, toggle X-ray and explode the assembly. Explain that wheels and sensors are envelopes.

**0:40–1:30 — A valid solid can be wrong.** Click “Inspect initial build.” The geometry compiles but thickness, tray-wall and board-clearance checks fail at 1.2, 1.2 and 0.1 mm. Open evidence. Switch to the repaired revision: 2.4, 2.4 and 0.8 mm. These measurements come from B-reps. There is no global minimum-wall or structural claim.

**1:30–2:00 — Take the engineering with you.** Open Files and download the CAD ZIP (source, exact spec, STL, STEP, report). Open Schematic: a net-derived connectivity diagram, explicitly not a native schematic. Open Layout: real KiCad SVG and DRC disclosure. Download the fixed board bundle; explain it is a signal breakout, not a motor controller.

**2:00–3:10 — A live worker, in AO.** Switch to `http://127.0.0.1:8766`. The server must be launched with `AUTOCADENT_ENABLE_AO=1`. Connect using AO execution mode. Change length to 150 mm and submit a brief. Show the actual worker appearing in AO while it runs. On completion, the live job updates the mesh, measurements and downloads. If the provider is slow, show the checked-in real AO runtime evidence and explicitly identify it as recorded; never narrate it as live.

**3:10–3:45 — Evidence, not a guessed percentage.** Open Benchmark: four fixed regression cases, one initial pass and four after deterministic repair. Explain the fixed policy and scope. Open MCP verification: actual initialize/tools-list/useful calls, including KiCad's six footprints/four traces/four nets and CAD's real measured failure.

**3:45–4:00 — Close on the boundary.** The result proves a supervisor → real AO worker → CAD evaluator → repair → export path. Next work is motors, mechanical retention, electrical design, manufacturing rules and physical validation. Show AO's actual total session count in the dashboard; do not substitute a guessed number. Team member names, video upload and Devpost submission are separate submission tasks.
