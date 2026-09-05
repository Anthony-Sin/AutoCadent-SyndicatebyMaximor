// Simple CDP test runner
import { spawn } from 'node:child_process';

async function main() {
  const PREVIEW_HOST = "ao-preview.mf2xi33dmfsgk3tufvzxs3tenfrwc5dfmj4w2ylynfww64rnnn.swk4dhn5uw4zznha.localhost:3001";
  const TARGET_URL = `http://${PREVIEW_HOST}/web/index.html`;

  console.log('Launching Chromium...');
  const chrome = spawn('chromium', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--host-resolver-rules=MAP * 127.0.0.1',
    '--disable-gpu=false',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--no-sandbox',
    '--window-size=1280,800'
  ]);

  let stdout = '';
  chrome.stderr.on('data', d => stdout += d.toString());

  // Wait for remote debugging port
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      if (res.ok) {
        const data = await res.json();
        wsUrl = data.webSocketDebuggerUrl;
        break;
      }
    } catch (e) {}
  }

  if (!wsUrl) {
    chrome.kill();
    throw new Error('Failed to connect to Chromium remote debugging port');
  }

  console.log('Connected to CDP browser endpoint:', wsUrl);

  // Create new target / page
  const newPageRes = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(TARGET_URL)}`, { method: 'PUT' });
  const pageTarget = await newPageRes.json();
  const pageWsUrl = pageTarget.webSocketDebuggerUrl;

  console.log('Page target created:', pageTarget.id, pageWsUrl);

  const ws = new WebSocket(pageWsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    }
  };

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');

  // Wait 2 seconds for app boot
  console.log('Waiting for app boot...');
  await new Promise(r => setTimeout(r, 2500));

  const titleRes = await send('Runtime.evaluate', {
    expression: 'document.title',
    returnByValue: true
  });
  console.log('Page Title:', titleRes.result.value);

  const activeProjectRes = await send('Runtime.evaluate', {
    expression: 'typeof window.getActiveProject === "function" ? window.getActiveProject()?.id : "none"',
    returnByValue: true
  });
  console.log('Active project ID:', activeProjectRes.result.value);

  ws.close();
  chrome.kill();
  console.log('CDP Test Complete.');
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
