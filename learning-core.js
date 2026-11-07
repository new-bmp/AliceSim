(function (root, factory) {
  "use strict";
  const api = factory(typeof module === "object" && module.exports ? require("./learning-lab.js") : root.AliceLearningLab);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AliceLearningCore = api;
}(typeof window !== "undefined" ? window : globalThis, function (lab) {
  "use strict";
  const list = value => Array.isArray(value) ? value : [];
  const text = (value, max = 1200) => typeof value === "string" ? value.slice(0, max) : "";
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const targetId = (kind, ...parts) => [kind, ...parts.map(value => encodeURIComponent(value))].join(":");
  function fingerprint(value) {
    const source = typeof value === "string" ? value : JSON.stringify(value);
    let hash = 2166136261;
    let second = 5381;
    for (let i = 0; i < source.length; i++) {
      hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
      second = Math.imul(second, 33) ^ source.charCodeAt(i);
    }
    return (hash >>> 0).toString(16) + (second >>> 0).toString(16);
  }
  function safeFile(path) {
    return typeof path === "string" && path.length <= 500 && !/(^|[\\/])\.{1,2}([\\/]|$)/.test(path) && /\.(c|cpp|cc|cxx|h|hpp|ioc)$/i.test(path);
  }
  function boundedData(value, depth = 0) {
    if (depth > 5) return null;
    if (typeof value === "string") return value.slice(0, 600);
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean" || value == null) return value ?? null;
    if (Array.isArray(value)) return value.slice(0, 40).map(v => boundedData(v, depth + 1));
    if (typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 50).map(([k, v]) => [k.slice(0, 100), boundedData(v, depth + 1)]));
    return null;
  }
  function primitiveProperties(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).slice(0, 30)
      .filter(([, v]) => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)))
      .map(([k, v]) => [text(k, 80), typeof v === "string" ? text(v, 200) : v]));
  }
  function buildContext(input = {}) {
    const omissions = [];
    const active = input.activeFile || {};
    const records = new Map();
    for (const file of list(input.files)) if (safeFile(file?.path)) records.set(file.path, String(file.content || ""));
    if (safeFile(active.path)) records.set(active.path, String(active.content || ""));
    const paths = [...records.keys()].sort((a, b) => (a === active.path ? -1 : b === active.path ? 1 : /\.ioc$/i.test(a) ? -1 : /\.ioc$/i.test(b) ? 1 : a.localeCompare(b)));
    let remaining = 80000;
    const files = [];
    for (const path of paths) {
      if (files.length >= 20 || remaining <= 0) { omissions.push("未附全文：" + path); continue; }
      const full = records.get(path);
      const content = full.slice(0, Math.min(24000, remaining));
      const truncated = content.length < full.length;
      files.push({ path, content, lineCount: content.split("\n").length, truncated });
      remaining -= content.length;
      if (truncated) omissions.push("源码已截取：" + path);
    }
    const circuit = input.circuit || {};
    const components = list(circuit.components).filter(c => c && typeof c === "object").slice(0, 200).map(c => ({
      id: text(c.id, 100), ref: text(c.ref, 80), type: text(c.type, 100), value: text(String(c.value ?? ""), 250),
      pins: list(c.pins).filter(Boolean).slice(0, 150).map(p => ({ name: text(typeof p === "string" ? p : p.name, 80), label: text(p.label, 120) })),
      properties: primitiveProperties(Object.fromEntries(["adcVoltage", "adcBits", "adcReferenceVoltage", "buttonClosed", "oledAddress", "lux", "thresholdLux"].map(k => [k, c[k] ?? c.properties?.[k]]))),
      parameters: primitiveProperties(c.peripheralProperties ?? c.parameters)
    }));
    const endpoint = e => ({ componentId: text(e?.componentId, 100), pin: text(e?.pin, 80) });
    const wires = list(circuit.wires).filter(Boolean).slice(0, 400).map(w => ({ id: text(w.id, 100), from: endpoint(w.from), to: endpoint(w.to) }));
    const nets = list(circuit.nets).filter(Boolean).slice(0, 300).map(n => ({ id: text(n.id, 100), endpoints: list(n.endpoints).slice(0, 100).map(endpoint), voltage: n.voltage == null ? null : number(n.voltage), level: n.level == null ? null : number(n.level), floating: Boolean(n.floating), conflict: Boolean(n.conflict || n.analogConflict) }));
    if (list(circuit.components).length > components.length || list(circuit.wires).length > wires.length) omissions.push("电路较大，已限制附加元件和导线数量");
    const targets = [];
    for (const c of components) {
      targets.push({ id: targetId("component", c.id), kind: "component", componentId: c.id, label: `${c.ref || c.id} · ${c.type}` });
      for (const pin of c.pins) targets.push({ id: targetId("pin", c.id, pin.name), kind: "pin", componentId: c.id, pin: pin.name, label: `${c.ref || c.id} / ${pin.name}` });
    }
    for (const w of wires) targets.push({ id: targetId("wire", w.id), kind: "wire", wireId: w.id, label: `导线 ${w.id} · ${w.from.pin} → ${w.to.pin}` });
    for (const f of files) targets.push({ id: targetId("code", f.path), kind: "code", path: f.path, lineCount: f.lineCount, label: f.path });
    const channels = list(input.trace?.channels).filter(Boolean).slice(0, 4).map(channel => {
      const source = list(channel.samples).filter(Boolean);
      const samples = source.length <= 120 ? source : Array.from({ length: 120 }, (_, i) => source[Math.round(i * (source.length - 1) / 119)]);
      return { pin: text(channel.pin, 80), label: text(channel.label, 120), samples: samples.map(s => ({ timeMs: number(s.timeMs), value: number(s.value) })), sampled: source.length > 120, originalCount: source.length };
    });
    for (const ch of channels) targets.push({ id: targetId("trace", ch.pin), kind: "trace", pin: ch.pin, label: "波形 " + ch.pin });
    for (const t of list(input.uiTargets).slice(0, 20)) if (t?.kind === "ui" && /^ui:[a-z-]+$/.test(t.id)) targets.push({ id: t.id, kind: "ui", label: text(t.label, 120) });
    const revision = fingerprint({ project: text(input.project?.name), files: paths.slice().sort().map(p => [p, fingerprint(records.get(p))]), components, wires });
    return {
      version: 1, revision, capturedAt: new Date().toISOString(), project: { name: text(input.project?.name, 200) || "未命名工程" },
      activeFile: text(active.path, 500), selection: input.selection ? { path: text(input.selection.path, 500), startLine: number(input.selection.startLine), endLine: number(input.selection.endLine) } : null,
      files, circuit: { components, wires, nets, netsAvailable: circuit.netsAvailable !== false && Array.isArray(circuit.nets) }, targets,
      peripherals: boundedData(input.peripherals || {}), observations: boundedData(list(input.observations).slice(-20)),
      controls: list(input.controls).slice(0, 80).map(c => ({ id: text(c.id, 200), componentId: text(c.componentId, 100), label: text(c.label, 160), unit: text(c.unit, 30), min: number(c.min), max: number(c.max), value: number(c.value) })),
      measurements: boundedData(input.measurements || {}),
      runtime: { status: text(input.runtime?.status, 80) || "未运行", timeMs: number(input.runtime?.timeMs), built: Boolean(input.runtime?.built), error: text(input.runtime?.error, 2000) },
      diagnostics: list(input.diagnostics).filter(Boolean).slice(-30).map(d => ({ severity: text(d.severity, 40), text: text(d.text || d.message, 2000), file: text(d.file, 500), line: number(d.line) })),
      serial: list(input.serial).filter(Boolean).slice(-30).map(s => ({ instance: text(s.instance, 80), text: text(s.text, 1000), timeMs: number(s.timeMs) })),
      trace: { timeMs: number(input.trace?.timeMs), channels }, omissions,
      limitations: ["HAL 语义级仿真；不是完整 ARM 指令或模拟电路瞬态仿真。", "波形可能抽样，不能根据截取数据推断未记录的边沿。", "上下文是提问时的快照，未知和未运行的数据不能当作测试结果。"]
    };
  }
  function normalizeGuidance(raw, context) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("模型返回的指导格式无效");
    const byId = new Map(list(context?.targets).map(t => [t.id, t]));
    const annotations = [], rejected = [];
    for (const item of list(raw.annotations).slice(0, 16)) {
      const target = byId.get(item?.targetId);
      const style = item?.style || "highlight";
      const start = item?.startLine == null ? 1 : Number(item.startLine);
      const end = item?.endLine == null ? start : Number(item.endLine);
      if (!target || !["circle", "arrow", "highlight"].includes(style) || (target.kind === "code" && (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > target.lineCount))) {
        rejected.push("忽略无法定位的标注：" + text(item?.targetId, 200)); continue;
      }
      annotations.push({ targetId: target.id, style, label: text(item.label, 200) || target.label, ...(target.kind === "code" ? { startLine: start, endLine: end } : {}) });
    }
    const handout = raw.handout && typeof raw.handout === "object" ? normalizeHandoutBody(raw.handout) : null;
    const message = text(raw.message, 16000);
    const lesson = raw.lesson && lab ? lab.normalizePlan(raw.lesson, context) : null;
    const interaction = normalizeInteraction(raw.interaction);
    const followUps = [...new Set(list(raw.followUps).map(s => text(s, 120).trim()).filter(Boolean))].slice(0, 3);
    if (!message && !annotations.length && !handout && !lesson && !interaction) throw new Error("模型没有返回可显示的指导内容");
    return { message, annotations, handout, lesson, interaction, followUps, rejected, revision: context.revision };
  }
  function normalizeInteraction(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const question = text(raw.question, 600).trim();
    if (!question) return null;
    return { question, choices: [...new Set(list(raw.choices).map(s => text(s, 180).trim()).filter(Boolean))].slice(0, 4) };
  }
  function normalizeHandoutBody(raw = {}) {
    return { title: text(raw.title, 180) || "实验学习记录", sections: list(raw.sections).slice(0, 12).map(s => ({ heading: text(s?.heading, 180), body: text(s?.body, 6000) })), exercises: list(raw.exercises).slice(0, 8).map(s => text(s, 1500)) };
  }
  function createHandout(raw, context) {
    return { ...normalizeHandoutBody(raw), createdAt: new Date().toISOString(), origin: raw?.origin === "local" ? "local" : "ai", evidence: {
      project: context.project.name, revision: context.revision, capturedAt: context.capturedAt,
      runtime: context.runtime, circuit: context.circuit,
      files: context.files.slice(0, 4).map(f => ({ path: f.path, content: f.content.slice(0, 10000), truncated: f.truncated || f.content.length > 10000 })),
      diagnostics: context.diagnostics.slice(-12), serial: context.serial.slice(-12), limitations: context.limitations, omissions: context.omissions.slice(0, 30)
    } };
  }
  function codeFence(source) {
    const longest = Math.max(2, ...((String(source).match(/`+/g) || []).map(s => s.length)));
    return "`".repeat(longest + 1);
  }
  function handoutMarkdown(doc) {
    const e = doc.evidence || {};
    const plain = v => String(v || "").replace(/[\r\n]/g, " ");
    let md = `# ${plain(doc.title)}\n\n工程：${plain(e.project)}\n\n采集时间：${plain(e.capturedAt)} · 修订：${plain(e.revision)}\n\n${doc.origin === "local" ? "本地实验记录" : "AI 生成的讲义草稿，请结合实际实验核对"}\n`;
    for (const s of doc.sections) md += `\n## ${plain(s.heading)}\n\n${s.body}\n`;
    if (doc.exercises.length) md += "\n## 继续练习\n\n" + doc.exercises.map((s, i) => `${i + 1}. ${s}`).join("\n") + "\n";
    md += `\n## 采集时的证据\n\n运行状态：${plain(e.runtime?.status)} · ${number(e.runtime?.timeMs)} ms\n`;
    for (const f of list(e.files)) { const fence = codeFence(f.content); md += `\n### ${plain(f.path)}${f.truncated ? "（节选）" : ""}\n\n${fence}c\n${f.content}\n${fence}\n`; }
    if (list(e.serial).length) { const content = e.serial.map(s => `[${s.timeMs} ms ${s.instance}] ${s.text}`).join("\n"); const fence = codeFence(content); md += `\n### 串口记录\n\n${fence}text\n${content}\n${fence}\n`; }
    for (const d of list(e.diagnostics)) md += `\n- ${plain(d.severity)}: ${plain(d.text)}`;
    md += "\n\n## 观测边界\n\n" + list(e.limitations).concat(list(e.omissions)).map(s => "- " + s).join("\n") + "\n";
    return md;
  }
  function circuitSvg(circuit = {}) {
    const components = list(circuit.components).slice(0, 24);
    if (!components.length) return "";
    const height = Math.ceil(components.length / 4) * 95 + 30;
    const positions = new Map(components.map((c, i) => [c.id, { x: 18 + i % 4 * 172, y: 20 + Math.floor(i / 4) * 95 }]));
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 ${height}" role="img" aria-label="采集时的连接关系简图"><rect width="100%" height="100%" fill="#f4f7fb"/>`;
    for (const w of list(circuit.wires)) { const a = positions.get(w.from.componentId), b = positions.get(w.to.componentId); if (a && b) svg += `<path d="M${a.x + 75} ${a.y + 30}L${b.x + 75} ${b.y + 30}" stroke="#93a8bb" stroke-width="2"/>`; }
    for (const c of components) { const p = positions.get(c.id); svg += `<g transform="translate(${p.x},${p.y})"><rect width="150" height="60" rx="8" fill="white" stroke="#99adbf"/><text x="9" y="23" font-family="sans-serif" font-size="13" fill="#243b53">${escape((c.ref || c.id).slice(0, 16))}</text><text x="9" y="44" font-family="sans-serif" font-size="11" fill="#486581">${escape(c.type.slice(0, 20))}</text></g>`; }
    return svg + "</svg>";
  }
  function handoutHtml(doc) {
    const e = doc.evidence || {};
    const pre = value => `<pre>${escape(value)}</pre>`;
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(doc.title)}</title><style>body{max-width:880px;margin:36px auto;padding:0 24px;color:#243b53;font:16px/1.8 system-ui,sans-serif}h1{font-size:30px}h2{margin-top:32px;font-size:21px}p{white-space:pre-wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f5f9;padding:16px;border-radius:8px;font:13px/1.7 monospace}small{color:#627d98}svg{width:100%;max-height:600px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d9e2ec;padding:6px;text-align:left}@media print{body{margin:0;max-width:none}pre,svg{break-inside:avoid}}</style></head><body><small>AliceSIM · ${doc.origin === "local" ? "本地实验记录" : "AI 学习讲义草稿"}</small><h1>${escape(doc.title)}</h1><p>${escape(e.project)} · ${escape(e.capturedAt)}<br>修订 ${escape(e.revision)}</p>${doc.sections.map(s => `<h2>${escape(s.heading)}</h2><p>${escape(s.body)}</p>`).join("")}${doc.exercises.length ? "<h2>继续练习</h2><ol>" + doc.exercises.map(s => `<li>${escape(s)}</li>`).join("") + "</ol>" : ""}<h2>采集时的证据</h2><p>运行状态：${escape(e.runtime?.status)} · ${number(e.runtime?.timeMs)} ms</p>${circuitSvg(e.circuit)}${list(e.circuit?.wires).length ? "<table><tr><th>起点（元件 ID / 端子）</th><th>终点（元件 ID / 端子）</th></tr>" + list(e.circuit.wires).map(w => `<tr><td>${escape(w.from.componentId)} / ${escape(w.from.pin)}</td><td>${escape(w.to.componentId)} / ${escape(w.to.pin)}</td></tr>`).join("") + "</table>" : ""}${list(e.files).map(f => `<h2>${escape(f.path)}${f.truncated ? "（节选）" : ""}</h2>${pre(f.content)}`).join("")}${list(e.serial).length ? "<h2>串口记录</h2>" + pre(e.serial.map(s => `[${s.timeMs} ms ${s.instance}] ${s.text}`).join("\n")) : ""}${list(e.diagnostics).length ? "<h2>诊断记录</h2>" + pre(e.diagnostics.map(d => d.text).join("\n")) : ""}<h2>观测边界</h2><ul>${list(e.limitations).concat(list(e.omissions)).map(s => `<li>${escape(s)}</li>`).join("")}</ul></body></html>`;
  }
  function createSession() {
    let sequence = 0, messageSequence = 0, pending = null, messages = [], handouts = [];
    function addMessage(role, value, extra = {}) {
      if (!["user", "assistant"].includes(role)) return;
      const message = { id: "message-" + ++messageSequence, role, text: text(value, 16000) };
      if (role === "assistant") {
        message.revision = text(extra.revision, 100);
        message.interaction = normalizeInteraction(extra.interaction);
        if (message.interaction && typeof extra.interaction.answer === "string") message.interaction.answer = text(extra.interaction.answer, 2000);
        message.followUps = [...new Set(list(extra.followUps).map(s => text(s, 120).trim()).filter(Boolean))].slice(0, 3);
      }
      messages.push(message); messages = messages.slice(-40);
    }
    function addHandout(doc) { handouts.push(doc); handouts = handouts.slice(-8); }
    return {
      begin(context) { pending = { id: ++sequence, revision: context.revision, context }; return pending.id; },
      cancel() { pending = null; sequence++; },
      accept(id, revision, raw) {
        if (!pending || id !== pending.id || pending.revision !== revision) return false;
        const result = normalizeGuidance(raw, pending.context); pending = null;
        if (result.message || result.interaction) addMessage("assistant", result.message, result);
        return result;
      },
      addMessage, addHandout,
      answerInteraction(id, answer) {
        const message = messages.at(-1);
        if (!message || message.id !== id || !message.interaction || message.interaction.answer != null) return false;
        message.interaction.answer = text(answer, 2000); return true;
      },
      export() { return JSON.parse(JSON.stringify({ version: 1, messages, handouts })); },
      restore(value) {
        pending = null; sequence++; messages = []; handouts = [];
        if (value?.version !== 1) return;
        list(value.messages).slice(-40).forEach(m => addMessage(m?.role, m?.text, m || {}));
        for (const h of list(value.handouts).slice(-8)) {
          if (!h || typeof h !== "object") continue;
          const e = h.evidence || {};
          const context = buildContext({ project: { name: e.project }, files: e.files, circuit: e.circuit, runtime: e.runtime, diagnostics: e.diagnostics, serial: e.serial });
          context.capturedAt = text(e.capturedAt, 80); context.revision = text(e.revision, 80);
          context.omissions = list(e.omissions).slice(0, 30).map(s => text(s));
          for (const file of context.files) if (list(e.files).some(f => f?.path === file.path && f.truncated)) file.truncated = true;
          const restored = createHandout(h, context);
          restored.createdAt = text(h.createdAt, 80) || restored.createdAt;
          addHandout(restored);
        }
      }
    };
  }
  return Object.freeze({ buildContext, targetId, fingerprint, normalizeGuidance, createHandout, handoutHtml, handoutMarkdown, createSession });
}));
