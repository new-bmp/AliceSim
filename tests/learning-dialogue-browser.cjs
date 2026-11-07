/* Isolated UI regression: provider fixtures never enter production or user projects. */
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path");
const { chromium } = require(process.env.ALICESIM_PLAYWRIGHT_PATH || "playwright");
const base = process.env.ALICESIM_QA_URL || "http://127.0.0.1:4325";
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1050 }, serviceWorkers: "block" });
  const page = await context.newPage(), errors = [], requests = [];
  let pending = null, holdNext = false, failNext = false;
  page.on("pageerror", e => errors.push(e.message));
  const ask = async text => { await page.locator("#learningQuestion").fill(text); await page.locator("#learningSend").click(); };
  const done = () => page.waitForFunction(() => !document.getElementById("learningSend").disabled && document.getElementById("learningThinking").hidden);
  try {
    await page.route("**/api/learning/status", route => route.fulfill({ json: { configured: true, model: "isolated interaction QA", detail: "测试" } }));
    await page.route("**/api/learning/respond", async route => {
      const request = route.request().postDataJSON(); requests.push(request);
      if (holdNext) { holdNext = false; pending = { route, request }; return; }
      if (failNext) { failNext = false; await route.fulfill({ status: 503, json: { ok: false, detail: "测试请求失败" } }); return; }
      let guidance;
      if (request.mode === "coach") {
        guidance = { message: "先预测再验证。", lesson: { title: "理解 PWM", goal: "预测脉宽与周期", steps: [{ title: "观察 PA8", instruction: "先预测仅改变 CCR 的结果。", prediction: "周期和高电平宽度会怎样变化？", targetIds: [], hints: ["看计数器。", "PSC 和 ARR 决定周期。", "隐藏的第三层提示"], checks: [{ kind: "build", label: "构建状态" }], cases: [] }] } };
      } else if (request.context.learningStep) {
        guidance = { message: "你的预测需要分别核对周期和比较值。我们先看一个问题。", interaction: { question: "哪一个寄存器控制周期？", choices: ["ARR", "CCR", "还不确定"] } };
      } else if (request.question.includes("我的想法是")) {
        guidance = { message: "我收到你的思路了，接下来用波形核对。", followUps: ["再问一个关于 PWM 的问题", "怎样验证？"] };
      } else {
        guidance = { message: "我们先区分**周期与 `CCR`**。\n\n- 先预测\n- 再观察\n\n```c\n<script>window.injected=true</script>\n```", interaction: { question: "PSC 与 ARR 不变，只增大 CCR，哪一项变化？", choices: ["高电平宽度增加", "整个周期增加", "<script>window.injected=true</script>", "还不确定"] }, followUps: ["换个说法"] };
      }
      await route.fulfill({ json: { ok: true, revision: request.context.revision, guidance } });
    });
    await page.goto(base, { waitUntil: "networkidle" }); await page.locator("#bootScreen").waitFor({ state: "hidden" });
    const project = JSON.parse(await fs.readFile(path.join(__dirname, "../tutorials/projects/Learning02_Servo.alice.json"), "utf8"));
    await page.evaluate(async p => { await AliceProjectWorkspace.loadFiles(p.files, p.project.name); AliceSchematic.importCircuit(p.circuit); AliceWorkspacePages.set("simulation"); }, project);
    await page.locator("#learningAssistantButton").click();
    await page.locator('[data-learning-starter="quiz"]').click(); await done();
    assert.equal(await page.locator(".learning-choice").count(), 4);
    assert.equal(await page.locator("#learningPanel").getAttribute("data-companion"), "question");
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.equal(await page.locator(".learning-copy strong").last().innerText(), "周期与 CCR");
    assert.equal(await page.locator(".learning-copy code").last().innerText(), "CCR");
    assert.equal(await page.locator(".learning-copy script").count(), 0);
    const out = path.join(__dirname, "../output/qa"); await fs.mkdir(out, { recursive: true });
    await page.locator(".learning-interaction").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, "learning-dialogue-desktop.png") });
    await page.locator(".learning-choice").first().click(); await done();
    assert.equal(requests.length, 2);
    assert.match(requests[1].question, /PSC 与 ARR/); assert.match(requests[1].question, /高电平宽度增加/);
    assert.equal(await page.locator('.learning-choice[aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator('.coach-check[data-status="pass"]').count(), 0);
    await page.getByRole("button", { name: "再问一个关于 PWM 的问题", exact: true }).click(); await done();
    await page.locator(".learning-reply-form textarea").fill("我认为周期不变，因为 ARR 没变化");
    await page.locator(".learning-reply-send").click(); await done();
    assert.match(requests.at(-1).question, /周期不变，因为 ARR/);
    await page.getByRole("button", { name: "再问一个关于 PWM 的问题", exact: true }).click(); await done();
    await page.evaluate(() => { const e = document.getElementById("codeEditor"); e.value += "\n// revised during question"; e.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.getByRole("button", { name: "根据当前工程重新出题", exact: true }).waitFor();
    assert.equal(await page.locator(".learning-message").last().locator(".learning-choice").first().isDisabled(), true);
    await page.getByRole("button", { name: "根据当前工程重新出题", exact: true }).click(); await done();
    holdNext = true; await ask("等一下再回复");
    await page.waitForFunction(() => document.getElementById("learningPanel").dataset.companion === "thinking");
    assert.equal(await page.locator("#learningThinking").isVisible(), true);
    await page.locator("#learningCancel").click();
    assert.equal(await page.locator("#learningThinking").isVisible(), false);
    if (pending) { await pending.route.fulfill({ json: { ok: true, revision: pending.request.context.revision, guidance: { message: "已取消的旧回复" } } }).catch(() => {}); pending = null; }
    assert.equal((await page.locator("#learningMessages").innerText()).includes("已取消的旧回复"), false);
    holdNext = true; await ask("保留后续草稿");
    await page.waitForFunction(() => !document.getElementById("learningCancel").hidden);
    await page.locator("#learningQuestion").fill("这是等待时写下的下一个问题");
    for (let attempt = 0; !pending && attempt < 250; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(pending, "The held request must arrive before checking draft preservation");
    await pending.route.fulfill({ json: { ok: true, revision: pending.request.context.revision, guidance: { message: "上一轮已回答" } } }); pending = null; await done();
    assert.equal(await page.locator("#learningQuestion").inputValue(), "这是等待时写下的下一个问题");
    failNext = true; await ask("测试重试"); await page.locator("#learningRetry").waitFor({ state: "visible" });
    const count = await page.evaluate(() => AliceLearningAssistant.exportState().messages.filter(m => m.role === "user").length);
    await page.locator("#learningRetry").click(); await done();
    assert.equal(await page.evaluate(() => AliceLearningAssistant.exportState().messages.filter(m => m.role === "user").length), count);
    await page.locator('[data-learning-view="coach"]').click();
    await page.locator("#coachGoal").fill("理解 PWM"); await page.locator(".coach-goal-form button").click();
    await page.locator(".coach-prediction textarea").fill("周期不变，脉宽增大");
    await page.getByRole("button", { name: "点评我的预测", exact: true }).click(); await done();
    assert.equal(requests.at(-1).context.learningStep.studentPrediction, "周期不变，脉宽增大");
    assert.deepEqual(requests.at(-1).context.learningStep.revealedHints, []);
    assert.equal(JSON.stringify(requests.at(-1).context.learningStep).includes("隐藏的第三层提示"), false);
    await page.locator("#learningReturnToTask").click();
    assert.equal(await page.locator(".coach-prediction textarea").inputValue(), "周期不变，脉宽增大");
    assert.equal(await page.locator(".coach-step[aria-current=step]").count(), 1);
    await page.keyboard.press("Control+s"); await page.waitForFunction(() => document.body.textContent.includes("项目已保存") || document.body.textContent.includes("已保存到浏览器"));
    await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => AliceLearningAssistant?.exportState().coach?.plan);
    await page.locator("#learningAssistantButton").click();
    assert.equal(await page.locator(".coach-prediction textarea").inputValue(), "周期不变，脉宽增大");
    const state = await page.evaluate(() => AliceLearningAssistant.exportState());
    assert.equal(state.messages.find(m => m.interaction?.answer)?.interaction.answer, "高电平宽度增加");
    await page.locator('[data-learning-view="ask"]').click();
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(".learning-interaction").last().scrollIntoViewIfNeeded();
    const bounds = await page.locator("#learningPanel").boundingBox();
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= 391 && bounds.y >= -1 && bounds.y + bounds.height <= 845, JSON.stringify(bounds));
    assert.equal(await page.locator(".alice-eyes").evaluate(el => getComputedStyle(el).animationName), "none");
    assert.equal(await page.locator(".learning-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await page.screenshot({ path: path.join(out, "learning-dialogue-mobile.png") });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, requests: requests.length, checks: "question choices, free answers, inert text, follow-up context, stale questions, cancel, retry, prediction discussion, hidden hints, return to task, save/reload, mobile, reduced motion" }));
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
