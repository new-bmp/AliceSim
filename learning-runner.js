(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./learning-lab.js") : root.AliceLearningLab);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AliceLearningRunner = api;
}(typeof window !== "undefined" ? window : globalThis, function (lab) {
  "use strict";
  function create(env) {
    let busy = false;
    async function run(step, { signal, onProgress = () => {} } = {}) {
      if (busy) throw new Error("另一项验收还在进行。");
      busy = true;
      const original = env.capture(), generation = env.generation();
      const inputs = new Map(env.controls().map(c => [c.id, { ...c }]));
      const changedInputs = new Map(), results = [];
      const wasRunning = original.runtime.status === "RUNNING";
      let started = false, completed = null;
      const checkAlive = () => {
        if (signal?.aborted || env.generation() !== generation) throw new Error("验收已取消，未生成通过结论。");
      };
      try {
        checkAlive();
        for (const c of step.cases) for (const stimulus of c.stimuli) {
          const control = inputs.get(stimulus.controlId);
          if (!control || stimulus.value < control.min || stimulus.value > control.max) throw new Error("测试输入已发生变化，请重新规划。");
        }
        if (!await env.start(signal)) throw new Error("仿真未能启动，请检查构建和运行输出。");
        started = true; checkAlive();
        for (let i = 0; i < step.cases.length; i++) {
          const c = step.cases[i];
          // Every case starts with the original inputs, so omitted inputs do not leak from the previous case.
          for (const [id, value] of changedInputs) env.setControl(id, value);
          for (const stimulus of c.stimuli) {
            if (!changedInputs.has(stimulus.controlId)) changedInputs.set(stimulus.controlId, inputs.get(stimulus.controlId).value);
            if (env.setControl(stimulus.controlId, stimulus.value) === false) throw new Error("无法设置测试输入。");
          }
          const sinceMs = env.capture().runtime.timeMs;
          env.clearObservations?.();
          const wallStart = env.now();
          while (true) {
            checkAlive();
            const current = env.capture(), elapsed = current.runtime.timeMs - sinceMs;
            if (current.runtime.error || /error|fault|exceeded/i.test(current.runtime.status)) throw new Error(current.runtime.error || "固件运行异常，本次验收没有通过结论。");
            if (current.runtime.status !== "RUNNING") throw new Error("仿真已暂停，验收中止。");
            onProgress({ index: i, count: step.cases.length, label: c.label, progress: Math.min(1, Math.max(0, elapsed / c.waitMs)), inputs: c.stimuli });
            if (elapsed >= c.waitMs) {
              const checked = lab.evaluateAll(c.checks, current, { sinceMs });
              results.push({ ...checked, label: c.label, inputs: c.stimuli, sinceMs }); break;
            }
            if (env.now() - wallStart > 30000) throw new Error("仿真推进超时，请检查运行状态后重试。");
            await env.wait(60);
          }
        }
        checkAlive();
        if (step.checks.length) results.push({ ...lab.evaluateAll(step.checks, env.capture()), label: "通用检查", inputs: [] });
        completed = { status: results.some(r => r.status === "unknown") ? "unknown" : results.some(r => r.status === "fail") ? "fail" : "pass",
          revision: original.revision, createdAt: new Date().toISOString(), cases: results, results: results.flatMap(r => r.results), timeMs: env.capture().runtime.timeMs };
        return completed;
      } finally {
        // Never restore old controls into a newly opened project, even if it reuses component IDs.
        if (env.generation() === generation) {
          for (const [id, value] of changedInputs) env.setControl(id, value);
          if (completed && !signal?.aborted && changedInputs.size) {
            // Let the original inputs propagate before restoring a paused state.
            const restoredAt = env.capture().runtime.timeMs, wallStart = env.now();
            const settleMs = Math.max(...step.cases.map(c => c.waitMs));
            while (!signal?.aborted && env.generation() === generation && env.capture().runtime.status === "RUNNING" && env.capture().runtime.timeMs - restoredAt < settleMs && env.now() - wallStart < 30000) await env.wait(60);
          }
          if (env.generation() === generation && completed) completed.revision = env.capture().revision;
          if (env.generation() === generation && started && !wasRunning) env.pause();
        }
        busy = false;
      }
    }
    return Object.freeze({ run, isBusy: () => busy });
  }
  return Object.freeze({ create });
}));
