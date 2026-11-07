(function (root) {
  "use strict";
  const lab = root.AliceLearningLab, document = root.document;
  if (!lab || !document) return;
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (text, fn, cls = "") => { const b = node("button", cls, text); b.type = "button"; b.onclick = fn; return b; };
  const statusText = { pass: "通过", fail: "未达标", unknown: "证据不足", reviewed: "已记录", pending: "待完成" };
  const fmt = v => typeof v === "number" ? Number(v.toFixed(3)).toLocaleString("zh-CN") : String(v ?? "—");
  function create(options) {
    const host = options.host;
    let mode = "coach", plan = null, index = 0, hints = [], answers = [], results = [], goal = "", busy = false, available = true, activeRun = null, progress = null, epoch = 0;
    let refreshTimer = null;
    const capture = options.capture;
    const runner = root.AliceLearningRunner.create({ capture, generation: () => epoch,
      controls: () => root.AliceSchematic.getAutomationTargets(), setControl: (id, value) => root.AliceSchematic.applyAutomationValue(id, value),
      start: signal => root.AliceLearningEvidence.start(signal), pause: () => root.AliceLearningEvidence.pause(),
      now: () => performance.now(), wait: ms => new Promise(resolve => root.setTimeout(resolve, ms)), clearObservations: () => root.AliceLearningWorkspace.clearObservations()
    });
    const changed = () => { options.changed(); };
    function currentStatus(i, context) {
      const r = results[i];
      return !r ? "pending" : r.status === "reviewed" ? "reviewed" : r.historical || r.revision !== context.revision ? "pending" : r.status;
    }
    function mark() {
      const context = capture(), step = plan?.steps[index];
      if (!step) return;
      const items = step.targetIds.filter(id => context.targets.some(t => t.id === id)).map((id, i) => ({ targetId: id, style: i ? "arrow" : "circle", label: context.targets.find(t => t.id === id).label }));
      options.mark(items, context);
    }
    function waveform(result) {
      if (!result.waveform) return null;
      const { frequencyHz, dutyCycle } = result.waveform;
      if (!Number.isFinite(frequencyHz) || !Number.isFinite(dutyCycle)) return null;
      const box = node("figure", "coach-wave");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 360 76"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `PWM ${fmt(frequencyHz)} Hz，${fmt(dutyCycle * 100)}%`);
      const path = document.createElementNS(svg.namespaceURI, "path");
      let d = "M 10 60";
      for (let k = 0; k < 3; k++) { const x = 10 + 112 * k, high = 112 * Math.max(0, Math.min(1, dutyCycle)); d += ` L ${x} 60 L ${x} 16 L ${x + high} 16 L ${x + high} 60 L ${x + 112} 60`; }
      path.setAttribute("d", d); svg.append(path); box.append(svg, node("figcaption", "", `运行 PWM 参数 · ${fmt(frequencyHz)} Hz · ${fmt(dutyCycle * 100)}%（示意）`)); return box;
    }
    function resultCard(r) {
      const card = node("article", "coach-check"); card.dataset.status = r.status;
      const head = node("div", "coach-check-head"); head.append(node("strong", "", r.label), node("span", "coach-badge", statusText[r.status] || "历史结果")); card.append(head);
      const values = node("div", "coach-values"); values.append(node("span", "", "目标 " + r.expected), node("strong", "", "实测 " + fmt(r.actual) + (r.unit ? " " + r.unit : ""))); card.append(values);
      if (typeof r.actual === "number" && Number.isFinite(r.min) && Number.isFinite(r.max)) {
        const pad = Math.max(Math.abs(r.max - r.min), Math.abs(r.actual) * .12, Math.abs(r.max) * .12, .01);
        const low = Math.min(r.min, r.actual) - pad, high = Math.max(r.max, r.actual) + pad;
        const scale = v => (v - low) / (high - low) * 100;
        const bar = node("div", "coach-range"), band = node("i", "coach-range-band"), marker = node("b", "coach-range-marker");
        band.style.left = scale(r.min) + "%"; band.style.width = Math.max(1, scale(r.max) - scale(r.min)) + "%"; marker.style.left = scale(r.actual) + "%";
        bar.append(band, marker); bar.setAttribute("aria-label", "浅色区间是目标范围，圆点是实测值"); card.append(bar);
      }
      card.append(node("small", "", r.detail)); const wave = waveform(r); if (wave) card.append(wave); return card;
    }
    function render() {
      const context = capture(); host.replaceChildren();
      const intro = node("div", "coach-intro"); intro.append(node("span", "coach-kicker", mode === "challenge" ? "CHALLENGE / 挑战练习" : "LEARN BY DOING / 跟着做"), node("h3", "", mode === "challenge" ? "把理解，变成一次验证。" : "每做一步，都看见进步。"));
      intro.append(node("p", "", mode === "challenge" ? "先独立尝试，遇到困难再逐层查看提示。" : "从你的工程出发，分步操作，用运行结果验证。")); host.append(intro);
      const form = node("form", "coach-goal-form"), label = node("label", "", "这次想学什么？"), input = node("textarea");
      input.id = "coachGoal"; input.rows = 2; input.maxLength = 2000; input.placeholder = "例如：掌握 ADC 控制 PWM，并验证不同输入的输出"; input.value = goal;
      input.oninput = () => { goal = input.value; changed(); }; label.htmlFor = input.id;
      const generate = node("button", "coach-primary", busy ? "正在规划…" : plan ? "重新规划" : "生成学习任务"); generate.type = "submit"; generate.disabled = busy || !available || Boolean(activeRun);
      form.append(label, input, generate); form.onsubmit = e => { e.preventDefault(); goal = input.value.trim(); if (!goal) { input.focus(); return; } options.request(mode, goal); }; host.append(form);
      if (!plan) {
        const empty = node("div", "coach-empty"); empty.append(node("span", "coach-orbit", "01 → 02 → 03"), node("strong", "", "目标 → 动手 → 验证"), node("p", "", "AI 安排步骤和提示，平台用真实接线、运行参数与串口记录验收。")); host.append(empty); return;
      }
      const done = plan.steps.filter((_, i) => ["pass", "reviewed"].includes(currentStatus(i, context))).length;
      const overview = node("section", "coach-overview"), top = node("div", "coach-overview-heading");
      top.append(node("h3", "", plan.title), node("strong", "coach-fraction", `${done}/${plan.steps.length}`)); overview.append(top, node("p", "", plan.goal));
      overview.append(node("small", "coach-test-note", "AI 规划任务与提示 · 本机运行结果验证"));
      const track = node("div", "coach-progress-track"), fill = node("div"); fill.style.width = done / plan.steps.length * 100 + "%"; track.append(fill); overview.append(track);
      const steps = node("nav", "coach-steps"); steps.setAttribute("aria-label", "实验步骤");
      plan.steps.forEach((s, i) => { const st = currentStatus(i, context), b = button("", () => { index = i; progress = null; render(); changed(); }); b.className = "coach-step"; b.dataset.status = st; b.setAttribute("aria-current", i === index ? "step" : "false"); b.title = s.title; b.disabled = Boolean(activeRun); b.append(node("span", "", ["pass", "reviewed"].includes(st) ? "✓" : String(i + 1)), node("small", "", s.title)); steps.append(b); });
      overview.append(steps); host.append(overview);
      const step = plan.steps[index], card = node("section", "coach-task");
      const heading = node("div", "coach-task-heading"); heading.append(node("span", "coach-kicker", `STEP ${String(index + 1).padStart(2, "0")}`), node("span", "coach-badge", statusText[currentStatus(index, context)])); card.append(heading, node("h3", "", step.title));
      card.append(node("p", "coach-instruction", step.instruction));
      if (mode === "challenge") card.append(node("small", "coach-test-note", "先独立完成，需要帮助时再逐层展开提示。"));
      if (step.targetIds.length) card.append(button("◎ 定位相关元件 / 代码", mark, "coach-locate"));
      if (step.prediction) { const label = node("label", "coach-prediction", step.prediction), field = node("textarea"); field.rows = 2; field.maxLength = 1000; field.placeholder = "先写下你的预期，再对照实测结果…"; field.value = answers[index] || ""; field.oninput = () => { answers[index] = field.value; changed(); }; label.append(field); card.append(label); }
      const dialogue = node("div", "coach-dialogue");
      dialogue.append(node("strong", "", "和 Alice 聊聊这一步"));
      const conversation = node("div", "coach-dialogue-actions");
      [["我卡住了", "我卡在当前这一步了。请根据已有证据先给一个小提示，问我一个定位原因的问题，暂时不要把完整答案给出来。"],
        ["换个说法", "这一步我还没理解，请用贴合当前工程的例子重新解释，并用一个小问题确认我的理解。"],
        ["点评我的预测", "请讨论我对当前步骤的预测：先核对推理依据，指出需要验证的地方，再让我动手确认。不要把预测当成实测。"]].forEach(([label, prompt]) => {
        const b = button(label, () => {
          if (label === "点评我的预测" && !answers[index]?.trim()) { host.querySelector(".coach-prediction textarea")?.focus(); options.notify("先写一点你的预测，我才能和你讨论这条思路。"); return; }
          options.discuss(prompt);
        }); b.disabled = busy || !available || Boolean(activeRun); conversation.append(b);
      });
      dialogue.append(conversation); card.append(dialogue);
      const checks = node("div", "coach-expectations");
      for (const c of step.checks) checks.append(node("p", "", "◇ " + c.label + (Number.isFinite(c.min) ? ` · ${c.min}–${c.max} ${c.unit}` : "")));
      for (const c of step.cases) checks.append(node("p", "", `◇ ${c.label} · ${c.stimuli.map(s => `${s.label} ${s.value}${s.unit}`).join(" / ") || "当前输入"} · ${c.waitMs} ms`));
      if (checks.childNodes.length) card.append(checks);
      if (progress) { const p = node("div", "coach-running"); p.setAttribute("role", "status"); p.append(node("strong", "", `正在验证 ${progress.index + 1}/${progress.count} · ${progress.label}`)); const meter = node("progress"); meter.max = 1; meter.value = progress.progress; p.append(meter); card.append(p); }
      const result = results[index];
      if (result) {
        const reflection = node("div", "coach-reflection");
        const fresh = !result.historical && result.revision === context.revision;
        reflection.dataset.status = fresh ? result.status : "pending";
        reflection.append(node("strong", "", !fresh ? "保留这次观察，再验证现在的工程。" : result.status === "pass" ? "这一步的验收条件通过了。" : result.status === "fail" ? "出现了差异，我们从这里找原因。" : result.status === "reviewed" ? "观察已经记下，说说你怎样理解它。" : "还缺一些证据，先确认观察条件。"));
        if (answers[index]) reflection.append(node("p", "", "你先前的预测：" + answers[index]));
        const discussResult = button(result.status === "pass" ? "为什么会得到这个结果？" : "一起分析这次结果", () => options.discuss("请结合当前步骤、我的预测和最近验收记录，解释目标与观测之间的关系。如果证据过期或不足，请先指出，并只建议下一项最有价值的验证。"));
        discussResult.disabled = busy || !available || Boolean(activeRun); reflection.append(discussResult); card.append(reflection);
        if (result.historical || (result.revision !== context.revision && result.status !== "reviewed")) card.append(node("p", "coach-stale", "这是此前的实验记录。工程或运行状态已变化，请重新验收。"));
        if (result.cases?.length) for (const c of result.cases) { card.append(node("h4", "coach-case-title", c.label)); c.results.forEach(r => card.append(resultCard(r))); }
        else (result.results || []).forEach(r => card.append(resultCard(r)));
      }
      const actions = node("div", "coach-actions");
      const verify = button(activeRun ? "取消验收" : step.cases.length ? "▶ 运行验收" : step.checks.length ? "检查这一步" : "记录观察完成", activeRun ? cancel : verifyStep, "coach-primary"); verify.disabled = busy; actions.append(verify);
      const hint = button(`给我一点提示${hints[index] ? ` · ${hints[index]}/${step.hints.length}` : ""}`, () => { hints[index] = Math.min(step.hints.length, (hints[index] || 0) + 1); options.feedback("help", "先看这一条提示，试着验证一个判断。需要时可以继续追问。"); render(); changed(); }); hint.disabled = Boolean(activeRun) || (hints[index] || 0) >= step.hints.length; actions.append(hint); card.append(actions);
      if (step.cases.length) card.append(node("small", "coach-test-note", "验收会临时改变上方输入并推进仿真，完成或取消后恢复输入。原本暂停的仿真将恢复暂停。"));
      step.hints.slice(0, hints[index] || 0).forEach((h, i) => { const row = node("div", "coach-hint"); row.append(node("strong", "", ["01 看哪里", "02 为什么", "03 怎么改"][i]), node("p", "", h)); card.append(row); });
      if (!step.cases.length && !step.checks.length) card.append(node("small", "coach-test-note", "此步骤由你记录观察完成，不计为自动验证。"));
      host.append(card);
      const nav = node("div", "coach-nav"); const prev = button("← 上一步", () => { index--; render(); changed(); }); prev.disabled = index <= 0 || Boolean(activeRun); const next = button("下一步 →", () => { index++; render(); changed(); }); next.disabled = index >= plan.steps.length - 1 || Boolean(activeRun); nav.append(prev, next); host.append(nav);
      if (done === plan.steps.length) { const success = node("div", "coach-finish"); success.append(node("strong", "", "✓ 本轮任务已完成"), node("p", "", "保留你的预测、提示与实测记录，再尝试改变一个条件。")); host.append(success); }
      const save = button("保存这轮实验记录", saveRecord, "coach-save-record"); save.disabled = Boolean(activeRun); host.append(save);
    }
    function cancel() { activeRun?.abort(); }
    async function verifyStep() {
      if (!plan || activeRun || busy) return;
      const step = plan.steps[index], stepIndex = index, context = capture();
      if (!step.cases.length) {
        results[index] = step.checks.length ? lab.evaluateAll(step.checks, context) : { status: "reviewed", results: [], revision: context.revision };
        feedback(results[index]);
        render(); changed(); return;
      }
      const controller = new AbortController(), generation = epoch; activeRun = controller;
      options.setTesting(true); render();
      try {
        const result = await runner.run(step, { signal: controller.signal, onProgress: p => {
          if (epoch !== generation) return; progress = p;
          const container = host.querySelector(".coach-running");
          if (container && container.querySelector("progress")) { container.querySelector("progress").value = p.progress; container.querySelector("strong").textContent = `正在验证 ${p.index + 1}/${p.count} · ${p.label}`; }
          else render();
        } });
        if (generation === epoch && !controller.signal.aborted) { results[stepIndex] = result; feedback(result); changed(); options.notify(result.status === "pass" ? "实测验收通过。可以继续下一步。" : "已完成观测，请对照目标和实测结果。", result.status === "pass" ? "" : "warn"); }
      } catch (error) { if (generation === epoch) { options.notify(error.message, "warn"); options.feedback("help", "这次验收没有得到完整结论。可以检查条件后再试。"); } }
      finally { if (activeRun === controller) { activeRun = null; progress = null; options.setTesting(false); render(); } }
    }
    function feedback(result) {
      options.feedback(result.status === "pass" ? "success" : result.status === "reviewed" ? "ready" : "help", result.status === "pass" ? "本次验收通过了。试着解释结果，再换一个条件验证。" : result.status === "reviewed" ? "你的观察已记录。愿意说说它和预测有什么联系吗？" : result.status === "fail" ? "实测和目标有差异。我们可以一起找最关键的线索。" : "目前证据还不够。先检查运行状态和观测条件。");
    }
    function discussion() {
      const step = plan?.steps[index]; if (!step) return null;
      const context = capture(), result = results[index];
      return { title: step.title, goal: plan.goal, step: index + 1, instruction: step.instruction,
        predictionQuestion: step.prediction || "", studentPrediction: answers[index] || "", revealedHints: step.hints.slice(0, hints[index] || 0),
        status: currentStatus(index, context), evidence: result ? { status: result.status, historical: Boolean(result.historical || result.revision !== context.revision), results: result.results, timeMs: result.timeMs } : null };
    }
    function saveRecord() {
      if (!plan) return;
      const context = capture();
      const sections = [{ heading: "实验目标", body: plan.goal }];
      plan.steps.forEach((s, i) => { const r = results[i]; sections.push({ heading: `${i + 1}. ${s.title}`, body: [s.instruction, answers[i] ? "我的预测：" + answers[i] : "", `提示使用：${hints[i] || 0} 层`, "完成状态：" + statusText[currentStatus(i, context)], ...(r?.results || []).map(c => `${c.label}：目标 ${c.expected}；实测 ${fmt(c.actual)} ${c.unit}；${statusText[c.status]}。${c.detail}`)].filter(Boolean).join("\n") }); });
      options.record({ title: plan.title + " · 实验记录", origin: "local", sections, exercises: [] }, context);
    }
    function invalidate() { cancel(); if (!host.hidden && !refreshTimer) refreshTimer = root.setTimeout(() => { refreshTimer = null; if (!activeRun && !host.querySelector("textarea:focus")) render(); }, 180); }
    function exportState() { return { version: 1, mode, plan, index, hints, answers, results, goal }; }
    function restore(value) {
      cancel(); epoch++; activeRun = null; progress = null; plan = null; results = []; hints = []; answers = []; index = 0; goal = ""; options.setTesting(false);
      if (value?.version === 1 && value.plan) {
        try {
          plan = lab.normalizePlan(value.plan, capture()); index = Math.max(0, Math.min(plan.steps.length - 1, Math.trunc(Number(value.index) || 0)));
          mode = value.mode === "challenge" ? "challenge" : "coach"; goal = String(value.goal || "").slice(0, 2000);
          hints = plan.steps.map((s, i) => Math.max(0, Math.min(s.hints.length, Math.trunc(Number(value.hints?.[i]) || 0))));
          answers = plan.steps.map((s, i) => String(value.answers?.[i] || "").slice(0, 1000));
          // Restored reports are historical observations. They never count as a fresh automated pass.
          results = plan.steps.map((s, i) => {
            const r = value.results?.[i]; if (!r || !["pass", "fail", "unknown", "reviewed"].includes(r.status)) return null;
            return { status: r.status, historical: true, revision: String(r.revision || "").slice(0, 100), results: (Array.isArray(r.results) ? r.results : []).slice(0, 32).filter(Boolean).map(c => ({
              label: String(c.label || "").slice(0, 180), status: ["pass", "fail", "unknown"].includes(c.status) ? c.status : "unknown", expected: String(c.expected || "").slice(0, 300), actual: typeof c.actual === "number" && Number.isFinite(c.actual) ? c.actual : typeof c.actual === "string" ? c.actual.slice(0, 300) : null,
              unit: String(c.unit || "").slice(0, 30), detail: String(c.detail || "").slice(0, 600), min: Number.isFinite(c.min) ? c.min : null, max: Number.isFinite(c.max) ? c.max : null
            })) };
          });
        } catch (_) { options.notify("保存的学习任务已不适用于当前工程，请重新规划。", "warn"); }
      }
      render();
    }
    function setPlan(value) { cancel(); plan = value; index = 0; results = []; hints = []; answers = []; render(); changed(); }
    return Object.freeze({ render, invalidate, restore, exportState, setPlan, cancel, discussion,
      setMode(value) { mode = value === "challenge" ? "challenge" : "coach"; render(); },
      setBusy(value, configured = true) { busy = value; available = configured; if (!host.hidden) render(); },
      hasPlan: () => Boolean(plan)
    });
  }
  root.AliceLearningCoach = Object.freeze({ create });
}(window));
