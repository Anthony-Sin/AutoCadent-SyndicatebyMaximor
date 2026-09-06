"""Tests for the MCP bridge: list tools, call tools, API endpoints, episode recording."""
import json
import os
import shutil
import time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from autocadent import mcp_bridge
import autocadent.api as api

ROOT = Path(__file__).resolve().parents[1]
client = TestClient(api.app)


@pytest.fixture(autouse=True)
def _clear_episodes():
    mcp_bridge._episodes.clear()
    yield
    mcp_bridge._episodes.clear()


class TestMcpBridgeListTools:
    def test_list_servers_returns_declared_servers(self):
        servers = mcp_bridge.list_servers()
        names = [s['name'] for s in servers]
        assert 'autocadent-cad' in names
        assert 'kicad' in names
        for s in servers:
            assert s['transport'] == 'stdio'
            assert s['command']

    def test_list_tools_autocadent_cad(self):
        tools = mcp_bridge.list_tools('autocadent-cad')
        tool_names = [t['name'] for t in tools]
        assert 'inspect_spec' in tool_names
        assert 'generate_rover' in tool_names
        for t in tools:
            assert 'inputSchema' in t
            assert 'description' in t

    def test_list_tools_unknown_server_raises(self):
        with pytest.raises(Exception):
            mcp_bridge.list_tools('nonexistent-server')

    def test_kicad_server_skips_gracefully_when_unavailable(self, monkeypatch):
        original = mcp_bridge._make_params
        def bad_params(name):
            if name == 'kicad':
                return None
            return original(name)
        monkeypatch.setattr(mcp_bridge, '_make_params', bad_params)
        result = mcp_bridge.run_drc_via_mcp('/tmp/nonexistent.kicad_pcb')
        assert result is None


class TestMcpBridgeCallTool:
    def test_inspect_spec_returns_measured_dict_and_records_episode(self):
        result = mcp_bridge.call_tool('autocadent-cad', 'inspect_spec', {
            'length': 140, 'width': 90, 'thickness': 2.5, 'wall': 2.5,
            'clearance': 1.0, 'mast_height': 52,
        })
        assert result['status'] == 'success'
        assert result['server'] == 'autocadent-cad'
        assert result['tool'] == 'inspect_spec'
        assert result['latency_ms'] > 0
        assert result['episode_id']
        assert result['result'] is not None
        content = result['result']['content']
        assert content
        data = json.loads(content[0]['text'])
        assert 'passed' in data
        assert 'checks' in data
        episodes = mcp_bridge.get_episodes()
        assert len(episodes) == 1
        assert episodes[0]['episode_id'] == result['episode_id']
        assert episodes[0]['server'] == 'autocadent-cad'

    def test_unknown_server_raises(self):
        with pytest.raises(ValueError, match='Unknown MCP server'):
            mcp_bridge.call_tool('no-such-server', 'tool', {})

    def test_error_feedback_captured_verbatim(self):
        result = mcp_bridge.call_tool('autocadent-cad', 'nonexistent_tool', {})
        assert result['status'] == 'error'
        assert result['error']
        assert result['episode_id']
        episodes = mcp_bridge.get_episodes()
        assert len(episodes) == 1
        assert episodes[0]['error']


class TestMcpApiEndpoints:
    def test_get_mcp_servers(self):
        resp = client.get('/api/mcp/servers')
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        names = [s['name'] for s in data]
        assert 'autocadent-cad' in names

    def test_post_mcp_call_inspect_spec(self):
        resp = client.post('/api/mcp/call', json={
            'server': 'autocadent-cad',
            'tool': 'inspect_spec',
            'args': {'length': 140, 'width': 90, 'thickness': 2.5, 'wall': 2.5,
                     'clearance': 1.0, 'mast_height': 52},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'success'
        assert data['episode_id']
        assert data['latency_ms'] > 0

    def test_post_mcp_call_unknown_server_404(self):
        resp = client.post('/api/mcp/call', json={
            'server': 'no-such-server', 'tool': 'x', 'args': {}})
        assert resp.status_code == 404

    def test_post_mcp_call_rejects_extra_fields(self):
        resp = client.post('/api/mcp/call', json={
            'server': 'autocadent-cad', 'tool': 'x', 'args': {}, 'extra': 1})
        assert resp.status_code == 422


class TestKicadMcpDrc:
    @pytest.mark.skipif(
        not shutil.which('uvx'),
        reason='uvx not available; kicad MCP requires uvx',
    )
    def test_kicad_drc_via_mcp_with_real_board(self, tmp_path):
        spec = {
            'kind': 'signal_breakout',
            'nets': ['VCC', 'GND', 'SDA', 'SCL'],
            'connector_spacing': 26.0,
            'trace_width': 0.4,
        }
        (tmp_path / 'spec.json').write_text(json.dumps(spec))
        kicad_py = os.getenv('AUTOCADENT_KICAD_PYTHON', '/usr/bin/python3')
        proc = __import__('subprocess').run(
            [kicad_py, str(ROOT / 'scripts/model_board.py'),
             '--spec', str(tmp_path / 'spec.json'),
             '--output', str(tmp_path / 'board')],
            capture_output=True, text=True, timeout=120,
        )
        if proc.returncode != 0:
            pytest.skip(f'KiCad board generation failed: {proc.stderr[:200]}')
        pcb_path = tmp_path / 'board' / 'custom-breakout.kicad_pcb'
        if not pcb_path.exists():
            pytest.skip('PCB file not generated')
        episode = mcp_bridge.run_drc_via_mcp(str(pcb_path))
        if episode is None:
            pytest.skip('kicad MCP server unavailable')
        assert episode['server'] == 'kicad'
        assert episode['tool'] == 'run_drc'
        assert episode['status'] in ('success', 'error')
        assert episode['latency_ms'] > 0
        assert episode['episode_id']
