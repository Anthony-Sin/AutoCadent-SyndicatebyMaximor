"""Backend MCP bridge: launch stdio MCP servers, list tools, invoke them, record episodes."""
import asyncio
import json
import time
import uuid
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]
_episodes: list[dict] = []


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


async def _list_tools_async(server_name: str) -> list[dict]:
    params = _make_params(server_name)
    if not params:
        raise ValueError(f'Unknown MCP server: {server_name}')
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            listed = await session.list_tools()
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
                await session.initialize()
                result = await session.call_tool(tool_name, arguments)
                result_data = result.model_dump(mode='json')
                if result_data.get('isError'):
                    status = 'error'
                    error_text = '; '.join(
                        c.get('text', '') for c in result_data.get('content', []) if c.get('type') == 'text'
                    )
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


def list_servers() -> list[dict]:
    configs = _load_server_configs()
    return [{'name': name, 'transport': 'stdio', 'command': cfg['command'],
             'args': cfg.get('args', []), 'tools': []}
            for name, cfg in configs.items()]


def list_tools(server_name: str) -> list[dict]:
    return asyncio.run(_list_tools_async(server_name))


def call_tool(server_name: str, tool_name: str, arguments: dict) -> dict:
    return asyncio.run(_call_tool_async(server_name, tool_name, arguments))


def list_tools_with_servers() -> list[dict]:
    configs = _load_server_configs()
    servers = []
    for name, cfg in configs.items():
        tools = []
        try:
            tools = list_tools(name)
        except Exception:
            pass
        servers.append({
            'name': name,
            'transport': 'stdio',
            'command': cfg['command'],
            'args': cfg.get('args', []),
            'tools': tools,
        })
    return servers


def run_drc_via_mcp(pcb_path: str) -> dict | None:
    pcb = Path(pcb_path)
    if not pcb.is_file():
        return None
    try:
        episode = call_tool('kicad', 'run_drc', {'pcb_path': str(pcb.resolve())})
    except Exception:
        return None
    if episode['status'] == 'unavailable':
        return None
    return episode
