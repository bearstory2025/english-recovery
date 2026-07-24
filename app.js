const STORAGE_KEY = "english-recovery-state-v1";
const taskMeta = {
  warmup: ["热身", "5 分钟", "快速唤醒现状描述句型"],
  shadowing: ["影子跟读", "12 分钟", "模仿语音、重音与停顿"],
  reuse: ["句型复用", "10 分钟", "替换关键词并用于工作场景"],
  retell: ["工作场景复述", "10 分钟", "解释限制并给出下一步"],
  review: ["回顾与巩固", "5 分钟", "记录收获、卡点和调整"],
};
const phrases = [
  ["工作英语", "避免过度承诺", "Let me verify this before we commit.", "在我们承诺之前，让我先核实一下。"],
  ["工作英语", "确认需求", "Let me make sure I understand your request correctly.", "我先确认一下是否正确理解了你的需求。"],
  ["工作英语", "解释限制", "Our current limitation is the available bandwidth.", "我们目前的限制是可用带宽。"],
  ["工作英语", "项目推进", "The next step is to confirm the capacity with our network team.", "下一步是向网络团队确认容量。"],
  ["生活英语", "英语角开场", "What brought you to the English corner today?", "你今天为什么来英语角？"],
  ["生活英语", "自然接话", "That sounds interesting. How did you get into it?", "听起来很有意思，你是怎么开始接触它的？"],
];
const defaultState = {
  currentDay: 1,
  streak: 0,
  completedDays: 0,
  tasks: Object.fromEntries(Object.keys(taskMeta).map((key) => [key, false])),
  evidence: [],
  reviews: [],
};

let state = loadState();
let activeFilter = "全部";
let searchQuery = "";
let recorder = null;
let recordingChunks = [];
let recordingSeconds = 0;
let recordingTimer = null;
let currentAudioUrl = null;

const app = document.querySelector("#app");
const nav = document.querySelector("#main-nav");
const menuButton = document.querySelector("#menu-button");
document.querySelector("#today-date").textContent = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "long", day: "numeric", weekday: "short",
}).format(new Date());

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved.currentDay !== "number") return structuredClone(defaultState);
    return { ...structuredClone(defaultState), ...saved, tasks: { ...defaultState.tasks, ...saved.tasks } };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
}

function currentView() {
  const value = location.hash.slice(1);
  return ["plan", "library", "evidence", "review", "studio"].includes(value) ? value : "today";
}

function navigate(view) {
  location.hash = view === "today" ? "" : view;
  nav.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "打开导航");
  render();
}

function bindNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.view));
  });
  menuButton.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
  });
}

function render() {
  const view = currentView();
  document.querySelectorAll("nav [data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "today") renderToday();
  if (view === "plan") renderPlan();
  if (view === "library") renderLibrary();
  if (view === "evidence") renderEvidence();
  if (view === "review") renderReview();
  if (view === "studio") renderStudio();
  app.focus({ preventScroll: true });
}

function renderToday() {
  app.replaceChildren(document.querySelector("#today-template").content.cloneNode(true));
  const completed = Object.values(state.tasks).filter(Boolean).length;
  app.querySelectorAll('[data-bind="day"]').forEach((node) => { node.textContent = state.currentDay; });
  app.querySelectorAll('[data-bind="streak"]').forEach((node) => { node.textContent = state.streak; });
  app.querySelector('[data-bind="remaining"]').textContent = `距离 Day 30 还有 ${Math.max(0, 30 - state.currentDay)} 天`;
  app.querySelector('[data-bind="task-count"]').textContent = `${completed}/5`;
  app.querySelector('[data-bind="recordings"]').textContent = state.evidence.filter((item) => item.kind === "recording").length;
  app.querySelector('[data-bind="start-copy"]').textContent = `继续第 ${state.currentDay} 天训练`;
  app.querySelector('[data-bind-width="progress"]').style.width = `${Math.max(2, state.currentDay / 90 * 100)}%`;
  app.querySelector("[data-action=studio]").addEventListener("click", () => navigate("studio"));

  const taskList = app.querySelector("#task-list");
  taskList.innerHTML = Object.entries(taskMeta).map(([key, meta]) => `
    <button class="task-row ${state.tasks[key] ? "done" : ""}" data-task="${key}" aria-pressed="${state.tasks[key]}">
      <span class="check">${state.tasks[key] ? "✓" : ""}</span>
      <span><strong>${meta[0]}</strong><em>${meta[2]}</em></span>
      <small>${meta[1]}</small>
    </button>`).join("");
  taskList.querySelectorAll("[data-task]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tasks[button.dataset.task] = !state.tasks[button.dataset.task];
      saveState();
      renderToday();
    });
  });

  const completeButton = app.querySelector("#complete-day");
  completeButton.hidden = completed !== 5;
  completeButton.textContent = `完成第 ${state.currentDay} 天`;
  completeButton.addEventListener("click", () => {
    state.completedDays = Math.max(state.completedDays, state.currentDay);
    state.streak += 1;
    state.currentDay = Math.min(90, state.currentDay + 1);
    state.tasks = structuredClone(defaultState.tasks);
    saveState();
    renderToday();
  });

  app.querySelector("#home-evidence").innerHTML = renderEvidenceRows(state.evidence.slice(0, 3));
  bindAudioButtons(app);
  app.querySelector("#home-progress").innerHTML = state.evidence.length
    ? `<div class="notice">已经保存 ${state.evidence.length} 条真实训练记录。继续积累后再比较变化。</div>`
    : `<div class="empty">完成第一次录音或复盘后，这里会显示你的真实进度。</div>`;
}

function renderPlan() {
  const phases = [
    ["阶段 1", "重新开口", "Day 1-14", "恢复嘴和耳朵，每天完成跟读和 1 分钟表达。"],
    ["阶段 2", "工作句型库", "Day 15-42", "掌握确认需求、解释限制、回应催促和推动闭环。"],
    ["阶段 3", "会议与项目推进", "Day 43-70", "从能说句子进入能做 3-5 分钟项目汇报。"],
    ["阶段 4", "职业加分", "Day 71-90", "完成英文自我介绍、项目案例和会议模拟。"],
  ];
  app.innerHTML = `<div class="page inner-page">
    <div class="page-title"><p class="eyebrow">90 天计划</p><h1>恢复一个长期休眠的工作语言系统</h1><p>不是刷题，也不是追求口音。目标是在真实工作中听懂、确认、追问、总结和推进。</p></div>
    <div class="phase-list">${phases.map((phase, index) => `<section class="phase ${state.currentDay > index * 28 ? "active" : ""}">
      <div><span>${phase[0]}</span><strong>${phase[1]}</strong></div><b>${phase[2]}</b><p>${phase[3]}</p><em>${index === 0 ? "当前阶段" : "稍后解锁"}</em>
    </section>`).join("")}</div>
  </div>`;
}

function renderLibrary() {
  const visible = phrases.filter((item) => (activeFilter === "全部" || item[0] === activeFilter)
    && item.join("").toLowerCase().includes(searchQuery.toLowerCase()));
  app.innerHTML = `<div class="page inner-page">
    <div class="page-title"><p class="eyebrow">语料库</p><h1>按场景调用，而不是孤立背单词</h1></div>
    <div class="library-tools"><label class="search"><input id="phrase-search" value="${escapeHtml(searchQuery)}" placeholder="搜索场景、英文或中文"></label>
      <div class="filters">${["全部", "工作英语", "生活英语"].map((name) => `<button class="${activeFilter === name ? "active" : ""}" data-filter="${name}">${name}</button>`).join("")}</div>
    </div>
    <div class="phrase-list">${visible.map((item) => `<article class="phrase"><div><span class="tag">${item[0]}</span><small>${item[1]}</small></div><strong>${item[2]}</strong><p>${item[3]}</p><button data-copy="${escapeHtml(item[2])}">复制表达</button></article>`).join("")}</div>
  </div>`;
  app.querySelector("#phrase-search").addEventListener("input", (event) => { searchQuery = event.target.value; renderLibrary(); });
  app.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { activeFilter = button.dataset.filter; renderLibrary(); }));
  app.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy);
    button.textContent = "已复制";
  }));
}

function renderEvidenceRows(items) {
  if (!items.length) return `<div class="empty">还没有作品。完成第一次录音后，它会出现在这里。</div>`;
  return items.map((item) => `<article class="evidence-row"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.snippet || "")}</p><small>${escapeHtml(item.duration || "")} · ${formatDate(item.createdAt)}</small>${item.audioId ? `<button data-audio="${item.audioId}">播放录音</button>` : ""}</article>`).join("");
}

function renderEvidence() {
  app.innerHTML = `<div class="page inner-page">
    <div class="page-title"><p class="eyebrow">作品与进步</p><h1>用可复查的输出证明进步</h1><p>所有数据从第 1 天开始，只记录你的真实训练。</p></div>
    <div class="mini-stats"><div><strong>${state.streak}</strong><span>连续天数</span></div><div><strong>${state.evidence.filter((item) => item.kind === "recording").length}</strong><span>录音练习</span></div></div>
    <div class="evidence-list">${renderEvidenceRows(state.evidence)}</div>
  </div>`;
  bindAudioButtons(app);
}

function bindAudioButtons(root) {
  root.querySelectorAll("[data-audio]").forEach((button) => button.addEventListener("click", async () => {
    const blob = await getAudio(button.dataset.audio);
    if (!blob) { button.textContent = "录音不存在"; return; }
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(blob);
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.autoplay = true;
    audio.src = currentAudioUrl;
    button.parentElement.append(audio);
  }));
}

function renderReview() {
  app.innerHTML = `<div class="page inner-page">
    <div class="page-title"><p class="eyebrow">每日复盘</p><h1>把今天的卡点变成明天的训练内容</h1></div>
    <div class="review-layout">
      <form id="review-form">
        <label>今天学到了什么？<textarea name="learned" maxlength="1000" placeholder="例如：解释限制时先承认客户诉求。"></textarea></label>
        <label>卡在哪里？<textarea name="blocked" maxlength="1000" placeholder="例如：说到下一步时容易停顿。"></textarea></label>
        <label>明天要调整什么？<textarea name="nextStep" maxlength="1000" placeholder="例如：复用 3 次 The next step is..."></textarea></label>
        <button class="primary-action" type="submit"><span>保存今日复盘</span><span>→</span></button>
      </form>
      <aside class="review-history"><h2>最近复盘</h2><div id="review-items"></div></aside>
    </div>
  </div>`;
  const history = app.querySelector("#review-items");
  history.innerHTML = state.reviews.length ? state.reviews.slice(0, 8).map((item) => `<article class="review-item"><small>${formatDate(item.createdAt)}</small><p>${escapeHtml(item.learned || item.blocked || item.nextStep)}</p></article>`).join("") : `<div class="empty">还没有复盘记录。</div>`;
  app.querySelector("#review-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const review = { id: crypto.randomUUID(), learned: data.get("learned").trim(), blocked: data.get("blocked").trim(), nextStep: data.get("nextStep").trim(), createdAt: new Date().toISOString() };
    if (!review.learned && !review.blocked && !review.nextStep) return;
    state.reviews.unshift(review);
    saveState();
    renderReview();
  });
}

function renderStudio() {
  app.innerHTML = `<div class="page inner-page">
    <button class="phrase-buttons" data-back="today">← 返回今日训练</button>
    <div class="studio-grid">
      <section class="scenario"><p class="eyebrow">今日场景 · 客户催进度</p><h1>客户问今天能否交付 50Gbps？</h1><p>你需要：说明带宽限制、避免过度承诺、给出下一步。</p>
        <h2>回应思路指引</h2>
        ${[["1","承认并聚焦问题","简要确认客户关切，明确当前问题。"],["2","说明限制","清晰说明带宽限制与原因。"],["3","给出下一步","在承诺前核实信息，并说明后续动作。"]].map((step) => `<div class="guide-step"><b>${step[0]}</b><div><strong>${step[1]}</strong><p>${step[2]}</p></div></div>`).join("")}
        <div class="phrase-buttons"><h2>可用表达</h2>${["The current issue is...","Our current limitation is...","Let me verify this before we commit.","The next step is..."].map((text) => `<button data-copy="${text}">${text}</button>`).join("")}</div>
      </section>
      <section class="recording"><p class="eyebrow">目标：给出专业、可靠、可执行的回答</p><h2>录音准备就绪</h2><p>录音保存在当前浏览器，可在“作品与进步”中回放。</p>
        <div class="timer"><span id="timer">00:00</span> <small>/ 00:45</small></div>
        <div id="record-action"><button id="record-start" class="record-button">开始录音回答</button></div>
        <div id="record-notice" aria-live="polite"></div>
      </section>
    </div>
  </div>`;
  app.querySelector("[data-back]").addEventListener("click", () => navigate("today"));
  app.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy);
    button.textContent = "已复制";
  }));
  app.querySelector("#record-start").addEventListener("click", startRecording);
}

async function startRecording() {
  const notice = app.querySelector("#record-notice");
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    notice.innerHTML = `<p class="notice error">当前浏览器不支持录音，请使用最新版 Chrome 或 Safari。</p>`;
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    recordingChunks = [];
    recordingSeconds = 0;
    recorder.ondataavailable = (event) => { if (event.data.size) recordingChunks.push(event.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      clearInterval(recordingTimer);
      const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
      const audioId = crypto.randomUUID();
      await saveAudio(audioId, blob);
      state.evidence.unshift({
        id: crypto.randomUUID(),
        title: `Day ${state.currentDay} · 50Gbps 快速反应`,
        kind: "recording",
        snippet: "说明限制、避免过度承诺、给出下一步",
        duration: formatDuration(recordingSeconds),
        audioId,
        createdAt: new Date().toISOString(),
      });
      saveState();
      notice.innerHTML = `<p class="notice">录音已保存在当前浏览器，可到“作品与进步”中回放。</p>`;
      app.querySelector("#record-action").innerHTML = `<button class="record-button" id="record-again">重新录制</button>`;
      app.querySelector("#record-again").addEventListener("click", startRecording);
    };
    recorder.start();
    app.querySelector("#record-action").innerHTML = `<div class="record-controls"><button id="record-pause">暂停</button><button id="record-stop" class="stop">结束录音</button></div>`;
    app.querySelector("#record-stop").addEventListener("click", () => recorder.state !== "inactive" && recorder.stop());
    app.querySelector("#record-pause").addEventListener("click", (event) => {
      if (recorder.state === "recording") { recorder.pause(); event.currentTarget.textContent = "继续"; }
      else { recorder.resume(); event.currentTarget.textContent = "暂停"; }
    });
    recordingTimer = setInterval(() => {
      if (recorder.state === "recording") recordingSeconds += 1;
      const timer = app.querySelector("#timer");
      if (timer) timer.textContent = formatDuration(recordingSeconds);
      if (recordingSeconds >= 45 && recorder.state !== "inactive") recorder.stop();
    }, 1000);
  } catch {
    notice.innerHTML = `<p class="notice error">无法使用麦克风，请允许浏览器麦克风权限后重试。</p>`;
  }
}

function formatDuration(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function openAudioDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("english-recovery-audio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("recordings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveAudio(id, blob) {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("recordings", "readwrite");
    transaction.objectStore("recordings").put(blob, id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getAudio(id) {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("recordings").objectStore("recordings").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

window.addEventListener("hashchange", render);
bindNavigation();
render();
