/* ===========================================================
   ARIA — 저장은 전부 localStorage(이 기기 안)에서만 이뤄짐
   =========================================================== */

const STORAGE_KEY = "diaryboard:v1";
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const DOW_KEYS = ["mon", "tue", "wed", "thu", "fri"];
const DOW_LABEL = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금" };

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
function fmtYmd(ymd) {
  return `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- 상태 ---------- */
function defaultSemester() {
  const m = new Date().getMonth() + 1;
  return m >= 3 && m <= 7 ? 1 : 2;
}
function defaultSchoolYear() {
  const now = new Date();
  const m = now.getMonth() + 1;
  return m < 3 ? now.getFullYear() - 1 : now.getFullYear();
}

const defaultState = {
  school: null, // { officeCode, schoolCode, name }
  neisKey: "",
  grade: "",
  classNm: "",
  semester: defaultSemester(),
  schoolYear: defaultSchoolYear(),
  periods: 7,
  timetable: { mon: [], tue: [], wed: [], thu: [], fri: [] },
  todos: [], // { id, text, done }
  notes: [], // { id, title, body, updatedAt }
  events: [], // { id, date: 'YYYYMMDD', title }
  mealCache: {} // ymd -> menu text
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(defaultState), parsed);
  } catch (e) {
    return structuredClone(defaultState);
  }
}
let state = loadState();
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------- 라우팅 ---------- */
let currentView = "home";
let calCursor = new Date(); // 캘린더에서 보고 있는 월
let calSelected = todayStr();
let openNoteId = null;

const viewEl = document.getElementById("view");
const tabbar = document.getElementById("tabbar");

tabbar.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  navigate(btn.dataset.view);
});

function navigate(view) {
  currentView = view;
  openNoteId = null;
  render();
}

document.getElementById("settings-btn").addEventListener("click", openSettingsModal);

function render() {
  [...tabbar.children].forEach((b) => b.classList.toggle("active", b.dataset.view === currentView));
  const label = document.getElementById("today-label");
  const now = new Date();
  label.textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 ${DOW[now.getDay()]}요일`;

  if (currentView === "home") renderHome();
  else if (currentView === "timetable") renderTimetable();
  else if (currentView === "todo") renderTodo();
  else if (currentView === "notes") renderNotes();
  else if (currentView === "calendar") renderCalendar();

  initIcons();
}

function initIcons() {
  if (window.lucide) window.lucide.createIcons();
}

/* ===========================================================
   나이스 오픈 API
   =========================================================== */
const NEIS_BASE = "https://open.neis.go.kr/hub";

async function neisFetch(endpoint, params) {
  const url = new URL(`${NEIS_BASE}/${endpoint}`);
  url.searchParams.set("Type", "json");
  if (state.neisKey) url.searchParams.set("KEY", state.neisKey);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("network");
  const data = await res.json();
  const root = data[endpoint];
  if (!root) {
    // RESULT 코드만 있는 경우 (검색 결과 없음 등)
    const code = data.RESULT?.CODE;
    if (code === "INFO-200") return [];
    throw new Error(data.RESULT?.MESSAGE || "조회 실패");
  }
  const head = root[0]?.head;
  const errCode = head?.find?.((h) => h.RESULT)?.RESULT?.CODE;
  if (errCode && errCode !== "INFO-000") {
    if (errCode === "INFO-200") return [];
    throw new Error("조회 실패 (" + errCode + ")");
  }
  return root[1]?.row || [];
}

async function searchSchools(name) {
  return neisFetch("schoolInfo", { SCHUL_NM: name });
}

async function fetchMeal(ymd) {
  if (state.mealCache[ymd]) return state.mealCache[ymd];
  if (!state.school) throw new Error("no-school");
  const rows = await neisFetch("mealServiceDietInfo", {
    ATPT_OFCDC_SC_CODE: state.school.officeCode,
    SD_SCHUL_CODE: state.school.schoolCode,
    MLSV_YMD: ymd
  });
  if (!rows.length) {
    state.mealCache[ymd] = "";
    saveState();
    return "";
  }
  // 여러 끼(조식/중식/석식)가 있으면 합쳐서 보여줌
  const text = rows
    .map((r) => r.DDISH_NM.replace(/<br\/?>/gi, "\n").replace(/\([0-9.]+\)/g, "").trim())
    .join("\n\n");
  state.mealCache[ymd] = text;
  saveState();
  return text;
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // 월요일로 이동
  d.setDate(d.getDate() + diff);
  return d;
}

async function fetchTimetableWeek() {
  if (!state.school) throw new Error("학교를 먼저 연결해주세요");
  if (!state.grade || !state.classNm) throw new Error("학년/반을 입력해주세요");

  const monday = mondayOf(new Date());
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);

  const rows = await neisFetch("hisTimetable", {
    ATPT_OFCDC_SC_CODE: state.school.officeCode,
    SD_SCHUL_CODE: state.school.schoolCode,
    AY: state.schoolYear,
    SEM: state.semester,
    GRADE: state.grade,
    CLASS_NM: state.classNm,
    TI_FROM_YMD: todayStr(monday),
    TI_TO_YMD: todayStr(friday)
  });

  const next = { mon: [], tue: [], wed: [], thu: [], fri: [] };
  let maxPeriod = state.periods;

  rows.forEach((r) => {
    const ymd = r.ALL_TI_YMD;
    const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`);
    const idx = d.getDay() - 1; // mon=0
    if (idx < 0 || idx > 4) return;
    const key = DOW_KEYS[idx];
    const period = Number(r.PERIO);
    const arr = next[key];
    while (arr.length < period) arr.push("");
    arr[period - 1] = (r.ITRT_CNTNT || "").trim();
    if (period > maxPeriod) maxPeriod = period;
  });

  if (!rows.length) throw new Error("이번 주 시간표 자료가 없어요 (아직 미등록이거나 방학 기간일 수 있어요)");

  state.timetable = next;
  state.periods = Math.min(maxPeriod, 10);
  saveState();
  return rows.length;
}

/* ===========================================================
   홈
   =========================================================== */
function renderHome() {
  const now = new Date();
  const dayIdx = now.getDay();
  const dowKey = DOW_KEYS[dayIdx - 1]; // mon=0
  const isWeekday = dayIdx >= 1 && dayIdx <= 5;
  const ymd = todayStr(now);

  viewEl.innerHTML = `
    <div class="section-title"><i data-lucide="utensils" class="ti"></i>오늘의 급식</div>
    <div id="meal-slot"></div>

    <div class="section-title"><i data-lucide="calendar-clock" class="ti"></i>오늘 시간표</div>
    <div id="tt-slot"></div>
  `;

  renderMealSlot(ymd);

  const ttSlot = document.getElementById("tt-slot");
  if (!isWeekday) {
    ttSlot.innerHTML = `<div class="empty-hint">주말엔 시간표가 없어요. 푹 쉬기 🌿</div>`;
  } else {
    const periods = state.timetable[dowKey] || [];
    const filled = periods.map((s, i) => ({ i: i + 1, s })).filter((p) => p.s && p.s.trim());
    if (!filled.length) {
      ttSlot.innerHTML = `<div class="empty-hint">아직 ${DOW_LABEL[dowKey]}요일 시간표가 없어요. '시간표' 탭에서 채워보세요.</div>`;
    } else {
      ttSlot.innerHTML = `<div class="today-schedule">${filled
        .map((p) => `<div class="period-pill"><div class="n">${p.i}교시</div><div class="s">${escapeHtml(p.s)}</div></div>`)
        .join("")}</div>`;
    }
  }
  initIcons();
}

function renderMealSlot(ymd) {
  const slot = document.getElementById("meal-slot");
  if (!state.school) {
    slot.innerHTML = `
      <div class="meal-card">
        <div class="meal-card-head"><h2>급식 정보</h2><span>${fmtYmd(ymd)}</span></div>
        <div class="meal-empty">학교가 아직 설정되지 않았어요.<br>설정에서 학교를 검색해 연결해보세요.
        <div><button onclick="openSettingsModal()">학교 설정하기</button></div>
        </div>
      </div>`;
    initIcons();
    return;
  }
  slot.innerHTML = `
    <div class="meal-card">
      <div class="meal-card-head"><h2>${escapeHtml(state.school.name)}</h2><span>${fmtYmd(ymd)}</span></div>
      <div class="meal-list" id="meal-text">불러오는 중…</div>
    </div>`;
  fetchMeal(ymd)
    .then((text) => {
      const el = document.getElementById("meal-text");
      if (!el) return;
      el.textContent = text || "오늘은 등록된 급식 정보가 없어요 (주말·방학 등).";
    })
    .catch((err) => {
      const el = document.getElementById("meal-text");
      if (!el) return;
      el.innerHTML = `급식 정보를 불러오지 못했어요.<br><span style="font-size:11.5px;color:var(--danger)">${escapeHtml(err.message || "")}</span>`;
    });
}

/* ===========================================================
   시간표 (수동 입력)
   =========================================================== */
function renderTimetable() {
  viewEl.innerHTML = `
    <div class="tt-toolbar">
      <div class="section-title" style="margin:0"><i data-lucide="calendar-clock" class="ti"></i>주간 시간표</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <div class="stepper">
          교시 수
          <button id="p-minus">−</button>
          <b id="p-count">${state.periods}</b>
          <button id="p-plus">+</button>
        </div>
        <button class="tt-fetch-btn" id="tt-fetch">나이스로 불러오기</button>
      </div>
    </div>
    <div class="tt-note">나이스 학급 시간표를 기준으로 불러와요. 선택과목 등으로 개인 시간표와 다를 수 있어 불러온 뒤 직접 칸을 눌러 수정할 수 있어요.</div>
    <div class="tt-grid" id="tt-grid"></div>
  `;
  buildTimetableGrid();

  document.getElementById("p-minus").onclick = () => {
    if (state.periods > 1) {
      state.periods--;
      saveState();
      renderTimetable();
    }
  };
  document.getElementById("p-plus").onclick = () => {
    if (state.periods < 10) {
      state.periods++;
      saveState();
      renderTimetable();
    }
  };
  document.getElementById("tt-fetch").onclick = async () => {
    const btn = document.getElementById("tt-fetch");
    if (!state.school || !state.grade || !state.classNm) {
      openSettingsModal();
      return;
    }
    btn.disabled = true;
    btn.textContent = "불러오는 중…";
    try {
      await fetchTimetableWeek();
      renderTimetable();
    } catch (err) {
      alert(err.message || "불러오기에 실패했어요.");
      btn.disabled = false;
      btn.textContent = "나이스로 불러오기";
    }
  };
  initIcons();
}

function buildTimetableGrid() {
  const grid = document.getElementById("tt-grid");
  let html = `<div></div>`;
  DOW_KEYS.forEach((k) => (html += `<div class="dow">${DOW_LABEL[k]}</div>`));
  for (let p = 0; p < state.periods; p++) {
    html += `<div class="pnum">${p + 1}</div>`;
    DOW_KEYS.forEach((k) => {
      const val = state.timetable[k][p] || "";
      html += `<div class="tt-cell"><textarea data-day="${k}" data-idx="${p}">${escapeHtml(val)}</textarea></div>`;
    });
  }
  grid.innerHTML = html;
  grid.querySelectorAll("textarea").forEach((ta) => {
    ta.addEventListener("input", (e) => {
      const day = e.target.dataset.day;
      const idx = Number(e.target.dataset.idx);
      const arr = state.timetable[day];
      while (arr.length <= idx) arr.push("");
      arr[idx] = e.target.value;
      saveState();
    });
  });
}

/* ===========================================================
   할일
   =========================================================== */
function renderTodo() {
  const items = state.todos;
  viewEl.innerHTML = `
    <div class="section-title" style="margin-top:8px"><i data-lucide="check-square" class="ti"></i>할일</div>
    <div class="add-row">
      <input id="todo-input" placeholder="할일을 입력하고 추가..." />
      <button class="add-btn" id="todo-add">+</button>
    </div>
    <div id="todo-list"></div>
  `;
  const list = document.getElementById("todo-list");
  if (!items.length) {
    list.innerHTML = `<div class="empty-hint">아직 할일이 없어요.</div>`;
  } else {
    list.innerHTML = items
      .slice()
      .reverse()
      .map(
        (t) => `
        <div class="todo-item ${t.done ? "done" : ""}" data-id="${t.id}">
          <button class="todo-check">${t.done ? "✓" : ""}</button>
          <div class="todo-text">${escapeHtml(t.text)}</div>
          <button class="del-btn">✕</button>
        </div>`
      )
      .join("");
  }

  document.getElementById("todo-add").onclick = addTodo;
  document.getElementById("todo-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTodo();
  });
  list.querySelectorAll(".todo-check").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      const id = e.target.closest(".todo-item").dataset.id;
      const t = state.todos.find((x) => x.id === id);
      t.done = !t.done;
      saveState();
      renderTodo();
    })
  );
  list.querySelectorAll(".del-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      const id = e.target.closest(".todo-item").dataset.id;
      state.todos = state.todos.filter((x) => x.id !== id);
      saveState();
      renderTodo();
    })
  );
  initIcons();
}
function addTodo() {
  const input = document.getElementById("todo-input");
  const text = input.value.trim();
  if (!text) return;
  state.todos.push({ id: uid(), text, done: false });
  saveState();
  input.value = "";
  renderTodo();
}

/* ===========================================================
   노트
   =========================================================== */
function renderNotes() {
  if (openNoteId) return renderNoteEditor();
  const notes = state.notes.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  viewEl.innerHTML = `
    <div class="section-title" style="margin-top:8px"><i data-lucide="file-text" class="ti"></i>노트</div>
    <div class="add-row">
      <input id="note-title-new" placeholder="새 노트 제목..." />
      <button class="add-btn" id="note-add">+</button>
    </div>
    <div id="note-list"></div>
  `;
  const list = document.getElementById("note-list");
  if (!notes.length) {
    list.innerHTML = `<div class="empty-hint">아직 노트가 없어요.</div>`;
  } else {
    list.innerHTML = notes
      .map(
        (n) => `
      <div class="note-item" data-id="${n.id}">
        <div>
          <h3>${escapeHtml(n.title || "제목 없음")}</h3>
          <p>${escapeHtml((n.body || "").slice(0, 60))}</p>
          <div class="meta">${new Date(n.updatedAt).toLocaleDateString("ko-KR")}</div>
        </div>
        <button class="del-btn" data-del="${n.id}">✕</button>
      </div>`
      )
      .join("");
  }
  document.getElementById("note-add").onclick = () => {
    const titleInput = document.getElementById("note-title-new");
    const title = titleInput.value.trim() || "제목 없음";
    const n = { id: uid(), title, body: "", updatedAt: Date.now() };
    state.notes.push(n);
    saveState();
    openNoteId = n.id;
    renderNotes();
  };
  list.querySelectorAll(".note-item").forEach((el) =>
    el.addEventListener("click", (e) => {
      if (e.target.closest(".del-btn")) return;
      openNoteId = el.dataset.id;
      renderNotes();
    })
  );
  list.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.notes = state.notes.filter((n) => n.id !== btn.dataset.del);
      saveState();
      renderNotes();
    })
  );
  initIcons();
}

function renderNoteEditor() {
  const note = state.notes.find((n) => n.id === openNoteId);
  if (!note) {
    openNoteId = null;
    return renderNotes();
  }
  viewEl.innerHTML = `
    <div class="back-row">
      <button id="note-back">‹ 노트 목록</button>
      <button class="del-btn" id="note-del">삭제</button>
    </div>
    <div class="note-editor">
      <input class="note-title" id="note-title" value="${escapeAttr(note.title)}" placeholder="제목" />
      <textarea class="note-body" id="note-body" placeholder="내용을 적어보세요...">${escapeHtml(note.body || "")}</textarea>
    </div>
  `;
  document.getElementById("note-back").onclick = () => {
    openNoteId = null;
    renderNotes();
  };
  document.getElementById("note-del").onclick = () => {
    state.notes = state.notes.filter((n) => n.id !== note.id);
    saveState();
    openNoteId = null;
    renderNotes();
  };
  const titleEl = document.getElementById("note-title");
  const bodyEl = document.getElementById("note-body");
  const persist = () => {
    note.title = titleEl.value;
    note.body = bodyEl.value;
    note.updatedAt = Date.now();
    saveState();
  };
  titleEl.addEventListener("input", persist);
  bodyEl.addEventListener("input", persist);
}

/* ===========================================================
   캘린더
   =========================================================== */
function renderCalendar() {
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayYmd = todayStr();

  let cells = "";
  for (let i = 0; i < firstDay; i++) cells += `<div class="cal-day blank"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = `${y}${String(m + 1).padStart(2, "0")}${String(d).padStart(2, "0")}`;
    const hasEvent = state.events.some((ev) => ev.date === ymd);
    const cls = ["cal-day"];
    if (ymd === todayYmd) cls.push("today");
    if (ymd === calSelected) cls.push("selected");
    cells += `<div class="${cls.join(" ")}" data-ymd="${ymd}">${d}${hasEvent ? '<div class="dot"></div>' : ""}</div>`;
  }

  viewEl.innerHTML = `
    <div class="cal-head">
      <h2>${y}년 ${m + 1}월</h2>
      <div class="cal-nav">
        <button id="cal-prev">‹</button>
        <button id="cal-next">›</button>
      </div>
    </div>
    <div class="cal-grid">
      ${DOW.map((d) => `<div class="dow">${d}</div>`).join("")}
      ${cells}
    </div>
    <div class="day-panel">
      <div class="section-title" id="day-panel-title"></div>
      <div class="add-row">
        <input id="event-input" placeholder="일정 추가..." />
        <button class="add-btn" id="event-add">+</button>
      </div>
      <div id="event-list"></div>
    </div>
  `;

  document.getElementById("cal-prev").onclick = () => {
    calCursor = new Date(y, m - 1, 1);
    renderCalendar();
  };
  document.getElementById("cal-next").onclick = () => {
    calCursor = new Date(y, m + 1, 1);
    renderCalendar();
  };
  viewEl.querySelectorAll(".cal-day:not(.blank)").forEach((el) =>
    el.addEventListener("click", () => {
      calSelected = el.dataset.ymd;
      renderCalendar();
    })
  );
  document.getElementById("event-add").onclick = addEvent;
  document.getElementById("event-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addEvent();
  });

  renderDayPanel();
  initIcons();
}

function renderDayPanel() {
  const title = document.getElementById("day-panel-title");
  title.textContent = `${fmtYmd(calSelected)} 일정`;
  const list = document.getElementById("event-list");
  const evs = state.events.filter((e) => e.date === calSelected);
  if (!evs.length) {
    list.innerHTML = `<div class="empty-hint">이 날 등록된 일정이 없어요.</div>`;
  } else {
    list.innerHTML = evs
      .map((e) => `<div class="event-item"><span>${escapeHtml(e.title)}</span><button class="del-btn" data-id="${e.id}">✕</button></div>`)
      .join("");
    list.querySelectorAll(".del-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.events = state.events.filter((e) => e.id !== btn.dataset.id);
        saveState();
        renderCalendar();
      })
    );
  }
}
function addEvent() {
  const input = document.getElementById("event-input");
  const title = input.value.trim();
  if (!title) return;
  state.events.push({ id: uid(), date: calSelected, title });
  saveState();
  input.value = "";
  renderCalendar();
}

/* ===========================================================
   설정 모달 (학교 검색 + API 키)
   =========================================================== */
function openSettingsModal() {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-sheet">
        <div class="close-row"><button id="modal-close">×</button></div>
        <h2>학교 연결</h2>
        <p class="modal-sub">급식과 시간표를 자동으로 불러오려면 나이스(NEIS) 인증키와 학교 정보가 필요해요.</p>

        <div class="guide-box">
          <ol>
            <li><a href="https://open.neis.go.kr/portal/mainPage.do" target="_blank" rel="noopener">open.neis.go.kr</a> 접속 후 회원가입 · 로그인</li>
            <li>상단 메뉴에서 <b>오픈API활용 → 활용신청</b> 이동</li>
            <li>"학교급식식단정보", "시간표" 서비스를 신청 (보통 자동으로 즉시 승인돼요)</li>
            <li>마이페이지에서 발급된 인증키를 복사해 아래에 붙여넣기</li>
          </ol>
        </div>

        <div class="field">
          <label>나이스 Open API 인증키</label>
          <input id="neis-key" placeholder="발급받은 인증키 붙여넣기" value="${escapeAttr(state.neisKey)}" />
          <div class="field-hint">이 기기의 브라우저 안에만 저장되고 외부로 전송되지 않아요.</div>
        </div>

        ${
          state.school
            ? `<div class="school-tag"><div><strong>${escapeHtml(state.school.name)}</strong>연결된 학교</div><button class="del-btn" id="school-clear">해제</button></div>`
            : `<div class="field">
                <label>학교 검색</label>
                <input id="school-search" placeholder="학교 이름을 입력하세요" />
              </div>
              <button class="btn-secondary" id="school-search-btn">검색</button>
              <div id="school-results"></div>`
        }

        ${
          state.school
            ? `
        <div class="field-row" style="margin-top:16px;">
          <div class="field">
            <label>학년도</label>
            <input id="school-year" type="number" value="${escapeAttr(state.schoolYear)}" />
          </div>
          <div class="field">
            <label>학기</label>
            <select id="school-sem">
              <option value="1" ${state.semester === 1 ? "selected" : ""}>1학기</option>
              <option value="2" ${state.semester === 2 ? "selected" : ""}>2학기</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>학년</label>
            <input id="school-grade" placeholder="예: 2" value="${escapeAttr(state.grade)}" />
          </div>
          <div class="field">
            <label>반</label>
            <input id="school-class" placeholder="예: 5" value="${escapeAttr(state.classNm)}" />
          </div>
        </div>
        <div class="field-hint" style="margin-bottom:6px;">학년/반은 '시간표' 탭에서 나이스 시간표를 자동으로 불러올 때 쓰여요.</div>
        `
            : ""
        }
      </div>
    </div>
  `;

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });

  const keyInput = document.getElementById("neis-key");
  keyInput.addEventListener("change", () => {
    state.neisKey = keyInput.value.trim();
    saveState();
  });

  const clearBtn = document.getElementById("school-clear");
  if (clearBtn) {
    clearBtn.onclick = () => {
      state.school = null;
      state.mealCache = {};
      saveState();
      openSettingsModal();
    };
  }

  const searchBtn = document.getElementById("school-search-btn");
  if (searchBtn) {
    searchBtn.onclick = doSchoolSearch;
    document.getElementById("school-search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSchoolSearch();
    });
  }

  const yearInput = document.getElementById("school-year");
  if (yearInput) {
    yearInput.addEventListener("change", () => {
      state.schoolYear = Number(yearInput.value) || defaultSchoolYear();
      saveState();
    });
  }
  const semSelect = document.getElementById("school-sem");
  if (semSelect) {
    semSelect.addEventListener("change", () => {
      state.semester = Number(semSelect.value);
      saveState();
    });
  }
  const gradeInput = document.getElementById("school-grade");
  if (gradeInput) {
    gradeInput.addEventListener("change", () => {
      state.grade = gradeInput.value.trim();
      saveState();
    });
  }
  const classInput = document.getElementById("school-class");
  if (classInput) {
    classInput.addEventListener("change", () => {
      state.classNm = classInput.value.trim();
      saveState();
    });
  }
  initIcons();
}

async function doSchoolSearch() {
  const input = document.getElementById("school-search");
  const resultsEl = document.getElementById("school-results");
  const q = input.value.trim();
  if (!q) return;
  resultsEl.innerHTML = `<div class="empty-hint">검색 중…</div>`;
  try {
    const rows = await searchSchools(q);
    if (!rows.length) {
      resultsEl.innerHTML = `<div class="empty-hint">검색 결과가 없어요.</div>`;
      return;
    }
    resultsEl.innerHTML = rows
      .slice(0, 20)
      .map(
        (r) => `
      <div class="result-item" data-office="${r.ATPT_OFCDC_SC_CODE}" data-code="${r.SD_SCHUL_CODE}" data-name="${escapeAttr(r.SCHUL_NM)}">
        <span>${escapeHtml(r.SCHUL_NM)}</span>
        <small>${escapeHtml(r.LCTN_SC_NM || "")}</small>
      </div>`
      )
      .join("");
    resultsEl.querySelectorAll(".result-item").forEach((el) =>
      el.addEventListener("click", () => {
        state.school = { officeCode: el.dataset.office, schoolCode: el.dataset.code, name: el.dataset.name };
        state.mealCache = {};
        saveState();
        openSettingsModal();
        if (currentView === "home") renderHome();
        if (currentView === "timetable") renderTimetable();
      })
    );
  } catch (err) {
    resultsEl.innerHTML = `<div class="empty-hint">검색에 실패했어요: ${escapeHtml(err.message || "")}</div>`;
  }
}

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

/* ---------- 유틸 ---------- */
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}

/* ---------- 초기화 ---------- */
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
