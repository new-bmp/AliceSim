(function (root) {
  "use strict";

  // A tiny deterministic WASM kernel.  It is deliberately small so the
  // simulator can load it without a network request or a toolchain at run
  // time.  The JS path remains available for browsers that disable WASM.
  var WASM_BYTES = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    1, 12, 2, 96, 1, 125, 1, 125, 96, 2, 127, 127, 1, 127,
    3, 3, 2, 0, 1,
    7, 26, 2,
    7, 99, 108, 97, 109, 112, 48, 49, 0, 0,
    12, 116, 114, 97, 99, 101, 67, 104, 97, 110, 103, 101, 100, 0, 1,
    10, 26, 2,
    16, 0, 32, 0, 67, 0, 0, 0, 0, 151, 67, 0, 0, 128, 63, 150, 11,
    7, 0, 32, 0, 32, 1, 71, 11
  ]);

  var wasmKernel = null;
  var backend = "js";
  var wasmReady = null;
  var MAX_TRACE_POINTS = 720;

  function clamp(value, minimum, maximum) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) numeric = 0;
    return Math.min(maximum, Math.max(minimum, numeric));
  }

  function initialize() {
    if (wasmReady) return wasmReady;
    if (typeof WebAssembly === "undefined") {
      wasmReady = Promise.resolve(false);
      return wasmReady;
    }
    wasmReady = WebAssembly.instantiate(WASM_BYTES).then(function (result) {
      wasmKernel = result.instance && result.instance.exports || null;
      backend = wasmKernel && typeof wasmKernel.clamp01 === "function" ? "wasm" : "js";
      return backend === "wasm";
    }).catch(function () {
      wasmKernel = null;
      backend = "js";
      return false;
    });
    return wasmReady;
  }

  function clamp01(value) {
    if (wasmKernel && typeof wasmKernel.clamp01 === "function") return wasmKernel.clamp01(Number(value) || 0);
    return clamp(value, 0, 1);
  }

  function sensorBatch(records) {
    var list = Array.isArray(records) ? records : [];
    return list.map(function (record) {
      var source = record || {};
      var minimum = Number.isFinite(Number(source.minimum)) ? Number(source.minimum) : 0;
      var maximum = Number.isFinite(Number(source.maximum)) ? Number(source.maximum) : 1;
      if (maximum < minimum) { var swap = minimum; minimum = maximum; maximum = swap; }
      var ratio = clamp01((Number(source.value) - minimum) / Math.max(1e-12, maximum - minimum));
      return Object.assign({}, source, {
        ratio: ratio,
        value: minimum + (maximum - minimum) * ratio
      });
    });
  }

  function sampleTrace(samples, limit) {
    var source = Array.isArray(samples) ? samples : [];
    var maximum = Math.max(1, Math.floor(Number(limit) || MAX_TRACE_POINTS));
    if (source.length <= maximum) return source.slice();
    var output = [];
    var stride = (source.length - 1) / Math.max(1, maximum - 1);
    for (var index = 0; index < maximum; index += 1) {
      var position = Math.min(source.length - 1, Math.round(index * stride));
      var sample = source[position];
      if (!sample) continue;
      if (!output.length || output[output.length - 1].timeMs !== sample.timeMs || output[output.length - 1].value !== sample.value) {
        output.push({ timeMs: Number(sample.timeMs) || 0, value: Boolean(sample.value) });
      }
    }
    return output;
  }

  function compressTrace(samples, limit) {
    var source = Array.isArray(samples) ? samples : [];
    if (!source.length) return [];
    var transitions = [];
    var previous = Boolean(source[0].value);
    transitions.push({ timeMs: Number(source[0].timeMs) || 0, value: previous });
    for (var index = 1; index < source.length; index += 1) {
      var sample = source[index];
      var value = Boolean(sample && sample.value);
      var changed = wasmKernel && typeof wasmKernel.traceChanged === "function"
        ? Boolean(wasmKernel.traceChanged(previous ? 1 : 0, value ? 1 : 0))
        : value !== previous;
      if (changed) {
        transitions.push({ timeMs: Number(sample.timeMs) || 0, value: value });
        previous = value;
      }
    }
    return transitions.length <= (Number(limit) || MAX_TRACE_POINTS)
      ? transitions
      : sampleTrace(transitions, limit);
  }

  function getState() {
    return {
      backend: backend,
      wasm: backend === "wasm",
      traceKernel: Boolean(wasmKernel && typeof wasmKernel.traceChanged === "function"),
      maxTracePoints: MAX_TRACE_POINTS
    };
  }

  initialize();
  root.AliceSimulationAccel = Object.freeze({
    initialize: initialize,
    getState: getState,
    sensorBatch: sensorBatch,
    sampleTrace: sampleTrace,
    compressTrace: compressTrace,
    clamp01: clamp01
  });
}(window));
