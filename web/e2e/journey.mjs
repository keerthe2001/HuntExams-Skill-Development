// End-to-end journey against a running API + web app.
//   BASE=http://localhost:5174 ADMIN_EMAIL=admin@huntexams.dev node e2e/journey.mjs
// The API must list ADMIN_EMAIL in HX_ADMIN_EMAILS and, because the test fast-forwards ~400
// answers, run with HX_RATE_LIMIT_WRITES_PER_MINUTE=10000. Uses the preinstalled Playwright.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE ?? "http://localhost:5174";
const ADMIN = process.env.ADMIN_EMAIL ?? "admin@huntexams.dev";
const SHOTS = process.env.SHOTS ?? "";
const PW = "correct-horse-1";
const stamp = Date.now();
const LEARNER = `Priya Raman ${String(stamp).slice(-5)}`;
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ✓ " + msg); else { failures++; console.log("  ✗ " + msg); } };
const step = (t) => console.log("\n▶ " + t);

const browser = await chromium.launch();
const errors = [];
function watch(page, label) {
  page.on("pageerror", (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
}
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const api = async (page, path, body, method) => page.evaluate(async ([p, b, m]) => {
  const r = await fetch(`/api${p}`, { method: m ?? (b === undefined ? "GET" : "POST"), credentials: "same-origin",
    headers: { "X-HX-Client": "web", "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body, method]);

async function signup(page, name, email) {
  await page.goto(`${BASE}/signup`);
  await page.fill("#name", name); await page.fill("#email", email); await page.fill("#password", PW);
  await page.click("button[type=submit]");
  await page.waitForURL(/onboarding|dashboard|roadmap|learn/);
}

/* ------------------------------------------------------------ admin + answer key */
step("Admin account and answer key");
const adminCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const admin = await adminCtx.newPage(); watch(admin, "admin");
await admin.goto(`${BASE}/login`);
await admin.fill("#email", ADMIN); await admin.fill("#password", PW); await admin.click("button[type=submit]");
await admin.waitForTimeout(800);
if (!/onboarding|dashboard|learn/.test(admin.url())) await signup(admin, "Admin", ADMIN);
const me = await api(admin, "/me");
ok(me.body?.role === "admin", "admin role granted from HX_ADMIN_EMAILS");
const topicsList = (await api(admin, "/admin/content?kind=topic")).body;
const key = {};
for (const row of topicsList) key[row.slug] = (await api(admin, `/admin/content/topic/${row.id}`)).body.body;
ok(Object.keys(key).length >= 100, `admin can read ${Object.keys(key).length} topic documents`);

/* ------------------------------------------------------------ public pages, desktop + phone */
step("Public pages render without errors or sideways scrolling");
const publicRoutes = ["/", "/learn", "/glossary", "/glossary/token", "/world/llm-foundations", "/ta/learn/what-is-a-program", "/learn/what-is-a-program?step=build", "/learn/context-windows?step=experiment", "/roadmap", "/pricing", "/guides", "/guides/rag-explained-for-beginners", "/verify", "/login", "/signup",
  "/about", "/privacy", "/terms", "/learn/what-is-a-program", "/learn/rag-architecture", "/learn/conditional-routing", "/learn/caching-scalability",
  "/learn/similarity-search", "/learn/chunk-size-overlap", "/learn/inference-parameters", "/learn/capstone-api", "/lab/lab-chunking", "/nope-404"];
for (const [label, ctxOpts] of [["desktop", { viewport: { width: 1360, height: 900 } }], ["phone", devices["iPhone 13"]]]) {
  const ctx = await browser.newContext(ctxOpts);
  const p = await ctx.newPage(); watch(p, label);
  for (const r of publicRoutes) {
    await p.goto(BASE + r); await p.waitForTimeout(r.startsWith("/learn/") || r.startsWith("/lab/") ? 1200 : 500);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) ok(false, `${label} ${r} scrolls sideways by ${over}px`);
  }
  ok(true, `${label}: visited ${publicRoutes.length} routes`);
  await ctx.close();
}

/* ------------------------------------------------------------ learner journey */
step("Sign up, onboarding (3 questions), roadmap");
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage(); watch(page, "learner");
const email = `e2e${stamp}@test.dev`;
await signup(page, LEARNER, email);
ok(page.url().includes("/onboarding"), "new learner lands on onboarding");
await page.click("text=Continue");
await page.click("text=Beginner"); await page.click("text=Continue");
await page.click("text=1 hour a day"); await page.click("text=Continue");
await page.waitForSelector("text=Here's your route");
ok(await page.waitForSelector("text=Starter · Python in plain words", { timeout: 10000 }).then(() => true, () => false), "beginners start with the starter pack");
await page.click("text=Enter the AI world"); await page.waitForURL("**/learn");
ok(await page.waitForSelector(".w-world >> text=Python in plain words", { timeout: 10000 }).then(() => true, () => false), "the AI world shows the starter world");
await shot(page, "roadmap");

step("Lesson: scene to the end marks it watched; every question type through the UI");
// In the world, a topic's questions live in its Experiment step (one interactive question)
// and its Practice step (the rest).
async function cardFor(slug, qid) {
  for (const st of ["experiment", "practice"]) {
    await page.goto(`${BASE}/learn/${slug}?step=${st}`);
    await page.waitForSelector(".w-steps");
    await page.waitForTimeout(400);
    const card = page.locator(`.q[data-qid="${qid}"]`);
    if (await card.count()) return card;
  }
  throw new Error(`question ${qid} not found in ${slug}`);
}
async function answerAll(slug) {
  await page.goto(`${BASE}/learn/${slug}`);
  await page.waitForSelector(".scene");
  // Walk every scene to its last step, then finish the place (marks it watched).
  for (let s = 0; s < 6; s++) {
    for (let k = 0; k < 15; k++) { const n = page.locator(".scene-ctl >> text=Next ›").first(); if (await n.isDisabled()) break; await n.click(); }
    const more = page.locator(".w-bar >> text=Next scene");
    if (!(await more.count())) break;
    await more.click();
  }
  await page.goto(`${BASE}/learn/${slug}?step=done`); await page.waitForSelector(".w-done");
  await page.waitForTimeout(600);
  for (const q of key[slug].checks) {
    const card = await cardFor(slug, q.id);
    if (q.type === "predict" || q.type === "mcq") await card.locator(".opt").nth(q.answer).click();
    if (q.type === "multi") for (const a of q.answer) await card.locator(".opt").nth(a).click();
    if (q.type === "fill") await card.locator("select").selectOption(q.answer);
    if (q.type === "debug") await card.locator(".code-lines button.cl").nth(q.answer - 1).click();
    if (q.type === "tune") { await card.locator('input[type="range"]').fill("1.5"); }
    if (q.type === "order") {
      for (let target = 0; target < q.items.length; target++) {
        const rows = await card.locator(".ord > div > span:nth-child(2)").allTextContents();
        let at = rows.indexOf(q.items[target]);
        while (at > target) { await card.locator(".ord > div").nth(at).locator("button").first().click(); at--; }
      }
    }
    await card.locator("button", { hasText: "Check" }).click();
    await card.locator(".fb").waitFor();
    const txt = await card.locator(".fb").textContent();
    ok(/Correct/.test(txt ?? ""), `${slug}/${q.id} (${q.type}) answered correctly in the UI`);
  }
}
await answerAll("what-is-a-program");
const practised = await (await page.request.get(`${BASE}/api/topics/what-is-a-program`)).json();
ok(practised.progress?.status === "practised", "topic marked practised after scene + all checks");
await shot(page, "lesson-practised");

step("Wrong answer shows a hint, not XP");
const q0 = key["variables"].checks.find((q) => q.type === "mcq" || q.type === "predict");
const wrongCard = await cardFor("variables", q0.id);
await wrongCard.locator(".opt").nth((q0.answer + 1) % q0.options.length).click();
await wrongCard.locator("button", { hasText: "Check" }).click();
await wrongCard.locator(".fb").waitFor();
ok(/Not yet/.test(await wrongCard.locator(".fb").textContent() ?? ""), "wrong answer gets 'Not yet' feedback");

step("Run the worked example in the Python sandbox and watch each line");
await page.goto(`${BASE}/learn/variables?step=build`); await page.waitForSelector(".codebox");
await page.click("text=▶ Run and watch each line");
await page.waitForSelector(".viz .says", { timeout: 90000 });
ok(/Creates price = 120|price/.test(await page.locator(".viz .says").textContent() ?? ""), "visualizer narrates the executed line");

step("Code exercise: fail, reveal solution, pass");
const exCheck = page.locator("button", { hasText: "Check my code" });
await exCheck.click(); await page.waitForSelector(".w-build-ex .alert");
await exCheck.click(); await page.waitForTimeout(1500);
await page.click("text=Show a solution"); await page.click("text=Use it");
await exCheck.click();
await page.waitForSelector("text=All checks passed", { timeout: 30000 });
ok(true, "exercise passes with the solution");

step("Guided lab, full screen, every step with Show me + Check");
await page.goto(`${BASE}/lab/lab-variables`); await page.waitForSelector(".lab-say");
const labSteps = await page.locator(".lab-steps li").count();
for (let k = 0; k < labSteps; k++) {
  if (await page.locator("text=Show me").isVisible()) { await page.click("text=Show me"); await page.waitForTimeout(400); while (await page.isVisible("text=Typing…")) await page.waitForTimeout(200); }
  const check = page.locator(".lab-foot button", { hasText: "Check" });
  if (await check.count()) { await check.click(); await page.waitForSelector(".lab-guide .alert.good", { timeout: 60000 }); }
  await page.locator(".lab-foot button", { hasText: /Next step|Finish|Continue/ }).click();
  await page.waitForTimeout(300);
}
await page.waitForSelector("text=Lab complete");
ok(true, `lab finished (${labSteps} steps)`);
await shot(page, "lab-complete");

step("Dashboard shows XP, streak, next activity and achievements");
await page.goto(`${BASE}/dashboard`); await page.waitForSelector(".next");
const xpText = await page.locator(".xp").first().textContent();
ok(Number.parseInt(xpText ?? "0") > 0, `XP is shown (${xpText})`);
ok(await page.isVisible("text=First code run"), "achievement 'First code run' earned");
await shot(page, "dashboard");

step("Fast-forward the rest of the route through the API (same endpoints the UI uses)");
const state = (await api(page, "/me/state")).body;
for (const lv of state.levels.filter((l) => !l.optional)) {
  for (const t of lv.topics) {
    await api(page, `/topics/${t.slug}/watched`, {});
    for (const q of key[t.slug].checks) {
      const ans = q.type === "order" ? q.items : q.type === "tune" ? 1.5 : q.answer;
      await api(page, `/topics/${t.slug}/answer`, { question_id: q.id, answer: ans });
    }
  }
}
const after = (await api(page, "/me/state")).body;
ok(after.totals.percent === 100, `every required topic practised (${after.totals.percent}%)`);

step("Mission submitted in the UI, reviewed by an admin in the UI");
await page.goto(`${BASE}/missions/token-budget-calculator`); await page.waitForSelector("#p-repo");
await page.fill("#p-repo", "http://not-github.example/x"); await page.click("text=Submit for review");
ok(await page.isVisible("text=Use a GitHub repository link"), "invalid repo link rejected with a clear message");
await page.fill("#p-repo", "https://github.com/priya/token-budget"); await page.fill("#p-notes", "Tested on 5 prompts.");
await page.click("text=Submit for review"); await page.waitForSelector("text=Submitted.");
ok(true, "mission submitted");
for (const lv of after.levels.filter((l) => !l.optional && l.mission && l.mission.slug !== "token-budget-calculator")) {
  await api(page, `/projects/${lv.mission.slug}/submissions`, { repo_url: `https://github.com/priya/${lv.mission.slug}` });
}
await admin.goto(`${BASE}/admin/reviews`); await admin.waitForSelector(".card");
let reviewed = 0;
while (await admin.locator(".card", { hasText: LEARNER }).count()) {
  const card = admin.locator(".card", { hasText: LEARNER }).first();
  for (const input of await card.locator('input[type="number"]').all()) await input.fill(await input.getAttribute("max"));
  await card.locator("textarea").fill("Clear README and solid tests.");
  await card.locator("text=Save review").click();
  await admin.waitForTimeout(700);
  reviewed++;
  if (reviewed > 50) break;
}
ok(reviewed === 8, `admin reviewed ${reviewed} missions in the UI`);
await shot(admin, "admin-reviews");

step("Certificate: claim in the UI, verify publicly");
await page.goto(`${BASE}/certificate`); await page.waitForSelector("text=Claim my certificate");
await page.click("text=Claim my certificate"); await page.waitForSelector(".cert");
const code = (await page.locator(".cert .top span").nth(1).textContent())?.trim();
ok(/^HX-AAE-\d{4}-\d{5}$/.test(code ?? ""), `certificate issued: ${code}`);
await shot(page, "certificate");
const anon = await (await browser.newContext()).newPage(); watch(anon, "anon");
await anon.goto(`${BASE}/verify/${code}`); await anon.waitForSelector("text=Valid.");
ok(await anon.isVisible(`text=${LEARNER}`), "public verification shows the holder");
await anon.goto(`${BASE}/verify/HX-AAE-2000-00000`); await anon.click("text=Verify");
await anon.waitForSelector("text=No certificate has this ID.");
ok(true, "unknown certificate ID is rejected");

step("Admin content editor: invalid JSON is refused, publish works");
const row = topicsList.find((r) => r.slug === "model-selection");
await admin.goto(`${BASE}/admin/edit/topic/${row.id}`); await admin.waitForSelector("#a-body");
await admin.fill("#a-body", "{ not json");
await admin.click('button:has-text("Publish")');
ok(await admin.waitForSelector("text=valid JSON", { timeout: 5000 }).then(() => true, () => false), "invalid JSON is caught before saving");
await admin.click("text=Preview scene");

step("Phone: world steps, tap-to-build and lab tabs");
const phone = await browser.newContext(devices["iPhone 13"]);
const pp = await phone.newPage(); watch(pp, "phone");
await pp.goto(`${BASE}/learn/rag-architecture?step=build`); await pp.waitForSelector(".w-steps");
ok(await pp.isVisible("text=Run and watch each line"), "phone: Build step shows the runnable example");
await pp.goto(`${BASE}/learn/rag-architecture?step=practice`); await pp.waitForSelector(".q");
ok(await pp.isVisible(".q"), "phone: Practice step shows questions");
await pp.goto(`${BASE}/learn/what-is-a-program?step=build`); await pp.waitForSelector(".w-blocks");
for (let h = 0; h < 20 && await pp.locator(".w-pool .w-line").count(); h++) await pp.click("text=Hint");
await pp.click("text=▶ Run my program");
ok(await pp.waitForSelector("text=✓ It works", { timeout: 90000 }).then(() => true, () => false), "phone: tap-to-build program runs and passes");
await pp.goto(`${BASE}/lab/lab-chunking`); await pp.waitForSelector(".lab-tabs");
await pp.click(".lab-tabs >> text=Code"); ok(await pp.isVisible(".cm-editor"), "phone: lab Code tab shows the editor");
await shot(pp, "phone-lab");

console.log(`\nConsole/page errors: ${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log("  ! " + e));
await browser.close();
if (errors.length) failures++;
console.log(failures ? `\nFAILED (${failures})` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
