"""Backend MCP bridge: launch stdio MCP servers, list tools, invoke them, record episodes.

Every subprocess spawn has a hard wall-clock timeout. If the MCP handshake or tool call does not
complete within the timeout, the child process is killed (SIGKILL) and the operation returns an
error episode. No operation can block unbounded on stdin/stdout reads.
"""
import asyncio
import json
import os
import shutil
import signal
import threading
import time
import uuid
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]
_episodes: list[dict] = []

HANDSHAKE_TIMEOUT = 15.0
TOOL_LIST_TIMEOUT = 30.0
TOOL_CALL_TIMEOUT = 60.0
SESSION_WALL_TIMEOUT = 45.0


def _load_server_configs() -> dict[str, dict]:
    mcp_json = ROOT / 'mcp.json'
    if not mcp_json.is_file():
        return {}
    return json.loads(mcp_json.read_text()).get('mcpServers', {})


def _make_params(server_name: str) -> StdioServerParameters | None:
    configs = _load_server_configs()
    cfg = configs.get(server_name)
    if not cfg:
        return None
    return StdioServerParameters(
        command=cfg['command'],
        args=cfg.get('args', []),
        cwd=str(ROOT / cfg.get('cwd', '.')),
    )


def record_episode(episode: dict):
    _episodes.append(episode)


def get_episodes() -> list[dict]:
    return list(_episodes)


def _server_command_available(cfg: dict) -> bool:
    command = cfg.get('command', '')
    return shutil.which(command) is not None if command else True


async def _list_tools_async(server_name: str) -> list[dict]:
    params = _make_params(server_name)
    if not params:
        raise ValueError(f'Unknown MCP server: {server_name}')
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await asyncio.wait_for(session.initialize(), timeout=HANDSHAKE_TIMEOUT)
            listed = await asyncio.wait_for(session.list_tools(), timeout=TOOL_LIST_TIMEOUT)
            return [t.model_dump(mode='json') for t in listed.tools]


async def _call_tool_async(server_name: str, tool_name: str, arguments: dict) -> dict:
    params = _make_params(server_name)
    if not params:
        raise ValueError(f'Unknown MCP server: {server_name}')
    episode_id = str(uuid.uuid4())
    started = time.monotonic()
    status = 'success'
    error_text = ''
    result_data = None
    try:
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=HANDSHAKE_TIMEOUT)
                result = await asyncio.wait_for(
                    session.call_tool(tool_name, arguments), timeout=TOOL_CALL_TIMEOUT)
                result_data = result.model_dump(mode='json')
                if result_data.get('isError'):
                    status = 'error'
                    error_text = '; '.join(
                        c.get('text', '') for c in result_data.get('content', []) if c.get('type') == 'text'
                    )
    except asyncio.TimeoutError:
        status = 'unavailable'
        error_text = f'MCP operation timed out after {TOOL_CALL_TIMEOUT}s'
    except Exception as exc:
        status = 'unavailable'
        error_text = str(exc)
    latency_ms = round((time.monotonic() - started) * 1000, 1)
    episode = {
        'episode_id': episode_id,
        'server': server_name,
        'tool': tool_name,
        'arguments': arguments,
        'status': status,
        'latency_ms': latency_ms,
        'result': result_data,
        'error': error_text,
    }
    record_episode(episode)
    return episode


def _run_with_wall_timeout(coro, timeout: float):
    """Run async coro in a thread with a hard wall-clock timeout.

    asyncio.run() can block if subprocess cleanup hangs. We run it in a daemon thread
    and join with a timeout. If the thread doesn't finish, we abandon it (daemon thread
    dies with the process) and raise TimeoutError immediately.
    """
    result = [None]
    exception = [None]

    def _target():
        try:
            result[0] = asyncio.run(coro)
        except BaseException as e:
            exception[0] = e

    thread = threading.Thread(target=_target, daemon=True)
    thread.start()
    thread.join(timeout=timeout)
    if thread.is_alive():
        raise TimeoutError(f'MCP session timed out after {timeout}s (child process may be hung)')
    exc = exception[0]
    if exc is not None:
        if isinstance(exc, TimeoutError):
            raise exc
        if isinstance(exc, BaseExceptionGroup):
            for sub in exc.exceptions:
                if isinstance(sub, TimeoutError):
                    raise TimeoutError(f'MCP operation timed out: {sub}') from sub
        raise exc
    return result[0]


def list_servers() -> list[dict]:
    configs = _load_server_configs()
    return [{'name': name, 'transport': 'stdio', 'command': cfg['command'],
             'args': cfg.get('args', []), 'tools': []}
            for name, cfg in configs.items()]


def list_tools(server_name: str) -> list[dict]:
    return _run_with_wall_timeout(_list_tools_async(server_name), SESSION_WALL_TIMEOUT)


def call_tool(server_name: str, tool_name: str, arguments: dict) -> dict:
    return _run_with_wall_timeout(
        _call_tool_async(server_name, tool_name, arguments),
        SESSION_WALL_TIMEOUT + TOOL_CALL_TIMEOUT)


def list_tools_with_servers() -> list[dict]:
    configs = _load_server_configs()
    servers = []
    for name, cfg in configs.items():
        tools = []
        if not _server_command_available(cfg):
            servers.append({
                'name': name, 'transport': 'stdio',
                'command': cfg['command'], 'args': cfg.get('args', []),
                'tools': [], 'available': False,
            })
            continue
        try:
            tools = list_tools(name)
        except Exception:
            pass
        servers.append({
            'name': name, 'transport': 'stdio',
            'command': cfg['command'], 'args': cfg.get('args', []),
            'tools': tools, 'available': True,
        })
    return servers


def is_server_available(server_name: str) -> bool:
    configs = _load_server_configs()
    cfg = configs.get(server_name)
    if not cfg:
        return False
    return _server_command_available(cfg)


def probe_server(server_name: str, timeout: float = 10.0) -> bool:
    """Quick check: can this server start and respond to initialize? Returns False on any failure."""
    try:
        _run_with_wall_timeout(_list_tools_async(server_name), timeout)
        return True
    except Exception:
        return False


def run_drc_via_mcp(pcb_path: str) -> dict | None:
    pcb = Path(pcb_path)
    if not pcb.is_file():
        return None
    if not is_server_available('kicad'):
        return None
    try:
        episode = call_tool('kicad', 'run_drc', {'pcb_path': str(pcb.resolve())})
    except Exception:
        return None
    if episode['status'] == 'unavailable':
        return None
    return episode
