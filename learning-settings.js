(function (root) {
  "use strict";
  const document = root.document;
  if (!document) return;
  const $ = id => document.getElementById(id);
  let dialog, current = null, pending = null, sequence = 0, busy = "";
  function notice(message, kind = "") {
    $("learningSettingsNotice").textContent = message;
    $("learningSettingsNotice").dataset.kind = kind;
  }
  function setBusy(value) {
    busy = value;
    $("learningSettingsFields").disabled = Boolean(value) || !current;
    $("learningSettingsSave").disabled = Boolean(value) || !current;
    $("learningSettingsTest").disabled = Boolean(value) || !current;
    $("learningSettingsSave").textContent = value === "save" ? "保存中…" : "保存并生效";
    $("learningSettingsTest").textContent = value === "test" ? "连接中…" : "测试连接";
    $("learningSettingsClose").disabled = value === "save";
    $("learningSettingsDone").disabled = value === "save";
    dialog.setAttribute("aria-busy", String(Boolean(value)));
  }
  function updateKeyHint() {
    const moved = current?.hasKey && $("learningModelUrl").value.trim() !== current.url;
    $("learningModelKey").disabled = $("learningModelClearKey").checked;
    $("learningModelKeyHint").textContent = $("learningModelClearKey").checked ? "保存后移除已存密钥，适用于无需认证的本机服务。"
      : moved ? "接口地址已变化：请重新填写密钥，或勾选清除原密钥。"
      : current?.hasKey ? "已保存密钥。留空可保留原值；输入新值可替换。" : "填入服务商提供的密钥；无需认证的本机服务可留空。";
  }
  function populate(value) {
    current = value;
    $("learningModelUrl").value = value.url || "";
    $("learningModelName").value = value.model || "";
    $("learningModelKey").value = "";
    $("learningModelKey").placeholder = value.hasKey ? "已保存，留空保留" : "输入 API Key";
    $("learningModelClearKey").checked = false;
    $("learningModelTools").checked = value.tools !== false;
    $("learningSettingsSource").textContent = value.source === "saved" ? "当前使用本机保存的配置" : value.configured ? "当前使用启动环境配置；保存后以本机设置为准" : "连接你自己的模型服务";
    updateKeyHint();
  }
  async function request(path, options, signal) {
    const response = await (root.AlicePlatform?.fetch || root.fetch.bind(root))(path, { cache: "no-store", ...options, signal });
    if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("当前后端尚未提供模型设置接口，请重启更新后的 AliceSIM 服务。");
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.detail || "无法处理模型设置");
    return data;
  }
  async function open() {
    mount();
    if (dialog.open) return;
    $("settingsModal")?.classList.remove("open");
    $("learningSettingsForm").reset(); current = null;
    dialog.showModal(); setBusy("load"); notice("正在读取模型设置…");
    const token = ++sequence;
    const controller = new AbortController(); pending = controller;
    const timer = root.setTimeout(() => controller.abort(), 12000);
    try {
      const data = await request("/api/learning/config", {}, controller.signal);
      if (token !== sequence) return;
      populate(data); notice(data.configured ? "修改后点击保存即可生效，无需重启。" : data.detail);
    } catch (error) {
      if (token === sequence) notice(error.name === "AbortError" ? "读取配置超时，请关闭后重新打开。" : error.message, "error");
    } finally {
      root.clearTimeout(timer);
      if (token === sequence) { pending = null; setBusy(""); }
    }
  }
  function draft() {
    const key = $("learningModelKey").value.trim();
    const clear = $("learningModelClearKey").checked;
    const url = $("learningModelUrl").value.trim();
    if (current.hasKey && url !== current.url && !key && !clear) throw new Error("接口地址已变化，请重新填写密钥，或勾选清除原密钥。");
    return { url, model: $("learningModelName").value.trim(), key: clear ? "" : key,
      keyAction: clear ? "clear" : key ? "replace" : "keep", tools: $("learningModelTools").checked };
  }
  async function submit(mode) {
    if (busy || !current || !$("learningSettingsForm").reportValidity()) return;
    let payload;
    try { payload = draft(); } catch (error) { notice(error.message, "error"); return; }
    const token = ++sequence;
    const controller = new AbortController(); pending = controller;
    setBusy(mode); notice(mode === "test" ? "正在发送简短测试请求…" : "正在保存…");
    const timer = root.setTimeout(() => controller.abort(), mode === "test" ? 25000 : 12000);
    try {
      const data = await request(mode === "test" ? "/api/learning/test" : "/api/learning/config", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      }, controller.signal);
      if (token !== sequence) return;
      if (mode === "save") {
        populate(data);
        notice("已保存并生效，后续提问使用此配置。", "success");
        document.dispatchEvent(new CustomEvent("alice:learning-configured"));
      } else notice(`连接成功 · ${data.latencyMs} ms。测试不会保存设置。`, "success");
    } catch (error) {
      if (token === sequence) notice(error.name === "AbortError" ? mode === "save" ? "未能确认保存结果，请重新打开设置检查。" : "连接测试超时，请检查接口和网络。" : error.message, "error");
    } finally {
      root.clearTimeout(timer);
      if (token === sequence) { pending = null; setBusy(""); }
    }
  }
  function mount() {
    if (dialog) return;
    dialog = document.createElement("dialog"); dialog.id = "learningSettingsDialog"; dialog.className = "learning-settings";
    dialog.setAttribute("aria-labelledby", "learningSettingsTitle");
    dialog.innerHTML = `<header class="learning-settings-heading"><div><small>ALICE / MODEL</small><h2 id="learningSettingsTitle">模型设置</h2><p id="learningSettingsSource">连接你自己的模型服务</p></div><button type="button" id="learningSettingsClose" aria-label="关闭模型设置">×</button></header>
      <form id="learningSettingsForm" autocomplete="off">
        <fieldset id="learningSettingsFields" disabled>
          <label class="learning-setting-field" for="learningModelUrl">接口地址<span>完整 Chat Completions URL</span><input id="learningModelUrl" type="url" required maxlength="2048" placeholder="https://服务商地址/v1/chat/completions" spellcheck="false" autocomplete="off"><small>支持兼容接口；本机模型可使用 http://127.0.0.1:端口/v1/chat/completions。</small></label>
          <label class="learning-setting-field" for="learningModelName">模型名称<span>Model ID</span><input id="learningModelName" type="text" required maxlength="200" placeholder="填写服务商提供的模型 ID" spellcheck="false" autocomplete="off"></label>
          <label class="learning-setting-field" for="learningModelKey">API 密钥<span>API Key</span><input id="learningModelKey" type="password" maxlength="4096" placeholder="输入 API Key" autocomplete="new-password" spellcheck="false" aria-describedby="learningModelKeyHint"><small id="learningModelKeyHint"></small></label>
          <label class="learning-setting-check learning-clear-key"><input id="learningModelClearKey" type="checkbox"><span>清除原密钥（无需认证时）</span></label>
          <label class="learning-setting-check learning-tools-check"><input id="learningModelTools" type="checkbox" checked><span><strong>启用工具调用</strong><small>用于结构化的画圈、定位和讲义。模型不支持时可关闭，改用 JSON / 文本响应。</small></span></label>
        </fieldset>
        <p class="learning-settings-storage">设置保存在运行服务的本机用户目录，密钥不进入工程文件。测试连接会发送少量请求，可能计费；不会发送工程内容。</p>
        <p id="learningSettingsNotice" role="status" aria-live="polite"></p>
        <footer><button type="button" id="learningSettingsTest">测试连接</button><div><button type="button" id="learningSettingsDone">关闭</button><button type="submit" id="learningSettingsSave">保存并生效</button></div></footer>
      </form>`;
    document.body.append(dialog);
    $("learningSettingsForm").addEventListener("submit", event => { event.preventDefault(); submit("save"); });
    $("learningSettingsTest").addEventListener("click", () => submit("test"));
    for (const id of ["learningSettingsClose", "learningSettingsDone"]) $(id).addEventListener("click", () => dialog.close());
    for (const id of ["learningModelUrl", "learningModelClearKey"]) $(id).addEventListener("input", updateKeyHint);
    dialog.addEventListener("cancel", event => { if (busy === "save") event.preventDefault(); });
    dialog.addEventListener("close", () => { sequence++; pending?.abort(); pending = null; $("learningModelKey").value = ""; });
  }
  root.AliceLearningSettings = Object.freeze({ open });
  $("modelSettingsButton")?.addEventListener("click", open);
}(window));
