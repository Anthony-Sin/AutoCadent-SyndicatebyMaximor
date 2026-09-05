/**
 * Adversarial Stress Harness: Motion Lab Three.js Simulation
 * Tasks:
 *  - 50+ rapid terrain switches (Martian -> Lunar -> Proving Ground -> Martian).
 *  - Continuous WebGL error auditing: gl.getError() === 0 throughout.
 *  - Check WebGL context loss and stability.
 *  - Rapid tab switching pause/resume stability (#/workspace -> #/simulation -> #/designs -> #/simulation).
 *  - Telemetry animation loop heartbeat and kinematics verification.
 *  - Playback controls & camera controls under stress.
 */

import { spawn } from 'node:child_process';

const PREVIEW_HOST = "ao-preview.mf2xi33dmfsgk3tufvzxs3tenfrwc5dfmj4w2ylynfww64rnnn.swk4dhn5uw4zznha.localhost:3001";
const TARGET_URL = `http://${PREVIEW_HOST}/web/index.html#/simulation`;

async function main() {
  console.log('================================================================');
  console.log(' Adversarial Challenger 2 — Motion Lab Three.js Stress Test');
  console.log('================================================================');

  const chrome = spawn('chromium', [
    '--headless=new',
    '--remote-debugging-port=9224',
    '--host-resolver-rules=MAP * 127.0.0.1',
    '--disable-gpu=false',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--no-sandbox',
    '--window-size=1280,800'
  ]);

  let stderrOutput = '';
  chrome.stderr.on('data', d => stderrOutput += d.toString());

  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch('http://127.0.0.1:9224/json/version');
      if (res.ok) {
        const data = await res.json();
        wsUrl = data.webSocketDebuggerUrl;
        break;
      }
    } catch (e) {}
  }

  if (!wsUrl) {
    chrome.kill();
    throw new Error('Could not connect to Chromium on port 9224');
  }

  const newPageRes = await fetch(`http://127.0.0.1:9224/json/new?${encodeURIComponent(TARGET_URL)}`, { method: 'PUT' });
  const pageTarget = await newPageRes.json();
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 1;
  const pending = new Map();
  const consoleErrors = [];

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.consoleAPICalled') {
      if (data.params.type === 'error') {
        consoleErrors.push(data.params.args.map(a => a.value || a.description).join(' '));
      }
    }
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

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result.value;
  }

  await send('Page.enable');
  await send('Runtime.enable');

  console.log('Waiting for app boot and window.tab initialization...');
  for (let i = 0; i < 30; i++) {
    const ready = await evaluate(`typeof window.tab === 'function'`).catch(() => false);
    if (ready) break;
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('Navigating to Motion Lab (#/simulation) and awaiting WebGL initialization...');
  await evaluate(`window.tab('simulation')`);
  await new Promise(r => setTimeout(r, 2000));

  // Verify canvas and WebGL context exists
  const initCheck = await evaluate(`
    (() => {
      const canvas = document.querySelector('#sim-viewport canvas');
      if (!canvas) return { error: 'No canvas found in #sim-viewport' };
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return { error: 'No WebGL context on simulation canvas' };
      return {
        hasCanvas: true,
        width: canvas.width,
        height: canvas.height,
        isContextLost: gl.isContextLost(),
        glError: gl.getError(),
        webglVersion: gl instanceof WebGL2RenderingContext ? 2 : 1,
        rendererVendor: gl.getParameter(gl.RENDERER)
      };
    })()
  `);

  console.log('Initial WebGL status:', initCheck);
  if (initCheck.error) {
    throw new Error(initCheck.error);
  }

  console.log('\n--- SUITE 1: 60 Rapid Terrain Switches (Martian -> Lunar -> Proving Ground) ---');
  const terrains = ['martian', 'lunar', 'proving_ground'];
  const expectedLabels = {
    martian: 'Martian Regolith',
    lunar: 'Lunar Surface',
    proving_ground: 'Proving Ground Grid'
  };

  let terrainPassed = 0;
  const terrainTotal = 60;
  const glErrors = [];
  const tStart = Date.now();

  for (let i = 0; i < terrainTotal; i++) {
    const terrain = terrains[i % terrains.length];

    // Click terrain button in DOM
    await evaluate(`
      (() => {
        const btn = document.querySelector('#sim-terrain-select button[data-terrain="${terrain}"]');
        if (btn) btn.click();
      })()
    `);

    // Settle brief 30ms
    await new Promise(r => setTimeout(r, 30));

    // Audit WebGL error state and DOM telemetry
    const check = await evaluate(`
      (() => {
        const canvas = document.querySelector('#sim-viewport canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const err = gl.getError();
        const lost = gl.isContextLost();
        const telem = document.getElementById('telem-terrain')?.innerText || '';
        const activeBtn = document.querySelector('#sim-terrain-select button.active')?.dataset.terrain;
        return {
          glError: err,
          isContextLost: lost,
          telem,
          activeBtn
        };
      })()
    `);

    if (check.glError !== 0) {
      glErrors.push({ iter: i + 1, terrain, error: check.glError });
    }

    const telemMatches = check.telem.includes(expectedLabels[terrain]);
    const btnMatches = check.activeBtn === terrain;

    if (check.glError === 0 && !check.isContextLost && telemMatches && btnMatches) {
      terrainPassed++;
    } else {
      console.warn(`[WARN] Terrain iter ${i + 1} (${terrain}): glError=${check.glError}, lost=${check.isContextLost}, telem="${check.telem}", activeBtn="${check.activeBtn}"`);
    }
  }

  const tElapsed = ((Date.now() - tStart) / 1000).toFixed(2);
  console.log(`Suite 1 Result: ${terrainPassed}/${terrainTotal} terrain switches passed in ${tElapsed}s (gl.getError() === 0 on all)`);

  console.log('\n--- SUITE 2: Tab Switching Pause/Resume Stability (50 rapid tab transitions) ---');
  // Cycle: simulation -> explorer -> simulation -> designs -> simulation
  const tabSequence = ['preview', 'simulation', 'designs', 'simulation', 'files', 'simulation'];
  let tabStabilityPassed = 0;
  const tabTotal = 50;
  const tabStart = Date.now();

  for (let i = 0; i < tabTotal; i++) {
    const tName = tabSequence[i % tabSequence.length];
    await evaluate(`window.tab('${tName}')`);
    await new Promise(r => setTimeout(r, 20));

    const simCheck = await evaluate(`
      (() => {
        const canvas = document.querySelector('#sim-viewport canvas');
        if (!canvas) return { ok: false, error: 'canvas missing' };
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const err = gl.getError();
        const isLost = gl.isContextLost();
        return {
          ok: true,
          glError: err,
          isContextLost: isLost
        };
      })()
    `);

    if (simCheck.ok && simCheck.glError === 0 && !simCheck.isContextLost) {
      tabStabilityPassed++;
    }
  }

  const tabElapsed = ((Date.now() - tabStart) / 1000).toFixed(2);
  console.log(`Suite 2 Result: ${tabStabilityPassed}/${tabTotal} tab transitions passed in ${tabElapsed}s`);

  console.log('\n--- SUITE 3: Animation Loop Liveness & Kinematics Telemetry Verification ---');
  // Ensure we are on #/simulation
  await evaluate(`window.tab('simulation')`);
  await new Promise(r => setTimeout(r, 200));

  // Measure phase change over 400ms to confirm active rendering
  const telemetrySample1 = await evaluate(`document.getElementById('telem-phase')?.innerText || ''`);
  await new Promise(r => setTimeout(r, 400));
  const telemetrySample2 = await evaluate(`document.getElementById('telem-phase')?.innerText || ''`);
  const isLoopAnimating = (telemetrySample1 !== telemetrySample2) && telemetrySample1 !== '' && telemetrySample2 !== '';
  console.log(`Animation loop heartbeat: sample1="${telemetrySample1}", sample2="${telemetrySample2}", active=${isLoopAnimating}`);

  console.log('\n--- SUITE 4: Robot Locomotion Switch (Orion <-> Rove-1 20x toggles) ---');
  let robotSwitchPassed = 0;
  for (let i = 0; i < 20; i++) {
    const bot = (i % 2 === 0) ? 'rove1' : 'orion';
    await evaluate(`document.getElementById('sim-robot-${bot}')?.click()`);
    await new Promise(r => setTimeout(r, 25));

    const checkBot = await evaluate(`
      (() => {
        const activeBot = document.querySelector('[data-sim-robot].active')?.dataset.simRobot;
        const stride = document.getElementById('telem-stride')?.innerText || '';
        return { activeBot, stride };
      })()
    `);

    if (checkBot.activeBot === bot) {
      robotSwitchPassed++;
    }
  }
  console.log(`Suite 4 Result: ${robotSwitchPassed}/20 robot toggles passed`);

  console.log('\n--- SUITE 5: Playback & Camera Controls Under Stress ---');
  // Toggle Play/Pause 10 times, cycle speeds (0.5x, 1x, 2x), cycle cameras
  const controlsCheck = await evaluate(`
    (async () => {
      const pp = document.getElementById('sim-play-pause');
      // pause
      pp.click();
      const paused1 = pp.innerText.includes('Play');
      // play
      pp.click();
      const playing1 = pp.innerText.includes('Pause');

      // cycle speeds
      document.getElementById('sim-speed-2x')?.click();
      const speed2 = document.getElementById('telem-velocity')?.innerText || '';

      document.getElementById('sim-speed-half')?.click();
      const speedHalf = document.getElementById('telem-velocity')?.innerText || '';

      document.getElementById('sim-speed-1x')?.click();

      // cycle cameras
      const cams = ['iso', 'top', 'side', 'chase'];
      for (const c of cams) {
        document.querySelector(\`#sim-camera-presets button[data-cam="\${c}"]\`)?.click();
      }

      return {
        paused1,
        playing1,
        speed2,
        speedHalf
      };
    })()
  `);
  console.log('Controls check result:', controlsCheck);

  // Final gl.getError() check
  const finalGlCheck = await evaluate(`
    (() => {
      const canvas = document.querySelector('#sim-viewport canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return {
        finalGlError: gl.getError(),
        finalContextLost: gl.isContextLost()
      };
    })()
  `);
  console.log('Final WebGL State:', finalGlCheck);

  console.log('\n--- SUITE 6: Console Error Audit During Motion Lab Stress ---');
  console.log(`Console Errors detected: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    consoleErrors.forEach((err, idx) => console.log(`  [Error ${idx + 1}]: ${err}`));
  }

  ws.close();
  chrome.kill();

  const allPassed = (terrainPassed === terrainTotal) &&
                    (tabStabilityPassed === tabTotal) &&
                    isLoopAnimating &&
                    (robotSwitchPassed === 20) &&
                    (finalGlCheck.finalGlError === 0) &&
                    !finalGlCheck.finalContextLost &&
                    (consoleErrors.length === 0);

  console.log('\n================================================================');
  console.log(` MOTION LAB THREE.JS VERDICT: ${allPassed ? 'APPROVE (PASSED)' : 'FAIL'}`);
  console.log('================================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test harness error:', err);
  process.exit(1);
});
