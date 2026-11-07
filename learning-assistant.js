(function (root) {
  "use strict";
  const document = root.document, core = root.AliceLearningCore, workspace = root.AliceLearningWorkspace;
  if (!document || !core || !workspace) return;
  const session = core.createSession();
  const ns = "http://www.w3.org/2000/svg";
  let panel, overlay, preview, context = null, annotations = [], controller = null, requestSequence = 0, frame = 0, lastDraw = 0, generation = 0;
  let status = { configured: false, detail: "正在检查 AI 服务…" };
  let coach = null, learningView = "ask", testing = false, discussingStep = false, lastRequest = null;
  let companionState = "ready", companionText = "我在这里。我们从一个小问题开始。";
  const $ = id => document.getElementById(id);
  const notify = (message, kind = "") => { if ($("learningNotice")) { $("learningNotice").textContent = message; $("learningNotice").dataset.kind = kind; } };
  const changed = () => document.dispatchEvent(new CustomEvent("alice:learning-change"));
  function element(tag, className, content) {
    const node = document.createElement(tag); if (className) node.className = className; if (content != null) node.textContent = content; return node;
  }
  function action(label, handler, className) { const button = element("button", className, label); button.type = "button"; button.addEventListener("click", handler); return button; }
  function companion(state, text) {
    companionState = state; companionText = text;
    if (!panel) return;
    panel.dataset.companion = testing ? "testing" : controller ? "thinking" : state;
    $("learningCompanionState").textContent = testing ? "正在一起验证" : controller ? "正在思考" : ({ ready: "准备好了", question: "轮到你了", success: "有新进展", help: "一起找原因", offline: "等待连接" }[state] || "准备好了");
    $("learningCompanionSpeech").textContent = testing ? "观察目标和实测的差别，结束后一起解释。" : controller ? "让我对照一下这次的代码、接线和观测。你也可以继续查看实验。" : text;
  }
  function conversationalAction(label, handler, className = "") {
    const button = action(label, handler, className); button.dataset.learningAction = "true";
    button.disabled = Boolean(controller) || testing || !status.configured; return button;
  }
  // A small display-only subset: every model string becomes a text node, never HTML.
  function inline(parent, value) {
    let at = 0;
    for (const match of value.matchAll(/\*\*[^*\n]{1,400}\*\*|`[^`\n]{1,400}`/g)) {
      parent.append(document.createTextNode(value.slice(at, match.index)));
      const bold = match[0].startsWith("**"), body = match[0].slice(bold ? 2 : 1, bold ? -2 : -1);
      parent.append(bold ? inline(element("strong"), body) : element("code", "", body));
      at = match.index + match[0].length;
    }
    parent.append(document.createTextNode(value.slice(at))); return parent;
  }
  function messageContent(text) {
    const content = element("div", "learning-copy");
    let paragraph = [], listing = null, code = null;
    const flush = () => { if (paragraph.length) { content.append(inline(element("p"), paragraph.join("\n"))); paragraph = []; } listing = null; };
    for (const line of text.split("\n")) {
      if (/^\s*```/.test(line)) {
        flush(); if (code) { content.append(element("pre", "", code.join("\n"))); code = null; } else code = []; continue;
      }
      if (code) { code.push(line); continue; }
      if (!line.trim()) { flush(); continue; }
      const bullet = /^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(line);
      if (bullet) {
        if (paragraph.length) flush();
        const tag = bullet[1] ? "UL" : "OL";
        if (!listing || listing.tagName !== tag) { listing = element(tag.toLowerCase()); content.append(listing); }
        listing.append(inline(element("li"), bullet[2])); continue;
      }
      const heading = /^#{1,4}\s+(.+)$/.exec(line);
      if (heading) { flush(); content.append(inline(element("h4"), heading[1])); continue; }
      listing = null; paragraph.push(line);
    }
    flush(); if (code) content.append(element("pre", "", code.join("\n"))); return content;
  }
  function replyTo(message, answer) {
    if (!answer.trim()) return;
    if (message.revision && message.revision !== workspace.capture().revision) { renderHistory(); notify("工程已变化，请基于当前工程重新出题。", "warn"); return; }
    ask("ask", `关于「${message.interaction.question}」，我的想法是：${answer.trim()}。请先回应我的思路，再引导我做下一步。`, { messageId: message.id, answer: answer.trim() });
  }
  function interactionCard(message, latest, revision) {
    const card = element("section", "learning-interaction"); card.setAttribute("aria-label", "一起想一想");
    const valid = !message.revision || message.revision === revision, answered = message.interaction.answer != null;
    card.append(element("small", "learning-interaction-label", "轮到你 · 一起想一想"), inline(element("h4"), message.interaction.question));
    const choices = element("div", "learning-choices");
    message.interaction.choices.forEach((choice, i) => {
      const button = conversationalAction("", () => replyTo(message, choice), "learning-choice");
      button.append(element("span", "learning-choice-letter", String.fromCharCode(65 + i)), inline(element("span"), choice));
      button.dataset.unavailable = String(!valid || !latest || answered); button.disabled ||= !valid || !latest || answered;
      button.setAttribute("aria-pressed", String(message.interaction.answer === choice)); choices.append(button);
    });
    card.append(choices);
    if (answered) card.append(element("p", "learning-answer-record", "我的回答：" + message.interaction.answer));
    else if (!valid && latest) {
      card.append(element("p", "learning-interaction-note", "工程已修改，这道题需要重新对照。"), conversationalAction("根据当前工程重新出题", () => ask("ask", "请根据当前工程重新设计一个预测或排查小问题，先不要给答案。")));
    } else if (latest) {
      const form = element("form", "learning-reply-form"), field = element("textarea"), send = element("button", "learning-reply-send", "说说我的想法 ↗");
      field.rows = 2; field.maxLength = 2000; field.placeholder = "也可以写自己的想法，暂时不确定也没关系"; field.setAttribute("aria-label", "我的思路");
      send.type = "submit"; send.dataset.learningAction = "true"; send.disabled = Boolean(controller) || testing || !status.configured;
      form.onsubmit = event => { event.preventDefault(); if (!field.value.trim()) { field.focus(); return; } replyTo(message, field.value); };
      form.append(field, send); card.append(form);
    }
    card.append(element("small", "learning-interaction-note", "先讨论思路，再用实验确认。")); return card;
  }
  function renderHistory() {
    if (!panel) return;
    const saved = session.export();
    const revision = workspace.capture().revision;
    $("learningMessages").replaceChildren(...saved.messages.map((m, i) => {
      const item = element("article", "learning-message " + m.role);
      item.append(element("small", "", m.role === "user" ? "我" : "ALICE · 一起做实验"));
      if (m.text) item.append(messageContent(m.text));
      const latest = i === saved.messages.length - 1;
      if (m.role === "assistant" && m.interaction) item.append(interactionCard(m, latest, revision));
      if (m.role === "assistant" && latest) {
        const follow = element("div", "learning-followups"); follow.setAttribute("aria-label", "继续聊");
        const prompts = m.followUps?.length ? m.followUps : ["换个更容易理解的说法", "我该怎样验证这个结论？", "围绕这里考考我，先不要给答案"];
        prompts.forEach(prompt => follow.append(conversationalAction(prompt, () => ask("ask", prompt)))); item.append(follow);
      }
      return item;
    }));
    $("learningMessages").hidden = !saved.messages.length || learningView !== "ask";
    $("learningWelcome").hidden = Boolean(saved.messages.length) || learningView !== "ask";
    $("learningDocuments").replaceChildren(...saved.handouts.slice().reverse().map(doc => {
      const row = element("div", "learning-document-row");
      row.append(action(doc.title, () => showHandout(doc), "learning-document-title"), element("small", "", doc.origin === "local" ? "实验记录" : "讲义草稿")); return row;
    }));
    $("learningDocumentCount").textContent = saved.handouts.length;
    const messages = $("learningMessages"); messages.scrollTop = messages.scrollHeight;
  }
  function refreshTargets() {
    context = workspace.capture();
    const select = $("learningTarget"), previous = select.value;
    const search = $("learningTargetSearch").value.trim().toLowerCase();
    select.replaceChildren(element("option", "", "整个工程")); select.options[0].value = "";
    for (const target of context.targets.filter(t => !search || t.label.toLowerCase().includes(search))) {
      const option = element("option", "", target.label); option.value = target.id; select.append(option);
    }
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
    const counts = `${context.circuit.components.length} 个元件 · ${context.files.length} 份源码 / IOC`;
    $("learningContextSummary").textContent = counts;
    return context;
  }
  function clearAnnotations() {
    annotations = []; overlay?.replaceChildren();
    if (frame) root.cancelAnimationFrame(frame); frame = 0;
    $("learningAnnotations")?.replaceChildren();
  }
  function svgNode(tag, attrs, label) {
    const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (label != null) node.textContent = label; return node;
  }
  function draw(timestamp) {
    frame = 0;
    if (!annotations.length) return;
    if (timestamp - lastDraw >= 80) {
      lastDraw = timestamp;
      const bounds = overlay.getBoundingClientRect();
      overlay.setAttribute("viewBox", `0 0 ${bounds.width || 1} ${bounds.height || 1}`);
      const groups = [];
      for (const item of annotations) {
        const target = context?.targets.find(t => t.id === item.targetId);
        const rect = workspace.rectFor(target, item);
        if (!rect) continue;
        const x = rect.left - bounds.left, y = rect.top - bounds.top, w = rect.width, h = rect.height;
        const group = svgNode("g", { "data-learning-target": item.targetId });
        if (item.style === "circle") group.append(svgNode("ellipse", { cx: x + w / 2, cy: y + h / 2, rx: w / 2 + 7, ry: h / 2 + 7, class: "learning-ring" }));
        else if (item.style === "arrow") {
          const startX = Math.max(18, x - 50), startY = Math.max(22, y - 38);
          const endX = x + Math.min(w / 2, 18), endY = y + Math.min(h / 2, 18);
          const angle = Math.atan2(endY - startY, endX - startX), size = 11;
          group.append(svgNode("path", { d: `M${startX} ${startY} L${endX} ${endY} M${endX - size * Math.cos(angle - .5)} ${endY - size * Math.sin(angle - .5)} L${endX} ${endY} L${endX - size * Math.cos(angle + .5)} ${endY - size * Math.sin(angle + .5)}`, class: "learning-ring" }));
        } else group.append(svgNode("rect", { x: x - 3, y: y - 3, width: w + 6, height: h + 6, rx: 5, class: "learning-highlight" }));
        const label = item.label.slice(0, 44), labelWidth = Math.min(360, label.length * 10 + 18);
        const lx = Math.max(4, Math.min(x, bounds.width - labelWidth - 4)), ly = y > 28 ? y - 28 : y + h + 8;
        group.append(svgNode("rect", { x: lx, y: ly, width: labelWidth, height: 23, rx: 5, fill: "#0f766e" }));
        group.append(svgNode("text", { x: lx + 8, y: ly + 16, fill: "white", "font-size": 12, "font-family": "system-ui,sans-serif" }, label));
        groups.push(group);
      }
      overlay.replaceChildren(...groups);
    }
    frame = root.requestAnimationFrame(draw);
  }
  function applyAnnotations(items, captured) {
    clearAnnotations(); context = captured; annotations = items;
    $("learningAnnotations").replaceChildren(...items.map((item, index) => action(`${index + 1}. ${item.label}`, () => {
      const current = workspace.capture();
      if (current.revision !== captured.revision) { clearAnnotations(); notify("工程已修改，请重新提问或选择目标。", "warn"); return; }
      workspace.focus(captured.targets.find(t => t.id === item.targetId), item);
    }, "learning-target-chip")));
    if (items.length) {
      workspace.focus(captured.targets.find(t => t.id === items[0].targetId), items[0]);
      frame = root.requestAnimationFrame(draw);
    }
  }
  function cancelRequest(quiet = false) {
    requestSequence++; controller?.abort(); controller = null; session.cancel(); setBusy(false);
    if ($("learningThinking")) $("learningThinking").hidden = true;
    if (!quiet) notify("已取消请求。后续返回的回答不会应用到工作台。");
    if (!quiet) companion("ready", "先停一下。准备好时，可以继续刚才的问题。");
  }
  function setBusy(busy) {
    if (!panel) return;
    $("learningSend").disabled = busy || testing || !status.configured;
    $("learningCancel").hidden = !busy;
    $("learningRetry").disabled = busy || testing || !status.configured;
    $("learningComposer").setAttribute("aria-busy", String(busy));
    for (const button of panel.querySelectorAll("[data-learning-mode]")) button.disabled = busy || testing || !status.configured;
    for (const button of panel.querySelectorAll("[data-learning-action]")) button.disabled = busy || testing || !status.configured || button.dataset.unavailable === "true";
    coach?.setBusy(busy, Boolean(status.configured));
    companion(companionState, companionText);
  }
  async function checkStatus() {
    try {
      const response = await (root.AlicePlatform?.fetch || root.fetch.bind(root))("/api/learning/status", { cache: "no-store" });
      if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) throw new Error("当前后端尚未提供 AI 接口，请重启更新后的 AliceSIM 服务。");
      status = await response.json();
    } catch (error) { status = { configured: false, detail: error.message || "无法连接 AliceSIM AI 服务" }; }
    if (!panel) return;
    $("learningProvider").textContent = status.configured ? `已配置 · ${status.model}` : "尚未连接模型";
    $("learningProvider").dataset.ready = String(Boolean(status.configured));
    $("learningSetupMessage").textContent = status.detail;
    if (!status.configured) $("learningSetup").open = true;
    if (!status.configured) companion("offline", "连接模型后就能一起讨论。现在也可以定位元件、记录实验。");
    else if (companionState === "offline") companion("ready", "连接已准备好。想先理解原理，还是试着找一个问题？");
    setBusy(Boolean(controller));
  }
  async function ask(mode = "ask", explicitQuestion = "", reply = null, retry = false) {
    if (controller || testing) return;
    if (!status.configured) { notify("请先配置模型。可以先查看上下文、定位目标或保存本地实验记录。", "warn"); return; }
    const defaults = { explain: "请结合当前工程和选中目标解释工作原理。", debug: "请根据代码、接线和已有诊断帮我排查问题，说明依据和下一步验证方法。", handout: "请根据当前工程和对话制作一份学习讲义，包含原理、实验步骤、观测依据和练习。" };
    const draft = $("learningQuestion").value;
    const question = explicitQuestion || draft.trim() || defaults[mode];
    if (!question) { $("learningQuestion").focus(); return; }
    const captured = refreshTargets(), history = session.export().messages;
    if (discussingStep && learningView === "ask") captured.learningStep = coach?.discussion();
    const token = session.begin(captured), seq = ++requestSequence, projectGeneration = generation;
    if (reply && !session.answerInteraction(reply.messageId, reply.answer)) { session.cancel(); return; }
    if (!retry) session.addMessage("user", question);
    lastRequest = { mode, question }; $("learningRetry").hidden = true;
    renderHistory(); changed();
    const requestController = new AbortController(); controller = requestController;
    setBusy(true); notify("正在结合当前工程分析…");
    $("learningThinking").hidden = false;
    const timeout = root.setTimeout(() => requestController.abort(), 70000);
    try {
      const response = await (root.AlicePlatform?.fetch || root.fetch.bind(root))("/api/learning/respond", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: requestController.signal,
        body: JSON.stringify({ question, mode, history, focusTargetId: $("learningTarget").value, context: captured })
      });
      const payload = await response.json();
      if (seq !== requestSequence || generation !== projectGeneration) return;
      if (!response.ok || !payload.ok) throw new Error(payload.detail || "AI 请求失败");
      if (payload.revision !== captured.revision) throw new Error("模型响应与本次工程快照不匹配，请重试。");
      const result = session.accept(token, workspace.capture().revision, payload.guidance);
      if (!result) { notify("工程已发生变化，本次回答已失效。请基于当前工程重新提问。", "warn"); return; }
      applyAnnotations(result.annotations, captured);
      if (["coach", "challenge"].includes(mode)) {
        if (!result.lesson) throw new Error("模型没有返回完整学习任务，请重新规划或换一个更具体的目标。");
        coach.setPlan(result.lesson);
      }
      if (result.handout) { const handout = core.createHandout(result.handout, captured); session.addHandout(handout); showHandout(handout); }
      renderHistory(); changed(); if (!explicitQuestion && $("learningQuestion").value === draft) $("learningQuestion").value = "";
      companion(result.interaction ? "question" : "ready", result.interaction ? "先说说你的判断。选一个答案，或写出自己的思路。" : "可以接着追问，也可以把这个结论放进实验里试一试。");
      if (learningView === "ask" && !panel.hidden) $("learningMessages").lastElementChild?.scrollIntoView({ block: "nearest" });
      notify(result.rejected.length ? `${result.rejected.length} 处无效标注已忽略；其余内容已显示。` : "已根据提问时的工程快照生成指导。", result.rejected.length ? "warn" : "");
    } catch (error) {
      if (seq === requestSequence && generation === projectGeneration) { notify(error.name === "AbortError" ? "请求已超时或取消，请重试。" : error.message, "error"); $("learningRetry").hidden = false; companion("help", "这次回答没有取到，你的想法还在。可以重试。"); }
    } finally {
      root.clearTimeout(timeout);
      if (seq === requestSequence) { controller = null; $("learningThinking").hidden = true; setBusy(false); }
    }
  }
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), anchor = element("a");
    anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); root.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function showHandout(doc) {
    if (!preview) return;
    const filename = (doc.title || "AliceSIM讲义").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 80);
    $("learningHandoutTitle").textContent = doc.title;
    $("learningHandoutFrame").srcdoc = core.handoutHtml(doc);
    $("learningHandoutMd").onclick = () => download(core.handoutMarkdown(doc), filename + ".md", "text/markdown;charset=utf-8");
    $("learningHandoutHtml").onclick = () => download(core.handoutHtml(doc), filename + ".html", "text/html;charset=utf-8");
    $("learningHandoutPrint").onclick = () => { try { $("learningHandoutFrame").contentWindow.print(); } catch (_) { notify("请下载 HTML 后在浏览器中打印为 PDF。", "warn"); } };
    if (!preview.open) preview.showModal();
  }
  function localRecord() {
    const captured = refreshTargets();
    const prompt = $("learningQuestion").value.trim();
    const sections = [{ heading: "本次问题与目标", body: prompt || "尚未记录学习问题。" }, { heading: "实验记录", body: "以下为采集时的工程与观测数据，尚未由 AI 分析。可在实验后补充你的解释和结论。" }];
    const latest = session.export().messages.filter(m => m.role === "assistant").at(-1);
    if (latest) sections.push({ heading: "最近一次 AI 说明（可能基于此前快照）", body: latest.text });
    const doc = core.createHandout({ title: captured.project.name + " · 实验记录", origin: "local", sections, exercises: [] }, captured);
    session.addHandout(doc); renderHistory(); changed(); showHandout(doc);
  }
  function markTarget() {
    const captured = refreshTargets(), target = captured.targets.find(t => t.id === $("learningTarget").value);
    if (!target) { notify("请先在目标列表中选择元件、端子、代码或观测区域。"); return; }
    const annotation = { targetId: target.id, style: $("learningStyle").value, label: target.label };
    if (target.kind === "code") {
      const selection = captured.selection?.path === target.path ? captured.selection : null;
      annotation.startLine = selection?.startLine || 1; annotation.endLine = selection?.endLine || 1;
    }
    applyAnnotations([annotation], captured); notify("已定位。标注随画布移动，可随时清除。");
  }
  function open(value = true) {
    if (!panel) return;
    panel.hidden = !value; document.body.classList.toggle("learning-open", value);
    $("learningAssistantButton")?.setAttribute("aria-expanded", String(value));
    root.dispatchEvent(new Event("resize"));
    if (value) { refreshTargets(); checkStatus(); } else $("learningAssistantButton")?.focus();
  }
  function invalidate() {
    coach?.invalidate();
    if (context && workspace.capture().revision === context.revision) return;
    clearAnnotations();
    if (panel && !panel.hidden) renderHistory();
    if (controller) { cancelRequest(true); notify("工程已修改，请基于当前内容重新提问。", "warn"); }
  }
  function setView(view) {
    learningView = ["coach", "challenge"].includes(view) ? view : "ask";
    panel.dataset.view = learningView;
    panel.querySelectorAll("[data-learning-view]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.learningView === learningView)));
    $("learningCoach").hidden = learningView === "ask";
    $("learningMessages").hidden = learningView !== "ask" || !session.export().messages.length;
    $("learningWelcome").hidden = learningView !== "ask" || Boolean(session.export().messages.length);
    $("learningComposer").classList.toggle("coach-mode", learningView !== "ask");
    if (learningView !== "ask") discussingStep = false;
    $("learningDiscussion").hidden = !discussingStep;
    if (learningView !== "ask") coach?.setMode(learningView);
  }
  function restore(saved) { cancelRequest(true); clearAnnotations(); generation++; lastRequest = null; discussingStep = false; $("learningRetry").hidden = true; session.restore(saved); coach?.restore(saved?.coach); renderHistory(); setView(saved?.coach?.plan ? saved.coach.mode : "ask"); companion("ready", "我在这里。我们从一个小问题开始。"); if (panel && !panel.hidden) refreshTargets(); }
  root.AliceLearningAssistant = Object.freeze({ open, exportState: () => ({ ...session.export(), coach: coach?.exportState() || null }), restore, clearAnnotations, capture: () => workspace.capture() });
  function mount() {
    if (panel) return;
    panel = element("aside", "learning-panel"); panel.id = "learningPanel"; panel.hidden = true; panel.setAttribute("aria-label", "AI 学习助手");
    panel.innerHTML = `<header class="learning-heading"><div><span>ALICE / LEARN TOGETHER</span><h2>学习助手</h2></div><button type="button" id="learningClose" aria-label="收起学习助手">×</button></header>
      <div class="learning-companion"><div class="learning-avatar" aria-hidden="true"><svg viewBox="0 0 80 80"><path class="alice-antenna" d="M40 18V9"/><circle cx="40" cy="8" r="4" fill="currentColor"/><rect class="alice-shell" x="10" y="19" width="60" height="48" rx="20"/><rect class="alice-face" x="17" y="27" width="46" height="30" rx="13"/><g class="alice-eyes"><rect x="27" y="36" width="5" height="9" rx="2.5"/><rect x="48" y="36" width="5" height="9" rx="2.5"/></g><path class="alice-smile" d="M34 49Q40 54 46 49"/><circle cx="21" cy="49" r="3" fill="#58dbd0" opacity=".45"/><circle cx="59" cy="49" r="3" fill="#58dbd0" opacity=".45"/></svg></div><div class="learning-companion-copy"><strong id="learningCompanionState">准备好了</strong><p id="learningCompanionSpeech">我在这里。我们从一个小问题开始。</p></div></div>
      <div class="learning-provider"><i></i><span id="learningProvider">检查服务…</span><button type="button" id="learningRefreshStatus" title="重新检查模型连接">刷新</button></div>
      <div class="learning-tabs" role="tablist" aria-label="学习方式"><button type="button" role="tab" data-learning-view="ask" aria-selected="true">问问题</button><button type="button" role="tab" data-learning-view="coach" aria-selected="false">跟着做</button><button type="button" role="tab" data-learning-view="challenge" aria-selected="false">挑战练习</button></div>
      <div class="learning-body">
        <div id="learningWelcome" class="learning-welcome"><h3>今天，一起弄懂什么？</h3><p>可以带着疑问来，也可以先让我问你一个小问题。</p><div class="learning-starters"><button type="button" data-learning-action data-learning-starter="quiz"><strong>先考考我 ↗</strong><span>根据当前工程，来一道预测题</span></button><button type="button" data-learning-action data-learning-starter="debug"><strong>一起找原因 ↗</strong><span>从现象出发，一次排查一个点</span></button><button type="button" data-learning-starter="coach"><strong>陪我做实验 ↗</strong><span>边动手，边理解每一步</span></button></div></div>
        <details id="learningSetup" class="learning-details"><summary>模型连接</summary><p id="learningSetupMessage"></p><button type="button" id="learningOpenSettings">配置模型</button><p>填写接口地址、模型名称和密钥，保存后直接生效。</p></details>
        <div class="learning-context-head"><span id="learningContextSummary">工程上下文</span><button type="button" id="learningInspect">查看</button></div>
        <details class="learning-details" id="learningTargetDetails"><summary>选择指导目标</summary><input id="learningTargetSearch" type="search" placeholder="搜索元件、引脚或文件" aria-label="搜索指导目标"><select id="learningTarget" aria-label="指导目标"><option value="">整个工程</option></select><div class="learning-mark-actions"><select id="learningStyle" aria-label="标注样式"><option value="circle">画圈</option><option value="arrow">箭头</option><option value="highlight">高亮</option></select><button type="button" id="learningMark">定位标注</button><button type="button" id="learningClearMarks">清除</button></div></details>
        <div id="learningAnnotations" class="learning-annotations"></div><section id="learningCoach" hidden aria-label="实验陪练"></section><div id="learningMessages" class="learning-messages" aria-live="polite"></div><div id="learningThinking" class="learning-thinking" role="status" hidden><span aria-hidden="true"><i></i><i></i><i></i></span>正在结合你的实验思考…</div>
        <details class="learning-details"><summary>讲义与记录 <span id="learningDocumentCount">0</span></summary><div id="learningDocuments"></div><button type="button" id="learningLocalRecord">保存本地实验记录</button><p>对话与讲义随“保存项目”保存，也可单独下载讲义。</p></details>
      </div>
      <form id="learningComposer" class="learning-composer"><div id="learningDiscussion" class="learning-discussion" hidden><span id="learningDiscussionTitle"></span><button type="button" id="learningReturnToTask">返回任务 →</button></div><div class="learning-quick"><button type="button" data-learning-mode="explain">解释这里</button><button type="button" data-learning-mode="debug">带我排查</button><button type="button" data-learning-mode="handout">生成讲义</button></div><textarea id="learningQuestion" rows="3" maxlength="8000" placeholder="说说你的疑问，或告诉我刚才观察到了什么…" aria-label="学习问题"></textarea><div class="learning-send-row"><small>附带当前工程 · Ctrl+Enter 发送</small><button type="button" id="learningRetry" hidden>重试</button><button type="button" id="learningCancel" hidden>取消</button><button type="submit" id="learningSend">发送 ↗</button></div><p id="learningNotice" role="status"></p></form>`;
    document.body.append(panel);
    coach = root.AliceLearningCoach.create({ host: $("learningCoach"), capture: () => workspace.capture(), changed, notify,
      request: (mode, question) => ask(mode, question), mark: applyAnnotations,
      discuss: question => { if (controller || testing) return; setView("ask"); discussingStep = true; $("learningDiscussion").hidden = false; $("learningDiscussionTitle").textContent = "正在讨论 · " + coach.discussion().title; ask("ask", question); },
      feedback: companion,
      setTesting: value => { testing = value; setBusy(Boolean(controller)); },
      record: (raw, captured) => { const doc = core.createHandout(raw, captured); session.addHandout(doc); renderHistory(); changed(); showHandout(doc); }
    });
    panel.querySelectorAll("[data-learning-view]").forEach(b => b.addEventListener("click", () => setView(b.dataset.learningView)));
    panel.querySelectorAll("[data-learning-starter]").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.learningStarter === "coach") { setView("coach"); $("coachGoal")?.focus(); return; }
      ask(b.dataset.learningStarter === "debug" ? "debug" : "ask", b.dataset.learningStarter === "debug" ? "我们一起排查这个工程。请先根据已有证据给我一个最小的排查动作，并问我一个能区分原因的问题，不要一次列出所有答案。" : "请根据当前工程出一道有思考价值的预测或原理问题。给我几个可点选的选项，也允许我说出自己的想法；先不要揭示答案。");
    }));
    $("learningReturnToTask").onclick = () => setView(coach.exportState().mode);
    $("learningRetry").onclick = () => { if (lastRequest) ask(lastRequest.mode, lastRequest.question, null, true); };
    panel.querySelector(".learning-tabs").addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const tabs = [...panel.querySelectorAll("[data-learning-view]")], current = tabs.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (Math.max(0, current) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      tabs[next].focus(); setView(tabs[next].dataset.learningView);
    });
    overlay = svgNode("svg", { class: "learning-overlay", "aria-hidden": "true" }); document.documentElement.append(overlay);
    preview = element("dialog", "learning-handout"); preview.id = "learningHandout";
    preview.innerHTML = `<header><strong id="learningHandoutTitle">学习讲义</strong><div><button type="button" id="learningHandoutMd">Markdown</button><button type="button" id="learningHandoutHtml">HTML</button><button type="button" id="learningHandoutPrint">打印 / PDF</button><button type="button" id="learningHandoutClose" aria-label="关闭讲义">×</button></div></header><iframe id="learningHandoutFrame" title="学习讲义预览" sandbox="allow-same-origin allow-modals"></iframe>`;
    document.body.append(preview);
    $("learningAssistantButton")?.addEventListener("click", () => open(panel.hidden));
    $("learningClose").addEventListener("click", () => open(false));
    $("learningRefreshStatus").addEventListener("click", checkStatus);
    $("learningOpenSettings").addEventListener("click", () => root.AliceLearningSettings?.open());
    document.addEventListener("alice:learning-configured", () => { cancelRequest(true); checkStatus(); });
    $("learningComposer").addEventListener("submit", event => { event.preventDefault(); ask(); });
    $("learningQuestion").addEventListener("keydown", event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); ask(); } });
    panel.querySelectorAll("[data-learning-mode]").forEach(button => button.addEventListener("click", () => ask(button.dataset.learningMode)));
    $("learningCancel").addEventListener("click", () => cancelRequest());
    $("learningMark").addEventListener("click", markTarget);
    $("learningClearMarks").addEventListener("click", clearAnnotations);
    $("learningTargetSearch").addEventListener("input", refreshTargets);
    $("learningTargetDetails").addEventListener("toggle", () => { if ($("learningTargetDetails").open) refreshTargets(); });
    $("learningLocalRecord").addEventListener("click", localRecord);
    $("learningHandoutClose").addEventListener("click", () => preview.close());
    $("learningInspect").addEventListener("click", () => {
      const captured = refreshTargets();
      const dialog = element("dialog", "learning-context-dialog");
      const close = action("关闭", () => dialog.close());
      dialog.append(element("h2", "", "将附带的工程上下文"), element("p", "", "仅在发送问题时传给已配置的模型服务。源码、运行记录和裁剪说明如下："), element("pre", "", JSON.stringify(captured, null, 2)), close);
      document.body.append(dialog); dialog.addEventListener("close", () => dialog.remove(), { once: true }); dialog.showModal();
    });
    $("codeEditor")?.addEventListener("input", invalidate);
    document.addEventListener("alice:schematic-change", invalidate);
    document.addEventListener("keydown", event => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) clearAnnotations(); });
    root.addEventListener("alice-project-files-upserted", invalidate);
    root.addEventListener("alice-project-opened", () => { restore(null); workspace.clear(); });
    root.addEventListener("alice:ioc-viewer-loaded", invalidate);
    root.addEventListener("alice-project-snapshot-restored", event => restore(event.detail?.snapshot?.learning));
    renderHistory(); checkStatus();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
}(window));
