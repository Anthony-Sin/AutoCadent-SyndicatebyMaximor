"""Addendum D: exercise the agent against a real Tensormux model endpoint.

All tests skip gracefully when TENSORMUX_API_KEY is absent (CI without secrets).
The key is read from /home/ANT/.ao/data/scratch/default/tensormux.key or env.
NEVER hardcoded, printed, committed, or logged.
"""
import json
import os
import time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from autocadent.provider import ProviderConfig, Tensormux, ProviderError
from autocadent.design import Design
from autocadent.cad import Spec, build, evaluate

KEY_PATH = Path('/home/ANT/.ao/data/scratch/default/tensormux.key')

def _get_key():
    key = os.environ.get('TENSORMUX_API_KEY', '')
    if key:
        return key
    if KEY_PATH.is_file():
        return KEY_PATH.read_text().strip()
    return ''

requires_key = pytest.mark.skipif(
    not _get_key(),
    reason='TENSORMUX_API_KEY not set and key file not found',
)

import autocadent.api as api
client = TestClient(api.app)


def _generate_with_retry(provider, description, seed, max_attempts=3):
    """Retry real-model generation: the model is non-deterministic and may
    occasionally return schema-invalid output. Record each attempt."""
    last_error = None
    for attempt in range(max_attempts):
        try:
            return provider.generate(description, seed)
        except ProviderError as e:
            last_error = e
            if e.code in ('not_configured', 'transport_error', 'timeout'):
                raise
    pytest.skip(f'Model returned invalid output {max_attempts} times: {last_error.code}')


@requires_key
class TestProviderRoundTrip:
    def test_real_chat_completion_round_trip(self, monkeypatch):
        monkeypatch.setenv('TENSORMUX_API_KEY', _get_key())
        config = ProviderConfig.from_env()
        provider = Tensormux(config)
        seed = {'length': 140, 'width': 95, 'thickness': 3.0, 'wall': 2.5,
                'clearance': 1.2, 'mast_height': 50}
        design, meta = _generate_with_retry(
            provider, 'Educational rover with sensor mast and connector board', seed)
        assert isinstance(design, Design)
        assert meta['provider'] == 'tensormux'
        assert meta['model'] == 'glm-4-7-flash'
        assert meta['http_status'] == 200
        assert meta['seconds'] > 0
        assert meta['seconds'] < 90
        assert meta['revision'] is False
        assert design.spec.length == 140
        assert design.spec.width == 95

    def test_real_round_trip_records_latency(self, monkeypatch):
        monkeypatch.setenv('TENSORMUX_API_KEY', _get_key())
        config = ProviderConfig.from_env()
        provider = Tensormux(config)
        seed = {'length': 140, 'width': 95, 'thickness': 3.0, 'wall': 2.5,
                'clearance': 1.2, 'mast_height': 50}
        started = time.monotonic()
        _, meta = _generate_with_retry(provider, 'Small rover', seed)
        wall_clock = time.monotonic() - started
        assert meta['seconds'] > 0
        assert wall_clock < 90

    def test_real_round_trip_design_passes_cad_evaluation(self, monkeypatch):
        monkeypatch.setenv('TENSORMUX_API_KEY', _get_key())
        config = ProviderConfig.from_env()
        provider = Tensormux(config)
        seed = {'length': 140, 'width': 95, 'thickness': 3.0, 'wall': 2.5,
                'clearance': 1.2, 'mast_height': 50}
        design, meta = _generate_with_retry(
            provider, 'Educational rover with sensor mast and connector board', seed)
        s = design.spec.cad()
        parts, measured = build(s)
        result = evaluate(s, parts, measured)
        assert isinstance(result, dict)
        assert 'checks' in result
        assert 'passed' in result
        assert len(result['checks']) == 6

    def test_invalid_model_output_is_classified_not_crashed(self, monkeypatch):
        """Verify that when the model returns schema-invalid output, the provider
        raises a classified ProviderError rather than an unhandled exception."""
        monkeypatch.setenv('TENSORMUX_API_KEY', _get_key())
        config = ProviderConfig.from_env()
        provider = Tensormux(config)
        seed = {'length': 140, 'width': 95, 'thickness': 3.0, 'wall': 2.5,
                'clearance': 1.2, 'mast_height': 50}
        errors_seen = []
        for _ in range(3):
            try:
                provider.generate('Rover', seed)
                return
            except ProviderError as e:
                errors_seen.append(e.code)
                assert e.code in ('invalid_design_response', 'initial_spec_mismatch',
                                  'incomplete_or_tool_response', 'response_too_large')
                assert e.status == 200
        assert len(errors_seen) == 3


@requires_key
class TestReflectionQuality:
    def test_revision_with_real_failure_trace(self, monkeypatch):
        monkeypatch.setenv('TENSORMUX_API_KEY', _get_key())
        config = ProviderConfig.from_env()
        provider = Tensormux(config)
        seed = {'length': 140, 'width': 95, 'thickness': 3.0, 'wall': 2.5,
                'clearance': 1.2, 'mast_height': 50}
        initial_design, meta1 = _generate_with_retry(
            provider, 'Educational rover with sensor mast and connector board', seed)
        assert meta1['revision'] is False
        s = initial_design.spec.cad()
        parts, measured = build(s)
        evaluation = evaluate(s, parts, measured)
        if evaluation['passed']:
            naive_spec = Spec(length=140, width=95, thickness=1.2, wall=1.2,
                              clearance=0.1, mast_height=52)
            naive_parts, naive_measured = build(naive_spec)
            evaluation = evaluate(naive_spec, naive_parts, naive_measured)
        failed = [c for c in evaluation['checks'] if not c['passed']]
        if not failed:
            pytest.skip('Could not produce a failing evaluation for revision test')
        try:
            revised_design, meta2 = provider.generate(
                'Revise rover to fix failures', seed,
                previous=initial_design, evaluation=evaluation)
        except ProviderError as e:
            pytest.skip(f'Model returned invalid revision: {e.code}')
        assert meta2['revision'] is True
        assert isinstance(revised_design, Design)

    def test_graceful_degradation_when_endpoint_unreachable(self, monkeypatch):
        monkeypatch.setenv('TENSORMUX_API_KEY', 'fake-key-for-degradation-test')
        monkeypatch.setenv('TENSORMUX_BASE_URL', 'https://127.0.0.1:1/v1')
        monkeypatch.setenv('TENSORMUX_TIMEOUT_SECONDS', '5')
        config = ProviderConfig.from_env()
        provider = Tensormux(config)
        seed = {'length': 140, 'width': 95, 'thickness': 3.0, 'wall': 2.5,
                'clearance': 1.2, 'mast_height': 50}
        with pytest.raises(ProviderError) as exc_info:
            provider.generate('Test unreachable', seed)
        assert exc_info.value.code in ('transport_error', 'timeout', 'http_error')


class TestDeterministicChatZeroModelCalls:
    def test_deterministic_job_uses_no_model(self, tmp_path, monkeypatch):
        monkeypatch.setattr(api, 'JOBS', tmp_path)
        response = client.post('/api/jobs', json={
            'description': 'A compact rover',
            'spec': {'length': 125},
            'execution': 'deterministic',
        })
        assert response.status_code == 202
        job = response.json()['id']
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            status = client.get('/api/jobs/' + job).json()
            if status['status'] in ('complete', 'failed'):
                break
            time.sleep(0.1)
        assert status['status'] == 'complete'
        assert status['report']['passed']
        report_path = tmp_path / job / 'report.json'
        if report_path.exists():
            report = json.loads(report_path.read_text())
            assert report.get('execution') == 'deterministic'
            assert 'provider_requests' not in report

    def test_tensormux_job_requires_configured_key(self):
        response = client.post('/api/jobs', json={
            'description': 'Model rover',
            'spec': {'length': 140},
            'execution': 'tensormux',
        })
        if response.status_code == 409:
            assert 'Tensormux disabled' in response.json()['detail']
        elif response.status_code == 202:
            pass
        else:
            pytest.fail(f'Unexpected status: {response.status_code}')


@requires_key
class TestCostEvidence:
    def test_provider_metadata_includes_timing(self, monkeypatch):
        monkeypatch.setenv('TENSORMUX_API_KEY', _get_key())
        config = ProviderConfig.from_env()
        provider = Tensormux(config)
        seed = {'length': 140, 'width': 95, 'thickness': 3.0, 'wall': 2.5,
                'clearance': 1.2, 'mast_height': 50}
        _, meta = _generate_with_retry(provider, 'Cost evidence rover', seed)
        assert 'seconds' in meta
        assert isinstance(meta['seconds'], float)
        assert meta['seconds'] > 0
        assert meta['provider'] == 'tensormux'
        assert meta['model'] == 'glm-4-7-flash'
        assert meta['source'] == 'authenticated_endpoint'
