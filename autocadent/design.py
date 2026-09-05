"""Bounded data-only design language. No source code, paths or executable expressions."""
import json
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field
from .cad import Spec

Number = Annotated[float, Field(strict=True, allow_inf_nan=False)]

class Bounded(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

class RoverSpec(Bounded):
    length: Number = Field(ge=120, le=180)
    width: Number = Field(ge=80, le=110)
    thickness: Number = Field(ge=1, le=5)
    wall: Number = Field(ge=1, le=5)
    clearance: Number = Field(ge=.05, le=3)
    mast_height: Number = Field(ge=35, le=75)

    def cad(self):
        return Spec(**self.model_dump())

class AddonSpec(Bounded):
    kind: Literal['sensor_bridge']
    depth: Number = Field(ge=16, le=24)
    thickness: Number = Field(ge=1, le=5)

class PCBSpec(Bounded):
    kind: Literal['signal_breakout']
    # Fixed 60 x 40 mm outline matches the rover board envelope.
    nets: list[Annotated[str, Field(pattern=r'^[A-Z][A-Z0-9_]{0,15}$')]] = Field(min_length=3, max_length=8)
    connector_spacing: Number = Field(ge=20, le=38)
    trace_width: Number = Field(ge=.25, le=.8)

class Design(Bounded):
    spec: RoverSpec
    addon: AddonSpec
    pcb: PCBSpec

    def checked(self):
        if len(set(self.pcb.nets)) != len(self.pcb.nets):
            raise ValueError('PCB net names must be unique')
        return self


def parse_design(content: str) -> Design:
    if not isinstance(content, str) or len(content.encode('utf-8')) > 16384:
        raise ValueError('Design exceeds size bound')
    # Accept one JSON fence; never extract JSON from arbitrary surrounding prose.
    content = content.strip()
    if content.startswith('```json\n') and content.endswith('\n```'):
        content = content[8:-4]
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    data = json.loads(content, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
    return Design.model_validate(data).checked()
