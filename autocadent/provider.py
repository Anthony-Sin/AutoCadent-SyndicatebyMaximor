"""Server-only OpenAI-compatible Tensormux transport, with no raw response logging."""
from dataclasses import dataclass, field
import json
import math
import os
from pathlib import Path
import time
from urllib.parse import urlsplit
import httpx
from .design import Design, parse_design

ROOT = Path(__file__).resolve().parents[1]

class ProviderError(RuntimeError):
    def __init__(self, code, status=None):
        self.code, self.status = code, status
        super().__init__(f'Tensormux {code}' + (f' (HTTP {status})' if status else ''))

@dataclass(frozen=True)
class ProviderConfig:
    api_key: str = field(repr=False)
    base_url: str = 'https://api.tensormux.com/v1'
    model: str = 'glm-4-7-flash'
    timeout: float = 90.0

    @classmethod
    def from_env(cls):
        # Explicit server file supports worktrees; never load arbitrary dotenv settings.
        path = Path(os.getenv('AUTOCADENT_ENV_FILE', str(ROOT / '.env')))
        env_vars = {}
        if path.is_file():
            for line in path.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, _, v = line.partition('=')
                    env_vars[k.strip()] = v.strip().strip('\"\'')
        key = os.getenv('TENSORMUX_API_KEY') or env_vars.get('TENSORMUX_API_KEY', '')
        base_url = os.getenv('TENSORMUX_BASE_URL') or env_vars.get('TENSORMUX_BASE_URL', cls.base_url)
        model = os.getenv('TENSORMUX_MODEL') or env_vars.get('TENSORMUX_MODEL', cls.model)
        timeout_val = os.getenv('TENSORMUX_TIMEOUT_SECONDS') or env_vars.get('TENSORMUX_TIMEOUT_SECONDS', '90')
        timeout = float(timeout_val)

        config = cls(key, base_url.rstrip('/'), model, timeout)
        parsed = urlsplit(config.base_url)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or not math.isfinite(config.timeout)
                or not 1 <= config.timeout <= 180 or not config.model or len(config.model) > 100):
            raise ValueError('Invalid server provider configuration')
        return config

class Tensormux:
    def __init__(self, config, transport=None):
        self.config, self.transport = config, transport

    def generate(self, description, seed, previous=None, evaluation=None):
        if not self.config.api_key:
            raise ProviderError('not_configured')
        instruction = (
            'You design a bounded educational rover. Return ONLY a JSON object matching the schema. '
            'Never return source code, commands, paths, markdown prose or tool calls. '
            'Choose dimensions and PCB net labels appropriate to the user brief. The trusted CAD compiler '
            'builds a rover plus sensor_bridge plate on two existing chassis holes, 6 mm above the chassis. '
            'The PCB compiler builds a 60x40 mm parallel signal breakout, not a motor controller. '
            'Minimum acceptance: chassis thickness >=2.4 mm, tray wall >=2.4 mm, board side clearance >=0.8 mm, '
            'tray edge margin >=4 mm; bridge thickness >=2.4 mm, bridge-to-tray/mast clearance >=0.5 mm. '
            'For an initial prototype honor all supplied initial_spec values exactly, even if too thin: '
            'we need to measure it before revising. On revision, use the measured evaluation to correct '
            'all failed constraints, including initial_spec values when necessary. Keep supported requested '
            'features and net intent. Never claim electrical function or physical validation. Schema: '
            + json.dumps(Design.model_json_schema()))
        payload = {'brief': description, 'initial_spec': seed}
        if previous is not None:
            payload.update(previous_design=previous.model_dump(), measured_evaluation=evaluation,
                           task='Revise the design to correct measured failures. Return the complete design JSON.')
        body = {'model': self.config.model, 'messages': [
            {'role': 'system', 'content': instruction},
            {'role': 'user', 'content': json.dumps(payload)}], 'max_tokens': 3000, 'temperature': .2}
        started = time.monotonic()
        status = None
        try:
            # No redirects, proxy environment, retries or persisted raw provider payloads.
            with httpx.Client(timeout=self.config.timeout, follow_redirects=False, trust_env=False,
                              transport=self.transport) as client:
                with client.stream('POST', self.config.base_url + '/chat/completions', json=body,
                                   headers={'Authorization': 'Bearer ' + self.config.api_key}) as response:
                    status = response.status_code
                    if status != 200:
                        raise ProviderError('http_error', status)
                    chunks, size = [], 0
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > 65536:
                            raise ProviderError('response_too_large', status)
                        if time.monotonic() - started > self.config.timeout:
                            raise ProviderError('timeout', status)
                        chunks.append(chunk)
                    data = json.loads(b''.join(chunks))
            choice = data['choices'][0]
            if choice.get('finish_reason') != 'stop' or choice['message'].get('tool_calls'):
                raise ProviderError('incomplete_or_tool_response', status)
            design = parse_design(choice['message']['content'])
            if previous is None and any(design.spec.model_dump()[k] != v for k, v in seed.items()):
                raise ProviderError('initial_spec_mismatch', status)
        except ProviderError:
            raise
        except httpx.TimeoutException:
            raise ProviderError('timeout', status) from None
        except httpx.HTTPError:
            raise ProviderError('transport_error', status) from None
        except (ValueError, TypeError, KeyError, IndexError, RecursionError):
            raise ProviderError('invalid_design_response', status) from None
        return design, {'provider': 'tensormux', 'model': self.config.model, 'http_status': status,
                        'status': 'validated_design', 'seconds': round(time.monotonic() - started, 3),
                        'source': 'authenticated_endpoint', 'revision': previous is not None}
