"""Actual MCP handshake and useful calls, patterned after BCI's stdio setup."""
import argparse
import asyncio
import json
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def probe(server, output, call=None, arguments=None):
    root=Path(__file__).resolve().parents[1]
    config=json.loads((root/'mcp.json').read_text())['mcpServers'][server]
    params=StdioServerParameters(command=config['command'],args=config['args'],cwd=str(root/config.get('cwd','.')))
    async with stdio_client(params) as (read,write):
        async with ClientSession(read,write) as session:
            init=await session.initialize(); listed=await session.list_tools()
            data={'server':server,'initialize':init.model_dump(mode='json'),'tools':[t.model_dump(mode='json') for t in listed.tools]}
            if call:
                result=await session.call_tool(call,arguments or {})
                data['call']={'name':call,'arguments':arguments or {},'result':result.model_dump(mode='json')}
            Path(output).parent.mkdir(parents=True,exist_ok=True)
            Path(output).write_text(json.dumps(data,indent=2)+'\n')
            print(json.dumps({'server':server,'tools':len(listed.tools),'call':call,'isError':data.get('call',{}).get('result',{}).get('isError')}))
if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('server'); ap.add_argument('--output',default='.runs/mcp.json'); ap.add_argument('--call'); ap.add_argument('--arguments',default='{}'); a=ap.parse_args()
    asyncio.run(probe(a.server,a.output,a.call,json.loads(a.arguments)))
