(function (root, factory) {
  "use strict";

  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.AliceEnvelopeAutomation = api;
    if (root.document) {
      if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", api.mount, { once: true });
      else api.mount();
    }
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var STORAGE_KEY = "alicesim-envelope-automation-v1";
  var COLORS = ["#ff9f43", "#35d0ba", "#5aa9ff", "#d47cff", "#ff6b81", "#c9e265"];
  var SVG_NS = "http://www.w3.org/2000/svg";
  var laneCounter = 0;
  var pointCounter = 0;

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function decimalPlaces(value) {
    var text = String(value == null ? "" : value);
    var exponent = text.match(/e-(\d+)$/i);
    if (exponent) return Number(exponent[1]) || 0;
    var decimal = text.indexOf(".");
    return decimal < 0 ? 0 : text.length - decimal - 1;
  }

  function quantize(value, minimum, maximum, step) {
    var safeMinimum = finite(minimum, 0);
    var safeMaximum = Math.max(safeMinimum, finite(maximum, safeMinimum + 1));
    var safeStep = Math.abs(finite(step, 0));
    var next = clamp(finite(value, safeMinimum), safeMinimum, safeMaximum);
    if (safeStep > 0) next = safeMinimum + Math.round((next - safeMinimum) / safeStep) * safeStep;
    return Number(clamp(next, safeMinimum, safeMaximum).toFixed(Math.min(12, Math.max(decimalPlaces(safeStep), 4))));
  }

  function reserveSequentialId(id, prefix, current) {
    var match = String(id || "").match(new RegExp("^" + prefix + "(\\d+)$"));
    return match ? Math.max(current, Number(match[1]) || 0) : current;
  }

  function makePoint(timeMs, value, minimum, maximum, step, id) {
    var pointId = String(id || "point-" + (++pointCounter));
    pointCounter = reserveSequentialId(pointId, "point-", pointCounter);
    return {
      id: pointId,
      timeMs: Math.max(0, finite(timeMs, 0)),
      value: quantize(value, minimum, maximum, step)
    };
  }

  function normalizePoints(points, minimum, maximum, step, durationMs) {
    var duration = Math.max(1, finite(durationMs, 10000));
    var source = Array.isArray(points) ? points : [];
    var byTime = new Map();
    source.forEach(function (point) {
      if (!point || typeof point !== "object") return;
      var normalized = makePoint(clamp(finite(point.timeMs, 0), 0, duration), point.value, minimum, maximum, step, point.id);
      byTime.set(normalized.timeMs, normalized);
    });
    return Array.from(byTime.values()).sort(function (left, right) { return left.timeMs - right.timeMs; });
  }

  function sampleEnvelope(points, timeMs, minimum, maximum, step, durationMs) {
    var duration = Math.max(1, finite(durationMs, 10000));
    var normalized = normalizePoints(points, minimum, maximum, step, duration);
    if (!normalized.length) return quantize(minimum, minimum, maximum, step);
    var time = clamp(finite(timeMs, 0), 0, duration);
    if (time <= normalized[0].timeMs) return normalized[0].value;
    if (time >= normalized[normalized.length - 1].timeMs) return normalized[normalized.length - 1].value;
    for (var index = 1; index < normalized.length; index += 1) {
      var right = normalized[index];
      if (time > right.timeMs) continue;
      var left = normalized[index - 1];
      var span = Math.max(1e-9, right.timeMs - left.timeMs);
      var ratio = (time - left.timeMs) / span;
      return quantize(left.value + (right.value - left.value) * ratio, minimum, maximum, step);
    }
    return normalized[normalized.length - 1].value;
  }

  function cloneLane(lane, durationMs) {
    var laneId = String(lane.id || "lane-" + (++laneCounter));
    laneCounter = reserveSequentialId(laneId, "lane-", laneCounter);
    return {
      id: laneId,
      targetId: String(lane.targetId || ""),
      label: String(lane.label || lane.targetId || "Automation"),
      unit: String(lane.unit || ""),
      min: finite(lane.min, 0),
      max: finite(lane.max, 100),
      step: Math.abs(finite(lane.step, 0.1)) || 0.1,
      color: String(lane.color || COLORS[laneCounter % COLORS.length]),
      points: normalizePoints(lane.points, lane.min, lane.max, lane.step, durationMs || lane.durationMs || 10000)
    };
  }

  function normalizeLaneCollection(lanes, durationMs) {
    var source = Array.isArray(lanes) ? lanes : [];
    source.forEach(function (lane) {
      laneCounter = reserveSequentialId(lane && lane.id, "lane-", laneCounter);
      (lane && Array.isArray(lane.points) ? lane.points : []).forEach(function (point) {
        pointCounter = reserveSequentialId(point && point.id, "point-", pointCounter);
      });
    });
    var usedLaneIds = new Set();
    var usedPointIds = new Set();
    return source.map(function (lane) {
      var copy = cloneLane(lane || {}, durationMs);
      while (!copy.id || usedLaneIds.has(copy.id)) copy.id = "lane-" + (++laneCounter);
      usedLaneIds.add(copy.id);
      copy.points.forEach(function (point) {
        while (!point.id || usedPointIds.has(point.id)) point.id = "point-" + (++pointCounter);
        usedPointIds.add(point.id);
      });
      return copy;
    });
  }

  function createEngine(options) {
    var config = options && typeof options === "object" ? options : {};
    var state = {
      mode: config.mode === "envelope" ? "envelope" : "infinite",
      durationMs: clamp(finite(config.durationMs, 10000), 100, 3600000),
      loop: Boolean(config.loop),
      active: false,
      originTimeMs: 0,
      currentTimeMs: 0,
      lanes: []
    };

    function setLanes(lanes) {
      state.lanes = (Array.isArray(lanes) ? lanes : []).map(function (lane) {
        var copy = cloneLane(lane, state.durationMs);
        copy.points = normalizePoints(copy.points, copy.min, copy.max, copy.step, state.durationMs);
        return copy;
      });
      return state.lanes;
    }

    function applyAt(timeMs, applyValue) {
      var sampled = state.lanes.map(function (lane) {
        return {
          lane: lane,
          minimum: lane.min,
          maximum: lane.max,
          value: sampleEnvelope(lane.points, timeMs, lane.min, lane.max, lane.step, state.durationMs)
        };
      });
      var accelerator = root && root.AliceSimulationAccel;
      if (accelerator && typeof accelerator.sensorBatch === "function") sampled = accelerator.sensorBatch(sampled);
      var values = sampled.map(function (sample) {
        var lane = sample.lane;
        var value = sample.value;
        if (typeof applyValue === "function") applyValue(lane.targetId, value, lane);
        return { laneId: lane.id, targetId: lane.targetId, value: value, unit: lane.unit };
      });
      state.currentTimeMs = clamp(timeMs, 0, state.durationMs);
      return values;
    }

    return {
      setMode: function (mode) {
        state.mode = mode === "envelope" ? "envelope" : "infinite";
        if (state.mode !== "envelope") state.active = false;
        return state.mode;
      },
      setDuration: function (durationMs) {
        state.durationMs = clamp(finite(durationMs, state.durationMs), 100, 3600000);
        setLanes(state.lanes);
        state.currentTimeMs = clamp(state.currentTimeMs, 0, state.durationMs);
        return state.durationMs;
      },
      setLoop: function (loop) { state.loop = Boolean(loop); return state.loop; },
      setLanes: setLanes,
      begin: function (absoluteTimeMs, applyValue) {
        state.originTimeMs = Math.max(0, finite(absoluteTimeMs, 0));
        state.active = state.mode === "envelope" && state.lanes.length > 0;
        var values = state.active ? applyAt(0, applyValue) : [];
        return { active: state.active, complete: false, timeMs: 0, values: values };
      },
      advance: function (absoluteTimeMs, applyValue) {
        if (state.mode !== "envelope" || !state.active) return { active: false, complete: false, timeMs: state.currentTimeMs, values: [] };
        var elapsed = Math.max(0, finite(absoluteTimeMs, state.originTimeMs) - state.originTimeMs);
        var complete = !state.loop && elapsed >= state.durationMs;
        var position = state.loop ? elapsed % state.durationMs : Math.min(elapsed, state.durationMs);
        var values = applyAt(position, applyValue);
        if (complete) state.active = false;
        return { active: state.active, complete: complete, timeMs: position, elapsedMs: elapsed, values: values };
      },
      reset: function (applyValue) {
        state.active = false;
        state.originTimeMs = 0;
        return { timeMs: 0, values: applyAt(0, applyValue) };
      },
      pause: function () { state.active = false; return state.currentTimeMs; },
      applyAt: applyAt,
      getState: function () {
        return {
          mode: state.mode,
          durationMs: state.durationMs,
          loop: state.loop,
          active: state.active,
          originTimeMs: state.originTimeMs,
          currentTimeMs: state.currentTimeMs,
          lanes: state.lanes.map(function (lane) { return cloneLane(lane, state.durationMs); })
        };
      }
    };
  }

  var engine = createEngine();
  var CANVAS_LEFT = 170;
  var CANVAS_RIGHT = 32;
  var LANE_START = 40;
  var LANE_PITCH = 118;
  var GRAPH_OFFSET = 32;
  var GRAPH_HEIGHT = 76;
  var uiState = {
    mounted: false,
    targets: [],
    lanes: [],
    selectedLaneId: "",
    selectedPointId: "",
    fitTimeline: true,
    drag: null,
    nodes: {}
  };

  function formatNumber(value, step) {
    var places = Math.min(4, Math.max(0, decimalPlaces(step)));
    return Number(value).toFixed(places).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  function saveState() {
    if (!root || !root.localStorage) return;
    try {
      var state = engine.getState();
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: state.mode,
        durationMs: state.durationMs,
        loop: state.loop,
        fitTimeline: uiState.fitTimeline,
        lanes: uiState.lanes
      }));
    } catch (_error) {}
  }

  function loadState() {
    if (!root || !root.localStorage) return;
    try {
      var saved = JSON.parse(root.localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return;
      engine.setMode(saved.mode);
      engine.setDuration(saved.durationMs);
      engine.setLoop(saved.loop);
      uiState.fitTimeline = saved.fitTimeline !== false;
      uiState.lanes = Array.isArray(saved.lanes) ? saved.lanes : [];
      syncEngine();
    } catch (_error) {}
  }

  function syncEngine() {
    uiState.lanes = normalizeLaneCollection(uiState.lanes, engine.getState().durationMs);
    engine.setLanes(uiState.lanes);
    uiState.lanes = engine.getState().lanes;
  }

  function selectedLane() {
    return uiState.lanes.find(function (lane) { return lane.id === uiState.selectedLaneId; }) || null;
  }

  function selectedPoint() {
    var lane = selectedLane();
    return lane && lane.points.find(function (point) { return point.id === uiState.selectedPointId; }) || null;
  }

  function refreshTargets() {
    var api = root && root.AliceSchematic;
    uiState.targets = api && typeof api.getAutomationTargets === "function" ? api.getAutomationTargets() : [];
    uiState.lanes.forEach(function (lane) {
      var target = uiState.targets.find(function (candidate) { return candidate.id === lane.targetId; });
      if (!target) return;
      lane.label = target.label;
      lane.unit = target.unit;
      lane.min = target.min;
      lane.max = target.max;
      lane.step = target.step;
      lane.points = normalizePoints(lane.points, lane.min, lane.max, lane.step, engine.getState().durationMs);
    });
    syncEngine();
    renderTargetOptions();
    renderAll();
    return uiState.targets.slice();
  }

  function applyTargetValue(targetId, value) {
    var api = root && root.AliceSchematic;
    if (!api || typeof api.applyAutomationValue !== "function") return false;
    return api.applyAutomationValue(targetId, value);
  }

  function updatePlaybackUi(result) {
    if (!uiState.mounted) return;
    var state = engine.getState();
    var duration = Math.max(1, state.durationMs);
    var position = clamp(finite(result && result.timeMs, state.currentTimeMs), 0, duration);
    if (uiState.nodes.timeReadout) uiState.nodes.timeReadout.textContent = (position / 1000).toFixed(3) + " / " + (duration / 1000).toFixed(3) + " s";
    if (uiState.nodes.playhead) {
      var width = Number(uiState.nodes.playhead.dataset.graphWidth || 0);
      var left = Number(uiState.nodes.playhead.dataset.graphLeft || 0);
      var x = left + width * position / duration;
      uiState.nodes.playhead.setAttribute("x1", x);
      uiState.nodes.playhead.setAttribute("x2", x);
    }
    (result && result.values || []).forEach(function (entry) {
      var valueNode = uiState.nodes.modal && uiState.nodes.modal.querySelector('[data-lane-value="' + entry.laneId + '"]');
      var lane = uiState.lanes.find(function (candidate) { return candidate.id === entry.laneId; });
      if (valueNode && lane) valueNode.textContent = formatNumber(entry.value, lane.step) + (lane.unit ? " " + lane.unit : "");
    });
  }

  function persistAndRender() {
    syncEngine();
    saveState();
    renderAll();
  }

  function addLane(targetId) {
    var target = uiState.targets.find(function (candidate) { return candidate.id === targetId; });
    if (!target) return null;
    var existing = uiState.lanes.find(function (lane) { return lane.targetId === target.id; });
    if (existing) {
      uiState.selectedLaneId = existing.id;
      renderAll();
      return existing;
    }
    var duration = engine.getState().durationMs;
    var current = quantize(target.value, target.min, target.max, target.step);
    var lane = cloneLane({
      id: "lane-" + (++laneCounter),
      targetId: target.id,
      label: target.label,
      unit: target.unit,
      min: target.min,
      max: target.max,
      step: target.step,
      color: COLORS[uiState.lanes.length % COLORS.length],
      durationMs: duration,
      points: [makePoint(0, current, target.min, target.max, target.step), makePoint(duration, current, target.min, target.max, target.step)]
    }, duration);
    uiState.lanes.push(lane);
    uiState.selectedLaneId = lane.id;
    uiState.selectedPointId = lane.points[0].id;
    persistAndRender();
    return lane;
  }

  function removeLane(laneId) {
    uiState.lanes = uiState.lanes.filter(function (lane) { return lane.id !== laneId; });
    if (uiState.selectedLaneId === laneId) {
      uiState.selectedLaneId = uiState.lanes[0] ? uiState.lanes[0].id : "";
      uiState.selectedPointId = "";
    }
    persistAndRender();
  }

  function generateTestCurve(lane) {
    if (!lane) return;
    var duration = engine.getState().durationMs;
    var target = uiState.targets.find(function (candidate) { return candidate.id === lane.targetId; });
    var current = quantize(target ? target.value : lane.points[0] && lane.points[0].value, lane.min, lane.max, lane.step);
    if (lane.max - lane.min <= lane.step * 1.5) {
      var opposite = current > (lane.min + lane.max) / 2 ? lane.min : lane.max;
      lane.points = [
        makePoint(0, current, lane.min, lane.max, lane.step),
        makePoint(duration * 0.25, opposite, lane.min, lane.max, lane.step),
        makePoint(duration * 0.75, current, lane.min, lane.max, lane.step),
        makePoint(duration, current, lane.min, lane.max, lane.step)
      ];
    } else {
      lane.points = [
        makePoint(0, current, lane.min, lane.max, lane.step),
        makePoint(duration * 0.25, lane.min, lane.min, lane.max, lane.step),
        makePoint(duration * 0.65, lane.max, lane.min, lane.max, lane.step),
        makePoint(duration, current, lane.min, lane.max, lane.step)
      ];
    }
    uiState.selectedPointId = lane.points[0].id;
    persistAndRender();
  }

  function deleteSelectedPoint() {
    var lane = selectedLane();
    var point = selectedPoint();
    if (!lane || !point) return false;
    lane.points = normalizePoints(lane.points, lane.min, lane.max, lane.step, engine.getState().durationMs);
    var index = lane.points.findIndex(function (candidate) { return candidate.id === point.id; });
    if (lane.points.length <= 2 || index <= 0 || index >= lane.points.length - 1) return false;
    lane.points.splice(index, 1);
    uiState.selectedPointId = lane.points[Math.max(0, index - 1)].id;
    persistAndRender();
    return true;
  }

  function renderTargetOptions() {
    var select = uiState.nodes.targetSelect;
    if (!select) return;
    select.textContent = "";
    if (!uiState.targets.length) {
      var empty = root.document.createElement("option");
      empty.value = "";
      empty.textContent = "先在原理图中放置传感器或输入器件";
      select.appendChild(empty);
      select.disabled = true;
      if (uiState.nodes.addLane) uiState.nodes.addLane.disabled = true;
      return;
    }
    select.disabled = false;
    if (uiState.nodes.addLane) uiState.nodes.addLane.disabled = false;
    uiState.targets.forEach(function (target) {
      var option = root.document.createElement("option");
      option.value = target.id;
      option.textContent = target.label + " · " + formatNumber(target.value, target.step) + (target.unit ? " " + target.unit : "");
      select.appendChild(option);
    });
  }

  function renderLaneList() {
    var container = uiState.nodes.laneList;
    if (!container) return;
    container.textContent = "";
    if (!uiState.lanes.length) {
      var empty = root.document.createElement("div");
      empty.className = "envelope-empty-lanes";
      empty.innerHTML = "<strong>还没有自动化轨道</strong><span>选择传感器属性后添加轨道，再点击网格增加关键帧。</span>";
      container.appendChild(empty);
      return;
    }
    uiState.lanes.forEach(function (lane) {
      var row = root.document.createElement("button");
      row.type = "button";
      row.className = "envelope-lane-row" + (lane.id === uiState.selectedLaneId ? " selected" : "");
      row.dataset.laneId = lane.id;
      var swatch = root.document.createElement("i");
      swatch.style.backgroundColor = lane.color;
      var copy = root.document.createElement("span");
      var targetExists = uiState.targets.some(function (target) { return target.id === lane.targetId; });
      copy.innerHTML = "<strong></strong><small></small>";
      copy.querySelector("strong").textContent = lane.label + (targetExists ? "" : "（器件未连接）");
      copy.querySelector("small").textContent = formatNumber(lane.min, lane.step) + " — " + formatNumber(lane.max, lane.step) + (lane.unit ? " " + lane.unit : "");
      var value = root.document.createElement("b");
      value.dataset.laneValue = lane.id;
      value.textContent = "—";
      var remove = root.document.createElement("span");
      remove.className = "envelope-lane-remove";
      remove.dataset.removeLane = lane.id;
      remove.title = "删除轨道";
      remove.textContent = "×";
      row.append(swatch, copy, value, remove);
      container.appendChild(row);
    });
  }

  function svgElement(name, attributes) {
    var element = root.document.createElementNS(SVG_NS, name);
    Object.keys(attributes || {}).forEach(function (key) { element.setAttribute(key, attributes[key]); });
    return element;
  }

  function renderCanvas() {
    var svg = uiState.nodes.canvas;
    if (!svg) return;
    svg.textContent = "";
    var state = engine.getState();
    var duration = state.durationMs;
    var scrollArea = uiState.nodes.canvasScroll;
    var availableWidth = Math.max(0, scrollArea && scrollArea.clientWidth || 0);
    var naturalWidth = Math.max(1100, Math.round(duration / 1000 * 120));
    var width = uiState.fitTimeline && availableWidth ? Math.max(760, availableWidth) : naturalWidth;
    var left = CANVAS_LEFT;
    var right = CANVAS_RIGHT;
    var graphWidth = width - left - right;
    var lanePitch = LANE_PITCH;
    var height = Math.max(320, LANE_START + Math.max(1, uiState.lanes.length) * lanePitch + 4);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.style.width = width + "px";
    svg.style.height = height + "px";

    var background = svgElement("rect", { x: 0, y: 0, width: width, height: height, class: "envelope-canvas-bg" });
    svg.appendChild(background);
    for (var marker = 0; marker <= 10; marker += 1) {
      var markerX = left + graphWidth * marker / 10;
      svg.appendChild(svgElement("line", { x1: markerX, y1: 28, x2: markerX, y2: height, class: marker % 5 === 0 ? "envelope-grid-major" : "envelope-grid-line" }));
      var markerText = svgElement("text", { x: markerX, y: 21, class: "envelope-time-label", "text-anchor": marker === 0 ? "start" : marker === 10 ? "end" : "middle" });
      markerText.textContent = (duration / 1000 * marker / 10).toFixed(duration < 10000 ? 2 : 1) + "s";
      svg.appendChild(markerText);
    }

    if (!uiState.lanes.length) {
      var help = svgElement("text", { x: width / 2, y: height / 2, class: "envelope-empty-text", "text-anchor": "middle" });
      help.textContent = "添加一条传感器轨道以开始编辑包络线";
      svg.appendChild(help);
    }

    uiState.lanes.forEach(function (lane, laneIndex) {
      var rowTop = LANE_START + laneIndex * lanePitch;
      var graphTop = rowTop + GRAPH_OFFSET;
      var graphHeight = GRAPH_HEIGHT;
      var row = svgElement("rect", { x: 0, y: rowTop, width: width, height: lanePitch - 4, rx: 4, class: "envelope-lane-bg" + (lane.id === uiState.selectedLaneId ? " selected" : ""), "data-lane-id": lane.id });
      svg.appendChild(row);
      [0, 0.25, 0.5, 0.75, 1].forEach(function (ratio) {
        var y = graphTop + graphHeight * ratio;
        svg.appendChild(svgElement("line", { x1: left, y1: y, x2: width - right, y2: y, class: ratio === 0.5 ? "envelope-value-major" : "envelope-value-line" }));
      });
      var label = svgElement("text", { x: 14, y: rowTop + 20, class: "envelope-track-label" });
      label.textContent = lane.label;
      svg.appendChild(label);
      var maximum = svgElement("text", { x: 14, y: graphTop + 16, class: "envelope-range-label" });
      maximum.textContent = formatNumber(lane.max, lane.step) + (lane.unit ? " " + lane.unit : "");
      svg.appendChild(maximum);
      var minimum = svgElement("text", { x: 14, y: graphTop + graphHeight - 3, class: "envelope-range-label" });
      minimum.textContent = formatNumber(lane.min, lane.step) + (lane.unit ? " " + lane.unit : "");
      svg.appendChild(minimum);

      var points = normalizePoints(lane.points, lane.min, lane.max, lane.step, duration);
      lane.points = points;
      var coordinateText = points.map(function (point) {
        var x = left + graphWidth * point.timeMs / duration;
        var ratio = (point.value - lane.min) / Math.max(1e-9, lane.max - lane.min);
        var y = graphTop + graphHeight * (1 - ratio);
        return x + "," + y;
      }).join(" ");
      if (coordinateText) svg.appendChild(svgElement("polyline", { points: coordinateText, class: "envelope-curve-shadow" }));
      if (coordinateText) {
        var curve = svgElement("polyline", { points: coordinateText, class: "envelope-curve", stroke: lane.color });
        svg.appendChild(curve);
      }
      points.forEach(function (point, pointIndex) {
        var x = left + graphWidth * point.timeMs / duration;
        var ratio = (point.value - lane.min) / Math.max(1e-9, lane.max - lane.min);
        var y = graphTop + graphHeight * (1 - ratio);
        var circle = svgElement("circle", {
          cx: x,
          cy: y,
          r: point.id === uiState.selectedPointId ? 6 : 4.5,
          fill: lane.color,
          class: "envelope-point" + (point.id === uiState.selectedPointId ? " selected" : "") + (pointIndex === 0 || pointIndex === points.length - 1 ? " endpoint" : ""),
          "data-lane-id": lane.id,
          "data-point-id": point.id,
          tabindex: 0,
          role: "button",
          "aria-label": lane.label + "，" + (point.timeMs / 1000).toFixed(3) + " 秒，" + formatNumber(point.value, lane.step) + " " + lane.unit + (pointIndex === 0 || pointIndex === points.length - 1 ? "，边界关键帧" : "")
        });
        svg.appendChild(circle);
      });
    });

    var playhead = svgElement("line", { x1: left, y1: 28, x2: left, y2: height, class: "envelope-playhead", id: "envelopePlayhead" });
    playhead.dataset.graphLeft = String(left);
    playhead.dataset.graphWidth = String(graphWidth);
    svg.appendChild(playhead);
    uiState.nodes.playhead = playhead;
    updatePlaybackUi({ timeMs: state.currentTimeMs, values: [] });
  }

  function renderPointEditor() {
    var lane = selectedLane();
    var point = selectedPoint();
    var panel = uiState.nodes.pointEditor;
    if (!panel) return;
    panel.hidden = !lane || !point;
    if (!lane || !point) {
      uiState.nodes.pointTime.disabled = true;
      uiState.nodes.deletePoint.disabled = true;
      return;
    }
    uiState.nodes.pointTime.value = (point.timeMs / 1000).toFixed(3);
    uiState.nodes.pointTime.max = (engine.getState().durationMs / 1000).toFixed(3);
    uiState.nodes.pointValue.value = String(point.value);
    uiState.nodes.pointValue.min = String(lane.min);
    uiState.nodes.pointValue.max = String(lane.max);
    uiState.nodes.pointValue.step = String(lane.step);
    uiState.nodes.pointUnit.textContent = lane.unit || "value";
    var points = normalizePoints(lane.points, lane.min, lane.max, lane.step, engine.getState().durationMs);
    var index = points.findIndex(function (candidate) { return candidate.id === point.id; });
    var endpoint = index === 0 || index === points.length - 1;
    uiState.nodes.pointTime.disabled = endpoint;
    uiState.nodes.deletePoint.disabled = points.length <= 2 || endpoint;
    uiState.nodes.deletePoint.title = endpoint ? "起点和终点用于定义测试边界，不能删除" : "删除当前关键帧 (Delete)";
  }

  function renderModeControls() {
    var state = engine.getState();
    if (uiState.nodes.modeSelect) uiState.nodes.modeSelect.value = state.mode;
    if (uiState.nodes.durationInput) uiState.nodes.durationInput.value = String(state.durationMs / 1000);
    if (uiState.nodes.loopInput) uiState.nodes.loopInput.checked = state.loop;
    if (uiState.nodes.openButton) uiState.nodes.openButton.classList.toggle("has-envelope", state.mode === "envelope");
    if (uiState.nodes.fitButton) {
      uiState.nodes.fitButton.classList.toggle("active", uiState.fitTimeline);
      uiState.nodes.fitButton.setAttribute("aria-pressed", String(uiState.fitTimeline));
      uiState.nodes.fitButton.textContent = uiState.fitTimeline ? "适应宽度" : "固定比例";
    }
  }

  function renderAll() {
    if (!uiState.mounted) return;
    renderModeControls();
    renderLaneList();
    renderCanvas();
    renderPointEditor();
  }

  function pointFromPointer(event, lane) {
    var svg = uiState.nodes.canvas;
    var rectangle = svg.getBoundingClientRect();
    var viewBox = svg.viewBox.baseVal;
    var x = (event.clientX - rectangle.left) * viewBox.width / rectangle.width;
    var y = (event.clientY - rectangle.top) * viewBox.height / rectangle.height;
    var duration = engine.getState().durationMs;
    var left = CANVAS_LEFT;
    var right = CANVAS_RIGHT;
    var graphWidth = viewBox.width - left - right;
    var laneIndex = uiState.lanes.indexOf(lane);
    var graphTop = LANE_START + laneIndex * LANE_PITCH + GRAPH_OFFSET;
    var timeMs = clamp((x - left) / graphWidth * duration, 0, duration);
    var ratio = 1 - clamp((y - graphTop) / GRAPH_HEIGHT, 0, 1);
    var value = lane.min + ratio * (lane.max - lane.min);
    return makePoint(timeMs, value, lane.min, lane.max, lane.step);
  }

  function bindCanvasEvents() {
    var svg = uiState.nodes.canvas;
    svg.addEventListener("pointerdown", function (event) {
      var target = event.target;
      var pointId = target && target.getAttribute && target.getAttribute("data-point-id");
      var laneId = target && target.getAttribute && target.getAttribute("data-lane-id");
      if (pointId && laneId) {
        uiState.selectedLaneId = laneId;
        uiState.selectedPointId = pointId;
        uiState.drag = { pointerId: event.pointerId, laneId: laneId, pointId: pointId };
        svg.setPointerCapture(event.pointerId);
        renderAll();
        event.preventDefault();
        return;
      }
      var viewBox = svg.viewBox.baseVal;
      var rectangle = svg.getBoundingClientRect();
      var y = (event.clientY - rectangle.top) * viewBox.height / rectangle.height;
      var laneIndex = Math.floor((y - LANE_START) / LANE_PITCH);
      var lane = uiState.lanes[laneIndex];
      if (!lane) return;
      var point = pointFromPointer(event, lane);
      lane.points.push(point);
      lane.points = normalizePoints(lane.points, lane.min, lane.max, lane.step, engine.getState().durationMs);
      uiState.selectedLaneId = lane.id;
      uiState.selectedPointId = point.id;
      persistAndRender();
      event.preventDefault();
    });
    svg.addEventListener("pointermove", function (event) {
      if (!uiState.drag || uiState.drag.pointerId !== event.pointerId) return;
      var lane = uiState.lanes.find(function (candidate) { return candidate.id === uiState.drag.laneId; });
      var point = lane && lane.points.find(function (candidate) { return candidate.id === uiState.drag.pointId; });
      if (!lane || !point) return;
      var next = pointFromPointer(event, lane);
      var points = normalizePoints(lane.points, lane.min, lane.max, lane.step, engine.getState().durationMs);
      var pointIndex = points.findIndex(function (candidate) { return candidate.id === point.id; });
      point.timeMs = pointIndex === 0 ? 0 : pointIndex === points.length - 1 ? engine.getState().durationMs : next.timeMs;
      point.value = next.value;
      lane.points = normalizePoints(lane.points, lane.min, lane.max, lane.step, engine.getState().durationMs);
      syncEngine();
      renderCanvas();
      renderPointEditor();
      event.preventDefault();
    });
    function finishDrag(event) {
      if (!uiState.drag || uiState.drag.pointerId !== event.pointerId) return;
      uiState.drag = null;
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      saveState();
      renderAll();
    }
    svg.addEventListener("pointerup", finishDrag);
    svg.addEventListener("pointercancel", finishDrag);
    svg.addEventListener("dblclick", function (event) {
      var pointId = event.target && event.target.getAttribute && event.target.getAttribute("data-point-id");
      var laneId = event.target && event.target.getAttribute && event.target.getAttribute("data-lane-id");
      var lane = uiState.lanes.find(function (candidate) { return candidate.id === laneId; });
      if (!pointId || !lane) return;
      uiState.selectedLaneId = laneId;
      uiState.selectedPointId = pointId;
      deleteSelectedPoint();
      event.preventDefault();
    });
  }

  function createModal() {
    var backdrop = root.document.getElementById("envelopeDockHost");
    if (!backdrop) {
      backdrop = root.document.createElement("div");
      backdrop.id = "envelopeDockHost";
      root.document.body.appendChild(backdrop);
    }
    backdrop.classList.add("envelope-dock");
    backdrop.innerHTML = '<section class="envelope-window envelope-dock-window" role="region" aria-label="传感器包络线编辑器">' +
      '<div class="envelope-transport"><span class="envelope-pane-title">包络编辑器</span><button id="envelopeTest" class="envelope-play" type="button">▶ 运行包络测试</button><button id="envelopeStop" type="button">■ 停止</button><label>测试时长 <input id="envelopeDuration" type="number" min="0.1" max="3600" step="0.1" value="10"> s</label><label class="envelope-loop"><input id="envelopeLoop" type="checkbox"> 循环</label><strong id="envelopeTimeReadout">0.000 / 10.000 s</strong><button class="observer-pane-toggle" id="envelopePaneToggle" type="button" aria-controls="envelopeDockHost" aria-expanded="true" title="折叠包络编辑器"><span aria-hidden="true">⌃</span><span class="sr-only">折叠包络编辑器</span></button></div>' +
      '<div class="envelope-workspace"><aside class="envelope-sidebar"><div class="envelope-add"><label for="envelopeTarget">自动化目标</label><select id="envelopeTarget"></select><button id="envelopeAddLane" type="button">＋ 添加轨道</button></div><div id="envelopeLaneList" class="envelope-lane-list"></div></aside>' +
      '<main class="envelope-editor"><div class="envelope-editor-toolbar"><div class="envelope-editor-actions"><button id="envelopeGenerate" type="button">生成测试曲线</button><button id="envelopeFit" class="active" type="button" aria-pressed="true" title="切换完整时间轴与固定时间比例">适应宽度</button><button id="envelopeDeletePoint" type="button" disabled>删除关键帧</button><span>单击添加 · 拖动调整 · Delete 删除</span></div><div id="envelopePointEditor" class="envelope-point-editor" hidden><label>时间 <input id="envelopePointTime" type="number" min="0" step="0.001"> s</label><label>数值 <input id="envelopePointValue" type="number"><b id="envelopePointUnit"></b></label></div></div><div class="envelope-canvas-scroll"><svg id="envelopeCanvas" aria-label="传感器包络线编辑网格"></svg></div></main></div>' +
      '</section>';
    return backdrop;
  }

  function mount() {
    if (uiState.mounted || !root || !root.document || !root.document.body) return false;
    uiState.mounted = true;
    var modal = root.document.getElementById("envelopeDockHost");
    if (!modal || !modal.querySelector("#envelopeCanvas")) modal = createModal();
    uiState.nodes = {
      modal: modal,
      openButton: root.document.getElementById("openEnvelopeEditor"),
      modeSelect: root.document.getElementById("simulationTimeMode"),
      testButton: modal.querySelector("#envelopeTest"),
      stopButton: modal.querySelector("#envelopeStop"),
      durationInput: modal.querySelector("#envelopeDuration"),
      loopInput: modal.querySelector("#envelopeLoop"),
      targetSelect: modal.querySelector("#envelopeTarget"),
      addLane: modal.querySelector("#envelopeAddLane"),
      laneList: modal.querySelector("#envelopeLaneList"),
      canvasScroll: modal.querySelector(".envelope-canvas-scroll"),
      canvas: modal.querySelector("#envelopeCanvas"),
      generateButton: modal.querySelector("#envelopeGenerate"),
      fitButton: modal.querySelector("#envelopeFit"),
      deletePoint: modal.querySelector("#envelopeDeletePoint"),
      pointEditor: modal.querySelector("#envelopePointEditor"),
      pointTime: modal.querySelector("#envelopePointTime"),
      pointValue: modal.querySelector("#envelopePointValue"),
      pointUnit: modal.querySelector("#envelopePointUnit"),
      timeReadout: modal.querySelector("#envelopeTimeReadout"),
      playhead: null
    };
    loadState();
    refreshTargets();

    uiState.nodes.openButton && uiState.nodes.openButton.addEventListener("click", function () {
      if (modal.classList.contains("open")) close();
      else open();
    });
    uiState.nodes.modeSelect && uiState.nodes.modeSelect.addEventListener("change", function (event) {
      engine.setMode(event.target.value);
      saveState();
      renderModeControls();
      if (event.target.value === "envelope") open();
    });
    function updateDurationFromInput(event) {
      engine.setDuration(finite(event.target.value, 10) * 1000);
      uiState.lanes.forEach(function (lane) { lane.points = normalizePoints(lane.points, lane.min, lane.max, lane.step, engine.getState().durationMs); });
      persistAndRender();
    }
    uiState.nodes.durationInput.addEventListener("change", updateDurationFromInput);
    uiState.nodes.durationInput.addEventListener("input", updateDurationFromInput);
    uiState.nodes.loopInput.addEventListener("change", function (event) { engine.setLoop(event.target.checked); saveState(); renderModeControls(); });
    uiState.nodes.addLane.addEventListener("click", function () { addLane(uiState.nodes.targetSelect.value); });
    uiState.nodes.laneList.addEventListener("click", function (event) {
      var remove = event.target.closest("[data-remove-lane]");
      if (remove) { removeLane(remove.dataset.removeLane); return; }
      var row = event.target.closest("[data-lane-id]");
      if (!row) return;
      uiState.selectedLaneId = row.dataset.laneId;
      var lane = selectedLane();
      uiState.selectedPointId = lane && lane.points[0] ? lane.points[0].id : "";
      renderAll();
    });
    uiState.nodes.generateButton.addEventListener("click", function () { generateTestCurve(selectedLane()); });
    uiState.nodes.fitButton.addEventListener("click", function () {
      uiState.fitTimeline = !uiState.fitTimeline;
      saveState();
      renderAll();
    });
    uiState.nodes.deletePoint.addEventListener("click", deleteSelectedPoint);
    uiState.nodes.pointTime.addEventListener("change", function (event) {
      var lane = selectedLane();
      var point = selectedPoint();
      if (!lane || !point) return;
      point.timeMs = clamp(finite(event.target.value, 0) * 1000, 0, engine.getState().durationMs);
      lane.points = normalizePoints(lane.points, lane.min, lane.max, lane.step, engine.getState().durationMs);
      persistAndRender();
    });
    uiState.nodes.pointValue.addEventListener("change", function (event) {
      var lane = selectedLane();
      var point = selectedPoint();
      if (!lane || !point) return;
      point.value = quantize(event.target.value, lane.min, lane.max, lane.step);
      persistAndRender();
    });
    uiState.nodes.testButton.addEventListener("click", function () {
      engine.setMode("envelope");
      if (uiState.nodes.modeSelect) uiState.nodes.modeSelect.value = "envelope";
      saveState();
      root.document.dispatchEvent(new CustomEvent("alice:envelope-test-request", { detail: { durationMs: engine.getState().durationMs } }));
    });
    uiState.nodes.stopButton.addEventListener("click", function () { root.document.dispatchEvent(new CustomEvent("alice:envelope-stop-request")); });
    bindCanvasEvents();
    if (root.ResizeObserver && uiState.nodes.canvasScroll) {
      uiState.resizeObserver = new root.ResizeObserver(function () {
        if (uiState.fitTimeline && uiState.nodes.modal.classList.contains("open")) renderCanvas();
      });
      uiState.resizeObserver.observe(uiState.nodes.canvasScroll);
    }
    root.document.addEventListener("alice:schematic-change", function () { refreshTargets(); });
    root.document.addEventListener("alice:schematic-reset", function () { engine.reset(applyTargetValue); updatePlaybackUi({ timeMs: 0, values: [] }); });
    root.document.addEventListener("alice:workspace-page-change", function (event) {
      if (event.detail && event.detail.page === "simulation" && !modal.classList.contains("open")) open();
    });
    root.document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && modal.classList.contains("open")) close();
      if ((event.key === "Delete" || event.key === "Backspace") && modal.classList.contains("open")) {
        if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
        if (deleteSelectedPoint()) event.preventDefault();
      }
    });
    renderAll();
    if (root.document.body.classList.contains("app-page-simulation")) root.requestAnimationFrame(open);
    return true;
  }

  function open() {
    if (!uiState.mounted) mount();
    root.document.dispatchEvent(new CustomEvent("alice:app-page-request", { detail: { page: "simulation" } }));
    uiState.nodes.modal.classList.add("open");
    if (uiState.nodes.openButton) {
      uiState.nodes.openButton.classList.add("active");
      uiState.nodes.openButton.setAttribute("aria-expanded", "true");
    }
    refreshTargets();
    root.requestAnimationFrame(function () { renderCanvas(); });
    if (uiState.nodes.testButton) uiState.nodes.testButton.focus();
    return true;
  }

  function close() {
    if (!uiState.mounted) return false;
    uiState.nodes.modal.classList.remove("open");
    if (uiState.nodes.openButton) {
      uiState.nodes.openButton.classList.remove("active");
      uiState.nodes.openButton.setAttribute("aria-expanded", "false");
    }
    uiState.nodes.openButton && uiState.nodes.openButton.focus();
    return true;
  }

  function begin(absoluteTimeMs) {
    var result = engine.begin(absoluteTimeMs, applyTargetValue);
    updatePlaybackUi(result);
    return result;
  }

  function advance(absoluteTimeMs) {
    var result = engine.advance(absoluteTimeMs, applyTargetValue);
    updatePlaybackUi(result);
    if (root && root.document && result.values.length) root.document.dispatchEvent(new CustomEvent("alice:envelope-frame", { detail: result }));
    return result;
  }

  function reset() {
    var result = engine.reset(applyTargetValue);
    updatePlaybackUi(result);
    return result;
  }

  return Object.freeze({
    mount: mount,
    open: open,
    close: close,
    begin: begin,
    advance: advance,
    pause: function () { return engine.pause(); },
    reset: reset,
    refreshTargets: refreshTargets,
    addLane: addLane,
    removeLane: removeLane,
    getState: function () { return engine.getState(); },
    setMode: function (mode) { var result = engine.setMode(mode); saveState(); renderModeControls(); return result; },
    setDuration: function (durationMs) { var result = engine.setDuration(durationMs); persistAndRender(); return result; },
    setLoop: function (loop) { var result = engine.setLoop(loop); saveState(); renderModeControls(); return result; },
    sampleEnvelope: sampleEnvelope,
    normalizePoints: normalizePoints,
    normalizeLaneCollection: normalizeLaneCollection,
    createEngine: createEngine
  });
}));
