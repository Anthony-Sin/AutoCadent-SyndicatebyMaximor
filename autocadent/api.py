"""Local runner. Explicit opt-in for AO dispatch and cross-origin hosting."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time
import uuid
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict
from .cad import Spec
from .pipeline import run, save_json
from .provider import ProviderConfig, ProviderError, Tensormux
from .model_pipeline import run_model, CompilerError
from .memory import MemoryStore
from .agents import SubAgentGraph
from . import mcp_bridge

ROOT=Path(__file__).resolve().parents[1]
JOBS=ROOT/'.runs/jobs'; JOBS.mkdir(parents=True,exist_ok=True)
TOKEN=os.getenv('AUTOCADENT_TOKEN','')
ORIGINS=[s.strip() for s in os.getenv('AUTOCADENT_ORIGINS','').split(',') if s.strip()]
if ORIGINS and not TOKEN: raise RuntimeError('Cross-origin access requires AUTOCADENT_TOKEN')
AO_ENABLED=os.getenv('AUTOCADENT_ENABLE_AO')=='1'

def get_provider_config():
    return ProviderConfig.from_env()

PROVIDER_CONFIG = get_provider_config()
app=FastAPI(title='AutoCadent local runner',docs_url=None,redoc_url=None)
app.add_middleware(TrustedHostMiddleware,allowed_hosts=['127.0.0.1','localhost','testserver',*os.getenv('AUTOCADENT_HOSTS','').split(',')])
app.add_middleware(CORSMiddleware,allow_origins=ORIGINS,allow_methods=['GET','POST'],allow_headers=['Content-Type','Authorization'])
LOCK=threading.Lock()

class JobRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    description: str=Field(min_length=1,max_length=1500)
    spec: dict=Field(default_factory=dict)
    execution: str='deterministic'

@app.middleware('http')
async def protect(request: Request, call_next):
    if request.url.path.startswith('/api/') and request.method!='OPTIONS':
        if TOKEN and not secrets.compare_digest(request.headers.get('authorization',''),'Bearer '+TOKEN):
            from fastapi.responses import JSONResponse
            return JSONResponse({'detail':'Runner authentication required'},status_code=401)
        origin=request.headers.get('origin')
        same=f'{request.url.scheme}://{request.headers.get("host","")}'
        if origin and origin!=same and origin not in ORIGINS:
            from fastapi.responses import JSONResponse
            return JSONResponse({'detail':'Origin is not allowed'},status_code=403)
    return await call_next(request)

@app.get('/api/health')
def health():
    global PROVIDER_CONFIG
    PROVIDER_CONFIG = get_provider_config()
    enabled = bool(PROVIDER_CONFIG.api_key)
    return {
        'status': 'ok',
        'ao_enabled': AO_ENABLED,
        'execution': ['deterministic'] + (['ao'] if AO_ENABLED else []) + (['tensormux'] if enabled else []),
        'scope': 'bounded-rover',
        'provider': {
            'name': 'tensormux',
            'configured': enabled,
            'model': PROVIDER_CONFIG.model,
            'capabilities': ['bounded-rover-spec', 'sensor-bridge-addon', 'custom-signal-breakout', 'measured-model-revision']
        }
    }


def get_dir(job_id):
    try:
        if str(uuid.UUID(job_id))!=job_id: raise ValueError()
    except ValueError: raise HTTPException(404,'Job not found')
    path=JOBS/job_id
    if not path.is_dir(): raise HTTPException(404,'Job not found')
    return path


def execute(job_id, req):
    folder=JOBS/job_id
    try:
        if req.execution=='ao':
            # Prompt contains only a generated UUID and administrator-owned paths.
            # User prose lives in JSON as data and is never interpolated into commands.
            command=[str(ROOT/'.venv/bin/python'),str(ROOT/'scripts/run_job.py'),job_id]
            import shlex
            prompt=('Execute this AutoCadent CAD runtime job only. Do not edit source, create commits, PRs, or other sessions. '
                    'The supervisor has validated a bounded rover spec. Run this exact command: '+shlex.join(command)+
                    '. It builds real CadQuery geometry, evaluates dimensions, applies bounded failure repairs, and writes job artifacts. '
                    'Report the actual final status and AO session id. Do not simulate a result. No extra implementation work.')
            proc=subprocess.run(['ao','spawn','--project',os.getenv('AUTOCADENT_AO_PROJECT','autocadent-syndicatebymaximor'),
                                 '--name','cad-'+job_id[:8],'--harness',os.getenv('AUTOCADENT_AO_HARNESS','opencode'),'--model',os.getenv('AUTOCADENT_AO_MODEL','opencode/muse-spark-1.3-contributor-free'),'--prompt',prompt],
                                capture_output=True,text=True,timeout=60)
            if proc.returncode: raise RuntimeError('AO spawn failed; inspect the runner AO configuration')
            save_json(folder/'dispatch.json',{'command':'ao spawn','dispatched_at':time.time(),'supervisor_session':os.getenv('AO_SESSION_ID'),'job_id':job_id})
            for _ in range(900):
                if (folder/'complete.json').exists(): break
                if (folder/'error.json').exists(): raise RuntimeError(json.loads((folder/'error.json').read_text())['error'])
                time.sleep(1)
            else: raise RuntimeError('AO job exceeded 15 minutes; inspect/terminate its session in AO before retrying')
        elif req.execution=='tensormux':
            PROVIDER_CONFIG = get_provider_config()
            run_model(Tensormux(PROVIDER_CONFIG),req.description,req.spec,folder)
            save_json(folder/'complete.json',{'execution':'tensormux'})
        else:
            run(Spec(**req.spec),folder,req.description)
            save_json(folder/'complete.json',{'execution':'deterministic'})
    except Exception as e:
        save_json(folder/'error.json',{'error':str(e) if req.execution!='tensormux' or isinstance(e,(ProviderError,CompilerError)) else 'Model CAD job failed; inspect local compiler setup',
                                        **({'provider_status':e.status,'code':e.code} if isinstance(e,ProviderError) else {})})
    finally: LOCK.release()

@app.post('/api/jobs',status_code=202)
def create_job(req: JobRequest, request: Request):
    global PROVIDER_CONFIG
    if not request.headers.get('content-type','').startswith('application/json'): raise HTTPException(415,'JSON required')
    try: Spec(**req.spec)
    except (ValueError,TypeError) as e: raise HTTPException(422,str(e))
    if req.execution not in ['ao','deterministic','tensormux']: raise HTTPException(422,'Unsupported execution mode')
    if req.execution=='ao' and not AO_ENABLED: raise HTTPException(409,'AO dispatch disabled; set AUTOCADENT_ENABLE_AO=1')
    if req.execution=='tensormux':
        PROVIDER_CONFIG = get_provider_config()
        if not PROVIDER_CONFIG.api_key:
            raise HTTPException(409,'Tensormux disabled; configure the server TENSORMUX_API_KEY')
    if not LOCK.acquire(blocking=False): raise HTTPException(429,'A CAD job is already running')
    job_id=str(uuid.uuid4());folder=JOBS/job_id
    try:
        folder.mkdir();save_json(folder/'request.json',req.model_dump())
        threading.Thread(target=execute,args=(job_id,req),daemon=True).start()
    except Exception:
        LOCK.release();raise
    return {'id':job_id,'status':'queued'}

@app.get('/api/jobs/{job_id}')
def get_job(job_id: str):
    folder=get_dir(job_id)
    if (folder/'error.json').exists(): return {'id':job_id,'status':'failed',**json.loads((folder/'error.json').read_text())}
    if (folder/'complete.json').exists():
        result=json.loads((folder/'report.json').read_text())
        return {'id':job_id,'status':'complete','report':result}
    return {'id':job_id,'status':'running','message':'AO worker dispatched; waiting for measured result.' if (folder/'dispatch.json').exists() else 'Building CAD and evaluating constraints…'}

_LEARNING_DB = ROOT / '.runs' / 'learning.db'
_LEARNING_STORE = MemoryStore(db_path=str(_LEARNING_DB))
_AGENT_GRAPH = SubAgentGraph()

@app.get('/api/learning/telemetry')
def learning_telemetry():
    import sqlite3
    conn = _LEARNING_STORE._connect()
    try:
        episodes = []
        for row in conn.execute(
            "SELECT episode_id, revision, status, summary, metrics_json FROM episodes ORDER BY revision"
        ):
            metrics = json.loads(row[4])
            episodes.append({"episode_id": row[0], "revision": row[1], "status": row[2],
                             "summary": row[3], **metrics})
        return episodes
    finally:
        conn.close()

@app.get('/api/learning/memory')
def learning_memory():
    rules = _LEARNING_STORE.get_active_heuristics()
    return [{"rule_id": r.rule_id, "category": r.category, "trigger_pattern": r.trigger_pattern,
             "parameter_override": r.parameter_override, "rationale": r.rationale,
             "confidence": r.confidence, "times_applied": r.times_applied,
             "times_helped": r.times_helped, "times_hurt": r.times_hurt,
             "evidence": r.evidence} for r in rules]

@app.get('/api/agents/graph')
def agents_graph():
    return _AGENT_GRAPH.get_state()


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    message: str = Field(min_length=1, max_length=2000)
    session: str | None = None


@app.post('/api/agent/chat')
def agent_chat(req: ChatRequest):
    msg = req.message.lower()
    store = _LEARNING_STORE
    cards = []
    chips = []
    citations = []
    reply_parts = []

    rules = store.get_active_heuristics()
    stats = store.get_memory_stats()

    if any(w in msg for w in ["rule", "heuristic", "memory", "learned", "learn"]):
        for r in rules[:5]:
            cards.append({"type": "rule", "payload": {
                "rule_id": r.rule_id, "category": r.category,
                "trigger_pattern": r.trigger_pattern,
                "parameter_override": r.parameter_override,
                "confidence": r.confidence, "rationale": r.rationale,
            }})
            citations.append({"kind": "rule", "id": r.rule_id})
        reply_parts.append(f"There are {stats['active_rules']} active learned rules in memory.")
        chips.extend(["Show all rules", "Rule confidence", "Pruning status"])

    if any(w in msg for w in ["telemetry", "episode", "revision", "history", "run"]):
        import sqlite3
        conn = store._connect()
        try:
            episodes = []
            for row in conn.execute(
                "SELECT episode_id, revision, status, summary, metrics_json FROM episodes ORDER BY revision DESC LIMIT 10"
            ):
                metrics = json.loads(row[4])
                episodes.append({"episode_id": row[0], "revision": row[1], "status": row[2],
                                 "summary": row[3], **metrics})
        finally:
            conn.close()
        for ep in episodes[:3]:
            cards.append({"type": "episode", "payload": ep})
            citations.append({"kind": "episode", "id": ep["episode_id"]})
        reply_parts.append(f"Found {len(episodes)} episodes in telemetry.")
        chips.extend(["Latest revision", "Token trend", "Failure history"])

    if any(w in msg for w in ["agent", "graph", "sub-agent", "orchestrator", "pipeline"]):
        graph_state = _AGENT_GRAPH.get_state()
        cards.append({"type": "graph", "payload": graph_state})
        reply_parts.append(f"The agent graph has {len(graph_state.get('agents', []))} roles.")
        chips.extend(["Agent status", "Transition log"])

    if any(w in msg for w in ["curve", "learning", "improvement", "trend", "pass rate"]):
        import sqlite3
        conn = store._connect()
        try:
            rows = conn.execute(
                "SELECT revision, metrics_json FROM episodes ORDER BY revision"
            ).fetchall()
            curve_data = []
            for row in rows:
                m = json.loads(row[1])
                curve_data.append({"revision": row[0],
                                   "checks_passed": m.get("checks_passed", 0),
                                   "checks_total": m.get("checks_total", 0),
                                   "duration_ms": m.get("duration_ms", 0)})
        finally:
            conn.close()
        if curve_data:
            cards.append({"type": "curves", "payload": {"points": curve_data}})
            reply_parts.append(f"Learning curve spans {len(curve_data)} revisions.")
            chips.extend(["Error reduction", "Duration trend"])

    if any(w in msg for w in ["cache", "tool cache"]):
        cache_stats = store.cache_stats()
        cards.append({"type": "memory", "payload": {"cache": cache_stats}})
        reply_parts.append(f"Tool cache: {cache_stats['entries']} entries, {cache_stats['total_hits']} hits.")
        chips.append("Cache details")

    if not cards:
        cards.append({"type": "memory", "payload": stats})
        reply_parts.append(f"Memory has {stats['active_rules']} rules, {stats['total_episodes']} episodes, "
                           f"{stats['cache_entries']} cache entries.")
        chips.extend(["Rules", "Episodes", "Cache", "Agent graph"])

    reply = " ".join(reply_parts) if reply_parts else "No matching data found."
    return {"reply": reply, "cards": cards, "chips": chips, "citations": citations}


class McpCallRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    server: str=Field(min_length=1,max_length=64)
    tool: str=Field(min_length=1,max_length=128)
    args: dict=Field(default_factory=dict)

@app.get('/api/mcp/servers')
def mcp_servers():
    try:
        return mcp_bridge.list_tools_with_servers()
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post('/api/mcp/call')
def mcp_call(req: McpCallRequest):
    try:
        episode = mcp_bridge.call_tool(req.server, req.tool, req.args)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f'MCP invocation failed: {e}')
    if episode['status'] == 'unavailable':
        raise HTTPException(502, episode['error'])
    return episode

# Job artifacts are shareable by opaque UUID. Do not put secrets in briefs.
# Private hosted deployments should enforce auth at the reverse proxy for all paths.
app.mount('/artifacts/jobs',StaticFiles(directory=JOBS),name='jobs')
app.mount('/',StaticFiles(directory=ROOT/'web',html=True),name='workspace')
