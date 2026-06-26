import {
  escapeHtml,
  formatDate,
  formatDateTime,
  getCurrentUrlWithoutHash,
  getDisplayName,
  groupBy,
  byId,
  statusLabels,
  supabase,
} from "./supabaseClient.js";

const state = {
  organizations: [],
  instructors: [],
  venues: [],
  courses: [],
  sessions: [],
  archives: [],
  reviews: [],
  composedCourses: [],
  activeView: "cards",
  activeCourseId: null,
  user: null,
};

const elements = {
  orgCount: document.getElementById("orgCount"),
  courseCount: document.getElementById("courseCount"),
  reviewCount: document.getElementById("reviewCount"),
  archiveCount: document.getElementById("archiveCount"),
  searchInput: document.getElementById("searchInput"),
  orgFilter: document.getElementById("orgFilter"),
  topicFilter: document.getElementById("topicFilter"),
  timeFilter: document.getElementById("timeFilter"),
  statusFilter: document.getElementById("statusFilter"),
  resultSummary: document.getElementById("resultSummary"),
  courseResults: document.getElementById("courseResults"),
  detailModal: document.getElementById("detailModal"),
  detailBadges: document.getElementById("detailBadges"),
  detailTitle: document.getElementById("detailTitle"),
  detailBody: document.getElementById("detailBody"),
  loginModal: document.getElementById("loginModal"),
  loginButton: document.getElementById("loginButton"),
  loginForm: document.getElementById("loginForm"),
  loginEmail: document.getElementById("loginEmail"),
  logoutButton: document.getElementById("logoutButton"),
  loginStatus: document.getElementById("loginStatus"),
  toast: document.getElementById("toast"),
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 2800);
}

function openModal(modal) {
  modal.classList.add("open");
  const focusTarget = modal.querySelector("button, input, textarea, select");
  if (focusTarget) focusTarget.focus();
}

function closeModal(modal) {
  modal.classList.remove("open");
}

function getStatusClass(status) {
  if (status === "open") return "green";
  if (status === "finished") return "gray";
  if (status === "cancelled") return "red";
  return "";
}

function getTimeLabel(course) {
  const first = course.sessions[0];
  if (!first?.starts_at) return "";
  const hour = new Date(first.starts_at).getHours();
  if (hour < 12) return "오전";
  if (hour < 18) return "오후";
  return "저녁";
}

function populateSelect(select, label, values) {
  select.innerHTML = `<option value="">${escapeHtml(label)}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
}

function composeCourses() {
  const organizations = byId(state.organizations);
  const instructors = byId(state.instructors);
  const venues = byId(state.venues);
  const sessionsByCourse = groupBy(state.sessions, "course_id");
  const archivesByCourse = groupBy(state.archives, "course_id");
  const reviewsByCourse = groupBy(state.reviews, "course_id");

  state.composedCourses = state.courses.map((course) => {
    const sessions = (sessionsByCourse.get(course.id) || []).slice().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const archives = (archivesByCourse.get(course.id) || []).slice().sort((a, b) => a.sort_order - b.sort_order);
    const reviews = (reviewsByCourse.get(course.id) || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return {
      ...course,
      organization: organizations.get(course.organization_id),
      instructor: instructors.get(course.instructor_id),
      venue: venues.get(course.venue_id),
      sessions,
      archives,
      reviews,
      timeLabel: getTimeLabel({ ...course, sessions }),
    };
  });
}

async function loadData() {
  elements.resultSummary.textContent = "교육 정보를 불러오는 중입니다.";
  const requests = await Promise.all([
    supabase.from("organizations").select("*").order("sort_order", { ascending: true }),
    supabase.from("instructors").select("*").order("name", { ascending: true }),
    supabase.from("venues").select("*").order("name", { ascending: true }),
    supabase.from("courses").select("*").order("starts_at", { ascending: true }),
    supabase.from("course_sessions").select("*").order("starts_at", { ascending: true }),
    supabase.from("course_archives").select("*").order("sort_order", { ascending: true }),
    supabase.from("reviews").select("id, course_id, author_name, body, verification_status, created_at").order("created_at", { ascending: false }),
  ]);

  const error = requests.find((result) => result.error)?.error;
  if (error) throw error;

  [
    state.organizations,
    state.instructors,
    state.venues,
    state.courses,
    state.sessions,
    state.archives,
    state.reviews,
  ] = requests.map((result) => result.data || []);

  composeCourses();
  populateFilters();
  render();
}

function populateFilters() {
  const orgNames = state.organizations.map((org) => org.name);
  const topics = [...new Set(state.courses.map((course) => course.topic))].sort((a, b) => a.localeCompare(b, "ko"));
  populateSelect(elements.orgFilter, "전체 기관", orgNames);
  populateSelect(elements.topicFilter, "전체 주제", topics);
}

function getFilters() {
  return {
    q: elements.searchInput.value.trim().toLowerCase(),
    org: elements.orgFilter.value,
    topic: elements.topicFilter.value,
    time: elements.timeFilter.value,
    status: elements.statusFilter.value,
  };
}

function filteredCourses() {
  const filters = getFilters();
  return state.composedCourses.filter((course) => {
    const haystack = [
      course.title,
      course.summary,
      course.description,
      course.topic,
      course.organization?.name,
      course.instructor?.name,
      course.venue?.name,
      course.venue?.address,
      course.timeLabel,
      ...(course.tags || []),
    ].join(" ").toLowerCase();

    return (!filters.q || haystack.includes(filters.q))
      && (!filters.org || course.organization?.name === filters.org)
      && (!filters.topic || course.topic === filters.topic)
      && (!filters.time || course.timeLabel === filters.time)
      && (!filters.status || course.status === filters.status);
  });
}

function renderStats() {
  elements.orgCount.textContent = state.organizations.length.toLocaleString("ko-KR");
  elements.courseCount.textContent = state.courses.length.toLocaleString("ko-KR");
  elements.reviewCount.textContent = state.reviews.length.toLocaleString("ko-KR");
  elements.archiveCount.textContent = state.archives.length.toLocaleString("ko-KR");
}

function renderCards(courses) {
  elements.courseResults.className = "course-grid";
  if (!courses.length) {
    elements.courseResults.innerHTML = `<div class="empty">조건에 맞는 교육이 없습니다. 검색어나 필터를 다시 확인해 주세요.</div>`;
    return;
  }

  elements.courseResults.innerHTML = courses.map((course) => {
    const firstSession = course.sessions[0];
    return `
      <article class="course-card">
        <div class="badge-row">
          <span class="badge ${getStatusClass(course.status)}">${escapeHtml(statusLabels[course.status] || course.status)}</span>
          <span class="badge">${escapeHtml(course.topic)}</span>
          <span class="badge gray">${escapeHtml(course.timeLabel || "시간 미정")}</span>
        </div>
        <h3>${escapeHtml(course.title)}</h3>
        <div class="meta">
          <span>🏛️ ${escapeHtml(course.organization?.name || "기관 미정")}</span>
          <span>🎙️ ${escapeHtml(course.instructor?.name || "강사 미정")} 강사</span>
          <span>📍 ${escapeHtml(course.venue?.name || "장소 미정")}</span>
          <span>🗓️ ${escapeHtml(formatDate(firstSession?.starts_at || course.starts_at))}</span>
        </div>
        <p>${escapeHtml(course.summary || "")}</p>
        <div class="footer">
          <span class="review-note">후기 ${course.reviews.length}개 · 기록 ${course.archives.length}개</span>
          <button class="btn small" type="button" data-open-course="${course.id}">상세 보기</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderCalendar(courses) {
  elements.courseResults.className = "calendar-list";
  if (!courses.length) {
    elements.courseResults.innerHTML = `<div class="empty">조건에 맞는 일정이 없습니다.</div>`;
    return;
  }

  const sorted = courses.slice().sort((a, b) => new Date(a.starts_at || 0) - new Date(b.starts_at || 0));
  elements.courseResults.innerHTML = sorted.map((course) => {
    const firstSession = course.sessions[0];
    return `
      <article class="calendar-item">
        <div class="date-box">${escapeHtml(formatDate(firstSession?.starts_at || course.starts_at))}<small>${escapeHtml(course.timeLabel || "")}</small></div>
        <div>
          <div class="badge-row">
            <span class="badge ${getStatusClass(course.status)}">${escapeHtml(statusLabels[course.status] || course.status)}</span>
            <span class="badge">${escapeHtml(course.organization?.name || "")}</span>
          </div>
          <h3>${escapeHtml(course.title)}</h3>
          <p>${escapeHtml(course.instructor?.name || "강사 미정")} 강사 · ${escapeHtml(course.venue?.name || "장소 미정")}</p>
        </div>
        <button class="btn small" type="button" data-open-course="${course.id}">상세 보기</button>
      </article>
    `;
  }).join("");
}

function render() {
  const courses = filteredCourses();
  elements.resultSummary.textContent = `${courses.length.toLocaleString("ko-KR")}개 교육이 표시됩니다.`;
  renderStats();
  if (state.activeView === "calendar") renderCalendar(courses);
  else renderCards(courses);
}

function renderReviews(course) {
  if (!course.reviews.length) return `<li class="review-item">아직 등록된 후기가 없습니다. 교육 후 첫 후기를 남겨보세요.</li>`;
  return course.reviews.map((review) => `
    <li class="review-item">
      <strong>${escapeHtml(review.author_name)} <span class="badge ${review.verification_status === "verified" ? "green" : "gray"}">${review.verification_status === "verified" ? "참여 확인" : "후기"}</span></strong><br>
      ${escapeHtml(review.body)}
    </li>
  `).join("");
}

function renderReviewForm(course) {
  if (!state.user) {
    return `<p>후기를 남기려면 로그인이 필요합니다. 교육 정보는 로그인 없이 볼 수 있습니다.</p><button class="btn" type="button" data-login-for-review>로그인 후 후기 쓰기</button>`;
  }
  if (course.status !== "finished") {
    return `<p>후기는 교육 종료 후 작성할 수 있습니다. 현재 상태: <strong>${escapeHtml(statusLabels[course.status] || course.status)}</strong></p>`;
  }
  return `
    <form id="reviewForm">
      <label>참여 코드(선택)<input name="participation_code" placeholder="교육 현장에서 안내받은 코드가 있으면 입력해 주세요"></label>
      <label style="margin-top: 10px;">후기<textarea name="body" placeholder="교육에서 좋았던 점, 기억에 남은 질문, 다음 참여자에게 전하고 싶은 말을 적어주세요." required minlength="10"></textarea></label>
      <div class="actions" style="margin-top: 12px;">
        <button class="btn" type="submit">후기 등록</button>
        <span class="badge green">참여 코드는 확인 후 반영됩니다</span>
      </div>
    </form>
  `;
}

function openCourseDetail(courseId) {
  const course = state.composedCourses.find((item) => item.id === courseId);
  if (!course) return;
  state.activeCourseId = courseId;

  elements.detailBadges.innerHTML = `
    <span class="badge ${getStatusClass(course.status)}">${escapeHtml(statusLabels[course.status] || course.status)}</span>
    <span class="badge">${escapeHtml(course.topic)}</span>
    <span class="badge gray">${escapeHtml(course.organization?.name || "")}</span>
  `;
  elements.detailTitle.textContent = course.title;
  elements.detailBody.innerHTML = `
    <div class="detail-grid">
      <div class="section">
        <h3>교육 정보</h3>
        <p>${escapeHtml(course.description || course.summary || "")}</p>
        <ul class="session-list">
          ${course.sessions.map((session) => `<li><strong>${escapeHtml(session.title)} · ${escapeHtml(formatDateTime(session.starts_at))}</strong><br>${escapeHtml(session.room || course.venue?.name || "")}</li>`).join("")}
        </ul>
        <div class="actions" style="margin-top: 14px;">
          ${course.application_url ? `<a class="btn small" href="${escapeHtml(course.application_url)}" target="_blank" rel="noreferrer">신청하기</a>` : ""}
          <button class="btn small secondary" type="button" data-login-for-review>후기 쓰기</button>
        </div>
      </div>
      <aside class="section">
        <h3>강사·장소</h3>
        <p><strong>${escapeHtml(course.instructor?.name || "강사 미정")}</strong> ${escapeHtml(course.instructor?.title || "")}</p>
        <p>${escapeHtml(course.instructor?.bio || "")}</p>
        <p>📍 ${escapeHtml(course.venue?.name || "장소 미정")} ${course.venue?.address ? `· ${escapeHtml(course.venue.address)}` : ""}</p>
        <p>주관 기관: ${escapeHtml(course.organization?.name || "")}</p>
      </aside>
      <div class="section">
        <h3>후기 ${course.reviews.length}개</h3>
        <ul class="review-list">${renderReviews(course)}</ul>
      </div>
      <div class="section">
        <h3>사진·영상 기록</h3>
        <div class="media-grid">
          ${course.archives.length ? course.archives.map((item) => `<a class="media" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(item.type)} · ${escapeHtml(item.title)}</strong><small>${escapeHtml(item.caption || "자료 보기")}</small></a>`).join("") : `<p class="muted">등록된 사진·영상 기록이 없습니다.</p>`}
        </div>
      </div>
      <div class="section" style="grid-column: 1 / -1;">
        <h3>후기 작성</h3>
        ${renderReviewForm(course)}
      </div>
    </div>
  `;
  openModal(elements.detailModal);
}

async function handleReviewSubmit(event) {
  event.preventDefault();
  const course = state.composedCourses.find((item) => item.id === state.activeCourseId);
  if (!course || !state.user) return;

  const form = event.currentTarget;
  const body = form.elements.body.value.trim();
  const participationCode = form.elements.participation_code.value.trim();
  if (body.length < 10) {
    showToast("후기는 10자 이상 입력해주세요.");
    return;
  }

  const { error } = await supabase.from("reviews").insert({
    course_id: course.id,
    user_id: state.user.id,
    author_name: getDisplayName(state.user),
    body,
    participation_code: participationCode || null,
  });

  if (error) {
    if (error.code === "23505") showToast("이미 이 교육에 후기를 작성했습니다.");
    else {
      console.error("Review submission failed", error);
      showToast("후기를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    return;
  }

  showToast(participationCode ? "후기가 등록되었습니다. 참여 확인은 확인 후 반영됩니다." : "후기가 등록되었습니다.");
  await loadData();
  openCourseDetail(course.id);
}

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  state.user = data.session?.user || null;
  elements.loginButton.textContent = state.user ? `${getDisplayName(state.user)}님` : "후기 쓰기";
  elements.loginStatus.textContent = state.user ? `${state.user.email || getDisplayName(state.user)}로 로그인 중입니다.` : "로그인하지 않았습니다.";
}

async function handleLogin(event) {
  event.preventDefault();
  const email = elements.loginEmail.value.trim();
  if (!email) return;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: getCurrentUrlWithoutHash() },
  });
  if (error) {
    console.error("Login link request failed", error);
    showToast("로그인 링크를 보내지 못했습니다. 이메일을 확인한 뒤 다시 시도해 주세요.");
    return;
  }
  showToast("이메일로 로그인 링크를 보냈습니다.");
}

async function handleLogout() {
  await supabase.auth.signOut();
  await refreshSession();
  showToast("로그아웃했습니다.");
}

function bindEvents() {
  [elements.searchInput, elements.orgFilter, elements.topicFilter, elements.timeFilter, elements.statusFilter].forEach((element) => {
    element.addEventListener("input", render);
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });

  document.body.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-open-course]");
    const closeButton = event.target.closest("[data-close-modal]");
    const loginForReview = event.target.closest("[data-login-for-review]");
    if (openButton) openCourseDetail(openButton.dataset.openCourse);
    if (closeButton) closeModal(closeButton.closest(".modal"));
    if (loginForReview) openModal(elements.loginModal);
  });

  document.body.addEventListener("submit", (event) => {
    if (event.target.id === "reviewForm") handleReviewSubmit(event);
  });

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") document.querySelectorAll(".modal.open").forEach(closeModal);
  });

  elements.loginButton.addEventListener("click", () => openModal(elements.loginModal));
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.logoutButton.addEventListener("click", handleLogout);
  supabase.auth.onAuthStateChange(async () => {
    await refreshSession();
  });
}

async function initialize() {
  bindEvents();
  await refreshSession();
  await loadData();
}

initialize().catch((error) => {
  console.error("Public page initialization failed", error);
  elements.resultSummary.textContent = "교육을 불러오지 못했습니다.";
  elements.courseResults.innerHTML = `<div class="empty">일시적으로 교육 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>`;
});
