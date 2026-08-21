/* ===========================================================
   ARIA — 저장은 전부 localStorage(이 기기 안)에서만 이뤄짐
   =========================================================== */

const STORAGE_KEY = "diaryboard:v1";

// 버그 신고 메일을 받을 주소 — 본인 이메일로 바꿔주세요.
const BUG_REPORT_EMAIL = "ARIA.myarea@gmail.com";
// Formspree(formspree.io) 무료 계정에서 폼을 만들면 나오는 주소를 여기 넣으면,
// 메일 앱을 열지 않고도 신고 내용(+사진)이 바로 전송돼요. 비워두면 예전처럼
// 메일 앱을 여는 방식으로 대신 동작해요 (이 경우 사진 첨부는 안 돼요).
const BUG_REPORT_FORM_ENDPOINT = "https://formspree.io/f/xkjwkedd";
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const DOW_KEYS = ["mon", "tue", "wed", "thu", "fri"];
const WEEK_DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DOW_LABEL = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

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
  timetable: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
  todos: [], // { id, text, done }
  events: [], // { id, date: 'YYYYMMDD', title }
  mealCache: {}, // ymd -> { 조식: '...', 중식: '...', 석식: '...' }
  weatherCache: null, // { lat, lon, data, ts }
  darkMode: false,
  dday: null // { date: 'YYYYMMDD', label: '기말고사' }
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    const merged = Object.assign(structuredClone(defaultState), parsed);
    // 이전 버전 호환: timetable에 토/일 등 누락된 요일 키가 있으면 채워넣기
    merged.timetable = Object.assign(
      { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      merged.timetable || {}
    );
    // 이전 버전의 급식 캐시(문자열 형식)가 남아있으면 제거
    if (merged.mealCache) {
      Object.keys(merged.mealCache).forEach((k) => {
        if (typeof merged.mealCache[k] !== "object") delete merged.mealCache[k];
      });
    }
    return merged;
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

const viewEl = document.getElementById("view");
const tabbar = document.getElementById("tabbar");

tabbar.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  navigate(btn.dataset.view);
});

function navigate(view) {
  currentView = view;
  render();
  window.scrollTo(0, 0);
}

document.getElementById("settings-btn").addEventListener("click", openSettingsModal);

function render() {
  [...tabbar.children].forEach((b) => b.classList.toggle("active", b.dataset.view === currentView));
  const label = document.getElementById("today-label");
  const now = new Date();
  label.textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 ${DOW[now.getDay()]}요일`;

  if (currentView === "home") renderHome();
  else if (currentView === "timetable") renderTimetable();
  else if (currentView === "meal") renderMeal();
  else if (currentView === "todo") renderTodo();
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
  const cached = state.mealCache[ymd];
  if (cached && typeof cached === "object") return cached;
  if (!state.school) throw new Error("no-school");
  const rows = await neisFetch("mealServiceDietInfo", {
    ATPT_OFCDC_SC_CODE: state.school.officeCode,
    SD_SCHUL_CODE: state.school.schoolCode,
    MLSV_YMD: ymd
  });
  const meals = { "조식": "", "중식": "", "석식": "" };
  rows.forEach((r) => {
    const name = r.MMEAL_SC_NM || "중식";
    const text = (r.DDISH_NM || "")
      .replace(/<br\/?>/gi, "\n")
      .replace(/\([0-9.]+\)/g, "")
      .trim();
    if (name in meals) meals[name] = text;
    else meals[name] = text;
  });
  state.mealCache[ymd] = meals;
  saveState();
  return meals;
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

  const next = {
    mon: [], tue: [], wed: [], thu: [], fri: [],
    sat: state.timetable.sat || [],
    sun: state.timetable.sun || []
  };
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
   홈 (추후 채울 예정 — 지금은 비워둠)
   =========================================================== */
const DAILY_QUESTIONS = [
  "오늘 하루 중 가장 기억에 남는 순간은?",
  "오늘 나를 웃게 한 일이 있다면?",
  "지금 가장 하고 싶은 게 뭐야?",
  "오늘 감사한 일 한 가지를 꼽는다면?",
  "요즘 제일 신경 쓰이는 건 뭐야?",
  "오늘 스스로를 칭찬한다면 어떤 점?",
  "내일의 나에게 하고 싶은 말은?",
  "요즘 자주 떠오르는 생각은?",
  "오늘 컨디션을 한 단어로 표현한다면?",
  "최근에 새로 알게 된 거 하나는?",
  "오늘 누군가에게 고마웠던 순간은?",
  "요즘 가장 듣고 싶은 말은?",
  "오늘 제일 잘한 선택은 뭐였어?",
  "지금 기분을 날씨로 비유하면?",
  "이번 주말에 하고 싶은 건?",
  "요즘 무슨 노래를 제일 많이 들어?",
  "오늘 하루를 다시 산다면 뭘 바꾸고 싶어?",
  "지금 가장 응원받고 싶은 부분은?"
];

function ymdToIso(ymd) {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}
function isoToYmd(iso) {
  return iso.replaceAll("-", "");
}
function ddayText(ymd) {
  const target = new Date(ymdToIso(ymd));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return "D-DAY";
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

function renderDdaySlot() {
  const slot = document.getElementById("dday-slot");
  if (!state.dday) {
    slot.innerHTML = `
      <div class="meal-card">
        <div class="empty-state">
          <i data-lucide="flag" class="empty-state-icon"></i>
          <p class="empty-state-text">중요한 날짜를 등록하면<br>디데이를 보여드려요.</p>
          <button class="empty-state-btn" id="dday-setup"><i data-lucide="plus"></i>디데이 등록하기</button>
        </div>
      </div>`;
    document.getElementById("dday-setup").onclick = openDdayModal;
    initIcons();
    return;
  }
  slot.innerHTML = `
    <div class="meal-card dday-card" id="dday-card">
      <div class="dday-label">${escapeHtml(state.dday.label)}</div>
      <div class="dday-count">${ddayText(state.dday.date)}</div>
      <div class="dday-date">${fmtYmd(state.dday.date)}</div>
    </div>`;
  document.getElementById("dday-card").onclick = openDdayModal;
}

function openDdayModal() {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-sheet">
        <div class="close-row"><button id="modal-close">×</button></div>
        <h2>디데이 설정</h2>
        <div class="field">
          <label>날짜</label>
          <input type="date" id="dday-date-input" value="${state.dday ? ymdToIso(state.dday.date) : ""}" />
        </div>
        <div class="field">
          <label>이름</label>
          <input type="text" id="dday-label-input" placeholder="예: 기말고사" value="${state.dday ? escapeAttr(state.dday.label) : ""}" />
        </div>
        <button class="btn-primary" id="dday-save">저장</button>
        ${state.dday ? `<button class="btn-secondary" id="dday-delete">삭제</button>` : ""}
      </div>
    </div>
  `;
  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });
  document.getElementById("dday-save").onclick = () => {
    const iso = document.getElementById("dday-date-input").value;
    const label = document.getElementById("dday-label-input").value.trim();
    if (!iso) {
      alert("날짜를 선택해주세요.");
      return;
    }
    state.dday = { date: isoToYmd(iso), label: label || "디데이" };
    saveState();
    closeModal();
    if (currentView === "home") renderHome();
  };
  const delBtn = document.getElementById("dday-delete");
  if (delBtn) {
    delBtn.onclick = () => {
      state.dday = null;
      saveState();
      closeModal();
      if (currentView === "home") renderHome();
    };
  }
}

function renderHome() {
  const question = DAILY_QUESTIONS[Math.floor(Math.random() * DAILY_QUESTIONS.length)];
  viewEl.innerHTML = `
    <div class="section-title"><i data-lucide="flag" class="ti"></i>디데이</div>
    <div id="dday-slot"></div>

    <div class="section-title"><i data-lucide="sparkles" class="ti"></i>오늘의 질문</div>
    <div class="question-card">${escapeHtml(question)}</div>

    <div class="section-title"><i data-lucide="cloud-sun" class="ti"></i>오늘 날씨</div>
    <div id="weather-slot"></div>
    <div class="source-note">날씨 정보 제공: Open-Meteo (open-meteo.com)</div>
  `;
  renderDdaySlot();
  renderWeatherSlot();
  initIcons();
}

const WEATHER_INFO = {
  0: { label: "맑음", icon: "sun" },
  1: { label: "대체로 맑음", icon: "cloud-sun" },
  2: { label: "구름 조금", icon: "cloud-sun" },
  3: { label: "흐림", icon: "cloud" },
  45: { label: "안개", icon: "cloud-fog" },
  48: { label: "안개", icon: "cloud-fog" },
  51: { label: "이슬비", icon: "cloud-drizzle" },
  53: { label: "이슬비", icon: "cloud-drizzle" },
  55: { label: "이슬비", icon: "cloud-drizzle" },
  61: { label: "비", icon: "cloud-rain" },
  63: { label: "비", icon: "cloud-rain" },
  65: { label: "강한 비", icon: "cloud-rain" },
  71: { label: "눈", icon: "snowflake" },
  73: { label: "눈", icon: "snowflake" },
  75: { label: "강한 눈", icon: "snowflake" },
  80: { label: "소나기", icon: "cloud-rain-wind" },
  81: { label: "소나기", icon: "cloud-rain-wind" },
  82: { label: "강한 소나기", icon: "cloud-rain-wind" },
  95: { label: "뇌우", icon: "cloud-lightning" },
  96: { label: "뇌우", icon: "cloud-lightning" },
  99: { label: "뇌우", icon: "cloud-lightning" }
};
function weatherInfo(code) {
  return WEATHER_INFO[code] || { label: "-", icon: "cloud" };
}

const WEATHER_STALE_MS = 120 * 60 * 1000; // 2시간

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("weather-network");
  return res.json();
}

function weatherCardHtml(data) {
  const info = weatherInfo(data.current.weather_code);
  const temp = Math.round(data.current.temperature_2m);
  const feels = Math.round(data.current.apparent_temperature);
  const hi = Math.round(data.daily.temperature_2m_max[0]);
  const lo = Math.round(data.daily.temperature_2m_min[0]);
  const humidity = Math.round(data.current.relative_humidity_2m);
  const wind = Math.round(data.current.wind_speed_10m);
  return `
    <div class="meal-card weather-card">
      <div class="weather-row">
        <i data-lucide="${info.icon}" class="weather-icon"></i>
        <div>
          <div class="weather-temp">${temp}°</div>
          <div class="weather-label">${info.label} · 체감 ${feels}°</div>
        </div>
      </div>
      <div class="weather-stats">
        <div class="weather-stat"><i data-lucide="arrow-up" class="ti"></i>최고 ${hi}°</div>
        <div class="weather-stat"><i data-lucide="arrow-down" class="ti"></i>최저 ${lo}°</div>
        <div class="weather-stat"><i data-lucide="droplets" class="ti"></i>습도 ${humidity}%</div>
        <div class="weather-stat"><i data-lucide="wind" class="ti"></i>바람 ${wind}km/h</div>
      </div>
    </div>`;
}

function getAndCacheWeather(silent) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      fetchWeather(latitude, longitude)
        .then((data) => {
          state.weatherCache = { lat: latitude, lon: longitude, data, ts: Date.now() };
          saveState();
          const slot = document.getElementById("weather-slot");
          if (slot) {
            slot.innerHTML = weatherCardHtml(data);
            initIcons();
          }
        })
        .catch(() => {
          if (!silent) {
            const body = document.getElementById("weather-body");
            if (body) body.textContent = "날씨 정보를 가져오지 못했어요.";
          }
        });
    },
    () => {
      if (!silent) {
        const body = document.getElementById("weather-body");
        if (body) body.textContent = "위치 접근이 거부됐어요. 브라우저 설정에서 위치 권한을 허용해주세요.";
      }
    }
  );
}

function renderWeatherSlot() {
  const slot = document.getElementById("weather-slot");
  if (!("geolocation" in navigator)) {
    slot.innerHTML = `<div class="meal-card"><div class="meal-empty">이 브라우저에서는 위치 정보를 가져올 수 없어요.</div></div>`;
    return;
  }

  const cache = state.weatherCache;
  if (cache) {
    // 캐시가 있으면 즉시 보여주고, 오래됐으면 조용히 새로고침
    slot.innerHTML = weatherCardHtml(cache.data);
    initIcons();
    if (Date.now() - cache.ts > WEATHER_STALE_MS) {
      getAndCacheWeather(true);
    }
    return;
  }

  // 처음이면 권한 상태를 먼저 조용히 확인해서, 이미 허용돼 있으면 바로 불러온다
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (status.state === "granted") {
          slot.innerHTML = `<div class="meal-card"><div class="meal-empty" id="weather-body">날씨를 불러오는 중…</div></div>`;
          getAndCacheWeather(false);
        } else {
          showWeatherPrompt();
        }
      })
      .catch(showWeatherPrompt);
  } else {
    showWeatherPrompt();
  }
}

function showWeatherPrompt() {
  const slot = document.getElementById("weather-slot");
  if (!slot) return;
  slot.innerHTML = `
    <div class="meal-card">
      <div class="empty-state">
        <i data-lucide="map-pin" class="empty-state-icon"></i>
        <p class="empty-state-text" id="weather-body">날씨를 가져오려면<br>위치 접근을 허용해주세요.</p>
        <button class="empty-state-btn" id="weather-allow"><i data-lucide="navigation"></i>위치 허용하고 보기</button>
      </div>
    </div>`;
  initIcons();
  document.getElementById("weather-allow").onclick = () => {
    document.getElementById("weather-body").innerHTML = "위치 확인 중…";
    getAndCacheWeather(false);
  };
}

/* ===========================================================
   급식
   =========================================================== */
function mealTargetDate() {
  // 오후 6시 30분이 지나면 내일 급식을 보여준다
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(18, 30, 0, 0);
  const target = new Date(now);
  if (now >= cutoff) target.setDate(target.getDate() + 1);
  return { ymd: todayStr(target), isTomorrow: now >= cutoff };
}

function renderMeal() {
  const { ymd, isTomorrow } = mealTargetDate();
  viewEl.innerHTML = `
    <div class="section-title"><i data-lucide="utensils" class="ti"></i>${isTomorrow ? "내일의 급식" : "오늘의 급식"}</div>
    <div class="tt-note">오후 6시 30분이 지나면 자동으로 다음 날 급식으로 넘어가요.</div>
    <div id="meal-slot"></div>
  `;
  renderMealSlot(ymd);
}

const MEAL_ORDER = [
  { key: "조식", icon: "sunrise" },
  { key: "중식", icon: "sun" },
  { key: "석식", icon: "moon" }
];

function renderMealSlot(ymd) {
  const slot = document.getElementById("meal-slot");
  if (!state.school) {
    slot.innerHTML = `
      <div class="meal-card">
        <div class="empty-state">
          <i data-lucide="school" class="empty-state-icon"></i>
          <p class="empty-state-text">학교가 아직 설정되지 않았어요.<br>설정에서 학교를 검색해 연결해보세요.</p>
          <button class="empty-state-btn" onclick="openSettingsModal()"><i data-lucide="settings-2"></i>학교 설정하기</button>
        </div>
      </div>`;
    initIcons();
    return;
  }
  slot.innerHTML = `
    <div class="meal-card">
      <div class="meal-card-head"><h2>${escapeHtml(state.school.name)}</h2><span>${fmtYmd(ymd)}</span></div>
      <div id="meal-sections">불러오는 중…</div>
    </div>`;
  fetchMeal(ymd)
    .then((meals) => {
      const el = document.getElementById("meal-sections");
      if (!el) return;
      const any = MEAL_ORDER.some((m) => meals[m.key]);
      if (!any) {
        el.innerHTML = `<div class="meal-empty">오늘은 등록된 급식 정보가 없어요 (주말·방학 등).</div>`;
        return;
      }
      el.innerHTML = MEAL_ORDER.map(
        (m) => `
        <div class="meal-section">
          <div class="meal-section-head"><i data-lucide="${m.icon}" class="ti"></i>${m.key}</div>
          <div class="meal-list">${meals[m.key] ? escapeHtml(meals[m.key]) : '<span class="meal-none">정보 없음</span>'}</div>
        </div>`
      ).join("");
      initIcons();
    })
    .catch((err) => {
      const el = document.getElementById("meal-sections");
      if (!el) return;
      el.innerHTML = `급식 정보를 불러오지 못했어요.<br><span style="font-size:11.5px;color:var(--danger)">${escapeHtml(err.message || "")}</span>`;
    });
}

/* ===========================================================
   시간표 (수동 입력 + 나이스 불러오기)
   =========================================================== */
function renderTimetable() {
  viewEl.innerHTML = `
    <div class="tt-toolbar">
      <div class="section-title" style="margin:0"><i data-lucide="calendar-clock" class="ti"></i>주간 시간표</div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <div class="stepper">
          교시 수
          <button id="p-minus"><i data-lucide="minus"></i></button>
          <b id="p-count">${state.periods}</b>
          <button id="p-plus"><i data-lucide="plus"></i></button>
        </div>
        <button class="tt-fetch-btn" id="tt-fetch">나이스로 불러오기</button>
        <button class="tt-fetch-btn" id="tt-copy"><i data-lucide="clipboard-copy" style="width:12px;height:12px;margin-right:4px;"></i>위젯용 복사</button>
        <button class="mini-trash" id="tt-clear" title="시간표 모두 삭제"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
    <div class="tt-note">나이스 학급 시간표를 기준으로 불러와요. 선택과목 등으로 개인 시간표와 다를 수 있어 불러온 뒤 직접 칸을 눌러 수정할 수 있어요. '위젯용 복사'는 아이패드 홈 화면 위젯(Scriptable)에 붙여넣을 수 있는 형태로 복사해줘요.</div>
    <div class="tt-grid" id="tt-grid"></div>
  `;
  buildTimetableGrid();
  initIcons();

  document.getElementById("tt-copy").onclick = async () => {
    const btn = document.getElementById("tt-copy");
    const text = timetableToScriptableText();
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.innerHTML;
      btn.textContent = "복사됐어요!";
      setTimeout(() => {
        btn.innerHTML = original;
      }, 1600);
    } catch (e) {
      alert("복사에 실패했어요. 기기의 클립보드 권한을 확인해주세요.");
    }
  };

  document.getElementById("tt-clear").onclick = () => {
    const hasAny = Object.values(state.timetable).some((arr) => arr.some((s) => s && s.trim()));
    if (!hasAny) return;
    openConfirmModal("시간표 모두 삭제", "입력한 시간표 내용을 전부 지울까요? 되돌릴 수 없어요.", () => {
      state.timetable = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
      saveState();
      renderTimetable();
    });
  };

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

function timetableToScriptableText() {
  const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const lines = keys.map((k) => {
    const arr = state.timetable[k] || [];
    const items = arr.map((s) => JSON.stringify(s || "")).join(", ");
    return `  ${k}: [${items}]`;
  });
  return `const TIMETABLE = {\n${lines.join(",\n")}\n};`;
}

function buildTimetableGrid() {
  const grid = document.getElementById("tt-grid");
  let html = `<div></div>`;
  WEEK_DOW_KEYS.forEach((k) => (html += `<div class="dow ${k === "sun" ? "sun" : k === "sat" ? "sat" : ""}">${DOW_LABEL[k]}</div>`));
  for (let p = 0; p < state.periods; p++) {
    html += `<div class="pnum">${p + 1}</div>`;
    WEEK_DOW_KEYS.forEach((k) => {
      const val = state.timetable[k][p] || "";
      html += `<div class="tt-cell"><input type="text" data-day="${k}" data-idx="${p}" value="${escapeAttr(val)}" /></div>`;
    });
  }
  grid.innerHTML = html;
  grid.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("input", (e) => {
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
const TODO_COLORS = ["#E15B4F", "#E08D3C", "#E8C547", "#4C8065", "#4472C4", "#D97CA0", "#FFFFFF", "#7C6FAE"];
let newTodoColor = TODO_COLORS[0];

function renderTodo() {
  const items = state.todos;
  viewEl.innerHTML = `
    <div class="section-title-row">
      <div class="section-title"><i data-lucide="check-square" class="ti"></i>할일</div>
      <button class="mini-trash" id="todo-clear" title="할일 모두 삭제"><i data-lucide="trash-2"></i></button>
    </div>
    <div class="add-row">
      <input id="todo-input" placeholder="할일을 입력하고 추가..." />
      <button class="add-btn" id="todo-add">+</button>
    </div>
    <div class="color-row" id="todo-color-row">
      ${TODO_COLORS.map(
        (c) => `<button class="color-dot ${c === newTodoColor ? "active" : ""}" data-color="${c}" style="--dot:${c}"></button>`
      ).join("")}
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
        <div class="todo-item ${t.done ? "done" : ""}" data-id="${t.id}" style="border-left-color:${t.color || "var(--line)"}">
          <button class="todo-check">${t.done ? "✓" : ""}</button>
          <div class="todo-text">${escapeHtml(t.text)}</div>
          <button class="del-btn">✕</button>
        </div>`
      )
      .join("");
  }

  document.getElementById("todo-add").onclick = addTodo;
  document.getElementById("todo-clear").onclick = () => {
    if (!state.todos.length) return;
    openConfirmModal("할일 모두 삭제", "저장된 할일을 전부 삭제할까요? 되돌릴 수 없어요.", () => {
      state.todos = [];
      saveState();
      renderTodo();
    });
  };
  document.getElementById("todo-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTodo();
  });
  document.getElementById("todo-color-row").querySelectorAll(".color-dot").forEach((dot) =>
    dot.addEventListener("click", () => {
      newTodoColor = dot.dataset.color;
      document.querySelectorAll("#todo-color-row .color-dot").forEach((d) => d.classList.toggle("active", d === dot));
    })
  );
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
  state.todos.push({ id: uid(), text, done: false, color: newTodoColor });
  saveState();
  input.value = "";
  renderTodo();
}


/* ===========================================================
   캘린더
   =========================================================== */
/* ===========================================================
   대한민국 공휴일 (대체공휴일 포함) — 2026, 2027년
   출처: 공공데이터포털 특일 정보 기준 정리
   =========================================================== */
const HOLIDAYS = {
  "20260101": "신정",
  "20260216": "설날 연휴",
  "20260217": "설날",
  "20260218": "설날 연휴",
  "20260301": "삼일절",
  "20260302": "대체공휴일(삼일절)",
  "20260501": "노동절",
  "20260505": "어린이날",
  "20260524": "부처님오신날",
  "20260525": "대체공휴일(부처님오신날)",
  "20260603": "전국동시지방선거",
  "20260606": "현충일",
  "20260717": "제헌절",
  "20260815": "광복절",
  "20260817": "대체공휴일(광복절)",
  "20260924": "추석 연휴",
  "20260925": "추석",
  "20260926": "추석 연휴",
  "20261003": "개천절",
  "20261005": "대체공휴일(개천절)",
  "20261009": "한글날",
  "20261225": "성탄절",
  "20270101": "신정",
  "20270206": "설날 연휴",
  "20270207": "설날",
  "20270208": "설날 연휴",
  "20270209": "대체공휴일(설날)",
  "20270301": "삼일절",
  "20270501": "노동절",
  "20270503": "대체공휴일(노동절)",
  "20270505": "어린이날",
  "20270513": "부처님오신날",
  "20270606": "현충일",
  "20270717": "제헌절",
  "20270719": "대체공휴일(제헌절)",
  "20270815": "광복절",
  "20270816": "대체공휴일(광복절)",
  "20270914": "추석 연휴",
  "20270915": "추석",
  "20270916": "추석 연휴",
  "20271003": "개천절",
  "20271004": "대체공휴일(개천절)",
  "20271009": "한글날",
  "20271011": "대체공휴일(한글날)",
  "20271225": "성탄절",
  "20271227": "대체공휴일(성탄절)"
};

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
    const wd = new Date(y, m, d).getDay();
    const isHoliday = !!HOLIDAYS[ymd];
    const cls = ["cal-day"];
    if (isHoliday) cls.push("holiday");
    else if (wd === 0) cls.push("sun");
    else if (wd === 6) cls.push("sat");
    if (ymd === todayYmd) cls.push("today");
    if (ymd === calSelected) cls.push("selected");
    cells += `<div class="${cls.join(" ")}" data-ymd="${ymd}">${d}${hasEvent ? '<div class="dot"></div>' : ""}</div>`;
  }

  viewEl.innerHTML = `
    <div class="cal-head">
      <h2>${y}년 ${m + 1}월</h2>
      <div class="cal-nav">
        <button id="cal-prev"><i data-lucide="chevron-left"></i></button>
        <button id="cal-next"><i data-lucide="chevron-right"></i></button>
        <button class="mini-trash" id="cal-clear" title="모든 일정 삭제" style="margin-left:6px;"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
    <div class="cal-grid">
      ${DOW.map((d, i) => `<div class="dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</div>`).join("")}
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
  document.getElementById("cal-clear").onclick = () => {
    if (!state.events.length) return;
    openConfirmModal("모든 일정 삭제", "캘린더에 등록된 모든 날짜의 일정을 전부 삭제할까요? 되돌릴 수 없어요.", () => {
      state.events = [];
      saveState();
      renderCalendar();
    });
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
  const holidayName = HOLIDAYS[calSelected];
  title.innerHTML = `${fmtYmd(calSelected)} 일정${
    holidayName ? `<span class="holiday-badge"><i data-lucide="flag" class="ti"></i>${escapeHtml(holidayName)}</span>` : ""
  }`;
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
        <h2>설정</h2>

        <div class="switch-row">
          <div class="switch-row-label"><i data-lucide="moon" class="ti"></i>다크 모드</div>
          <button class="switch ${state.darkMode ? "on" : ""}" id="dark-toggle" role="switch" aria-checked="${state.darkMode}">
            <span class="switch-knob"></span>
          </button>
        </div>

        <div class="guide-box" style="display:flex; gap:10px; align-items:flex-start;">
          <i data-lucide="info" style="width:16px; height:16px; color:var(--ink-faint); flex-shrink:0; margin-top:1px;"></i>
          <p style="margin:0; font-size:12px; color:var(--ink-soft); line-height:1.7;">
            이 앱은 로그인 없이 <b>이 기기(브라우저)에만</b> 데이터를 저장해요. 앱을 지우거나 브라우저 저장공간을 정리하면 급식·시간표·할일·캘린더 내용이 함께 사라져요. 다른 기기에서 쓰려면 그 기기에서 처음부터 다시 설정해야 해요.
          </p>
        </div>

        <h2>학교 연결</h2>
        <p class="modal-sub">급식과 시간표를 자동으로 불러오려면 나이스(NEIS) 인증키와 학교 정보가 필요해요. <button class="link-btn" id="guide-toggle">발급 방법 보기</button></p>

        <div class="guide-box" id="neis-guide" style="display:none;">
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
        <p class="modal-sub" style="margin-top:16px;">학년·반 정보 <button class="link-btn" id="grade-toggle">펼쳐서 입력하기</button></p>
        <div id="grade-fields" style="display:none;">
          <div class="field-row">
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
        </div>
        `
            : ""
        }

        <h2>버그 신고</h2>
        <p class="modal-sub">이상한 점이나 오류를 발견하면 알려주세요. 필요하면 사진도 같이 보낼 수 있어요.</p>
        <div class="field">
          <label>어떤 문제가 있었나요?</label>
          <textarea id="bug-text" rows="4" placeholder="예: 캘린더에서 날짜를 눌러도 반응이 없어요"></textarea>
        </div>
        <div class="field">
          <label>사진 (선택)</label>
          <input type="file" id="bug-photo" accept="image/*" class="file-input-hidden" />
          <label for="bug-photo" class="btn-secondary" id="bug-photo-label" style="display:block; text-align:center; margin-top:0;">
            <i data-lucide="image-plus" style="width:14px;height:14px;margin-right:5px;vertical-align:-2px;"></i>사진 선택
          </label>
        </div>
        <button class="btn-secondary" id="bug-send">신고 보내기</button>
      </div>
    </div>
  `;

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });

  document.getElementById("dark-toggle").onclick = (e) => {
    state.darkMode = !state.darkMode;
    saveState();
    applyTheme();
    e.currentTarget.classList.toggle("on", state.darkMode);
    e.currentTarget.setAttribute("aria-checked", state.darkMode);
  };

  document.getElementById("guide-toggle").onclick = () => {
    const el = document.getElementById("neis-guide");
    const show = el.style.display === "none";
    el.style.display = show ? "block" : "none";
    document.getElementById("guide-toggle").textContent = show ? "접기" : "발급 방법 보기";
  };

  document.getElementById("bug-photo").addEventListener("change", (e) => {
    const label = document.getElementById("bug-photo-label");
    const file = e.target.files[0];
    label.innerHTML = file
      ? `<i data-lucide="image-plus" style="width:14px;height:14px;margin-right:5px;vertical-align:-2px;"></i>${escapeHtml(file.name)}`
      : `<i data-lucide="image-plus" style="width:14px;height:14px;margin-right:5px;vertical-align:-2px;"></i>사진 선택`;
    initIcons();
  });

  const gradeToggle = document.getElementById("grade-toggle");
  if (gradeToggle) {
    gradeToggle.onclick = () => {
      const el = document.getElementById("grade-fields");
      const show = el.style.display === "none";
      el.style.display = show ? "block" : "none";
      gradeToggle.textContent = show ? "접기" : "펼쳐서 입력하기";
    };
  }

  document.getElementById("bug-send").onclick = () => {
    const desc = document.getElementById("bug-text").value.trim();
    if (!desc) {
      alert("어떤 문제인지 간단히 적어주세요.");
      return;
    }
    const photoInput = document.getElementById("bug-photo");
    const photoFile = photoInput && photoInput.files[0] ? photoInput.files[0] : null;
    openConfirmModal(
      "버그 신고 보내기",
      "작성한 내용을 개발자에게 보낼까요?",
      () => sendBugReport(desc, photoFile),
      { confirmLabel: "보낼게요", danger: false }
    );
  };

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

async function sendBugReport(desc, photoFile) {
  const deviceInfo = {
    ua: navigator.userAgent,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    school: state.school ? state.school.name : "연결 안 됨",
    darkMode: state.darkMode ? "켜짐" : "꺼짐"
  };

  if (!BUG_REPORT_FORM_ENDPOINT) {
    // Formspree 연동 전: 메일 앱을 여는 방식으로 대체 (이 경우 사진은 첨부되지 않아요)
    const info = [
      `설명: ${desc}`,
      ``,
      `--- 자동 수집 정보 ---`,
      `기기/브라우저: ${deviceInfo.ua}`,
      `화면 크기: ${deviceInfo.screen}`,
      `학교 연결: ${deviceInfo.school}`,
      `다크모드: ${deviceInfo.darkMode}`
    ].join("\n");
    const subject = encodeURIComponent("[ARIA] 버그 신고");
    const body = encodeURIComponent(info);
    window.location.href = `mailto:${BUG_REPORT_EMAIL}?subject=${subject}&body=${body}`;
    return;
  }

  const fd = new FormData();
  fd.append("message", desc);
  fd.append("기기_브라우저", deviceInfo.ua);
  fd.append("화면크기", deviceInfo.screen);
  fd.append("학교연결", deviceInfo.school);
  fd.append("다크모드", deviceInfo.darkMode);
  if (photoFile) fd.append("photo", photoFile);

  try {
    const res = await fetch(BUG_REPORT_FORM_ENDPOINT, {
      method: "POST",
      body: fd,
      headers: { Accept: "application/json" }
    });
    if (res.ok) {
      alert("버그 신고를 보냈어요. 확인하고 반영할게요!");
    } else {
      alert("전송에 실패했어요. 잠시 후 다시 시도해주세요.");
    }
  } catch (e) {
    alert("전송에 실패했어요. 인터넷 연결을 확인해주세요.");
  }
}

function openConfirmModal(title, message, onConfirm, options) {
  const opts = options || {};
  const confirmLabel = opts.confirmLabel || "삭제할게요";
  const danger = opts.danger !== false; // 기본은 위험(빨강) 스타일, 명시적으로 false면 일반 스타일
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-overlay" id="confirm-overlay">
      <div class="modal-sheet">
        <div class="close-row"><button id="confirm-close">×</button></div>
        <h2>${escapeHtml(title)}</h2>
        <p class="modal-sub">${escapeHtml(message)}</p>
        <button class="btn-primary ${danger ? "btn-danger" : ""}" id="confirm-yes">${escapeHtml(confirmLabel)}</button>
        <button class="btn-secondary" id="confirm-no">취소</button>
      </div>
    </div>
  `;
  const overlay = document.getElementById("confirm-overlay");
  overlay.addEventListener("click", (e) => {
    if (e.target.id === "confirm-overlay") closeModal();
  });
  document.getElementById("confirm-close").onclick = closeModal;
  document.getElementById("confirm-no").onclick = closeModal;
  document.getElementById("confirm-yes").onclick = () => {
    closeModal();
    onConfirm();
  };
}

/* ---------- 유틸 ---------- */
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.darkMode ? "dark" : "light");
  const meta = document.getElementById("theme-color-meta");
  if (meta) meta.setAttribute("content", state.darkMode ? "#18191B" : "#FFFFFF");
}

/* ---------- 초기화 ---------- */
applyTheme();
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // updateViaCache: "none" — 서비스워커 스크립트 자체를 브라우저 HTTP 캐시에
    // 절대 태우지 않고, 매번 서버에서 새로 확인하도록 강제한다.
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  });

  // 새 버전의 서비스워커가 활성화되어 '주인'이 바뀌는 순간,
  // 열려 있던 페이지를 한 번 자동으로 새로고침해서 최신 파일을 반영한다.
  let refreshedOnce = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshedOnce) return;
    refreshedOnce = true;
    window.location.reload();
  });
}
