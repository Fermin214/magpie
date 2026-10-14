// Real magpie assets with the complete favorites wire format; no user data.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");
const assets = process.env.MAGPIE_ASSETS || path.resolve(__dirname, "../assets");
const doc = () => ({ schemaVersion: 1, revision: 0, prompts: [], repositories: [] });
const languages = {
 en: { add: "New prompt", repos: "Repositories", repo: "New repository", save: "Save", cancel: "Cancel", discard: "Discard", more: "Import / export", import: "Import JSON", confirm: "Import", reload: "Reload favorites" },
 zh: { add: "新增 Prompt", repos: "仓库", repo: "新增仓库", save: "保存", cancel: "取消", discard: "丢弃", more: "导入 / 导出", import: "导入 JSON", confirm: "导入", reload: "重新加载" },
};
async function fixture(page, lang = "en", { web = true } = {}) {
 const state = { data: doc(), saves: 0, copies: [], reads: 0, failSave: false, failRead: false, holdSave: null, holdRead: null, readGate: null };
 await page.route("http://magpie.test/**", async (r) => {
  const u = new URL(r.request().url()), p = u.pathname;
  const json = (d, status = 200) => r.fulfill({ json: d, status });
  if (p === "/boot.js") return r.fulfill({ contentType: "text/javascript", body: 'window.bootPrefs = ' + JSON.stringify({ lang, theme: "light", web }) });
  if (p === "/wails/runtime.js") return r.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
  if (p === "/api/state") return json({ agents: [], profiles: [], settings: { lang, theme: "light" } });
  if (p === "/api/agenthub/favorites") {
   state.reads++; const snap = structuredClone(state.data);
   if (state.holdRead) { state.readGate = state.holdRead; await state.holdRead; }
   if (state.failRead) return json({ code: "storage", error: "fixture read failure" }, 503);
   return json(snap);
  }
  if (p === "/api/agenthub/favorites/save") {
   state.saves++; const b = r.request().postDataJSON();
   assert.equal(typeof b.revision, "number"); assert(["prompt", "repository"].includes(b.kind));
   if (state.holdSave) await state.holdSave;
   if (state.failSave) return json({ code: "storage", error: "fixture save failure" }, 503);
   if (b.revision !== state.data.revision) return json({ code: "conflict", error: "stale" }, 409);
   const list = b.kind === "prompt" ? "prompts" : "repositories", item = structuredClone(b[b.kind]);
   const i = state.data[list].findIndex((x) => x.id === item.id);
   if (!item.id) item.id = "fixture-" + state.saves;
   item.createdAt ||= "2026-10-11T00:00:00Z"; item.updatedAt = "2026-10-11T01:00:00Z";
   if (i < 0) state.data[list].push(item); else state.data[list][i] = item;
   state.data.revision++; return json(state.data);
  }
  if (p === "/api/agenthub/favorites/delete") {
   const b = r.request().postDataJSON();
   if (b.revision !== state.data.revision) return json({ code: "conflict" }, 409);
   const key = b.kind === "prompt" ? "prompts" : "repositories"; state.data[key] = state.data[key].filter((x) => x.id !== b.id); state.data.revision++; return json(state.data);
  }
  if (p === "/api/agenthub/favorites/import/preview") {
   const data = r.request().postDataJSON().data; return json({ added: data.prompts.length, skipped: 0, conflicts: [], revision: state.data.revision });
  }
  if (p === "/api/agenthub/favorites/import") {
   const b = r.request().postDataJSON(); if (b.revision !== state.data.revision) return json({ code: "conflict" }, 409);
   state.data.prompts.push(...b.data.prompts); state.data.revision++; return json(state.data);
  }
  if (p === "/api/copy") { state.copies.push(r.request().postDataJSON().text); return r.fulfill({ status: 204 }); }
  if (p === "/api/groups") return json({ groups: [] });
  if (p === "/api/usage/quotas") return json([]);
  if (p === "/api/library") return json({ agents: [], instructions: { agents: [], sets: [] }, servers: [], skills: [], projects: [], foundSkills: [], foundServers: [] });
  if (p === "/api/plugins") return json({ plugins: [] });
  if (p === "/api/providers") return json({ providers: [], presets: [], excluded: [], gateway: { running: false } });
  if (p.startsWith("/api/")) return json({});
  const file = path.join(assets, p === "/" ? "index.html" : p);
  try { return r.fulfill({ body: await fs.readFile(file), contentType: { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)] }); }
  catch { return r.fulfill({ status: 404 }); }
 });
 return state;
}
async function open(browser, lang = "en", options = {}) {
 await fs.mkdir(path.resolve(__dirname, "../../../.agenthub-work"), { recursive: true });
 const page = await browser.newPage({ viewport: { width: 1120, height: 900 } }); page.setDefaultTimeout(7000);
 const errors = []; page.on("pageerror", (e) => errors.push(e.message));
 const state = await fixture(page, lang, options);
 await page.goto("http://magpie.test/?view=agenthub-favorites");
 assert.equal(await page.locator('[data-view="agenthub-favorites"]').count(), 1, "Favorites entry must be present in magpie's real navigation");
 await page.getByRole("button", { name: languages[lang].add, exact: true }).waitFor();
 return { page, state, errors, words: languages[lang] };
}
for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
 test(engine + ": bottom cards open visible details without moving the list", async (t) => {
  const browser = await ({ chromium, webkit }[engine]).launch(); t.after(() => browser.close());
  for (const lang of ["en", "zh"]) {
   const { page, state, errors, words: w } = await open(browser, lang, { web: false });
   const root = page.locator("#view-agenthub-favorites"), editor = page.locator("#modal .ah-editor");
   state.data.prompts = Array.from({ length: 32 }, (_, i) => ({
    id: "card-" + i, title: (lang === "zh" ? "事实核查 " : "Fact check ") + i,
    body: "Check the evidence and sources.\n".repeat(60), purpose: "核查观点、结论和数据的事实基础与推理链。",
    category: "研究", tags: ["事实核查"], favorite: false,
    createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z",
   }));
   await root.getByRole("button", { name: w.reload, exact: true }).click();
   await page.waitForFunction(() => document.querySelectorAll(".ah-item").length === 32);
   for (const width of [720, 560, 390]) {
    await page.setViewportSize({ width, height: 716 });
    const columns = await root.locator(".ah-item").evaluateAll(items => items.slice(0, 2).map(el => ({ x: el.offsetLeft, y: el.offsetTop })));
    assert.equal(columns[0].y === columns[1].y, width > 500, "two cards share a row when they fit; narrow windows use one column");
    await root.hover(); await page.mouse.wheel(0, 10000);
    await page.waitForFunction(() => {
     const root = document.querySelector("#view-agenthub-favorites");
     return root.scrollTop > 0 && root.scrollHeight - root.clientHeight - root.scrollTop <= 1;
    });
    const before = await root.evaluate(el => el.scrollTop);
    await root.locator(".ah-item").last().click();
    await page.waitForFunction(() => !document.querySelector("#modal").hidden);
    await page.locator("#modal").evaluate(m => Promise.all(m.getAnimations({ subtree: true }).map(a => a.finished)));
    assert.equal(await editor.locator('[name="title"]').inputValue(), state.data.prompts[31].title);
    assert.equal(await editor.locator('[name="body"]').inputValue(), state.data.prompts[31].body);
    const text = await editor.locator('[name="body"]').boundingBox(), save = await editor.locator("[data-ah-save]").boundingBox();
    assert(text.y >= 0 && text.y + text.height <= 716, "prompt text is visible immediately, even from the last card");
    assert(save.y >= 0 && save.y + save.height <= 716, "Save is always in the viewport");
    assert.equal(await root.evaluate(el => el.scrollTop), before, "opening details keeps the reader's position");
    if (width === 720) await page.screenshot({ path: path.resolve(__dirname, "../../../.agenthub-work/prompt-dialog-" + engine + "-" + lang + ".png") });
    await page.setViewportSize({ width, height: 480 });
    await editor.locator(".ah-field > span").first().hover(); await page.mouse.wheel(0, 2000);
    await page.waitForFunction(() => document.querySelector(".ah-fields").scrollTop > 0);
    assert.equal(await root.evaluate(el => el.scrollTop), before, "scrolling details does not scroll the list");
    const footer = await editor.locator("[data-ah-save]").boundingBox();
    assert(footer.y >= 0 && footer.y + footer.height <= 480, "Save stays visible in a short window after scrolling fields");
    await page.setViewportSize({ width, height: 716 });
    const cancel = editor.getByRole("button", { name: w.cancel, exact: true });
    await cancel.focus(); await page.keyboard.press("Tab");
    assert(await editor.locator("button").first().evaluate(el => el === document.activeElement), "Tab stays inside details");
    await page.keyboard.press("Escape");
    await page.locator("#modal").waitFor({ state: "hidden" });
    assert.equal(await root.evaluate(el => el.scrollTop), before, "closing details keeps the reader's position");
    assert(await root.locator(".ah-item").last().evaluate(el => el === document.activeElement), "focus returns to the selected card");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
    if (width === 720) await page.screenshot({ path: path.resolve(__dirname, "../../../.agenthub-work/prompt-cards-" + engine + "-" + lang + ".png") });
   }
   assert.deepEqual(errors, []); await page.close();
  }
 });
 test(engine + ": favorites entry and complete user flow", async (t) => {
  const browser = await ({ chromium, webkit }[engine]).launch(); t.after(() => browser.close());
  for (const lang of ["en", "zh"]) {
   const { page, state, errors, words: w } = await open(browser, lang);
   const root = page.locator("#view-agenthub-favorites"), editor = page.locator("#modal .ah-editor");
   await page.getByRole("button", { name: w.add, exact: true }).click();
   await editor.locator('[name="title"]').focus();
   await page.evaluate(() => window.dispatchEvent(new Event("focus")));
   await page.waitForTimeout(200);
   assert.equal(await editor.locator('[name="title"]').evaluate(el => el === document.activeElement), true, "returning to a clean editor must keep input focus");
   await editor.locator('[name="title"]').fill("Writing review");
   await editor.locator('[name="body"]').fill("  Keep the author’s words.\n");
   await editor.locator('[name="category"]').fill("Writing");
   await editor.locator('[name="tags"]').fill("editing, work");
   await editor.locator("[data-ah-save]").click();
   await root.locator(".ah-item").waitFor(); assert.equal(state.data.prompts.length, 1);
   await root.locator(".ah-item").click();
   await editor.getByRole("button", { name: lang === "zh" ? "复制" : "Copy", exact: true }).click();
   assert.deepEqual(state.copies, ["  Keep the author’s words.\n"]);
   await editor.locator('[name="body"]').fill("unsaved");
   await page.evaluate(() => { show("agents"); });
   await page.getByRole("alertdialog").getByRole("button", { name: w.cancel, exact: true }).click();
   assert.equal(await editor.locator('[name="body"]').inputValue(), "unsaved");
   await editor.getByRole("button", { name: w.cancel, exact: true }).click();
   await page.getByRole("alertdialog").locator("button").last().click();
   await root.getByRole("tab", { name: w.repos, exact: true }).click();
   await root.getByRole("button", { name: w.repo, exact: true }).click();
   await editor.locator('[name="name"]').fill("Useful project");
   await editor.locator('[name="url"]').fill("https://github.com/example/project");
   await editor.locator('[name="notes"]').fill("Read the source");
   await editor.locator("[data-ah-save]").click(); await root.locator(".ah-item").waitFor();
   assert.equal(state.data.repositories.length, 1);
   await root.locator(".ah-item").click();
   await page.setViewportSize({ width: 560, height: 800 });
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
   await page.evaluate(lang => applyPrefs({ theme: "dark", lang }), lang);
   await page.waitForFunction(() => !document.documentElement.classList.contains("theming"));
   assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
   await page.screenshot({ path: path.resolve(__dirname, "../../../.agenthub-work/favorites-" + engine + "-" + lang + ".png") });
   await editor.getByRole("button", { name: w.cancel, exact: true }).click();
   await page.setViewportSize({ width: 1120, height: 900 });
   await root.getByRole("button", { name: w.more, exact: true }).click();
   const download = page.waitForEvent("download");
   await page.getByRole("menuitemradio", { name: /JSON/ }).filter({ hasText: lang === "zh" ? "导出" : "Export" }).click();
   const file = await download; const exported = JSON.parse(await fs.readFile(await file.path(), "utf8"));
   assert.equal(exported.repositories[0].notes, "Read the source");
   assert.equal(exported.prompts[0].body, "  Keep the author’s words.\n");
   await root.getByRole("button", { name: w.more, exact: true }).click();
   const chooser = page.waitForEvent("filechooser");
   await page.getByRole("menuitemradio", { name: w.import, exact: true }).click();
   const importDoc = doc(); importDoc.prompts.push({ id: "imported", title: "Imported text", body: "safe", purpose: "", category: "", tags: [], favorite: false, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z" });
   await (await chooser).setFiles({ name: "favorites.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(importDoc)) });
   await editor.getByRole("button", { name: w.confirm, exact: true }).waitFor();
   assert.equal(state.data.prompts.length, 1, "preview must not import");
   await editor.getByRole("button", { name: w.confirm, exact: true }).click();
   await root.getByRole("button", { name: w.repo, exact: true }).waitFor();
   assert.equal(state.data.prompts.length, 2);
   await page.reload(); await root.getByRole("button", { name: w.repo, exact: true }).waitFor();
   assert.equal(await page.locator('[data-view="agenthub-favorites"]').getAttribute("aria-current"), "page");
   assert.deepEqual(errors, []); await page.close();
  }
 });
 test(engine + ": favorites keeps its draft and navigation in the desktop sidebar", async (t) => {
  const browser = await ({ chromium, webkit }[engine]).launch(); t.after(() => browser.close());
  for (const lang of ["en", "zh"]) {
   const { page, state, errors, words: w } = await open(browser, lang, { web: false });
   const root = page.locator("#view-agenthub-favorites"), editor = page.locator("#modal .ah-editor");
   const nav = page.locator('#nav [data-view="agenthub-favorites"]');
   assert(await page.locator("#side #nav").isVisible(), "Favorites opens in the desktop sidebar");
   assert.equal(await nav.locator(".nav-ic").count(), 1, "Favorites uses the sidebar's icon layout");
   assert.equal(await page.locator("#crumb b").textContent(), lang === "zh" ? "收藏" : "Favorites");
   await root.getByRole("button", { name: w.add, exact: true }).click();
   await editor.locator('[name="title"]').fill("Sidebar draft");
   await page.evaluate(() => { show("agents"); });
   await page.getByRole("alertdialog").getByRole("button", { name: w.cancel, exact: true }).click();
   assert.equal(await nav.getAttribute("aria-current"), "page", "cancelled navigation stays in Favorites");
   await page.keyboard.press("Control+Shift+S");
   await page.locator(".top #nav").waitFor();
   await page.waitForFunction(() => !document.documentElement.classList.contains("nav-morph"));
   assert(await page.locator(".top #nav").isVisible(), "Favorites stays in the collapsed sidebar's header navigation");
   assert.equal(await editor.locator('[name="title"]').inputValue(), "Sidebar draft");
   await page.setViewportSize({ width: 560, height: 800 });
   await page.locator(".top #nav").waitFor();
   await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
   assert(await page.locator(".top #nav").isVisible(), "narrow windows keep Favorites in header navigation");
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
   assert.equal(await editor.locator('[name="title"]').inputValue(), "Sidebar draft");
   const save = await editor.locator("[data-ah-save]").boundingBox();
   assert(save.y >= 0 && save.y + save.height <= 800, "Save stays visible while the fields scroll");
   await editor.locator("[data-ah-save]").click(); await root.locator(".ah-item").waitFor();
   assert.equal(state.data.prompts[0].title, "Sidebar draft");
   await page.setViewportSize({ width: 1120, height: 900 });
   await page.locator("#sideToggle").click();
   await page.locator("#side #nav").waitFor();
   await page.waitForFunction(() => !document.documentElement.classList.contains("nav-morph"));
   await page.reload(); await root.getByRole("button", { name: w.add, exact: true }).waitFor();
   assert(await page.locator("#side #nav").isVisible(), "reloading restores Favorites in the sidebar");
   assert.equal(await nav.getAttribute("aria-current"), "page");
   await page.goto("http://magpie.test/");
   await root.getByRole("button", { name: w.add, exact: true }).waitFor();
   assert.equal(await nav.getAttribute("aria-current"), "page", "opening without a view restores Favorites as the last page");
   assert.deepEqual(errors, []); await page.close();
  }
 });
 test(engine + ": save failure, stale completion and concurrent changes preserve drafts", async (t) => {
  const browser = await ({ chromium, webkit }[engine]).launch(); t.after(() => browser.close());
  const { page, state, errors } = await open(browser);
  const root = page.locator("#view-agenthub-favorites"), editor = page.locator("#modal .ah-editor");
  await root.getByRole("button", { name: "New prompt", exact: true }).click();
  await editor.locator('[name="title"]').fill("Must survive");
  let release; state.holdSave = new Promise((r) => { release = r; });
  await editor.locator("[data-ah-save]").dblclick({ delay: 5 });
  await page.waitForTimeout(100); assert.equal(state.saves, 1, "duplicate requests must not be sent");
  state.failSave = true; release(); state.holdSave = null;
  await editor.getByRole("alert").waitFor();
  assert.equal(await editor.locator('[name="title"]').inputValue(), "Must survive");
  state.failSave = false; state.data.revision++; state.data.repositories.push({ id: "other", name: "Other window", url: "https://example.com/repo", notes: "", tags: [], status: "interested", archived: false, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z" });
  await editor.locator("[data-ah-save]").click(); await page.waitForTimeout(100);
  assert.match(await editor.getByRole("alert").innerText(), /changed elsewhere/);
  assert.equal(await editor.locator('[name="title"]').inputValue(), "Must survive");
  assert.equal(state.data.repositories.length, 1);
  await editor.getByRole("button", { name: "Reload favorites", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
  await root.getByRole("button", { name: "New prompt", exact: true }).click();
  await editor.locator('[name="title"]').fill("After reload");
  await editor.locator("[data-ah-save]").click(); await root.locator(".ah-item").waitFor();
  state.failRead = true;
  await root.getByRole("button", { name: "Reload favorites", exact: true }).click();
  await root.getByRole("alert").waitFor();
  assert.equal(await root.locator(".ah-item").count(), 1, "failed read preserves last snapshot");
  assert.equal(await root.getByRole("button", { name: "New prompt", exact: true }).isDisabled(), true);
  state.failRead = false;
  let releaseRead; state.holdRead = new Promise((r) => { releaseRead = r; });
  await root.getByRole("button", { name: "Reload favorites", exact: true }).click();
  await page.evaluate(() => { show("agents"); });
  state.holdRead = null;
  await page.locator('[data-view="agenthub-favorites"]').click();
  await root.getByRole("button", { name: "New prompt", exact: true }).click();
  await editor.locator('[name="title"]').fill("New draft after navigation"); releaseRead();
  await page.waitForTimeout(100);
  assert.equal(await editor.locator('[name="title"]').inputValue(), "New draft after navigation");
  assert.deepEqual(errors, []);
 });
}
