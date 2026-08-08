(function () {
  "use strict";

  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
  const MAX_FILES = 10;
  const MAX_PDF_PAGES = 30;
  const state = { notes: [], sources: [], activeTab: "notes", editingId: null, pendingQuote: "" };

  const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const subject = () => document.body.dataset.subject || (location.hostname.includes("english") ? "english" : location.hostname.includes("math") ? "mathematics" : "general");
  const lessonId = () => document.body.dataset.lessonId || document.querySelector("[data-lesson-id]")?.dataset.lessonId || "";
  const context = () => ({
    subject: subject(),
    course_id: document.body.dataset.courseId || "",
    lesson_id: lessonId(),
    source_title: document.title,
    source_url: location.href.split("#")[0]
  });

  document.body.insertAdjacentHTML("beforeend", `
    <aside class="notebook-panel" data-notebook-panel aria-hidden="true" aria-label="Notebook">
      <header class="notebook-head">
        <div><span class="notebook-kicker">LUMINA ATLAS</span><h2>Notebook</h2></div>
        <button type="button" class="notebook-icon-button" data-notebook-close aria-label="Close notebook">×</button>
      </header>
      <nav class="notebook-tabs" aria-label="Notebook sections">
        <button type="button" data-notebook-tab="notes" class="active">Notes</button>
        <button type="button" data-notebook-tab="sources">Sources</button>
        <button type="button" data-notebook-tab="ask">Ask AI</button>
      </nav>
      <div class="notebook-status" data-notebook-status></div>
      <section class="notebook-view" data-notebook-view></section>
    </aside>
    <div class="notebook-backdrop" data-notebook-backdrop></div>
    <button class="notebook-selection-button" type="button" data-selection-save>Add to Notebook</button>
  `);

  const panel = document.querySelector("[data-notebook-panel]");
  const backdrop = document.querySelector("[data-notebook-backdrop]");
  const view = document.querySelector("[data-notebook-view]");
  const statusNode = document.querySelector("[data-notebook-status]");
  const selectionButton = document.querySelector("[data-selection-save]");

  function setStatus(message = "", tone = "") {
    statusNode.textContent = message;
    statusNode.dataset.tone = tone;
    statusNode.hidden = !message;
  }

  async function sessionAndClient() {
    const client = await window.LearningAuth?.getClient?.();
    const session = await window.LearningAuth?.getSession?.();
    return { client, session };
  }

  async function requireSession() {
    const auth = await sessionAndClient();
    if (!auth.client || !auth.session?.user) {
      close();
      window.LearningAuth?.open?.();
      return null;
    }
    return auth;
  }

  async function loadData() {
    const auth = await requireSession();
    if (!auth) return false;
    setStatus("Syncing…");
    const [notesResult, sourcesResult] = await Promise.all([
      auth.client.from("notebook_notes").select("*").order("updated_at", { ascending: false }),
      auth.client.from("notebook_sources").select("*").order("updated_at", { ascending: false })
    ]);
    if (notesResult.error || sourcesResult.error) {
      setStatus("Notebook could not sync. Please try again.", "error");
      return false;
    }
    state.notes = notesResult.data || [];
    state.sources = sourcesResult.data || [];
    setStatus("");
    return true;
  }

  function filterLabel(item) {
    return [item.subject, item.lesson_id].filter(Boolean).join(" · ");
  }

  function renderNotes() {
    view.innerHTML = `
      <div class="notebook-toolbar">
        <label class="notebook-search"><span>⌕</span><input type="search" placeholder="Search notes" data-note-search></label>
        <button class="notebook-primary" type="button" data-new-note>New note</button>
      </div>
      <div class="notebook-list" data-note-list></div>`;
    const list = view.querySelector("[data-note-list]");
    const draw = (query = "") => {
      const clean = query.trim().toLowerCase();
      const notes = state.notes.filter(note => !clean || `${note.title} ${note.content} ${note.quote || ""} ${filterLabel(note)}`.toLowerCase().includes(clean));
      list.innerHTML = notes.length ? notes.map(note => `
        <article class="notebook-item">
          <label class="notebook-source-check"><input type="checkbox" value="${note.id}" data-note-source><span>Select for AI</span></label>
          <button type="button" class="notebook-item-main" data-edit-note="${note.id}">
            <small>${esc(filterLabel(note) || "general")}</small>
            <strong>${esc(note.title)}</strong>
            ${note.quote ? `<blockquote>${esc(note.quote.slice(0, 180))}</blockquote>` : ""}
            <p>${esc(note.content.slice(0, 220) || "No additional note")}</p>
          </button>
          <button type="button" class="notebook-delete" data-delete-note="${note.id}" aria-label="Delete note">Delete</button>
        </article>`).join("") : `<div class="notebook-empty"><strong>No notes yet</strong><p>Select lesson text, save an AI answer, or create a note.</p></div>`;
    };
    draw();
    view.querySelector("[data-note-search]").addEventListener("input", event => draw(event.target.value));
    view.querySelector("[data-new-note]").addEventListener("click", () => renderEditor());
    list.addEventListener("click", async event => {
      const edit = event.target.closest("[data-edit-note]");
      const remove = event.target.closest("[data-delete-note]");
      if (edit) renderEditor(state.notes.find(note => note.id === edit.dataset.editNote));
      if (remove) await deleteNote(remove.dataset.deleteNote);
    });
  }

  function renderEditor(note = null, quote = "") {
    state.editingId = note?.id || null;
    state.pendingQuote = quote || note?.quote || "";
    view.innerHTML = `
      <form class="notebook-editor" data-note-editor>
        <button type="button" class="notebook-text-button" data-editor-back>← Notes</button>
        <label>Title<input name="title" maxlength="120" required value="${esc(note?.title || (quote ? "Lesson excerpt" : ""))}" placeholder="Note title"></label>
        ${state.pendingQuote ? `<div class="notebook-quote"><small>Selected text</small><blockquote>${esc(state.pendingQuote)}</blockquote></div>` : ""}
        <label>Your note<textarea name="content" rows="10" placeholder="Write what you want to remember…">${esc(note?.content || "")}</textarea></label>
        <div class="notebook-editor-actions"><button type="button" data-editor-cancel>Cancel</button><button class="notebook-primary" type="submit">Save note</button></div>
      </form>`;
    view.querySelector("[data-editor-back]").addEventListener("click", renderNotes);
    view.querySelector("[data-editor-cancel]").addEventListener("click", renderNotes);
    view.querySelector("[data-note-editor]").addEventListener("submit", saveEditor);
    view.querySelector("input[name=title]").focus();
  }

  async function saveEditor(event) {
    event.preventDefault();
    const auth = await requireSession();
    if (!auth) return;
    const form = new FormData(event.currentTarget);
    const payload = { ...context(), user_id: auth.session.user.id, title: form.get("title").trim(), content: form.get("content").trim(), quote: state.pendingQuote || null, source_type: state.pendingQuote ? "lesson_selection" : "manual" };
    setStatus("Saving…");
    const result = state.editingId
      ? await auth.client.from("notebook_notes").update(payload).eq("id", state.editingId).select().single()
      : await auth.client.from("notebook_notes").insert(payload).select().single();
    if (result.error) return setStatus(result.error.message, "error");
    await loadData();
    renderNotes();
  }

  async function add(payload = {}) {
    const auth = await requireSession();
    if (!auth) return false;
    const meta = context();
    const row = {
      ...meta,
      user_id: auth.session.user.id,
      title: payload.title || (payload.type === "ai-response" ? `AI answer — ${meta.source_title}` : "Saved note"),
      content: payload.text || payload.content || "",
      quote: payload.quote || null,
      source_type: payload.type === "ai-response" ? "ai_response" : payload.quote ? "lesson_selection" : "manual"
    };
    const result = await auth.client.from("notebook_notes").insert(row).select().single();
    if (result.error) { setStatus(result.error.message, "error"); return false; }
    state.notes.unshift(result.data);
    return true;
  }

  async function deleteNote(id) {
    if (!confirm("Delete this note?")) return;
    const auth = await requireSession();
    if (!auth) return;
    const result = await auth.client.from("notebook_notes").delete().eq("id", id);
    if (result.error) return setStatus(result.error.message, "error");
    state.notes = state.notes.filter(note => note.id !== id);
    renderNotes();
  }

  function renderSources() {
    const used = state.sources.reduce((sum, source) => sum + (source.file_size || 0), 0);
    view.innerHTML = `
      <div class="notebook-upload-card">
        <strong>Add a source</strong><p>PDF, TXT, or Markdown · 2 MB per file · 10 files · 5 MB total</p>
        <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" data-source-file hidden>
        <button type="button" class="notebook-primary" data-source-upload>Choose file</button>
        <small>${state.sources.length}/${MAX_FILES} files · ${(used / 1048576).toFixed(1)}/5 MB used</small>
      </div>
      <div class="notebook-list" data-source-list>
        ${state.sources.length ? state.sources.map(source => `
          <article class="notebook-item notebook-source-item">
            <label class="notebook-source-check"><input type="checkbox" value="${source.id}" data-file-source><span>Select for AI</span></label>
            <div class="notebook-item-main"><small>${esc(source.subject)}</small><strong>${esc(source.title)}</strong><p>${esc(source.file_name || source.source_url || "Saved source")}</p></div>
            <button type="button" class="notebook-delete" data-delete-source="${source.id}">Delete</button>
          </article>`).join("") : `<div class="notebook-empty"><strong>No sources yet</strong><p>Upload a short study file to ask questions grounded in it.</p></div>`}
      </div>`;
    const input = view.querySelector("[data-source-file]");
    view.querySelector("[data-source-upload]").addEventListener("click", () => input.click());
    input.addEventListener("change", () => input.files[0] && uploadSource(input.files[0]));
    view.querySelector("[data-source-list]").addEventListener("click", event => {
      const button = event.target.closest("[data-delete-source]");
      if (button) deleteSource(button.dataset.deleteSource);
    });
  }

  async function extractText(file) {
    if (file.type !== "application/pdf") return (await file.text()).slice(0, 180000);
    const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`PDFs are limited to ${MAX_PDF_PAGES} pages.`);
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      pages.push(content.items.map(item => item.str).join(" "));
    }
    return pages.join("\n\n").slice(0, 180000);
  }

  async function uploadSource(file) {
    const auth = await requireSession();
    if (!auth) return;
    const used = state.sources.reduce((sum, source) => sum + (source.file_size || 0), 0);
    if (file.size > MAX_FILE_BYTES) return setStatus("This file is larger than 2 MB.", "error");
    if (state.sources.length >= MAX_FILES || used + file.size > MAX_TOTAL_BYTES) return setStatus("Your Notebook storage allowance is full.", "error");
    const allowed = ["application/pdf", "text/plain", "text/markdown"];
    if (!allowed.includes(file.type) && !/\.(txt|md)$/i.test(file.name)) return setStatus("Choose a PDF, TXT, or Markdown file.", "error");
    setStatus("Reading and uploading source…");
    let extracted;
    try { extracted = await extractText(file); } catch (error) { return setStatus(error.message, "error"); }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const path = `${auth.session.user.id}/${crypto.randomUUID()}-${safeName}`;
    const upload = await auth.client.storage.from("notebook-files").upload(path, file, { contentType: file.type || "text/plain" });
    if (upload.error) return setStatus(upload.error.message, "error");
    const page = context();
    const row = { user_id: auth.session.user.id, subject: page.subject, course_id: page.course_id, lesson_id: page.lesson_id, source_url: page.source_url, title: file.name.replace(/\.[^.]+$/, ""), file_name: file.name, mime_type: file.type || "text/plain", file_size: file.size, storage_path: path, extracted_text: extracted };
    const inserted = await auth.client.from("notebook_sources").insert(row).select().single();
    if (inserted.error) {
      await auth.client.storage.from("notebook-files").remove([path]);
      return setStatus(inserted.error.message, "error");
    }
    state.sources.unshift(inserted.data);
    setStatus("Source added.", "success");
    renderSources();
  }

  async function deleteSource(id) {
    if (!confirm("Delete this source?")) return;
    const auth = await requireSession();
    if (!auth) return;
    const source = state.sources.find(item => item.id === id);
    if (source?.storage_path) await auth.client.storage.from("notebook-files").remove([source.storage_path]);
    const result = await auth.client.from("notebook_sources").delete().eq("id", id);
    if (result.error) return setStatus(result.error.message, "error");
    state.sources = state.sources.filter(item => item.id !== id);
    renderSources();
  }

  function renderAsk() {
    const selectableNotes = state.notes.map(note => `<label><input type="checkbox" name="note" value="${note.id}"><span>${esc(note.title)}</span></label>`).join("");
    const selectableSources = state.sources.map(source => `<label><input type="checkbox" name="source" value="${source.id}"><span>${esc(source.title)}</span></label>`).join("");
    view.innerHTML = `
      <form class="notebook-ask" data-notebook-ask>
        <div><h3>Choose sources</h3><p>The answer will use only the material you select.</p></div>
        <details open><summary>Notes (${state.notes.length})</summary><div class="notebook-picker">${selectableNotes || "<small>No notes available</small>"}</div></details>
        <details open><summary>Files (${state.sources.length})</summary><div class="notebook-picker">${selectableSources || "<small>No files available</small>"}</div></details>
        <label>Your question<textarea name="question" rows="4" required placeholder="Ask about the selected material…"></textarea></label>
        <button class="notebook-primary" type="submit">Ask Notebook AI</button>
      </form>
      <div class="notebook-answer" data-notebook-answer hidden></div>`;
    view.querySelector("[data-notebook-ask]").addEventListener("submit", askNotebook);
  }

  async function askNotebook(event) {
    event.preventDefault();
    const auth = await requireSession();
    if (!auth) return;
    const selectedNoteIds = [...event.currentTarget.querySelectorAll('input[name="note"]:checked')].map(input => input.value);
    const selectedSourceIds = [...event.currentTarget.querySelectorAll('input[name="source"]:checked')].map(input => input.value);
    if (!selectedNoteIds.length && !selectedSourceIds.length) return setStatus("Select at least one note or source.", "error");
    const materials = [
      ...state.notes.filter(note => selectedNoteIds.includes(note.id)).map(note => ({ title: note.title, text: [note.quote, note.content].filter(Boolean).join("\n") })),
      ...state.sources.filter(source => selectedSourceIds.includes(source.id)).map(source => ({ title: source.title, text: source.extracted_text || "" }))
    ].map(item => ({ ...item, text: item.text.slice(0, 14000) })).slice(0, 12);
    const question = new FormData(event.currentTarget).get("question").trim();
    setStatus("Notebook AI is reading your sources…");
    const response = await fetch("/api/notebook-ai", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.session.access_token}` }, body: JSON.stringify({ question, materials }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setStatus(data.error || "Notebook AI is unavailable.", "error");
    setStatus("");
    const answer = view.querySelector("[data-notebook-answer]");
    answer.hidden = false;
    answer.innerHTML = `<small>NOTEBOOK AI</small><div>${esc(data.answer).replace(/\n/g, "<br>")}</div><button type="button" class="notebook-primary" data-save-answer>Save to Notebook</button>`;
    answer.querySelector("[data-save-answer]").addEventListener("click", async event => {
      const saved = await add({ type: "ai-response", title: `AI — ${question.slice(0, 72)}`, text: data.answer });
      if (saved) { event.currentTarget.textContent = "Saved"; event.currentTarget.disabled = true; }
    });
  }

  async function switchTab(tab) {
    state.activeTab = tab;
    panel.querySelectorAll("[data-notebook-tab]").forEach(button => button.classList.toggle("active", button.dataset.notebookTab === tab));
    if (tab === "notes") renderNotes();
    if (tab === "sources") renderSources();
    if (tab === "ask") renderAsk();
  }

  async function open(tab = "notes") {
    const auth = await requireSession();
    if (!auth) return;
    panel.classList.add("open");
    backdrop.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    if (await loadData()) switchTab(tab);
  }

  function close() {
    panel.classList.remove("open");
    backdrop.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  }

  document.addEventListener("click", event => {
    if (event.target.closest("[data-notebook-open]")) open();
    if (event.target.closest("[data-notebook-close], [data-notebook-backdrop]")) close();
    const tab = event.target.closest("[data-notebook-tab]");
    if (tab) switchTab(tab.dataset.notebookTab);
  });
  document.addEventListener("keydown", event => event.key === "Escape" && close());
  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || "";
    if (text.length < 12 || panel.contains(selection?.anchorNode)) return selectionButton.classList.remove("show");
    const range = selection.getRangeAt(0).getBoundingClientRect();
    selectionButton.dataset.quote = text.slice(0, 5000);
    selectionButton.style.left = `${Math.min(innerWidth - 170, Math.max(12, range.left + range.width / 2 - 70))}px`;
    selectionButton.style.top = `${Math.max(12, range.top - 44)}px`;
    selectionButton.classList.add("show");
  });
  selectionButton.addEventListener("click", async () => {
    const quote = selectionButton.dataset.quote;
    selectionButton.classList.remove("show");
    await open("notes");
    if (panel.classList.contains("open")) renderEditor(null, quote);
  });

  window.LearningNotebook = { open, close, add };
  window.MathNotebook = window.LearningNotebook;
})();
