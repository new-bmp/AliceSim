(function (global) {
  "use strict";

  if (!global || typeof document === "undefined" || global.AliceDatasheetImport) return;

  const MAX_PDF_BYTES = 24 * 1024 * 1024;
  const PARSE_ENDPOINT = "/api/datasheet/parse";
  const VALIDATE_ENDPOINT = "/api/datasheet/validate";
  const REVIEWED_DRAFT_STORAGE = "alicesim.datasheet.reviewed-draft.v1";
  const CONFIRMATION_LABELS = {
    "identity.partNumber": "型号与订货身份",
    packages: "封装与引脚数量",
    pins: "引脚名称、方向和封装位置",
    "electrical.recommendedOperatingConditions": "推荐工作电压与限制",
    interfaces: "接口类型、地址与速率",
    registerMap: "寄存器地址与功能",
    "simulation.scope": "仿真范围与精度边界"
  };
  const CONFIDENCE_LABELS = {
    identity: "器件身份",
    packages: "封装",
    pins: "引脚",
    electrical: "电气限制",
    interfaces: "接口",
    registers: "寄存器"
  };

  const state = {
    modal: null,
    file: null,
    draft: null,
    validation: null,
    capabilities: null,
    stage: "upload",
    busy: false,
    handoffReady: false
  };

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const query = (selector, root = state.modal || document) => root?.querySelector(selector) || null;
  const queryAll = (selector, root = state.modal || document) => [...(root?.querySelectorAll(selector) || [])];

  function toast(message, type = "success") {
    if (typeof global.showToast === "function") {
      global.showToast(message, type);
      return;
    }
    const stack = document.querySelector("#toastStack");
    if (!stack) return;
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    const dot = document.createElement("i");
    const text = document.createElement("span");
    text.textContent = message;
    item.append(dot, text);
    stack.appendChild(item);
    setTimeout(() => item.classList.add("hide"), 2800);
    setTimeout(() => item.remove(), 3150);
  }

  function safeText(value, fallback = "—") {
    const text = String(value ?? "").trim();
    return text || fallback;
  }

  function safeFilename(value, fallback = "AliceSIM_Peripheral") {
    return safeText(value, fallback)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80) || fallback;
  }

  function setText(selector, value) {
    const node = query(selector);
    if (node) node.textContent = value;
  }

  function setBusy(busy, message = "") {
    state.busy = Boolean(busy);
    state.modal?.classList.toggle("is-busy", state.busy);
    queryAll("button, input, select").forEach(control => {
      if (control.matches(".modal-close")) return;
      control.disabled = state.busy || control.dataset.disabled === "true";
    });
    setText("[data-import-progress]", message);
    refreshActionState();
  }

  async function fetchJson(endpoint, payload) {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    let result = {};
    try {
      result = await response.json();
    } catch (_) {
      result = {};
    }
    if (!response.ok) throw new Error(result.detail || `请求失败（HTTP ${response.status}）`);
    return result;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunks = [];
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      let binary = "";
      for (let index = 0; index < chunk.length; index += 1) binary += String.fromCharCode(chunk[index]);
      chunks.push(binary);
    }
    return btoa(chunks.join(""));
  }

  function validatePdfFile(file) {
    if (!(file instanceof File)) throw new Error("请选择一个 PDF 文件");
    if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error("仅支持 .pdf 数据手册");
    if (file.type && file.type !== "application/pdf") throw new Error("文件类型不是 PDF");
    if (file.size <= 0) throw new Error("PDF 文件为空");
    if (file.size > MAX_PDF_BYTES) throw new Error("PDF 超过 24 MiB 上限");
  }

  async function readPdf(file) {
    validatePdfFile(file);
    const buffer = await file.arrayBuffer();
    const signature = new TextDecoder("ascii").decode(buffer.slice(0, 5));
    if (signature !== "%PDF-") throw new Error("文件头不符合 PDF 格式");
    return arrayBufferToBase64(buffer);
  }

  function collectHints() {
    const hints = {};
    queryAll("[data-datasheet-hint]").forEach(input => {
      const value = input.value.trim();
      if (value) hints[input.dataset.datasheetHint] = value;
    });
    return hints;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "—";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  }

  function selectFile(file) {
    try {
      validatePdfFile(file);
      state.file = file;
      state.draft = null;
      state.validation = null;
      state.handoffReady = false;
      setText("[data-selected-file]", `${file.name} · ${formatBytes(file.size)}`);
      query(".datasheet-import-dropzone")?.classList.add("has-file");
      setText("[data-import-error]", "");
      refreshActionState();
    } catch (error) {
      state.file = null;
      setText("[data-selected-file]", "尚未选择 PDF");
      setText("[data-import-error]", error.message || String(error));
      query(".datasheet-import-dropzone")?.classList.remove("has-file");
      refreshActionState();
    }
  }

  function createSummaryItem(label, value, tone = "") {
    const item = document.createElement("div");
    item.className = `datasheet-summary-item${tone ? ` ${tone}` : ""}`;
    const caption = document.createElement("span");
    caption.textContent = label;
    const content = document.createElement("strong");
    content.textContent = safeText(value);
    content.title = content.textContent;
    item.append(caption, content);
    return item;
  }

  function packageName(item) {
    if (typeof item === "string") return item;
    return item?.name || [item?.pinCount, item?.kind].filter(Boolean).join("-") || "未知封装";
  }

  function interfaceName(item) {
    if (typeof item === "string") return item;
    const details = [];
    if (Array.isArray(item?.addresses7Bit) && item.addresses7Bit.length) details.push(item.addresses7Bit.join(" / "));
    if (Number.isFinite(item?.maximumClockKHz)) details.push(`${item.maximumClockKHz} kHz`);
    return `${safeText(item?.kind, "未知接口")}${details.length ? ` · ${details.join(" · ")}` : ""}`;
  }

  function renderConfidence(draft) {
    const overall = Math.max(0, Math.min(1, Number(draft.confidence?.overallDraft) || 0));
    setText("[data-confidence-value]", `${Math.round(overall * 100)}%`);
    const meter = query("[data-confidence-meter]");
    if (meter) meter.style.setProperty("--confidence", `${Math.round(overall * 100)}%`);
    const list = query("[data-confidence-list]");
    if (!list) return;
    list.replaceChildren();
    Object.entries(CONFIDENCE_LABELS).forEach(([key, label]) => {
      const value = Math.max(0, Math.min(1, Number(draft.confidence?.[key]) || 0));
      const row = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = label;
      const bar = document.createElement("i");
      bar.style.setProperty("--confidence", `${Math.round(value * 100)}%`);
      const percent = document.createElement("b");
      percent.textContent = `${Math.round(value * 100)}%`;
      row.append(name, bar, percent);
      list.appendChild(row);
    });
  }

  function renderFacts(draft) {
    const summary = query("[data-draft-summary]");
    if (!summary) return;
    summary.replaceChildren(
      createSummaryItem("型号", draft.identity?.partNumber),
      createSummaryItem("厂商", draft.identity?.manufacturer),
      createSummaryItem("封装", (draft.packages || []).map(packageName).join("、")),
      createSummaryItem("逻辑引脚", `${draft.pins?.length || 0} 个`),
      createSummaryItem("接口", (draft.interfaces || []).map(item => safeText(item?.kind || item)).join(" / ")),
      createSummaryItem("寄存器", `${draft.registerMap?.count ?? draft.registerMap?.registers?.length ?? 0} 条`)
    );

    const interfaces = query("[data-interface-list]");
    interfaces?.replaceChildren();
    (draft.interfaces || []).forEach(item => {
      const chip = document.createElement("span");
      chip.textContent = interfaceName(item);
      interfaces?.appendChild(chip);
    });
    if (interfaces && !interfaces.childElementCount) interfaces.textContent = "未识别到接口";

    const conditions = draft.electrical?.recommendedOperatingConditions || [];
    const conditionText = conditions.slice(0, 4).map(item => {
      const range = [item.minimum, item.maximum].filter(value => String(value ?? "").trim()).join(" – ");
      return `${safeText(item.symbol || item.parameter, "工作条件")}: ${safeText(range)} ${safeText(item.unit, "")}`.trim();
    }).join("；");
    setText("[data-electrical-summary]", conditionText || "未识别推荐工作条件");
    setText("[data-simulation-scope]", `${safeText(draft.simulation?.scope)} · ${safeText(draft.simulation?.analogFidelity)}`);
    setText("[data-driver-files]", (draft.driver?.plannedFiles || []).join("；") || "尚无计划文件");
    setText("[data-source-summary]", `${safeText(draft.source?.filename)} · ${draft.source?.pageCount || 0} 页 · ${safeText(draft.source?.parser)}`);
  }

  function renderReviewMessages(draft) {
    const unresolved = draft.review?.unresolvedFields || [];
    const unresolvedBox = query("[data-unresolved-fields]");
    unresolvedBox?.replaceChildren();
    if (unresolved.length) {
      unresolved.forEach(field => {
        const tag = document.createElement("span");
        tag.textContent = safeText(field);
        unresolvedBox?.appendChild(tag);
      });
      query("[data-unresolved-wrap]")?.removeAttribute("hidden");
    } else {
      query("[data-unresolved-wrap]")?.setAttribute("hidden", "");
    }

    const warnings = query("[data-draft-warnings]");
    warnings?.replaceChildren();
    (draft.review?.warnings || []).forEach(message => {
      const item = document.createElement("li");
      item.textContent = safeText(message);
      warnings?.appendChild(item);
    });
  }

  function renderConfirmations(draft) {
    const list = query("[data-review-confirmations]");
    if (!list) return;
    list.replaceChildren();
    const required = Array.isArray(draft.review?.requiredConfirmations) ? draft.review.requiredConfirmations : [];
    const confirmed = new Set(Array.isArray(draft.review?.confirmedFields) ? draft.review.confirmedFields : []);
    required.forEach((path, index) => {
      const label = document.createElement("label");
      label.className = "datasheet-review-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = path;
      checkbox.checked = confirmed.has(path);
      checkbox.id = `datasheetConfirmation${index}`;
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = CONFIRMATION_LABELS[path] || path;
      const hint = document.createElement("small");
      hint.textContent = `确认字段：${path}`;
      text.append(title, hint);
      label.append(checkbox, text);
      list.appendChild(label);
    });
    list.addEventListener("change", updateConfirmedFields, { once: true });
  }

  function updateConfirmedFields() {
    if (!state.draft?.review) return;
    state.draft.review.confirmedFields = queryAll("[data-review-confirmations] input:checked").map(input => input.value);
    state.validation = null;
    state.handoffReady = false;
    renderValidation(null);
    refreshActionState();
    query("[data-review-confirmations]")?.addEventListener("change", updateConfirmedFields, { once: true });
  }

  function renderValidation(result) {
    const box = query("[data-validation-result]");
    if (!box) return;
    box.replaceChildren();
    box.className = "datasheet-validation-result";
    if (!result) {
      box.textContent = "勾选全部确认项后，由服务端再次校验草稿结构和安全约束。";
      return;
    }
    box.classList.add(result.installable ? "success" : result.ok ? "warning" : "error");
    const heading = document.createElement("strong");
    heading.textContent = result.installable
      ? "校验通过：可以进入驱动生成，当前仍未安装"
      : result.ok
        ? "结构校验通过，但仍有未解决项"
        : "草稿校验未通过";
    box.appendChild(heading);
    const issues = [...(result.errors || []), ...(result.warnings || [])];
    if (issues.length) {
      const list = document.createElement("ul");
      issues.forEach(issue => {
        const item = document.createElement("li");
        const fields = Array.isArray(issue.fields) && issue.fields.length ? `：${issue.fields.join("、")}` : "";
        item.textContent = `${safeText(issue.path, "草稿")}: ${safeText(issue.message)}${fields}`;
        list.appendChild(item);
      });
      box.appendChild(list);
    }
  }

  function renderDraft() {
    if (!state.draft) return;
    setStage("review");
    renderFacts(state.draft);
    renderConfidence(state.draft);
    renderReviewMessages(state.draft);
    renderConfirmations(state.draft);
    renderValidation(state.validation);
    refreshAiCapability();
    refreshActionState();
  }

  function setStage(stage) {
    state.stage = stage;
    query("[data-import-stage=upload]")?.toggleAttribute("hidden", stage !== "upload");
    query("[data-import-stage=review]")?.toggleAttribute("hidden", stage !== "review");
    query("[data-action=parse]")?.toggleAttribute("hidden", stage !== "upload");
    query("[data-action=change-file]")?.toggleAttribute("hidden", stage !== "review");
    query("[data-action=validate]")?.toggleAttribute("hidden", stage !== "review");
    query("[data-action=export]")?.toggleAttribute("hidden", stage !== "review" || !state.validation?.ok);
    query("[data-action=driver]")?.toggleAttribute("hidden", stage !== "review" || !state.validation?.installable);
    refreshActionState();
  }

  function confirmationsComplete() {
    const required = state.draft?.review?.requiredConfirmations || [];
    const confirmed = new Set(state.draft?.review?.confirmedFields || []);
    return required.length > 0 && required.every(path => confirmed.has(path));
  }

  function refreshActionState() {
    const parseButton = query("[data-action=parse]");
    if (parseButton) parseButton.disabled = state.busy || !state.file;
    const validateButton = query("[data-action=validate]");
    if (validateButton) validateButton.disabled = state.busy || !confirmationsComplete();
    const exportButton = query("[data-action=export]");
    if (exportButton) exportButton.disabled = state.busy || !state.validation?.ok;
    const driverButton = query("[data-action=driver]");
    if (driverButton) driverButton.disabled = state.busy || !state.validation?.installable;
    const aiButton = query("[data-action=ai-review]");
    const aiAvailable = typeof global.AliceDatasheetAI?.reviewDraft === "function";
    if (aiButton) {
      aiButton.disabled = state.busy || !aiAvailable || !state.draft;
      aiButton.dataset.disabled = String(!aiAvailable);
      aiButton.title = aiAvailable ? "复核低置信字段" : "未配置 AI 复核接口；可使用专用 Skill 审查导出的草稿";
    }
  }

  async function parseFile(file = state.file) {
    if (!state.modal) open();
    try {
      setBusy(true, "正在本地提取 PDF 文本、表格和寄存器……");
      setText("[data-import-error]", "");
      const pdfBase64 = await readPdf(file);
      const result = await fetchJson(PARSE_ENDPOINT, {
        filename: file.name,
        pdfBase64,
        hints: collectHints()
      });
      if (result.kind !== "AliceSIMPeripheralDraft") throw new Error("服务返回的不是 AliceSIM 器件草稿");
      state.file = file;
      state.draft = result;
      state.validation = null;
      state.handoffReady = false;
      renderDraft();
      toast(`说明书解析完成 · 置信度 ${Math.round((Number(result.confidence?.overallDraft) || 0) * 100)}%`);
      return clone(result);
    } catch (error) {
      setText("[data-import-error]", error.message || String(error));
      toast(`说明书解析失败：${error.message || error}`, "error");
      return null;
    } finally {
      setBusy(false, "");
    }
  }

  async function validateDraft() {
    if (!state.draft) return null;
    if (!confirmationsComplete()) {
      toast("请先完成全部人工确认项", "warning");
      return null;
    }
    try {
      setBusy(true, "正在校验草稿结构、确认项和安全边界……");
      const result = await fetchJson(VALIDATE_ENDPOINT, { draft: state.draft });
      state.validation = result;
      renderValidation(result);
      setStage("review");
      if (result.installable) toast("草稿校验通过，可以进入驱动生成阶段");
      else toast("草稿仍有需要处理的字段", "warning");
      return clone(result);
    } catch (error) {
      state.validation = { ok: false, installable: false, errors: [{ path: "request", message: error.message || String(error) }], warnings: [] };
      renderValidation(state.validation);
      setStage("review");
      toast(`草稿校验失败：${error.message || error}`, "error");
      return clone(state.validation);
    } finally {
      setBusy(false, "");
    }
  }

  async function reviewWithAi() {
    const reviewer = global.AliceDatasheetAI?.reviewDraft;
    if (typeof reviewer !== "function" || !state.draft) return;
    try {
      setBusy(true, "正在请求 AI 复核低置信字段……");
      const result = await reviewer(clone(state.draft));
      const reviewedDraft = result?.draft || result;
      if (reviewedDraft?.kind !== "AliceSIMPeripheralDraft") throw new Error("AI 复核接口没有返回有效草稿");
      reviewedDraft.review = reviewedDraft.review || {};
      reviewedDraft.review.confirmedFields = [];
      state.draft = reviewedDraft;
      state.validation = null;
      state.handoffReady = false;
      renderDraft();
      toast("AI 复核结果已载入，请重新人工确认");
    } catch (error) {
      toast(`AI 复核失败：${error.message || error}`, "error");
    } finally {
      setBusy(false, "");
    }
  }

  function exportDraft() {
    if (!state.draft || !state.validation?.ok) return;
    const payload = {
      kind: "AliceSIMReviewedPeripheralDraft",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      validation: state.validation,
      draft: state.draft
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFilename(state.draft.identity?.partNumber)}.alice-peripheral-draft.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast("已导出经校验的器件草稿");
  }

  async function enterDriverGeneration() {
    if (!state.draft || !state.validation?.installable) return;
    const handoff = {
      source: "datasheet-import",
      requestedAt: new Date().toISOString(),
      draft: clone(state.draft),
      validation: clone(state.validation)
    };
    try {
      sessionStorage.setItem(REVIEWED_DRAFT_STORAGE, JSON.stringify(handoff));
    } catch (_) {
      // The event and optional generator hook still provide the handoff.
    }
    global.dispatchEvent(new CustomEvent("alicesim:datasheet-driver-generation", { detail: handoff }));
    if (typeof global.AliceDatasheetDriverGenerator?.open === "function") {
      await global.AliceDatasheetDriverGenerator.open(handoff);
      return;
    }
    state.handoffReady = true;
    const box = query("[data-validation-result]");
    if (box) {
      box.className = "datasheet-validation-result success";
      box.replaceChildren();
      const heading = document.createElement("strong");
      heading.textContent = "驱动生成交接已准备";
      const note = document.createElement("p");
      note.textContent = "草稿已保存到会话并发出生成事件。当前未配置生成器，可导出草稿后交给专用 Skill 生成 STM32 HAL 文件并运行测试。";
      box.append(heading, note);
    }
    toast("已进入驱动生成交接；当前没有自动生成器", "warning");
  }

  function refreshAiCapability() {
    const available = typeof global.AliceDatasheetAI?.reviewDraft === "function";
    const status = query("[data-capability=ai]");
    if (status) {
      status.classList.toggle("available", available);
      status.querySelector("strong").textContent = available ? "AI 复核：可用" : "AI 复核：未配置";
      status.querySelector("small").textContent = available ? "仅复核低置信字段，结果仍需人工确认" : "可通过专用 Skill 或 AliceDatasheetAI.reviewDraft 接入";
    }
    refreshActionState();
  }

  async function refreshLocalCapability() {
    const status = query("[data-capability=local]");
    if (!status) return;
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const health = await response.json();
      const capability = health.datasheetImport || null;
      state.capabilities = capability;
      const available = Boolean(response.ok && capability?.available);
      status.classList.toggle("available", available);
      status.classList.toggle("unavailable", !available);
      status.querySelector("strong").textContent = available ? "本地解析器：可用" : "本地解析器：不可用";
      status.querySelector("small").textContent = available
        ? `${safeText(capability.engine)}${capability.tableExtraction ? " · 支持表格" : ""}`
        : safeText(capability?.detail, "请检查 PDF 解析依赖");
    } catch (error) {
      state.capabilities = null;
      status.classList.add("unavailable");
      status.querySelector("strong").textContent = "本地解析器：连接失败";
      status.querySelector("small").textContent = error.message || String(error);
    }
  }

  function createModal() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop datasheet-import-backdrop";
    backdrop.id = "datasheetImportModal";
    backdrop.innerHTML = `
      <div class="modal datasheet-import-modal" role="dialog" aria-modal="true" aria-labelledby="datasheetImportTitle">
        <button class="modal-close" type="button" aria-label="关闭导入说明书">×</button>
        <div class="datasheet-import-heading">
          <span class="modal-eyebrow">DATASHEET TO COMPONENT DRAFT</span>
          <h2 id="datasheetImportTitle">导入外设说明书</h2>
          <p>从 PDF 生成带证据和置信度的器件草稿。人工确认与服务端校验通过后，才能进入驱动生成；这里不会直接安装器件。</p>
        </div>
        <div class="datasheet-capabilities" aria-label="导入能力状态">
          <div data-capability="local"><i></i><span><strong>本地解析器：检查中</strong><small>正在读取服务能力</small></span></div>
          <div data-capability="ai"><i></i><span><strong>AI 复核：未配置</strong><small>可通过专用 Skill 或前端复核接口接入</small></span></div>
        </div>
        <div class="datasheet-import-scroll">
          <section data-import-stage="upload">
            <input type="file" accept=".pdf,application/pdf" data-pdf-input hidden />
            <button class="datasheet-import-dropzone" type="button" data-select-pdf>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v16H6Z"/><path d="M14 2v5h5M9 13h6M9 17h6M9 9h2"/></svg>
              <span><strong>选择或拖入 PDF 数据手册</strong><small data-selected-file>尚未选择 PDF</small></span>
            </button>
            <div class="datasheet-hints">
              <label><span>型号提示（可选）</span><input type="text" maxlength="80" data-datasheet-hint="partNumber" placeholder="例如 CS43131" /></label>
              <label><span>厂商提示（可选）</span><input type="text" maxlength="120" data-datasheet-hint="manufacturer" placeholder="例如 Cirrus Logic" /></label>
              <label><span>封装提示（可选）</span><input type="text" maxlength="80" data-datasheet-hint="package" placeholder="例如 42-WLCSP" /></label>
              <label><span>接口提示（可选）</span><input type="text" maxlength="40" data-datasheet-hint="interface" placeholder="I2C / SPI / UART" /></label>
            </div>
            <p class="datasheet-import-safety">PDF 被视为不可信输入：不会执行其中的脚本、附件、链接或命令。单个文件上限 24 MiB。</p>
            <p class="datasheet-import-error" data-import-error role="alert"></p>
          </section>
          <section data-import-stage="review" hidden>
            <div class="datasheet-source-line"><span>解析来源</span><strong data-source-summary>—</strong></div>
            <div class="datasheet-import-summary" data-draft-summary></div>
            <div class="datasheet-confidence">
              <div class="datasheet-confidence-head"><span>草稿总体置信度</span><strong data-confidence-value>0%</strong></div>
              <div class="datasheet-confidence-meter" data-confidence-meter><i></i></div>
              <div class="datasheet-confidence-list" data-confidence-list></div>
            </div>
            <div class="datasheet-detail-grid">
              <article><span>接口与地址</span><div class="datasheet-chip-list" data-interface-list></div></article>
              <article><span>推荐工作条件</span><p data-electrical-summary>—</p></article>
              <article><span>建议仿真范围</span><p data-simulation-scope>—</p></article>
              <article><span>计划生成文件</span><p data-driver-files>—</p></article>
            </div>
            <div class="datasheet-unresolved" data-unresolved-wrap hidden>
              <strong>仍需补充的字段</strong><div data-unresolved-fields></div>
            </div>
            <div class="datasheet-draft-warning">
              <strong>安全与精度提示</strong><ul data-draft-warnings></ul>
            </div>
            <div class="datasheet-review-head">
              <span><strong>人工确认</strong><small>逐项核对 PDF 原文后勾选，确认项由服务端控制</small></span>
              <button type="button" data-action="ai-review">AI 复核低置信项</button>
            </div>
            <div class="datasheet-review-list" data-review-confirmations></div>
            <div class="datasheet-validation-result" data-validation-result aria-live="polite"></div>
          </section>
        </div>
        <footer class="datasheet-import-actions">
          <span data-import-progress aria-live="polite"></span>
          <button type="button" class="datasheet-secondary" data-action="change-file" hidden>更换 PDF</button>
          <button type="button" class="modal-primary" data-action="parse" disabled>解析说明书</button>
          <button type="button" class="modal-primary" data-action="validate" hidden disabled>校验草稿</button>
          <button type="button" class="datasheet-secondary" data-action="export" hidden>导出草稿</button>
          <button type="button" class="modal-primary" data-action="driver" hidden>进入驱动生成</button>
        </footer>
      </div>`;

    backdrop.addEventListener("click", event => {
      if (event.target === backdrop || event.target.closest(".modal-close")) close();
    });
    const input = query("[data-pdf-input]", backdrop);
    query("[data-select-pdf]", backdrop)?.addEventListener("click", () => input?.click());
    input?.addEventListener("change", () => selectFile(input.files?.[0]));
    const dropzone = query(".datasheet-import-dropzone", backdrop);
    ["dragenter", "dragover"].forEach(name => dropzone?.addEventListener(name, event => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    }));
    ["dragleave", "drop"].forEach(name => dropzone?.addEventListener(name, event => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    }));
    dropzone?.addEventListener("drop", event => selectFile(event.dataTransfer?.files?.[0]));
    query("[data-action=parse]", backdrop)?.addEventListener("click", () => parseFile());
    query("[data-action=validate]", backdrop)?.addEventListener("click", validateDraft);
    query("[data-action=ai-review]", backdrop)?.addEventListener("click", reviewWithAi);
    query("[data-action=export]", backdrop)?.addEventListener("click", exportDraft);
    query("[data-action=driver]", backdrop)?.addEventListener("click", enterDriverGeneration);
    query("[data-action=change-file]", backdrop)?.addEventListener("click", () => {
      setStage("upload");
      input?.focus();
    });
    return backdrop;
  }

  function handleEscape(event) {
    if (event.key === "Escape" && state.modal) close();
  }

  function open() {
    if (state.modal?.isConnected) {
      state.modal.classList.add("open");
      return state.modal;
    }
    state.modal = createModal();
    document.body.appendChild(state.modal);
    if (state.file) {
      setText("[data-selected-file]", `${state.file.name} · ${formatBytes(state.file.size)}`);
      query(".datasheet-import-dropzone")?.classList.add("has-file");
    }
    if (state.draft) renderDraft();
    else setStage("upload");
    refreshAiCapability();
    refreshLocalCapability();
    document.addEventListener("keydown", handleEscape);
    requestAnimationFrame(() => {
      state.modal?.classList.add("open");
      setTimeout(() => query("[data-select-pdf]")?.focus(), 60);
    });
    return state.modal;
  }

  function close() {
    if (!state.modal) return;
    const closing = state.modal;
    state.modal = null;
    closing.classList.remove("open");
    document.removeEventListener("keydown", handleEscape);
    setTimeout(() => closing.remove(), 180);
  }

  function getState() {
    return {
      file: state.file ? { name: state.file.name, size: state.file.size, type: state.file.type } : null,
      draft: clone(state.draft),
      validation: clone(state.validation),
      capabilities: clone(state.capabilities),
      stage: state.stage,
      busy: state.busy,
      handoffReady: state.handoffReady
    };
  }

  global.AliceDatasheetImport = { open, close, parseFile, validateDraft, getState };
})(typeof window !== "undefined" ? window : null);
