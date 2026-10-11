// AgentHub favorites owns its state. The host calls enter/leave/relabel only.
(() => {
  const root = document.querySelector("#view-agenthub-favorites");
  let data = null, draft = null, baseline = "", draftRevision = 0, pendingImport = null;
  let busy = false, loading = null, generation = 0, failed = "", blocked = false;
  let tab = "prompts", query = "", category = "", tag = "", archived = false;
  try { if (localStorage.getItem("agenthub.favoritesTab") === "repositories") tab = "repositories"; } catch {}
  const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ""; if (text !== undefined) n.textContent = text; return n; };
  const dirty = () => !!draft && JSON.stringify(draft) !== baseline;
  const messages = {
    conflict: "Favorites changed elsewhere. Reload before saving; your draft is kept.",
    duplicate: "This repository is already in Favorites.",
    invalid: "Check the fields or import file and try again.",
    version: "This data format needs a newer AgentHub build.",
    corrupt: "Favorites could not be read. The original file has been kept.",
    storage: "Favorites could not be saved or read. Check access and try again.",
    missing: "This favorite no longer exists. Reload the list.",
    busy: "Another window is saving. Try again in a moment.",
  };
  function failure(e) { failed = messages[e.code] || "The request failed. Your changes are kept."; }
  function snapshot(value) {
    if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || !Array.isArray(value.prompts) || !Array.isArray(value.repositories)) throw new Error("Invalid favorites response");
    return value;
  }
  async function request(path = "", body) {
    const res = await fetch("/api/agenthub/favorites" + path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await res.json();
    if (!res.ok) { const e = new Error(result.error); e.code = result.code; throw e; }
    return result;
  }
  function button(label, run, cls = "text") {
    const b = node("button", cls, t(label)); b.type = "button"; b.disabled = busy;
    b.onclick = run; return b;
  }
  async function abandon() {
    if (busy) return false;
    if (dirty() && !(await confirmDiscard())) return false;
    draft = null; pendingImport = null; baseline = ""; return true;
  }
  async function load() {
    if (busy || dirty() || pendingImport) { render(); return; }
    if (loading) return loading;
    const own = ++generation;
    loading = (async () => {
      try {
        const next = snapshot(await request());
        if (own !== generation) return;
        data = next; failed = ""; blocked = false;
      } catch (e) { if (own === generation) { failure(e); blocked = true; } }
      finally { if (own === generation) { loading = null; render(); } }
    })();
    render(); return loading;
  }
  async function mutate(path, body) {
    if (busy || blocked) return;
    busy = true; generation++; failed = ""; render();
    try {
      const next = snapshot(await request(path, body));
      data = next; draft = null; baseline = ""; pendingImport = null; blocked = false;
    } catch (e) { failure(e); }
    finally { busy = false; render(); }
  }
  async function pick(item) {
    if (!(await abandon()) || !data || blocked) return;
    generation++; loading = null;
    draft = structuredClone(item || (tab === "prompts" ? { id: "", title: "", body: "", purpose: "", category: "", tags: [], favorite: false } : { id: "", name: "", url: "", notes: "", tags: [], status: "interested", archived: false }));
    baseline = JSON.stringify(draft); draftRevision = data.revision; failed = ""; render();
    root.querySelector(".ah-editor input")?.focus({ preventScroll: true });
  }
  function menu(label, options, value, change) {
    const b = button(label, () => openProtoMenu(b, options, value, change, label, "", "left"));
    return b;
  }
  function options(values, all) { return [{ v: "", name: all }, ...values.map((v) => ({ v, name: v, literalName: true }))]; }
  function save() {
    if (!draft || busy || blocked) return;
    if (!root.querySelector("form")?.reportValidity()) return;
    mutate("/save", { revision: draftRevision, kind: tab === "prompts" ? "prompt" : "repository", [tab === "prompts" ? "prompt" : "repository"]: draft });
  }
  function exportFile(markdown) {
    if (!data) return;
    let content = JSON.stringify(data, null, 2), name = "agenthub-favorites.json", type = "application/json";
    if (markdown) {
      const title = (s) => s.replace(/[\r\n]/g, " ");
      content = data.prompts.map((p) => "# " + title(p.title) + "\n\n" + p.body + "\n").join("\n");
      name = "agenthub-prompts.md"; type = "text/markdown";
    }
    const blob = new Blob([content], { type: type + ";charset=utf-8" }), url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file) {
    if (!file || !(await abandon())) return;
    busy = true; generation++; loading = null; failed = ""; render();
    try {
      if (file.size > 16 * 1024 * 1024) throw { code: "invalid" };
      const value = JSON.parse(await file.text());
      const preview = await request("/import/preview", { data: value });
      if (!Number.isInteger(preview.added) || !Number.isInteger(preview.skipped) || !Array.isArray(preview.conflicts) || !Number.isSafeInteger(preview.revision)) throw new Error("Invalid import preview");
      pendingImport = { value, preview };
    } catch (e) { failure(e); }
    finally { busy = false; render(); }
  }
  function field(form, key, label, multiline = false, required = false) {
    const wrap = node("label", "ah-field"), caption = node("span", "", t(label));
    const input = node(multiline ? "textarea" : "input", "");
    input.name = key; input.required = required; input.disabled = busy || blocked;
    input.value = key === "tags" ? draft.tags.join(", ") : draft[key] || "";
    if (!multiline) input.type = key === "url" ? "url" : "text";
    input.maxLength = ({ title: 512, name: 512, body: 1048576, notes: 20000, purpose: 20000, category: 128, url: 4096, tags: 6400 })[key];
    if (key === "body") input.classList.add("ah-content");
    input.oninput = () => { draft[key] = key === "tags" ? input.value.split(/[,，]/).map((v) => v.trim()).filter(Boolean) : input.value; updateSave(); };
    wrap.append(caption, input); form.append(wrap);
  }
  function updateSave() { const b = root.querySelector("[data-ah-save]"); if (b) b.disabled = busy || blocked || !dirty(); }
  function renderEditor(container) {
    if (pendingImport) {
      const { preview, value } = pendingImport;
      container.append(node("h2", "", t("Import favorites")));
      container.append(node("p", "ah-summary", t("{added} new entries; {skipped} existing entries kept.", preview)));
      for (const name of preview.conflicts) container.append(node("p", "ah-meta", name));
      const actions = node("div", "ah-actions");
      actions.append(button("Cancel", () => { pendingImport = null; render(); }), button("Import", () => mutate("/import", { revision: preview.revision, data: value }), "text primary"));
      container.append(actions); return;
    }
    if (!draft) {
      const empty = node("div", "ah-empty");
      empty.append(node("h2", "", t("Keep useful things close.")), node("p", "", t("Choose an entry to view or edit it.")));
      container.append(empty); return;
    }
    const form = node("form", "ah-form"); form.onsubmit = (e) => { e.preventDefault(); save(); };
    const heading = node("div", "ah-editor-head");
    heading.append(node("h2", "", t(tab === "prompts" ? "Prompt" : "Repository")));
    if (draft.id && tab === "prompts") heading.append(button("Copy", (e) => copy(draft.body, t("Prompt"), e.currentTarget)));
    if (draft.id && tab === "repositories") {
      const link = button("Open link", () => {
        try {
          const u = new URL(draft.url);
          if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw { code: "invalid" };
          api("open", { url: u.href }).catch((e) => { failure(e); render(); });
        } catch (e) { failure({ code: "invalid" }); render(); }
      });
      heading.append(link);
    }
    form.append(heading);
    if (tab === "prompts") {
      field(form, "title", "Title", false, true); field(form, "body", "Prompt text", true);
      field(form, "purpose", "Purpose"); field(form, "category", "Category");
    } else {
      field(form, "name", "Name", false, true); field(form, "url", "Repository URL", false, true); field(form, "notes", "Notes", true);
      const row = node("div", "ah-actions");
      const statuses = [{ v: "interested", name: "Interested" }, { v: "in_use", name: "In use" }, { v: "uninstalled", name: "Uninstalled" }];
      row.append(menu(statuses.find((s) => s.v === draft.status)?.name || "Interested", statuses, draft.status, (v) => { draft.status = v; render(); }));
      row.append(button(draft.archived ? "Unarchive" : "Archive", () => { draft.archived = !draft.archived; render(); })); form.append(row);
    }
    field(form, "tags", "Tags (comma separated)");
    if (tab === "prompts") {
      const label = node("label", "ah-check"), check = node("input", ""); check.type = "checkbox"; check.checked = draft.favorite; check.disabled = busy || blocked;
      check.onchange = () => { draft.favorite = check.checked; updateSave(); }; label.append(check, node("span", "", t("Pin prompt"))); form.append(label);
    }
    const actions = node("div", "ah-actions ah-save");
    const cancel = button("Cancel", async () => { if (await abandon()) render(); });
    const submit = button(busy ? "Saving…" : "Save", save, "text primary"); submit.dataset.ahSave = ""; submit.disabled = busy || blocked || !dirty();
    actions.append(cancel, submit);
    if (draft.id) {
      const id = draft.id, name = draft.title || draft.name, revision = draftRevision, kind = tab === "prompts" ? "prompt" : "repository";
      actions.prepend(button("Delete", async () => { if (!busy && await confirmRemoval(name)) mutate("/delete", { revision, kind, id }); }, "text danger"));
    }
    form.append(actions); container.append(form);
  }
  function renderList() {
    const list = root.querySelector(".ah-list"); if (!list) return;
    list.replaceChildren();
    const source = data?.[tab] || [];
    const q = query.toLowerCase();
    const items = source.filter((x) => (tab !== "repositories" || x.archived === archived) && (!category || x.category === category) && (!tag || x.tags.includes(tag)) && [x.title, x.body, x.purpose, x.name, x.url, x.notes, x.category, ...x.tags].some((v) => String(v || "").toLowerCase().includes(q)))
      .slice().sort((a, b) => Number(b.favorite || false) - Number(a.favorite || false) || b.updatedAt.localeCompare(a.updatedAt));
    if (!items.length) {
      list.append(node("p", "ah-empty-list", t(source.length ? "No matching favorites." : "No favorites yet. Add your first entry."))); return;
    }
    for (const item of items) {
      const row = node("button", "ah-item" + (draft?.id === item.id ? " on" : ""));
      row.type = "button"; row.disabled = busy || blocked; row.onclick = () => pick(item);
      row.append(node("strong", "", (item.favorite ? "★ " : "") + (item.title || item.name)));
      row.append(node("span", "ah-excerpt", item.purpose || item.notes || item.body || item.url || ""));
      row.append(node("span", "ah-meta", [...(item.category ? [item.category] : []), ...item.tags].join(" · ")));
      list.append(row);
    }
  }
  function render() {
    if (!root) return;
    const scroll = root.scrollTop;
    root.replaceChildren();
    const shell = node("div", "ah-shell");
    const bar = node("div", "ah-toolbar");
    const tabs = node("div", "ah-tabs"); tabs.setAttribute("role", "tablist");
    for (const [key, label] of [["prompts", "Prompts"], ["repositories", "Repositories"]]) {
      const b = button(label, async () => { if (key === tab || !(await abandon())) return; tab = key; category = ""; tag = ""; query = ""; try { localStorage.setItem("agenthub.favoritesTab", tab); } catch {} render(); });
      b.classList.toggle("on", tab === key); b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(tab === key)); tabs.append(b);
    }
    bar.append(tabs, node("span", "grow"));
    const reload = button("Reload favorites", async () => { if (await abandon()) await load(); }); reload.disabled = busy || !!loading;
    const more = menu("Import / export", [{ v: "import", name: "Import JSON" }, { v: "json", name: "Export JSON" }, { v: "markdown", name: "Export prompts as Markdown" }], "", (v) => {
      if (v === "import") {
        const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json"; input.onchange = () => importFile(input.files[0]); input.click();
      } else exportFile(v === "markdown");
    });
    more.disabled = busy || !data || blocked;
    const add = button(tab === "prompts" ? "New prompt" : "New repository", () => pick(null), "text primary"); add.disabled = busy || !data || blocked;
    bar.append(reload, more, add); shell.append(bar);
    if (failed) { const error = node("p", "ah-error", t(failed)); error.setAttribute("role", "alert"); shell.append(error); }
    if (!data) { shell.append(node("p", "ah-empty-list", t(loading ? "Loading…" : "Reload favorites to try again."))); root.append(shell); return; }
    const search = node("div", "ah-search");
    const input = node("input", ""); input.type = "search"; input.placeholder = t("Search favorites"); input.setAttribute("aria-label",t("Search favorites")); input.value = query;
    input.oninput = () => { query = input.value; renderList(); };
    search.append(input);
    const values = (key) => [...new Set(data[tab].flatMap((v) => Array.isArray(v[key]) ? v[key] : v[key] ? [v[key]] : []))].sort();
    if (tab === "prompts") search.append(menu(category || "All categories", options(values("category"), "All categories"), category, (v) => { category = v; render(); }));
    search.append(menu(tag || "All tags", options(values("tags"), "All tags"), tag, (v) => { tag = v; render(); }));
    if (tab === "repositories") {
      const b = button(archived ? "Archived" : "Active", () => { archived = !archived; render(); }); b.setAttribute("aria-pressed",String(archived)); search.append(b);
    }
    shell.append(search);
    const grid = node("div", "ah-grid" + (draft || pendingImport ? " ah-has-editor" : ""));
    grid.append(node("div", "ah-list")); const editor = node("section", "ah-editor"); renderEditor(editor); grid.append(editor); shell.append(grid);
    root.append(shell); renderList(); root.scrollTop = scroll;
  }
  window.agenthubFavorites = {
    enter: load, dirty,
    leave: async () => { if (!(await abandon())) return false; generation++; loading = null; return true; },
    relabel: render,
  };
  window.addEventListener("beforeunload", (e) => { if (dirty() || busy) { e.preventDefault(); e.returnValue = ""; } });
  window.addEventListener("focus", () => { if (!root?.hidden && !draft && !busy && !pendingImport) load(); });
})();
