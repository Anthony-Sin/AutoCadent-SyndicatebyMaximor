"""Project-scoped CAD MCP. Fixed templates only; no arbitrary Python execution."""
from pathlib import Path
import json
import re
from mcp.server.fastmcp import FastMCP
from .cad import Spec, build, evaluate
from .pipeline import run
mcp=FastMCP('AutoCadent CAD')
ROOT=Path(__file__).resolve().parents[1]/'.runs/mcp'

@mcp.tool()
def inspect_spec(length: float=140,width: float=90,thickness: float=1.2,wall: float=1.2,clearance: float=.1,mast_height: float=52) -> dict:
    """Build real CadQuery solids and measure validity, dimensions, tray walls and clearance."""
    s=Spec(length,width,thickness,wall,clearance,mast_height)
    parts, measured=build(s)
    return evaluate(s,parts,measured)

@mcp.tool()
def generate_rover(job_id: str, length: float=140,width: float=90,thickness: float=1.2,wall: float=1.2,clearance: float=.1,mast_height: float=52) -> dict:
    """Generate/export a bounded rover, evaluate and repair failed constraints. Writes only .runs/mcp/<job_id>."""
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',job_id): raise ValueError('Invalid job id')
    return run(Spec(length,width,thickness,wall,clearance,mast_height),ROOT/job_id)

if __name__=='__main__': mcp.run(transport='stdio')
