// Browser-global polyfills for running svg-pcb headless in Node.
// Must be preloaded via `node --import ./polyfill.mjs`.
globalThis.self = globalThis;
globalThis.window = globalThis;

// Minimal DOM shim: svg-pcb's flattenPath creates an SVG <path> element
// solely to parse path "d" attribute strings via the getPathData polyfill.
globalThis.document = {
  createElementNS(ns, tag) {
    const attrs = {};
    const el = {
      nodeName: tag.toLowerCase(),
      namespaceURI: ns,
      setAttribute(name, value) { attrs[name] = String(value); },
      getAttribute(name) { return attrs[name] ?? null; },
      hasAttribute(name) { return name in attrs; },
      style: {},
      pathLength: { baseVal: { value: 0 }, animVal: { value: 0 } },
      getPointAtLength() { return { x: 0, y: 0 }; },
      getTotalLength() { return 0; },
      ownerSVGElement: null,
    };
    el.ownerSVGElement = el;
    return el;
  },
  createElement(tag) {
    return this.createElementNS(null, tag);
  }
};
