(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const root = new URL("./", location.href);
  const markdown = window.AliceTutorialMarkdown;
  const texts = new Map();
  let lessons = [], projects = [], current = null, generation = 0, loadedId = null;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  async function get(url, json = false) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return json ? response.json() : response.text();
  }

  function setMenu(open) {
    $("sidebar").classList.toggle("is-open", open);
    $("menuToggle").setAttribute("aria-expanded", String(open));
    $("menuToggle").setAttribute("aria-label", open ? "收起教程目录" : "展开教程目录");
  }

  function renderNavigation() {
    const query = $("search").value.trim().toLocaleLowerCase();
    const filtered = lessons.filter(lesson => [lesson.title, lesson.group, lesson.summary, ...(lesson.tags || [])].join(" ").toLocaleLowerCase().includes(query));
    const fragment = document.createDocumentFragment();
    for (const group of new Set(filtered.map(lesson => lesson.group))) {
      const details = element("details", "nav-group");
      details.open = true;
      details.append(element("summary", "", group));
      for (const lesson of filtered.filter(item => item.group === group)) {
        const link = element("a", "nav-link");
        link.href = `#${lesson.id}`;
        if (lesson.id === current?.id) link.setAttribute("aria-current", "page");
        link.append(element("span", "nav-num", String(lessons.indexOf(lesson) + 1).padStart(2, "0")), element("span", "", lesson.title));
        details.append(link);
      }
      fragment.append(details);
    }
    $("navigation").replaceChildren(fragment);
    $("searchStatus").textContent = query ? `找到 ${filtered.length} 篇教程` : "";
  }

  function showError(message) {
    loadedId = null;
    $("lessonContent").hidden = true;
    $("contents").replaceChildren();
    const status = $("lessonStatus");
    status.hidden = false;
    status.classList.add("error");
    status.replaceChildren(element("p", "", message));
    const retry = element("button", "action-link", "重试");
    retry.addEventListener("click", () => lessons.length ? route() : initialize());
    const start = element("a", "action-link", "回到教程首页");
    start.href = "#start";
    status.append(retry, document.createTextNode(" "), start);
  }

  function downloadLink(path, label, primary = false) {
    const link = element("a", `action-link${primary ? " primary" : ""}`, label);
    link.href = new URL(path, root).href;
    link.download = path.split("/").pop();
    return link;
  }

  function renderExample(lesson) {
    const container = $("exampleActions");
    container.replaceChildren();
    const project = projects.find(item => item.id === lesson.project);
    container.hidden = !project;
    if (!project) return;
    const row = element("div", "action-row");
    row.append(downloadLink(project.project, "下载完整工程 · JSON", true), downloadLink(project.download, "源码与电路 · ZIP"));
    container.append(element("p", "example-caption", `配套工程 ${project.id} · ${project.title}`), row,
      element("p", "action-note", "下载 JSON 后，在工作台选择“项目 → 打开 IOC / 工程包”。ZIP 内含源码、IOC、电路与同一工程包；本页只读教程，不会替换你正在编辑的项目。"));
    const details = element("details", "source-preview");
    const summary = element("summary", "", "查看本例 main.c");
    const pre = element("pre");
    const code = element("code", "", "正在读取源码…");
    pre.append(code);
    details.append(summary, pre);
    let pending = false, ready = false;
    details.addEventListener("toggle", async () => {
      if (!details.open || pending || ready) return;
      pending = true;
      try {
        code.textContent = await get(new URL(project.main, root));
        ready = true;
      } catch (_) {
        code.textContent = "源码暂时无法读取，请检查本地服务；收起后重新展开可重试。也可下载 ZIP 查看。";
      } finally { pending = false; }
    });
    container.append(details);
  }

  function renderPagination(index) {
    const nodes = [];
    for (const [offset, caption] of [[-1, "上一篇"], [1, "下一篇"]]) {
      const lesson = lessons[index + offset];
      if (!lesson) continue;
      const link = element("a", `page-link${offset === 1 ? " next" : ""}`);
      link.href = `#${lesson.id}`;
      link.append(element("small", "", caption), element("span", "", lesson.title));
      nodes.push(link);
    }
    $("pagination").replaceChildren(...nodes);
  }

  function moveTo(section, focus = false) {
    const target = section ? document.getElementById(section) : $("lesson");
    if (target) target.scrollIntoView({ block: "start" });
    if (focus) $("lesson").focus({ preventScroll: true });
  }

  async function route() {
    // The accessibility skip link stays within the currently open article.
    if (location.hash === "#lesson") { $("lesson").focus(); return; }
    const [id = "start", section] = location.hash.slice(1).split("/");
    const lesson = lessons.find(item => item.id === (id || "start"));
    const request = ++generation;
    setMenu(false);
    current = lesson || null;
    renderNavigation();
    if (!lesson) { showError("没有找到这篇教程。请从左侧目录选择，或回到首页。"); return; }
    if (loadedId === lesson.id) { moveTo(section); return; }
    loadedId = null;
    const status = $("lessonStatus");
    status.hidden = false;
    status.classList.remove("error");
    status.textContent = "正在打开教程…";
    $("lessonContent").hidden = true;
    $("contents").replaceChildren();
    try {
      const lessonUrl = new URL(lesson.path, root);
      if (!texts.has(lesson.id)) texts.set(lesson.id, await get(lessonUrl));
      if (request !== generation) return;
      const rendered = markdown.render(texts.get(lesson.id), lessonUrl.href);
      $("article").innerHTML = rendered.html;
      $("lessonTitle").textContent = lesson.title;
      $("lessonSummary").textContent = lesson.summary;
      $("breadcrumb").textContent = `教程与例程 / ${lesson.group}`;
      $("lessonLabel").textContent = `第 ${String(lessons.indexOf(lesson) + 1).padStart(2, "0")} 篇 · ${lesson.group}`;
      document.title = `${lesson.title} · AliceSIM 教程`;
      renderExample(lesson);
      renderPagination(lessons.indexOf(lesson));
      $("contents").replaceChildren(...rendered.headings.map(heading => {
        const link = element("a", heading.level > 2 ? "subheading" : "", heading.text);
        link.href = `#${lesson.id}/${heading.id}`;
        return link;
      }));
      loadedId = lesson.id;
      $("lessonContent").hidden = false;
      status.hidden = true;
      moveTo(section, true);
    } catch (_) {
      if (request === generation) showError("这篇教程暂时无法读取。请检查本地服务后重试；也可直接在 tutorials/lessons 中阅读 Markdown 文件。");
    }
  }

  $("menuToggle").addEventListener("click", () => setMenu(!$("sidebar").classList.contains("is-open")));
  $("search").addEventListener("input", renderNavigation);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") { setMenu(false); $("menuToggle").focus(); }
  });
  if (window.parent && window.parent !== window) {
    $("backApp").textContent = "关闭教程，返回工作台";
    $("backApp").addEventListener("click", event => {
      event.preventDefault();
      window.parent.postMessage({ type: "alicesim:tutorial-close" }, location.origin === "null" ? "*" : location.origin);
    });
  }
  document.addEventListener("click", event => {
    if (!$("sidebar").contains(event.target) && !$("menuToggle").contains(event.target)) setMenu(false);
    const link = event.target.closest('a[href^="#"]');
    if (link?.getAttribute("href") === location.hash && location.hash !== "#lesson") route();
  });
  $("article").addEventListener("click", async event => {
    const button = event.target.closest(".copy-code");
    if (!button || button.disabled) return;
    const code = button.closest(".code-block").querySelector("code").textContent;
    button.disabled = true;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
      else {
        const field = element("textarea");
        field.value = code;
        field.style.cssText = "position:fixed;left:-10000px;top:0";
        document.body.append(field);
        field.select();
        let copied = false;
        try { copied = document.execCommand("copy"); } finally { field.remove(); }
        if (!copied) throw new Error("Copy failed");
      }
      button.textContent = "已复制";
    } catch (_) { button.textContent = "未复制，请选中代码复制"; }
    finally { button.disabled = false; }
  });
  window.addEventListener("hashchange", () => { if (lessons.length) route(); });

  async function initialize() {
    try {
      const [catalog, manifest] = await Promise.all([get(new URL("catalog.json", root), true), get(new URL("example-manifest.json", root), true)]);
      if (!Array.isArray(catalog.lessons) || !Array.isArray(manifest.projects) || !markdown) throw new Error("Invalid tutorial data");
      lessons = catalog.lessons;
      projects = manifest.projects;
      await route();
    } catch (_) { showError("教程目录未能加载。请通过 AliceSIM 本地服务打开 tutorials/，不要直接双击 HTML 文件。启动服务后点击重试。"); }
  }
  initialize();
})();
