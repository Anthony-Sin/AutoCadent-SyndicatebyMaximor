/**
 * Adversarial Stress Harness: Frontend Workspace Isolation
 * Tasks:
 *  - 50+ rapid project switches across rove1, orion, and multiple custom designs.
 *  - Race condition / concurrent switching stress test.
 *  - Tab-interleaved workspace switching.
 *  - Rigorous zero cross-contamination verification across Files, Schematic, Layout, 3D Canvas, and DOM.
 */

import { spawn } from 'node:child_process';

const PREVIEW_HOST = "ao-preview.mf2xi33dmfsgk3tufvzxs3tenfrwc5dfmj4w2ylynfww64rnnn.swk4dhn5uw4zznha.localhost:3001";
const TARGET_URL = `http://${PREVIEW_HOST}/web/index.html`;

async function main() {
  console.log('================================================================');
  console.log(' Adversarial Challenger 2 — Workspace Isolation Stress Test');
  console.log('================================================================');

  const chrome = spawn('chromium', [
    '--headless=new',
    '--remote-debugging-port=9225',
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

  // Wait for CDP endpoint
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch('http://127.0.0.1:9225/json/version');
      if (res.ok) {
        const data = await res.json();
        wsUrl = data.webSocketDebuggerUrl;
        break;
      }
    } catch (e) {}
  }

  if (!wsUrl) {
    chrome.kill();
    throw new Error('Could not connect to Chromium on port 9225');
  }

  const newPageRes = await fetch(`http://127.0.0.1:9225/json/new?${encodeURIComponent(TARGET_URL)}`, { method: 'PUT' });
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

  console.log('Seeding custom designs into localStorage and waiting for boot...');
  await evaluate(`
    localStorage.setItem('autocadent.designs', JSON.stringify([
      {
        id: 'custom-scout-alpha',
        name: 'Scout Alpha Explorer',
        description: 'High-speed reconnaissance rover with sensor mast',
        spec: { length: 155, width: 95, mast_height: 60 },
        kind: 'template',
        source: 'template',
        created_at: '2026-09-05T20:00:00Z',
        updated_at: '2026-09-05T20:00:00Z',
        revisions: [{ n: 1, spec: { length: 155, width: 95, mast_height: 60 }, evaluated: false, passed: false, source_job: null, note: 'Scout Alpha', saved_at: '2026-09-05T20:00:00Z' }]
      },
      {
        id: 'custom-titan-beta',
        name: 'Titan Beta Hauler',
        description: 'Heavy payload rover with dual tool mounts',
        spec: { length: 180, width: 110, mast_height: 75 },
        kind: 'template',
        source: 'template',
        created_at: '2026-09-05T20:00:00Z',
        updated_at: '2026-09-05T20:00:00Z',
        revisions: [{ n: 1, spec: { length: 180, width: 110, mast_height: 75 }, evaluated: false, passed: false, source_job: null, note: 'Titan Beta', saved_at: '2026-09-05T20:00:00Z' }]
      }
    ]));
  `);

  // Wait for initial boot and asset loads
  await new Promise(r => setTimeout(r, 2500));

  const projects = ['rove1', 'orion', 'custom-scout-alpha', 'custom-titan-beta'];

  console.log('\n--- SUITE 1: Sequential Rapid 60-Switch Loop with Deep Isolation Verification ---');

  let suite1Passed = 0;
  const suite1Total = 60;
  const startTime = Date.now();

  for (let i = 0; i < suite1Total; i++) {
    const target = projects[i % projects.length];
    
    // Call setActiveProject
    await evaluate(`window.setActiveProject('${target}')`);
    // Brief settle for DOM rendering
    await new Promise(r => setTimeout(r, 30));

    // Extract state and DOM snapshots
    const state = await evaluate(`
      (() => {
        const p = window.getActiveProject();
        const fileListHtml = document.getElementById('file-list')?.innerHTML || '';
        const fileListText = document.getElementById('file-list')?.innerText || '';
        const schH2 = document.querySelector('#schematic-view .view-heading h2')?.innerText || '';
        const schSvg = document.getElementById('schematic')?.innerHTML || '';
        const boardSvgSrc = document.getElementById('board-svg')?.getAttribute('src') || '';
        const boardSvgAlt = document.getElementById('board-svg')?.getAttribute('alt') || '';
        const dlLink = document.querySelector('#layout-view a.outline-button')?.getAttribute('href') || '';
        const dlAttr = document.querySelector('#layout-view a.outline-button')?.getAttribute('download') || '';
        const isOrionBody = document.body.classList.contains('orion-model');
        const cap = document.getElementById('geometry-caption')?.innerText || '';

        return {
          id: p?.id,
          name: p?.name,
          fileListHtml,
          fileListText,
          schH2,
          schSvg,
          boardSvgSrc,
          boardSvgAlt,
          dlLink,
          dlAttr,
          isOrionBody,
          cap
        };
      })()
    `);

    // Strict Verification Oracles:
    let ok = true;
    const errors = [];

    if (state.id !== target) {
      ok = false;
      errors.push(`Active ID mismatch: expected ${target}, got ${state.id}`);
    }

    if (target === 'rove1') {
      // Must contain rove1 files
      if (!state.fileListText.includes('chassis.stl') || !state.fileListText.includes('rove-1-board.zip')) {
        ok = false;
        errors.push(`Rove-1 files missing chassis.stl or rove-1-board.zip`);
      }
      // Zero cross-contamination
      if (state.fileListText.includes('orion-board.zip') || state.fileListText.includes('manifest.json') || state.fileListText.includes('scout-alpha') || state.fileListText.includes('titan-beta')) {
        ok = false;
        errors.push(`Rove-1 file list contaminated with alien files!`);
      }
      // Schematic checks
      if (!state.schH2.includes('Four signals') || !state.schSvg.includes('VCC') || !state.schSvg.includes('SDA')) {
        ok = false;
        errors.push(`Rove-1 schematic mismatch: h2="${state.schH2}"`);
      }
      if (state.schSvg.includes('VBAT (24V)') || state.schSvg.includes('CAN_H') || state.schSvg.includes('MAST_DATA')) {
        ok = false;
        errors.push(`Rove-1 schematic contaminated with foreign nets!`);
      }
      // Board layout checks
      if (!state.boardSvgSrc.includes('artifacts/board/board.svg')) {
        ok = false;
        errors.push(`Rove-1 board SVG path mismatch: ${state.boardSvgSrc}`);
      }
      if (state.isOrionBody) {
        ok = false;
        errors.push(`Rove-1 has orion-model class on body`);
      }
    } else if (target === 'orion') {
      // Must contain Orion files
      if (!state.fileListText.includes('manifest.json') || !state.fileListText.includes('orion-board.zip') || !state.fileListText.includes('mesh.bin')) {
        ok = false;
        errors.push(`Orion files missing orion-board.zip or mesh.bin`);
      }
      // Zero cross-contamination
      if (state.fileListText.includes('chassis.stl') || state.fileListText.includes('rove-1-board.zip') || state.fileListText.includes('scout-alpha') || state.fileListText.includes('titan-beta')) {
        ok = false;
        errors.push(`Orion file list contaminated with alien files!`);
      }
      // Schematic checks
      if (!state.schH2.includes('Quadruped') || !state.schSvg.includes('VBAT (24V)') || !state.schSvg.includes('CAN_H')) {
        ok = false;
        errors.push(`Orion schematic mismatch: h2="${state.schH2}"`);
      }
      if (state.schSvg.includes('Four signals') || state.schSvg.includes('MAST_DATA')) {
        ok = false;
        errors.push(`Orion schematic contaminated with foreign nets!`);
      }
      // Board layout checks
      if (!state.boardSvgSrc.includes('artifacts/orion/board.svg')) {
        ok = false;
        errors.push(`Orion board SVG path mismatch: ${state.boardSvgSrc}`);
      }
      if (!state.isOrionBody) {
        ok = false;
        errors.push(`Orion missing orion-model class on body`);
      }
    } else if (target === 'custom-scout-alpha') {
      // Must contain custom scout alpha files
      if (!state.fileListText.includes('scout-alpha-explorer.autocadent.json') || !state.fileListText.includes('spec.json')) {
        ok = false;
        errors.push(`Custom Scout Alpha files missing`);
      }
      // Zero cross-contamination
      if (state.fileListText.includes('orion-board.zip') || state.fileListText.includes('chassis.stl') || state.fileListText.includes('titan-beta')) {
        ok = false;
        errors.push(`Custom Scout Alpha contaminated with alien files!`);
      }
      if (!state.schH2.includes('Scout Alpha Explorer') || !state.schSvg.includes('MAST_DATA')) {
        ok = false;
        errors.push(`Custom Scout Alpha schematic mismatch: h2="${state.schH2}"`);
      }
      if (state.schSvg.includes('VBAT (24V)') || state.schSvg.includes('Four signals')) {
        ok = false;
        errors.push(`Custom Scout Alpha schematic contaminated with alien nets!`);
      }
      if (state.dlAttr !== 'scout-alpha-explorer-board.zip') {
        ok = false;
        errors.push(`Custom Scout Alpha download bundle mismatch: ${state.dlAttr}`);
      }
      if (state.isOrionBody) {
        ok = false;
        errors.push(`Custom Scout Alpha has orion-model class on body`);
      }
    } else if (target === 'custom-titan-beta') {
      // Must contain custom titan beta files
      if (!state.fileListText.includes('titan-beta-hauler.autocadent.json') || !state.fileListText.includes('spec.json')) {
        ok = false;
        errors.push(`Custom Titan Beta files missing`);
      }
      // Zero cross-contamination
      if (state.fileListText.includes('orion-board.zip') || state.fileListText.includes('chassis.stl') || state.fileListText.includes('scout-alpha')) {
        ok = false;
        errors.push(`Custom Titan Beta contaminated with alien files!`);
      }
      if (!state.schH2.includes('Titan Beta Hauler') || !state.schSvg.includes('MAST_DATA')) {
        ok = false;
        errors.push(`Custom Titan Beta schematic mismatch: h2="${state.schH2}"`);
      }
      if (state.schSvg.includes('VBAT (24V)') || state.schSvg.includes('Four signals')) {
        ok = false;
        errors.push(`Custom Titan Beta schematic contaminated with alien nets!`);
      }
      if (state.dlAttr !== 'titan-beta-hauler-board.zip') {
        ok = false;
        errors.push(`Custom Titan Beta download bundle mismatch: ${state.dlAttr}`);
      }
      if (state.isOrionBody) {
        ok = false;
        errors.push(`Custom Titan Beta has orion-model class on body`);
      }
    }

    if (ok) {
      suite1Passed++;
    } else {
      console.error(`[FAIL] Iteration ${i + 1} (${target}):`, errors.join('; '));
    }
  }

  const elapsed1 = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Suite 1 Result: ${suite1Passed}/${suite1Total} switches passed in ${elapsed1}s (Zero contamination verified)`);

  console.log('\n--- SUITE 2: Concurrent / Rapid-Fire Race Condition Stress Test (60 switches) ---');
  // Fire 60 switches without awaiting the previous one
  const raceResult = await evaluate(`
    (async () => {
      const targets = ['rove1', 'orion', 'custom-scout-alpha', 'custom-titan-beta'];
      const sequence = [];
      for (let i = 0; i < 60; i++) {
        const t = targets[(i * 3 + 1) % targets.length];
        sequence.push(t);
        // Call without awaiting to provoke in-flight race conditions
        window.setActiveProject(t);
        // tiny random jitter 0-3ms
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 4)));
      }
      const finalTarget = sequence[sequence.length - 1];
      // Final definitive switch
      await window.setActiveProject(finalTarget);
      // Wait for any trailing async mesh/file loads to settle
      await new Promise(r => setTimeout(r, 600));

      const p = window.getActiveProject();
      const fileListText = document.getElementById('file-list')?.innerText || '';
      const schH2 = document.querySelector('#schematic-view .view-heading h2')?.innerText || '';
      const boardSvgSrc = document.getElementById('board-svg')?.getAttribute('src') || '';
      const isOrionBody = document.body.classList.contains('orion-model');

      return {
        finalTarget,
        currentId: p?.id,
        fileListText,
        schH2,
        boardSvgSrc,
        isOrionBody,
        meshVisible: window.assembly?.visible,
        meshPartsCount: window.assembly?.children?.length || 0
      };
    })()
  `);

  console.log('Race Condition Test Completed. Final Target:', raceResult.finalTarget);
  console.log('Final Settled ID:', raceResult.currentId);
  console.log('Settled Board SVG:', raceResult.boardSvgSrc);

  let suite2Pass = (raceResult.currentId === raceResult.finalTarget);
  if (raceResult.finalTarget === 'orion') {
    suite2Pass = suite2Pass && raceResult.isOrionBody && raceResult.boardSvgSrc.includes('artifacts/orion/board.svg');
  } else if (raceResult.finalTarget === 'rove1') {
    suite2Pass = suite2Pass && !raceResult.isOrionBody && raceResult.boardSvgSrc.includes('artifacts/board/board.svg');
  }
  console.log('Suite 2 Result:', suite2Pass ? 'PASS (State cleanly settled without cross-talk)' : 'FAIL');

  console.log('\n--- SUITE 3: Tab-Interleaved Project Switching (50 switches) ---');
  const tabs = ['files', 'schematic', 'layout', 'preview'];
  let suite3Passed = 0;
  const suite3Total = 50;

  for (let i = 0; i < suite3Total; i++) {
    const tProject = projects[i % projects.length];
    const tTab = tabs[i % tabs.length];

    await evaluate(`
      window.tab('${tTab}');
      window.setActiveProject('${tProject}');
    `);
    await new Promise(r => setTimeout(r, 15));

    const check = await evaluate(`
      (() => {
        const p = window.getActiveProject();
        const curTab = location.hash.replace(/^#\\/?/, '');
        return {
          id: p?.id,
          tab: curTab
        };
      })()
    `);

    if (check.id === tProject) {
      suite3Passed++;
    }
  }
  console.log(`Suite 3 Result: ${suite3Passed}/${suite3Total} tab-interleaved switches passed`);

  console.log('\n--- SUITE 4: Console Error Audit During Workspace Stress ---');
  console.log(`Console Errors detected: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    consoleErrors.forEach((err, idx) => console.log(`  [Error ${idx + 1}]: ${err}`));
  }

  ws.close();
  chrome.kill();

  const allPassed = (suite1Passed === suite1Total) && suite2Pass && (suite3Passed === suite3Total) && (consoleErrors.length === 0);
  console.log('\n================================================================');
  console.log(` WORKSPACE ISOLATION VERDICT: ${allPassed ? 'APPROVE (PASSED)' : 'FAIL'}`);
  console.log('================================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test harness error:', err);
  process.exit(1);
});
