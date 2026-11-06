(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AliceLearningLab = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const list = v => Array.isArray(v) ? v : [];
  const text = (v, max = 1200) => typeof v === "string" ? v.slice(0, max) : "";
  const numeric = v => typeof v === "number" && Number.isFinite(v);
  const kinds = ["build", "connected", "voltage", "gpio", "adc-raw", "pwm-frequency", "pwm-duty", "pwm-pulse", "serial-contains"];
  const units = { voltage: "V", gpio: "", "adc-raw": "count", "pwm-frequency": "Hz", "pwm-duty": "%", "pwm-pulse": "µs" };
  function normalizePlan(raw, context) {
    if (!raw || typeof raw !== "object" || !text(raw.title) || !list(raw.steps).length || raw.steps.length > 8) throw new Error("学习任务缺少标题或步骤，请重新生成。");
    const targets = new Map(list(context.targets).map(t => [t.id, t]));
    const controls = new Map(list(context.controls).map(c => [c.id, c]));
    function check(c, i) {
      if (!c || !kinds.includes(c.kind)) throw new Error("任务包含尚不支持的验收规则，请重新生成。");
      const out = { id: "check-" + i, kind: c.kind, label: text(c.label, 180) || c.kind, targetId: text(c.targetId, 500) };
      if (!["build", "serial-contains"].includes(c.kind) && targets.get(out.targetId)?.kind !== "pin") throw new Error("验收规则没有引用当前工程的真实端子。");
      if (c.kind === "connected") {
        if (targets.get(c.peerTargetId)?.kind !== "pin") throw new Error("连接检查缺少另一端的真实端子。");
        out.peerTargetId = c.peerTargetId;
      } else if (c.kind === "serial-contains") {
        if (!text(c.contains, 300)) throw new Error("串口检查缺少预期内容。");
        out.contains = text(c.contains, 300); out.instance = text(c.instance, 80);
      } else if (c.kind !== "build") {
        if (!numeric(c.min) || !numeric(c.max) || c.min > c.max) throw new Error("验收数值范围无效，不能据此评分。");
        out.min = c.min; out.max = c.max; out.unit = units[c.kind];
      }
      return out;
    }
    return { version: 1, title: text(raw.title, 180), goal: text(raw.goal, 2000), steps: raw.steps.map((s, i) => {
      if (!s || !text(s.title) || !text(s.instruction)) throw new Error("任务步骤内容不完整。");
      const targetIds = list(s.targetIds).slice(0, 6);
      if (targetIds.some(id => !targets.has(id))) throw new Error("任务引用了当前工程不存在的指导目标。");
      const checks = list(s.checks);
      if (checks.length > 8 || list(s.cases).length > 4) throw new Error("单步验收项目过多，请拆分步骤。");
      const cases = list(s.cases).map((c, j) => {
        if (!c || !list(c.checks).length || c.checks.length > 8 || !numeric(c.waitMs) || c.waitMs < 100 || c.waitMs > 5000) throw new Error("测试情境缺少有效规则或等待时间（100–5000 ms）。");
        if (list(c.stimuli).length > 4) throw new Error("测试输入过多。");
        return { id: "case-" + j, label: text(c.label, 180) || `情境 ${j + 1}`, waitMs: c.waitMs,
          stimuli: list(c.stimuli).map(input => {
            const control = controls.get(input?.controlId);
            if (!control || !numeric(input.value) || input.value < control.min || input.value > control.max) throw new Error("测试输入不在当前元件支持的范围内。");
            return { controlId: control.id, value: input.value, label: control.label, unit: control.unit };
          }), checks: c.checks.map(check) };
      });
      return { id: "step-" + i, title: text(s.title, 180), instruction: text(s.instruction, 2400), prediction: text(s.prediction, 1000), targetIds,
        hints: list(s.hints).slice(0, 3).map(h => text(h, 2200)), checks: checks.map(check), cases };
    }) };
  }
  function linked(a, b, context) {
    const key = t => t.componentId + "\u0000" + t.pin;
    const graph = new Map();
    const add = (x, y) => { if (!graph.has(x)) graph.set(x, new Set()); graph.get(x).add(y); };
    for (const w of list(context.circuit?.wires)) { add(key(w.from), key(w.to)); add(key(w.to), key(w.from)); }
    if (context.circuit?.netsAvailable) for (const net of list(context.circuit.nets)) {
      const ends = list(net.endpoints); for (const e of ends.slice(1)) { add(key(ends[0]), key(e)); add(key(e), key(ends[0])); }
    }
    const queue = [key(a)], visited = new Set(queue);
    for (let i = 0; i < queue.length; i++) { if (queue[i] === key(b)) return true; for (const n of graph.get(queue[i]) || []) if (!visited.has(n)) { visited.add(n); queue.push(n); } }
    return false;
  }
  function evaluate(check, context, options = {}) {
    const targets = list(context.targets), target = targets.find(t => t.id === check.targetId);
    const base = { id: check.id, label: check.label, kind: check.kind, targetId: check.targetId, expected: check.kind === "serial-contains" ? check.contains : check.kind === "connected" ? "两端电气连通" : check.kind === "build" ? "构建成功" : `${check.min} – ${check.max} ${check.unit || ""}`, min: check.min, max: check.max, unit: check.unit || "", actual: null };
    const result = (status, detail, extra = {}) => ({ ...base, status, detail, ...extra });
    const unknown = detail => result("unknown", detail);
    if (check.kind === "build") return context.runtime?.built ? result("pass", "当前工程已构建") : unknown("请先构建当前工程；构建失败也可能是仿真暂不支持的行为。");
    if (check.kind === "connected") {
      const peer = targets.find(t => t.id === check.peerTargetId);
      if (!target || !peer) return unknown("检查端子已不存在，请重新规划。");
      return linked(target, peer, context) ? result("pass", "实际连接网络连通") : result("fail", "这两个端子之间没有连通路径");
    }
    const runtime = context.runtime || {};
    if (!runtime.built || !(runtime.timeMs > 0) || /ERROR|EXCEEDED|UNSUPPORTED|FAULT/i.test(runtime.status || "") || runtime.error) return unknown("需要当前工程的一次有效运行；尚未运行、已修改或运行异常不能作为验收依据。");
    if (check.kind === "serial-contains") {
      const messages = list(context.serial).filter(s => (!check.instance || s.instance === check.instance) && s.timeMs >= (options.sinceMs ?? 0));
      if (!messages.length) return unknown("本次观测窗口还没有串口数据。");
      const found = messages.some(s => s.text.includes(check.contains));
      return result(found ? "pass" : "fail", found ? "本次串口记录包含预期内容" : "本次已采集的串口记录未包含预期内容", { actual: messages.at(-1).text.slice(0, 300) });
    }
    if (!target) return unknown("目标端子已不存在。");
    let actual, waveform;
    if (check.kind.startsWith("pwm-")) {
      if (!list(context.circuit?.components).some(c => c.id === target.componentId && c.type === "mcu")) return unknown("PWM 参数检查需要 MCU 的实际输出端子。");
      const pwm = context.measurements?.pwm?.[target.pin];
      // This is a runtime PWM register observation, never an estimate from downsampled trace edges.
      if (!pwm?.active || !numeric(pwm.frequencyHz) || !(pwm.frequencyHz > 0) || !numeric(pwm.dutyCycle)) return unknown("该端子没有有效的 PWM 运行记录。");
      waveform = { frequencyHz: pwm.frequencyHz, dutyCycle: pwm.dutyCycle };
      actual = check.kind === "pwm-frequency" ? pwm.frequencyHz : check.kind === "pwm-duty" ? pwm.dutyCycle * 100 : 1e6 / pwm.frequencyHz * pwm.dutyCycle;
    } else if (check.kind === "adc-raw") {
      const observed = list(context.observations).filter(o => o.type === "adc-read" && o.data?.channel?.pin === target.pin && (o.data.timeMs ?? 0) >= (options.sinceMs ?? 0)).at(-1);
      if (!observed?.data?.sample?.connected || !numeric(observed.data.sample.raw)) return unknown("本次窗口没有该引脚的 ADC 读取证据。");
      actual = observed.data.sample.raw;
    } else {
      if (!context.circuit?.netsAvailable) return unknown("电路网络尚未求值。");
      const net = list(context.circuit.nets).find(n => list(n.endpoints).some(e => e.componentId === target.componentId && e.pin === target.pin));
      if (!net || net.floating || net.conflict) return unknown("端子悬空、冲突或没有已求值网络。");
      actual = check.kind === "gpio" ? net.level : net.voltage;
    }
    if (!numeric(actual)) return unknown("还没有有效数值，不能当成零值评分。");
    const pass = actual >= check.min - 1e-9 && actual <= check.max + 1e-9;
    return result(pass ? "pass" : "fail", pass ? "实测值在目标范围内" : "实测值超出目标范围", { actual, waveform });
  }
  function evaluateAll(checks, context, options) {
    const results = checks.map(c => evaluate(c, context, options));
    return { status: !results.length || results.some(r => r.status === "unknown") ? "unknown" : results.some(r => r.status === "fail") ? "fail" : "pass", results, revision: context.revision, timeMs: context.runtime?.timeMs || 0 };
  }
  return Object.freeze({ normalizePlan, evaluate, evaluateAll, kinds, units });
}));
