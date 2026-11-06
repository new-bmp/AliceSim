"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path");
const { chromium } = require(process.env.ALICESIM_PLAYWRIGHT_PATH || "playwright");
const base = process.env.ALICESIM_QA_URL || "http://127.0.0.1:4326";
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1080 }, serviceWorkers: "block" });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.route("**/api/learning/status", route => route.fulfill({ json: { configured: true, model: "isolated QA provider", detail: "测试" } }));
    await page.route("**/api/learning/respond", route => {
      const req = route.request().postDataJSON(), c = req.context;
      const mcuId = c.circuit.components.find(c => c.type === "mcu").id;
      const pin = name => c.targets.find(t => t.kind === "pin" && t.componentId === mcuId && t.pin === name).id;
      const source = c.targets.find(t => t.kind === "pin" && t.componentId === "adc" && t.pin === "AO").id;
      const pwm = (min, max) => ({ kind: "pwm-pulse", label: "PWM 高电平宽度", targetId: pin("PA8"), min, max });
      const step = (title, checks, cases) => ({ title, instruction: "检查代码与输出。<script>window.injected=true</script>", prediction: "你预计高电平会持续多久？", targetIds: [pin("PA8")], hints: ["先观察 PA8。", "周期由 PSC 和 ARR 决定。", "修改 CCR 后再次验收。"], checks, cases });
      return route.fulfill({ json: { ok: true, revision: c.revision, guidance: { message: "测试任务已就绪", annotations: [], lesson: { title: "PWM 实验陪练", goal: "通过实际仿真验收不同输入的 PWM", steps: [
        step("确认连接", [{ kind: "connected", label: "ADC 输入连通", targetId: pin("PA0"), peerTargetId: source }], []),
        step("检查目标差异", [pwm(740, 760)], []),
        step("双情境验收", [], [
          { label: "低输入", waitMs: 400, stimuli: [{ controlId: "adc:voltage", value: .825 }], checks: [pwm(995, 1005)] },
          { label: "高输入", waitMs: 400, stimuli: [{ controlId: "adc:voltage", value: 2.475 }], checks: [pwm(1995, 2005)] }
        ])
      ] } } } });
    });
    await page.goto(base, { waitUntil: "networkidle" }); await page.locator("#bootScreen").waitFor({ state: "hidden" });
    const project = JSON.parse(await fs.readFile(path.join(__dirname, "../tutorials/projects/Learning02_Servo.alice.json"), "utf8"));
    await page.evaluate(async p => { await AliceProjectWorkspace.loadFiles(p.files, p.project.name); AliceSchematic.importCircuit(p.circuit); AliceWorkspacePages.set("simulation"); }, project);
    await page.locator("#learningAssistantButton").click(); await page.locator('[data-learning-view="coach"]').click();
    await page.locator("#coachGoal").fill("验证 PWM"); await page.locator(".coach-goal-form button").click();
    await page.locator(".coach-step").first().waitFor();
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.locator(".coach-actions .coach-primary").click(); assert.equal(await page.locator('.coach-check[data-status="pass"]').count(), 1);
    await page.getByRole("button", { name: /给我一点提示/ }).click(); assert.equal(await page.locator(".coach-hint").count(), 1);
    await page.locator(".coach-locate").click(); await page.locator(".learning-overlay ellipse").waitFor();
    await page.locator(".coach-step").nth(1).click(); await page.locator(".coach-actions .coach-primary").click(); assert.equal(await page.locator('.coach-check[data-status="unknown"]').count(), 1);
    await page.locator(".coach-step").nth(2).click();
    const original = await page.evaluate(() => AliceSchematic.getAutomationTargets().find(c => c.id === "adc:voltage").value);
    await page.locator(".coach-actions .coach-primary").click();
    await page.waitForFunction(() => AliceLearningAssistant.exportState().coach.results[2], null, { timeout: 90000 });
    let state = await page.evaluate(() => ({ coach: AliceLearningAssistant.exportState().coach, runtime: AliceLearningEvidence.getSnapshot().runtime, input: AliceSchematic.getAutomationTargets().find(c => c.id === "adc:voltage").value }));
    assert.equal(state.coach.results[2].status, "pass", JSON.stringify(state)); assert.equal(state.input, original); assert.notEqual(state.runtime.status, "RUNNING");
    assert.equal(await page.locator(".coach-wave svg").count(), 2);
    await page.locator(".coach-step").nth(1).click(); await page.locator(".coach-actions .coach-primary").click(); assert.equal(await page.locator('.coach-check[data-status="fail"]').count(), 1);
    const out = path.join(__dirname, "../output/qa"); await fs.mkdir(out, { recursive: true });
    await page.locator(".coach-task").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, "coach-result-desktop.png") });
    // Cancellation must restore the input even after a running scenario has applied it.
    await page.locator(".coach-step").nth(2).click(); await page.locator(".coach-actions .coach-primary").click();
    await page.waitForFunction(() => AliceSchematic.getAutomationTargets().find(c => c.id === "adc:voltage").value === .825);
    await page.getByRole("button", { name: "取消验收", exact: true }).click();
    await page.waitForFunction(v => AliceSchematic.getAutomationTargets().find(c => c.id === "adc:voltage").value === v, original);
    await page.keyboard.press("Control+s"); await page.waitForFunction(() => document.body.textContent.includes("项目已保存") || document.body.textContent.includes("已保存到浏览器"));
    await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => AliceLearningAssistant?.exportState().coach?.plan);
    await page.locator("#learningAssistantButton").click();
    assert.equal(await page.locator('[data-learning-view="coach"]').getAttribute("aria-selected"), "true");
    assert.ok((await page.locator(".coach-stale").innerText()).includes("重新验收"));
    assert.equal(await page.locator('.coach-step[data-status="pass"]').count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.locator("#learningPanel").boundingBox(); assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= 391);
    await page.locator(".coach-task").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, "coach-mobile.png") });
    assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, originalInput: original, checks: "plan, real wiring, unknown/fail/pass, PWM scenarios, rollback, cancellation, save/reload historical evidence, annotations, inert text, mobile" }));
  } finally { await context.close(); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
