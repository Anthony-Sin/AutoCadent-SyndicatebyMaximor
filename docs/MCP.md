# Verified MCP setup

Read-only reference: `/home/ANT/projects/bci/scripts/mcp_client.py` uses `uvx --from mcp-server-kicad mcp-server-kicad`. AutoCadent uses the same package family with a pinned version and project working directory. No secrets, environment files, profiles or credentials were copied.

The repository's `mcp.json` is consumed by `scripts/mcp_probe.py`. For a desktop MCP client, resolve each `cwd` to the absolute checkout directory (KiCad uses `hardware/kicad`, CAD uses repository root). This configuration is project-scoped; it does not modify any global MCP client config. Servers are installed in uv's cache/project virtual environment.

| Server | Installation | Verified |
|---|---|---|
| KiCad | `uvx --python 3.12 --from mcp-server-kicad==0.20.1 mcp-server-kicad` | initialize, tools/list (109), get_version, get_board_info on the generated board |
| AutoCadent CAD | `uv run python -m autocadent.mcp_server` | initialize, tools/list (2), inspect_spec with real failing geometry |

`inspect_spec` builds B-reps and returns measured checks. `generate_rover` runs the bounded generation/evaluation/repair pipeline and exports under `.runs/mcp/<job_id>`. It does not accept arbitrary Python. Job IDs are restricted to safe characters.

```sh
uv sync --locked --python 3.12
uv run python scripts/mcp_probe.py autocadent-cad --output .runs/cad-probe.json --call inspect_spec
uv run python scripts/mcp_probe.py autocadent-cad --output .runs/cad-generate.json --call generate_rover --arguments '{"job_id":"example","length":150}'
uv run python scripts/mcp_probe.py kicad --output .runs/kicad-probe.json --call get_board_info --arguments '{"pcb_path":"../../web/artifacts/board/rove-1.kicad_pcb"}'
```

Useful-call results and complete advertised tool schemas are retained in `docs/evidence/`. The web workspace exposes a smaller summary at `web/artifacts/mcp-status.json`. MCP advertisement is not taken as proof that all 109 KiCad tools were tested. Only the named calls were verified.

Official documentation consulted before installation:

- [CadQuery installation](https://cadquery.readthedocs.io/en/stable/installation.html) and [exports](https://cadquery.readthedocs.io/en/stable/importexport.html): project uses CadQuery 2.6.1 / OpenCASCADE wheels with Python 3.12.
- [KiCad MCP package](https://pypi.org/project/mcp-server-kicad/): unified stdio entry point, project working directory and KiCad CLI requirements.
- [Official Python MCP SDK](https://github.com/modelcontextprotocol/python-sdk): client handshake and FastMCP server.
- [Three.js documentation](https://threejs.org/docs/): renderer and orbit controls, vendored version 0.180.0 with license.

KiCad 10.0.5 and its system `pcbnew` were already installed. System Python emits three KiCad enum-choice assertions on import in this environment; generation, DRC and exports still return success. The board script uses the system interpreter because its native KiCad binding is not in the CadQuery environment.
