import {
  ARCHIVE_BUCKET,
  escapeHtml,
  formatDateTime,
  getDisplayName,
  randomPick,
  shortDate,
  statusLabels,
  supabase,
  verificationLabels,
} from "./supabaseClient.js";

const state = {
  tab: "dashboard",
  user: null,
  adminProfile: null,
  organizations: [],
  instructors: [],
  venues: [],
  courses: [],
  sessions: [],
  archives: [],
  reviews: [],
  draws: [],
  winners: [],
};

const elements = {
  adminLoginForm: document.getElementById("adminLoginForm"),
  adminEmail: document.getElementById("adminEmail"),
  adminPassword: document.getElementById("adminPassword"),
  adminLogoutButton: document.getElementById("adminLogoutButton"),
  adminStatus: document.getElementById("adminStatus"),
  permissionNotice: document.getElementById("permissionNotice"),
  adminContent: document.getElementById("adminContent"),
  refreshButton: document.getElementById("refreshButton"),
  toast: document.getElementById("toast"),
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 3000);
}

function isAdmin() {
  return Boolean(state.user && state.adminProfile);
}

function optionList(items, selectedId = "") {
  return items.map((item) => `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name || item.title)}</option>`).join("");
}

function courseName(courseId) {
  return state.courses.find((course) => course.id === courseId)?.title || "교육 미정";
}

function courseById(courseId) {
  return state.courses.find((course) => course.id === courseId);
}

function localDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function statusBadge(status) {
  const className = status === "open" ? "green" : status === "finished" ? "gray" : status === "cancelled" ? "red" : "";
  return `<span class="badge ${className}">${escapeHtml(statusLabels[status] || status)}</span>`;
}

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  state.user = data.session?.user || null;
  state.adminProfile = null;

  if (state.user) {
    const { data: profile, error } = await supabase
      .from("admin_profiles")
      .select("*")
      .eq("user_id", state.user.id)
      .maybeSingle();
    if (!error) state.adminProfile = profile;
  }

  renderAuthStatus();
}

function renderAuthStatus() {
  if (!state.user) {
    elements.adminStatus.innerHTML = `<p>로그인하지 않았습니다.</p>`;
    elements.permissionNotice.classList.add("hidden");
    return;
  }

  const role = state.adminProfile ? `${state.adminProfile.role} 권한` : "관리자 권한 없음";
  elements.adminStatus.innerHTML = `
    <p><strong>${escapeHtml(state.user.email || getDisplayName(state.user))}</strong></p>
    <p class="muted">${escapeHtml(role)}</p>
    <p class="muted">사용자 UUID</p>
    <div class="code">${escapeHtml(state.user.id)}</div>
  `;

  if (!state.adminProfile) {
    elements.permissionNotice.classList.remove("hidden");
    elements.permissionNotice.innerHTML = `
      <h3>최초 관리자 등록이 필요합니다</h3>
      <p>Supabase SQL Editor에서 아래 SQL의 UUID를 현재 사용자 UUID로 바꿔 실행하세요.</p>
      <div class="code">insert into public.admin_profiles (user_id, display_name, role)<br>values ('${escapeHtml(state.user.id)}', '${escapeHtml(getDisplayName(state.user))}', 'owner');</div>
    `;
  } else {
    elements.permissionNotice.classList.add("hidden");
  }
}

async function loadAdminData() {
  const requests = await Promise.all([
    supabase.from("organizations").select("*").order("sort_order", { ascending: true }),
    supabase.from("instructors").select("*").order("name", { ascending: true }),
    supabase.from("venues").select("*").order("name", { ascending: true }),
    supabase.from("courses").select("*").order("starts_at", { ascending: true }),
    supabase.from("course_sessions").select("*").order("starts_at", { ascending: true }),
    supabase.from("course_archives").select("*").order("created_at", { ascending: false }),
    supabase.from("reviews").select("*").order("created_at", { ascending: false }),
    supabase.from("review_draws").select("*").order("created_at", { ascending: false }),
    supabase.from("review_draw_winners").select("*").order("created_at", { ascending: false }),
  ]);

  const error = requests.find((result) => result.error)?.error;
  if (error && isAdmin()) throw error;

  [
    state.organizations,
    state.instructors,
    state.venues,
    state.courses,
    state.sessions,
    state.archives,
    state.reviews,
    state.draws,
    state.winners,
  ] = requests.map((result) => result.data || []);

  render();
}

function renderDashboard() {
  const verified = state.reviews.filter((review) => review.verification_status === "verified").length;
  const pending = state.reviews.filter((review) => review.verification_status === "pending").length;
  elements.adminContent.innerHTML = `
    <h2>운영 현황</h2>
    <div class="stat-grid" style="margin-bottom: 16px;">
      <div class="stat" style="background:#fff;color:var(--ink);"><strong>${state.organizations.length}</strong><span>단체</span></div>
      <div class="stat" style="background:#fff;color:var(--ink);"><strong>${state.courses.length}</strong><span>교육</span></div>
      <div class="stat" style="background:#fff;color:var(--ink);"><strong>${state.archives.length}</strong><span>아카이브</span></div>
      <div class="stat" style="background:#fff;color:var(--ink);"><strong>${state.reviews.length}</strong><span>후기</span></div>
    </div>
    <div class="admin-grid">
      <div class="section"><h3>후기 검수</h3><p>참여 확인 ${verified}개 · 확인 대기 ${pending}개</p></div>
      <div class="section"><h3>관리자 전용 추첨</h3><p>추첨 기록 ${state.draws.length}건 · 당첨 이력 ${state.winners.length}건</p></div>
    </div>
  `;
}

function renderOrganizationForm(organization = {}) {
  return `
    <form id="organizationForm" class="section">
      <input type="hidden" name="organization_id" value="${escapeHtml(organization.id || "")}">
      <div class="admin-grid">
        <label>단체명<input name="name" value="${escapeHtml(organization.name || "")}" required></label>
        <label>주소 이름(영문)<input name="slug" value="${escapeHtml(organization.slug || "")}" placeholder="example-organization" required></label>
        <label>정렬 순서<input name="sort_order" type="number" value="${escapeHtml(organization.sort_order ?? 0)}"></label>
        <label>홈페이지<input name="website_url" value="${escapeHtml(organization.website_url || "")}" placeholder="https://"></label>
      </div>
      <label style="margin-top: 10px;">단체 소개<textarea name="description" placeholder="공개 페이지에 표시할 단체 소개를 입력하세요.">${escapeHtml(organization.description || "")}</textarea></label>
      <label style="margin-top: 10px;">로고 이미지 URL<input name="logo_url" value="${escapeHtml(organization.logo_url || "")}" placeholder="https://"></label>
      <label style="margin-top: 10px;">담당 이메일<input name="contact_email" type="email" value="${escapeHtml(organization.contact_email || "")}"></label>
      <label style="margin-top: 10px;"><span><input name="is_active" type="checkbox" ${organization.is_active !== false ? "checked" : ""} style="width:auto;min-height:auto;"> 공개 페이지에 표시</span></label>
      <div class="actions" style="margin-top: 14px;">
        <button class="btn" type="submit">${organization.id ? "단체 수정" : "단체 추가"}</button>
        <button class="btn secondary" type="button" id="newOrganizationButton">새 단체 입력</button>
      </div>
    </form>
  `;
}

function renderOrganizations() {
  const selectedId = document.getElementById("organizationPicker")?.value || "";
  const selectedOrganization = state.organizations.find((organization) => organization.id === selectedId) || {};
  elements.adminContent.innerHTML = `
    <h2>단체 관리</h2>
    <p class="muted">공개 페이지의 참여 단체 소개와 단체별 교육 모아보기에 사용됩니다.</p>
    <label>수정할 단체 선택<select id="organizationPicker"><option value="">새 단체</option>${state.organizations.map((organization) => `<option value="${organization.id}" ${organization.id === selectedId ? "selected" : ""}>${escapeHtml(organization.name)}</option>`).join("")}</select></label>
    <div style="margin-top: 14px;">${renderOrganizationForm(selectedOrganization)}</div>
    <h3>참여 단체</h3>
    <div class="table-list">
      ${state.organizations.map((organization) => {
        const courseCount = state.courses.filter((course) => course.organization_id === organization.id).length;
        return `<div class="table-row"><div class="row-top"><strong>${escapeHtml(organization.name)}</strong><span class="badge ${organization.is_active !== false ? "green" : "gray"}">${organization.is_active !== false ? "공개" : "숨김"}</span></div><span class="muted">교육 ${courseCount}개 · ${escapeHtml(organization.slug)}</span><p>${escapeHtml(organization.description || "소개 없음")}</p></div>`;
      }).join("") || `<div class="empty">등록된 단체가 없습니다.</div>`}
    </div>
  `;
}

function renderCourseForm(course = {}) {
  const firstSession = state.sessions.find((session) => session.course_id === course.id) || {};
  return `
    <form id="courseForm" class="section">
      <input type="hidden" name="course_id" value="${escapeHtml(course.id || "")}">
      <div class="admin-grid">
        <label>교육명<input name="title" value="${escapeHtml(course.title || "")}" required></label>
        <label>주제<input name="topic" value="${escapeHtml(course.topic || "")}" required></label>
        <label>단체<select name="organization_id" required><option value="">선택</option>${optionList(state.organizations, course.organization_id)}</select></label>
        <label>강사<select name="instructor_id"><option value="">선택</option>${optionList(state.instructors, course.instructor_id)}</select></label>
        <label>장소<select name="venue_id"><option value="">선택</option>${optionList(state.venues, course.venue_id)}</select></label>
        <label>상태<select name="status"><option value="scheduled" ${course.status === "scheduled" ? "selected" : ""}>예정</option><option value="open" ${course.status === "open" ? "selected" : ""}>모집 중</option><option value="finished" ${course.status === "finished" ? "selected" : ""}>종료</option><option value="cancelled" ${course.status === "cancelled" ? "selected" : ""}>취소</option></select></label>
        <label>시작 일시<input name="starts_at" type="datetime-local" value="${escapeHtml(localDateTimeValue(course.starts_at || firstSession.starts_at))}"></label>
        <label>종료 일시<input name="ends_at" type="datetime-local" value="${escapeHtml(localDateTimeValue(course.ends_at || firstSession.ends_at))}"></label>
      </div>
      <label style="margin-top: 10px;">요약<textarea name="summary">${escapeHtml(course.summary || "")}</textarea></label>
      <label style="margin-top: 10px;">상세 설명<textarea name="description">${escapeHtml(course.description || "")}</textarea></label>
      <label style="margin-top: 10px;">신청 링크<input name="application_url" value="${escapeHtml(course.application_url || "")}"></label>
      <label style="margin-top: 10px;"><span><input name="published" type="checkbox" ${course.published !== false ? "checked" : ""} style="width:auto;min-height:auto;"> 공개</span></label>
      <div class="actions" style="margin-top: 14px;">
        <button class="btn" type="submit">${course.id ? "교육 수정" : "교육 추가"}</button>
        <button class="btn secondary" type="button" id="newCourseButton">새 교육 입력</button>
      </div>
    </form>
  `;
}

function renderCourses() {
  const selectedId = document.getElementById("coursePicker")?.value || "";
  const selectedCourse = state.courses.find((course) => course.id === selectedId) || {};
  elements.adminContent.innerHTML = `
    <h2>교육 관리</h2>
    <p class="muted">새 교육을 등록하거나 기존 교육을 수정합니다. 회차는 첫 회차 기준으로 함께 생성·수정됩니다.</p>
    <label>수정할 교육 선택<select id="coursePicker"><option value="">새 교육</option>${state.courses.map((course) => `<option value="${course.id}" ${course.id === selectedId ? "selected" : ""}>${escapeHtml(course.title)}</option>`).join("")}</select></label>
    <div style="margin-top: 14px;">${renderCourseForm(selectedCourse)}</div>
    <h3>최근 교육</h3>
    <div class="table-list">
      ${state.courses.slice(0, 12).map((course) => `<div class="table-row"><div class="row-top"><strong>${escapeHtml(course.title)}</strong>${statusBadge(course.status)}</div><span class="muted">${escapeHtml(course.topic)} · ${escapeHtml(shortDate(course.starts_at))}</span></div>`).join("")}
    </div>
  `;
}

function renderArchive() {
  elements.adminContent.innerHTML = `
    <h2>아카이브 등록</h2>
    <p class="muted">영상은 YouTube/Vimeo 등 외부 링크를 권장합니다. 사진이나 PDF는 Supabase Storage에 업로드할 수 있습니다.</p>
    <form id="archiveForm" class="section">
      <label>교육<select name="course_id" required><option value="">선택</option>${optionList(state.courses)}</select></label>
      <div class="admin-grid" style="margin-top: 10px;">
        <label>자료 유형<select name="type"><option value="photo">사진</option><option value="video">영상</option><option value="file">파일</option><option value="link">링크</option></select></label>
        <label>제목<input name="title" required></label>
      </div>
      <label style="margin-top: 10px;">외부 URL<input name="url" placeholder="업로드 파일이 없으면 링크 입력"></label>
      <label style="margin-top: 10px;">파일 업로드<input name="file" type="file" accept="image/*,.pdf"></label>
      <label style="margin-top: 10px;">설명<textarea name="caption"></textarea></label>
      <label style="margin-top: 10px;"><span><input name="is_public" type="checkbox" checked style="width:auto;min-height:auto;"> 공개</span></label>
      <div class="actions" style="margin-top: 14px;"><button class="btn" type="submit">아카이브 등록</button></div>
    </form>
    <h3>최근 아카이브</h3>
    <div class="table-list">
      ${state.archives.slice(0, 15).map((item) => `<div class="table-row"><div class="row-top"><strong>${escapeHtml(item.title)}</strong><span class="badge">${escapeHtml(item.type)}</span></div><span class="muted">${escapeHtml(courseName(item.course_id))}</span></div>`).join("") || `<div class="empty">등록된 자료가 없습니다.</div>`}
    </div>
  `;
}

function renderReviews() {
  elements.adminContent.innerHTML = `
    <h2>후기 검수</h2>
    <p class="muted">참여 확인 코드는 관리자 화면에서만 보입니다. 공개 페이지에는 노출되지 않습니다.</p>
    <div class="table-list">
      ${state.reviews.map((review) => `
        <div class="table-row">
          <div class="row-top">
            <strong>${escapeHtml(review.author_name || "참여자")}</strong>
            <span class="badge ${review.verification_status === "verified" ? "green" : review.verification_status === "rejected" ? "red" : "gray"}">${escapeHtml(verificationLabels[review.verification_status] || review.verification_status)}</span>
          </div>
          <div class="muted">${escapeHtml(courseName(review.course_id))} · ${escapeHtml(shortDate(review.created_at))}</div>
          <p>${escapeHtml(review.body)}</p>
          <p class="muted">참여 코드: ${escapeHtml(review.participation_code || "없음")} · 공개 상태: ${review.is_hidden ? "숨김" : "공개"}</p>
          <div class="actions">
            <button class="btn small" type="button" data-review-action="verify" data-review-id="${review.id}">참여 확인</button>
            <button class="btn small secondary" type="button" data-review-action="reject" data-review-id="${review.id}">반려</button>
            <button class="btn small ${review.is_hidden ? "secondary" : "danger"}" type="button" data-review-action="${review.is_hidden ? "show" : "hide"}" data-review-id="${review.id}">${review.is_hidden ? "공개" : "숨김"}</button>
          </div>
        </div>
      `).join("") || `<div class="empty">아직 후기가 없습니다.</div>`}
    </div>
  `;
}

function renderDraws() {
  const eligible = state.reviews.filter((review) => review.verification_status === "verified" && !review.is_hidden);
  elements.adminContent.innerHTML = `
    <h2>관리자 전용 후기 추첨</h2>
    <p class="muted">이 화면은 관리자만 볼 수 있습니다. 시민 공개 페이지에는 추첨 기능이나 당첨자 목록이 노출되지 않습니다.</p>
    <form id="drawForm" class="section">
      <div class="admin-grid">
        <label>추첨명<input name="title" value="후기 작성자 선물 추첨" required></label>
        <label>당첨 인원<input name="winner_count" type="number" min="1" max="20" value="3"></label>
        <label>대상 교육<select name="target_course_id"><option value="">전체 교육</option>${optionList(state.courses)}</select></label>
        <label>선물명<input name="prize_label" value="문화상품권"></label>
      </div>
      <label style="margin-top: 10px;">메모<textarea name="note" placeholder="추첨 기준이나 회차 메모"></textarea></label>
      <div class="actions" style="margin-top: 14px;"><button class="btn" type="submit" ${eligible.length ? "" : "disabled"}>추첨 실행</button><span class="badge green">대상 ${eligible.length}명</span></div>
    </form>
    <h3>추첨 기록</h3>
    <div class="table-list">
      ${state.draws.map((draw) => `<div class="table-row"><div class="row-top"><strong>${escapeHtml(draw.title)}</strong><span class="badge gray">${escapeHtml(shortDate(draw.created_at))}</span></div><span class="muted">당첨 ${state.winners.filter((winner) => winner.draw_id === draw.id).length}명</span></div>`).join("") || `<div class="empty">아직 추첨 기록이 없습니다.</div>`}
    </div>
  `;
}

function render() {
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === state.tab);
  });

  if (!state.user) {
    elements.adminContent.innerHTML = `<div class="empty">관리자 기능을 사용하려면 먼저 로그인하세요.</div>`;
    return;
  }

  if (!isAdmin()) {
    elements.adminContent.innerHTML = `<div class="empty">로그인은 되었지만 관리자 권한이 없습니다. 왼쪽 안내에 따라 최초 관리자 등록을 완료하세요.</div>`;
    return;
  }

  if (state.tab === "organizations") renderOrganizations();
  else if (state.tab === "courses") renderCourses();
  else if (state.tab === "archive") renderArchive();
  else if (state.tab === "reviews") renderReviews();
  else if (state.tab === "draws") renderDraws();
  else renderDashboard();
}

async function handleLogin(event) {
  event.preventDefault();
  const email = elements.adminEmail.value.trim();
  const password = elements.adminPassword.value;
  if (!email || !password) return;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    showToast(`로그인 실패: ${error.message}`);
    return;
  }

  elements.adminPassword.value = "";
  await reload();
  showToast("로그인했습니다.");
}

async function handleLogout() {
  await supabase.auth.signOut();
  await refreshSession();
  render();
  showToast("로그아웃했습니다.");
}

async function saveOrganization(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const organizationId = formData.get("organization_id");
  const sortOrder = Number(formData.get("sort_order") || 0);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    slug: String(formData.get("slug") || "").trim(),
    description: String(formData.get("description") || "").trim() || null,
    website_url: String(formData.get("website_url") || "").trim() || null,
    contact_email: String(formData.get("contact_email") || "").trim() || null,
    logo_url: String(formData.get("logo_url") || "").trim() || null,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    is_active: formData.get("is_active") === "on",
  };

  if (!payload.name || !payload.slug) {
    showToast("단체명과 주소 이름을 입력해 주세요.");
    return;
  }

  const request = organizationId
    ? supabase.from("organizations").update(payload).eq("id", organizationId)
    : supabase.from("organizations").insert(payload);

  const { error } = await request;
  if (error) throw error;

  showToast("단체 정보를 저장했습니다.");
  await reload();
  state.tab = "organizations";
  render();
}

async function saveCourse(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const courseId = formData.get("course_id");
  const payload = {
    title: String(formData.get("title")).trim(),
    topic: String(formData.get("topic")).trim(),
    organization_id: formData.get("organization_id"),
    instructor_id: formData.get("instructor_id") || null,
    venue_id: formData.get("venue_id") || null,
    status: formData.get("status"),
    starts_at: toIso(formData.get("starts_at")),
    ends_at: toIso(formData.get("ends_at")),
    summary: String(formData.get("summary") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    application_url: String(formData.get("application_url") || "").trim() || null,
    published: formData.get("published") === "on",
    tags: [String(formData.get("topic")).trim()].filter(Boolean),
  };

  let savedCourse;
  if (courseId) {
    const { data, error } = await supabase.from("courses").update(payload).eq("id", courseId).select().single();
    if (error) throw error;
    savedCourse = data;
  } else {
    const { data, error } = await supabase.from("courses").insert(payload).select().single();
    if (error) throw error;
    savedCourse = data;
  }

  if (payload.starts_at) {
    const firstSession = state.sessions.find((session) => session.course_id === savedCourse.id && session.session_order === 1);
    const sessionPayload = {
      course_id: savedCourse.id,
      session_order: 1,
      title: "1강",
      starts_at: payload.starts_at,
      ends_at: payload.ends_at,
      room: state.venues.find((venue) => venue.id === payload.venue_id)?.name || null,
    };
    if (firstSession) await supabase.from("course_sessions").update(sessionPayload).eq("id", firstSession.id);
    else await supabase.from("course_sessions").insert(sessionPayload);
  }

  showToast("교육을 저장했습니다.");
  await reload();
  state.tab = "courses";
  render();
}

async function saveArchive(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const courseId = formData.get("course_id");
  let url = String(formData.get("url") || "").trim();
  const file = formData.get("file");

  if (file && file.size > 0) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${courseId}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from(ARCHIVE_BUCKET).upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from(ARCHIVE_BUCKET).getPublicUrl(path);
    url = data.publicUrl;
  }

  if (!url) {
    showToast("외부 URL 또는 업로드 파일이 필요합니다.");
    return;
  }

  const { error } = await supabase.from("course_archives").insert({
    course_id: courseId,
    type: formData.get("type"),
    title: String(formData.get("title")).trim(),
    url,
    caption: String(formData.get("caption") || "").trim(),
    is_public: formData.get("is_public") === "on",
    created_by: state.user.id,
  });
  if (error) throw error;

  showToast("아카이브를 등록했습니다.");
  await reload();
  state.tab = "archive";
  render();
}

async function updateReview(reviewId, action) {
  const payload = {};
  if (action === "verify") payload.verification_status = "verified";
  if (action === "reject") payload.verification_status = "rejected";
  if (action === "hide") payload.is_hidden = true;
  if (action === "show") payload.is_hidden = false;

  const { error } = await supabase.from("reviews").update(payload).eq("id", reviewId);
  if (error) throw error;
  showToast("후기 상태를 변경했습니다.");
  await reload();
  state.tab = "reviews";
  render();
}

async function runDraw(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const targetCourseId = formData.get("target_course_id") || null;
  const eligible = state.reviews.filter((review) => review.verification_status === "verified" && !review.is_hidden && (!targetCourseId || review.course_id === targetCourseId));
  const winnerCount = Math.min(Number(formData.get("winner_count") || 1), eligible.length);
  const winners = randomPick(eligible, winnerCount);

  if (!winners.length) {
    showToast("추첨 대상 후기가 없습니다.");
    return;
  }

  const { data: draw, error: drawError } = await supabase.from("review_draws").insert({
    title: String(formData.get("title")).trim(),
    note: String(formData.get("note") || "").trim(),
    target_course_id: targetCourseId,
    created_by: state.user.id,
  }).select().single();
  if (drawError) throw drawError;

  const prizeLabel = String(formData.get("prize_label") || "").trim();
  const rows = winners.map((winner) => ({
    draw_id: draw.id,
    review_id: winner.id,
    user_id: winner.user_id,
    course_id: winner.course_id,
    prize_label: prizeLabel || null,
  }));
  const { error: winnerError } = await supabase.from("review_draw_winners").insert(rows);
  if (winnerError) throw winnerError;

  showToast(`${winners.length}명을 추첨했습니다.`);
  await reload();
  state.tab = "draws";
  render();
}

async function reload() {
  await refreshSession();
  await loadAdminData();
}

function bindEvents() {
  elements.adminLoginForm.addEventListener("submit", handleLogin);
  elements.adminLogoutButton.addEventListener("click", handleLogout);
  elements.refreshButton.addEventListener("click", async () => {
    await reload();
    showToast("새로고침했습니다.");
  });

  document.body.addEventListener("click", async (event) => {
    const tabButton = event.target.closest("[data-admin-tab]");
    const reviewButton = event.target.closest("[data-review-action]");
    if (tabButton) {
      state.tab = tabButton.dataset.adminTab;
      render();
    }
    if (reviewButton) {
      try {
        await updateReview(reviewButton.dataset.reviewId, reviewButton.dataset.reviewAction);
      } catch (error) {
        showToast(`후기 변경 실패: ${error.message}`);
      }
    }
    if (event.target.id === "newCourseButton") {
      const picker = document.getElementById("coursePicker");
      if (picker) picker.value = "";
      renderCourses();
    }
    if (event.target.id === "newOrganizationButton") {
      const picker = document.getElementById("organizationPicker");
      if (picker) picker.value = "";
      renderOrganizations();
    }
  });

  document.body.addEventListener("change", (event) => {
    if (event.target.id === "organizationPicker") renderOrganizations();
    if (event.target.id === "coursePicker") renderCourses();
  });

  document.body.addEventListener("submit", async (event) => {
    try {
      if (event.target.id === "organizationForm") await saveOrganization(event);
      if (event.target.id === "courseForm") await saveCourse(event);
      if (event.target.id === "archiveForm") await saveArchive(event);
      if (event.target.id === "drawForm") await runDraw(event);
    } catch (error) {
      showToast(`작업 실패: ${error.message}`);
    }
  });

  supabase.auth.onAuthStateChange(async () => {
    await refreshSession();
    render();
  });
}

async function initialize() {
  bindEvents();
  await reload();
}

initialize().catch((error) => {
  elements.adminContent.innerHTML = `<div class="empty">관리자 페이지를 불러오지 못했습니다: ${escapeHtml(error.message)}</div>`;
});
