// svg-pcb headless Node runner.
// Reads a JSON command from stdin, executes PCB operations, writes JSON to stdout.
//
// Commands:
//   { "action": "generate", "board": {...}, "components": [...], "wires": [...],
//     "layers": ["F.Cu"], "layerColors": {...}, "flatten": false }
//   { "action": "export_svg", ...same as generate, "outputPath": "/path/to/file.svg" }
//
// Output: { "svg": "...", "metrics": {...}, "paths": {...}, "error": null }

import { PCB } from "./js/pcb.js";
import { getPathData, extrema } from "./geogram/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildPcb({ board, components = [], wires = [], layers = ["F.Cu"] }) {
  const pcb = new PCB();

  for (const comp of components) {
    const { footprint, translate, rotate, flip, id } = comp;
    pcb.add(footprint, { translate: translate || [0, 0], rotate: rotate || 0, flip: flip || false, id });
  }

  for (const w of wires) {
    const { points, thickness, layer } = w;
    const pts = points.map(p => {
      if (typeof p === "string") {
        // "compId.padName" reference
        const [compId, padName] = p.split(".");
        const c = pcb.getComponent(compId);
        if (!c) throw new Error(`Component not found: ${compId}`);
        return c.pad(padName);
      }
      return p;
    });
    pcb.wire(pts, thickness || 0.01, layer || "F.Cu");
  }

  return pcb;
}

function layerToSvgPaths(pcb, layer, flatten) {
  const raw = pcb.getLayer(layer, flatten);
  const paths = [];
  for (const item of raw) {
    if (typeof item === "string") {
      paths.push({ d: item, type: "shape" });
    } else if (item && item.type === "wire") {
      paths.push({ d: item.data, type: "wire", thickness: item.thickness });
    } else if (item && item.type === "text") {
      paths.push({ type: "text", value: item.value, x: item.translate[0], y: item.translate[1], size: item.size });
    }
  }
  return paths;
}

function computeBounds(pcb, layers) {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const comp of pcb.components) {
    for (const name in comp.pads) {
      const [x, y] = comp.pads[name];
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  if (!isFinite(xMin)) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  const pad = 0.05;
  return { xMin: xMin - pad, xMax: xMax + pad, yMin: yMin - pad, yMax: yMax + pad };
}

function buildSvg(layerPaths, bounds, layerColors, mmPerUnit = 25.4) {
  const { xMin, xMax, yMin, yMax } = bounds;
  const w = xMax - xMin;
  const h = yMax - yMin;

  let content = "";
  for (const [layer, paths] of Object.entries(layerPaths)) {
    const color = layerColors[layer] || "#000000ff";
    content += `  <g id="${layer}" fill="${color}" stroke="${color}">\n`;
    for (const p of paths) {
      if (p.type === "shape" || p.type === "wire") {
        const strokeW = p.type === "wire" ? p.thickness : 0;
        content += `    <path d="${p.d}" stroke-width="${strokeW}"${p.type === "wire" ? ' fill="none"' : ""}/>\n`;
      } else if (p.type === "text") {
        content += `    <text x="${p.x}" y="${p.y}" font-size="${p.size}" fill="${color}">${p.value}</text>\n`;
      }
    }
    content += `  </g>\n`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${xMin} ${yMin} ${w} ${h}" width="${w * mmPerUnit}mm" height="${h * mmPerUnit}mm">\n${content}</svg>`;
}

function generate(cmd) {
  const {
    board = {},
    components = [],
    wires = [],
    layers = ["F.Cu"],
    layerColors = { "F.Cu": "#ff8c00cc" },
    flatten = false,
  } = cmd;

  const pcb = buildPcb({ board, components, wires, layers });
  const bounds = computeBounds(pcb, layers);

  const allLayerPaths = {};
  let totalPaths = 0;
  for (const layer of layers) {
    const paths = layerToSvgPaths(pcb, layer, flatten);
    allLayerPaths[layer] = paths;
    totalPaths += paths.length;
  }

  const svg = buildSvg(allLayerPaths, bounds, layerColors);

  const metrics = {
    componentCount: pcb.components.length,
    wireCount: wires.length,
    layerCount: layers.length,
    totalPaths,
    bounds,
    mmPerUnit: 25.4,
    boardWidthMm: (bounds.xMax - bounds.xMin) * 25.4,
    boardHeightMm: (bounds.yMax - bounds.yMin) * 25.4,
  };

  return { svg, metrics, paths: allLayerPaths, error: null };
}

// --- Main: read JSON from stdin, execute, write JSON to stdout ---
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const cmd = JSON.parse(input);
    const action = cmd.action || "generate";

    let result;
    if (action === "generate" || action === "export_svg") {
      result = generate(cmd);
      if (action === "export_svg" && cmd.outputPath) {
        const outPath = resolve(cmd.outputPath);
        writeFileSync(outPath, result.svg, "utf8");
        result.outputPath = outPath;
      }
    } else {
      result = { svg: null, metrics: null, paths: null, error: `Unknown action: ${action}` };
    }

    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    const result = { svg: null, metrics: null, paths: null, error: err.message };
    process.stdout.write(JSON.stringify(result));
    process.exit(1);
  }
});
