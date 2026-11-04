/* Optional real-browser regression: ALICESIM_PLAYWRIGHT_PATH selects an installed Playwright package. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.ALICESIM_PLAYWRIGHT_PATH || "playwright");
const base = process.env.ALICESIM_QA_URL || "http://127.0.0.1:4325";

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.locator("#bootScreen").waitFor({ state: "hidden" });
    await page.locator("#learningAssistantButton").click();
    await page.waitForFunction(() => document.getElementById("learningProvider").textContent.includes("尚未"));
    assert.equal(await page.locator("#learningSend").isDisabled(), true);
    const project = JSON.parse(await fs.readFile(path.join(__dirname, "../tutorials/projects/Learning02_Servo.alice.json"), "utf8"));
    await page.evaluate(async p => {
      await window.AliceProjectWorkspace.loadFiles(p.files, p.project.name);
      if (p.circuit) window.AliceSchematic.importCircuit(p.circuit);
    }, project);
    await page.locator("#learningTargetDetails summary").click();
    const target = await page.evaluate(() => window.AliceLearningAssistant.capture().targets.find(t => t.kind === "component"));
    assert.ok(target);
    await page.locator("#learningTarget").selectOption(target.id);
    await page.locator("#learningMark").click();
    await page.locator(".learning-overlay ellipse").waitFor();
    assert.equal(await page.locator(".learning-overlay").evaluate(el => getComputedStyle(el).pointerEvents), "none");
    const before = await page.locator(".learning-overlay ellipse").getAttribute("rx");
    await page.locator("#zoomIn").click();
    await page.waitForFunction(old => document.querySelector(".learning-overlay ellipse")?.getAttribute("rx") !== old, before);
    assert.equal(await page.locator(".learning-overlay ellipse").count(), 1);
    // The annotation follows an actual world transform rather than stale screenshot coordinates.
    const matching = await page.evaluate(id => {
      const component = [...document.querySelectorAll(".schematic-component")].find(el => el.dataset.componentId === id);
      const r = component.getBoundingClientRect(), viewport = document.getElementById("schematicViewport").getBoundingClientRect();
      const ellipse = document.querySelector(".learning-overlay ellipse");
      const left = Math.max(r.left, viewport.left), right = Math.min(r.right, viewport.right);
      return Math.abs(Number(ellipse.getAttribute("cx")) - (left + right) / 2) < 2;
    }, target.componentId);
    assert.equal(matching, true);
    await page.locator("#learningClearMarks").click();
    assert.equal(await page.locator(".learning-overlay ellipse").count(), 0);

    const codeTarget = await page.evaluate(() => {
      const editor = document.getElementById("codeEditor");
      const start = editor.value.indexOf("\n") + 1;
      editor.setSelectionRange(start, editor.value.indexOf("\n", start));
      const captured = window.AliceLearningAssistant.capture();
      return captured.targets.find(t => t.kind === "code" && t.path === captured.activeFile);
    });
    await page.locator("#learningTarget").selectOption(codeTarget.id);
    await page.locator("#learningStyle").selectOption("highlight");
    await page.locator("#learningMark").click();
    await page.locator(".learning-overlay .learning-highlight").waitFor();
    assert.equal(await page.evaluate(() => document.body.dataset.appPage), "code");
    assert.ok(Number(await page.locator(".learning-overlay .learning-highlight").getAttribute("height")) < 30);
    await page.locator("#learningClearMarks").click();

    const documents = page.locator(".learning-details").filter({ hasText: "讲义与记录" });
    await documents.locator("summary").click();
    await page.locator("#learningQuestion").fill("解释 PWM 调节与舵机的关系");
    await page.locator("#learningLocalRecord").click();
    await page.locator("#learningHandout[open]").waitFor();
    assert.ok((await page.frameLocator("#learningHandoutFrame").locator("body").innerText()).includes("尚未由 AI 分析"));
    assert.ok(await page.frameLocator("#learningHandoutFrame").locator("svg").count());
    await page.locator("#learningHandoutClose").click();
    assert.equal(await page.evaluate(() => window.AliceLearningAssistant.exportState().handouts.length), 1);

    // Exercise the real UI with a deterministic provider boundary, not a fake production AI.
    await page.route("**/api/learning/status", route => route.fulfill({ json: { configured: true, model: "QA fixture", detail: "本地测试" } }));
    let pending = null, pendingReady = null, requestCount = 0;
    await page.route("**/api/learning/respond", async route => {
      const body = route.request().postDataJSON(); requestCount++;
      if (body.question.startsWith("等待")) { pending = { route, body }; pendingReady?.(); return; }
      const pin = body.context.targets.find(t => t.kind === "pin");
      await route.fulfill({ json: { ok: true, revision: body.context.revision, guidance: {
        message: "这是基于工程快照的测试说明。<script>window.__injected=1</script>",
        annotations: [{ targetId: pin.id, style: "arrow", label: "检查这个端子" }],
        handout: { title: "PWM 学习讲义", sections: [{ heading: "观察", body: "先核对配置，再观察波形。" }], exercises: ["改变参数后会怎样？"] }
      } } });
    });
    await page.locator("#learningRefreshStatus").click();
    await page.waitForFunction(() => !document.getElementById("learningSend").disabled);
    await page.locator("#learningSend").click();
    await page.locator("#learningHandout[open]").waitFor();
    await page.locator("#learningHandoutClose").click();
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    assert.equal(await page.evaluate(() => window.AliceLearningAssistant.exportState().handouts.length), 2);
    assert.ok((await page.locator("#learningMessages").innerText()).includes("<script>"));

    await page.locator("#learningQuestion").fill("等待过期测试");
    const staleReady = new Promise(resolve => { pendingReady = resolve; });
    await page.locator("#learningSend").click();
    await staleReady;
    await page.evaluate(() => { const e = document.getElementById("codeEditor"); e.value += "\n// changed"; e.dispatchEvent(new Event("input", { bubbles: true })); });
    if (pending) { const old = pending; pending = null; await old.route.fulfill({ json: { ok: true, revision: old.body.context.revision, guidance: { message: "不该显示的旧回答" } } }).catch(() => {}); }
    assert.equal((await page.locator("#learningMessages").innerText()).includes("不该显示的旧回答"), false);
    assert.equal(await page.locator(".learning-overlay g").count(), 0);

    await page.locator("#learningQuestion").fill("等待取消测试");
    const cancelledReady = new Promise(resolve => { pendingReady = resolve; });
    await page.locator("#learningSend").click();
    await cancelledReady;
    await page.locator("#learningCancel").click();
    if (pending) { const old = pending; pending = null; await old.route.fulfill({ json: { ok: true, revision: old.body.context.revision, guidance: { message: "取消后不显示" } } }).catch(() => {}); }
    assert.equal((await page.locator("#learningMessages").innerText()).includes("取消后不显示"), false);

    // Save via the application's own whole-project action and restore from IndexedDB on reload.
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => document.body.textContent.includes("项目已保存") || document.body.textContent.includes("已保存到浏览器"));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.AliceLearningAssistant?.exportState().handouts.length === 2);
    await page.locator("#learningAssistantButton").click();
    await page.waitForFunction(() => !document.getElementById("learningSend").disabled);
    await page.locator("#learningQuestion").fill("等待切换工程测试");
    const switchReady = new Promise(resolve => { pendingReady = resolve; });
    await page.locator("#learningSend").click(); await switchReady;
    await page.evaluate(() => window.AliceProjectWorkspace.loadFiles({ "main.c": "int main(void){return 0;}" }, "OtherProject"));
    if (pending) { const old = pending; pending = null; await old.route.fulfill({ json: { ok: true, revision: old.body.context.revision, guidance: { message: "旧工程回答" } } }).catch(() => {}); }
    assert.equal(await page.evaluate(() => window.AliceLearningAssistant.exportState().messages.length), 0);
    assert.equal(await page.evaluate(() => window.AliceLearningAssistant.exportState().handouts.length), 0);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.AliceLearningAssistant?.exportState().handouts.length === 2);
    await page.locator("#learningAssistantButton").click();
    const qa = path.join(__dirname, "../output/qa"); await fs.mkdir(qa, { recursive: true });
    await page.screenshot({ path: path.join(qa, "learning-desktop.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.locator("#learningPanel").boundingBox();
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= 391);
    assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= 845);
    await page.screenshot({ path: path.join(qa, "learning-mobile.png"), fullPage: false });
    await page.locator("#learningClose").click();
    assert.equal(await page.locator("#learningPanel").isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, requests: requestCount, checks: "unconfigured, context, zoom-following annotations, code range, handout, inert output, stale/cancelled/project-switch replies, project save/reload, mobile", screenshots: qa }));
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
