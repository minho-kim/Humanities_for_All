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
  activePage: "courses",
  activeOrganizationSlug: "",
  activeView: "cards",
  activeCourseId: null,
  user: null,
};

const elements = {
  searchTitle: document.getElementById("searchTitle"),
  viewDescription: document.getElementById("viewDescription"),
  courseFilters: document.getElementById("courseFilters"),
  courseViewOptions: document.getElementById("courseViewOptions"),
  viewToggle: document.querySelector(".toggle"),
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
  profileModal: document.getElementById("profileModal"),
  profileTitle: document.getElementById("profileTitle"),
  profileBody: document.getElementById("profileBody"),
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

function mapQuery(venue) {
  return [venue?.address, venue?.name].filter(Boolean).join(" ").trim();
}

function kakaoMapUrl(venue) {
  if (!venue || venue.is_online) return "";
  if (venue.kakao_map_url) return venue.kakao_map_url;
  const query = mapQuery(venue);
  return query ? `https://map.kakao.com/?q=${encodeURIComponent(query)}` : "";
}

function naverPlaceUrl(venue) {
  if (!venue || venue.is_online) return "";
  if (venue.naver_place_url) return venue.naver_place_url;
  const query = mapQuery(venue);
  return query ? `https://map.naver.com/p/search/${encodeURIComponent(query)}` : "";
}

function icsDate(value) {
  if (!value) return "";
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function calendarLocation(course) {
  if (!course.venue) return "";
  return [course.venue.name, course.venue.address, course.venue.detail].filter(Boolean).join(" · ");
}

function downloadCalendar(course) {
  const firstSession = course.sessions[0];
  const startsAt = firstSession?.starts_at || course.starts_at;
  const endsAt = firstSession?.ends_at || course.ends_at || startsAt;
  if (!startsAt) {
    showToast("캘린더에 등록할 일정이 없습니다.");
    return;
  }
  const description = [course.summary, course.description].filter(Boolean).join("\\n\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Humanities for All//Courses//KO",
    "BEGIN:VEVENT",
    `UID:${course.id}@humanities-for-all`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(startsAt)}`,
    `DTEND:${icsDate(endsAt)}`,
    `SUMMARY:${escapeIcs(course.title)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs(calendarLocation(course))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${course.title || "course"}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("캘린더 파일을 내려받았습니다.");
}

function populateSelect(select, label, values) {
  select.innerHTML = `<option value="">${escapeHtml(label)}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
}

function getSubmitForm(event) {
  return event.target instanceof HTMLFormElement ? event.target : null;
}

function publicOrganizations() {
  return state.organizations.filter((organization) => organization.is_active !== false);
}

function publicArchiveItems() {
  return state.archives.filter((item) => ["photo", "video"].includes(item.type));
}

function coursesForOrganization(organizationId) {
  return state.composedCourses.filter((course) => course.organization_id === organizationId);
}

function courseById(courseId) {
  return state.composedCourses.find((course) => course.id === courseId);
}

function routeHash(page, slug = "") {
  if (page === "organization" && slug) return `#organization/${encodeURIComponent(slug)}`;
  if (page === "organizations") return "#organizations";
  if (page === "reviews") return "#reviews";
  if (page === "archive") return "#archive";
  return "#courses";
}

function applyRouteFromHash() {
  const value = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (value.startsWith("organization/")) {
    state.activePage = "organization";
    state.activeOrganizationSlug = value.replace("organization/", "");
    return;
  }
  if (["organizations", "reviews", "archive"].includes(value)) {
    state.activePage = value;
    state.activeOrganizationSlug = "";
    return;
  }
  state.activePage = "courses";
  state.activeOrganizationSlug = "";
}

function navigate(page, slug = "") {
  const nextHash = routeHash(page, slug);
  document.querySelectorAll(".modal.open").forEach(closeModal);
  if (window.location.hash === nextHash) {
    applyRouteFromHash();
    render();
  } else {
    window.location.hash = nextHash;
  }
  document.getElementById("courses")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setPageHeader({ title, description, showCourseTools = false, summary = "" }) {
  elements.searchTitle.textContent = title;
  elements.viewDescription.textContent = description;
  elements.courseFilters.classList.toggle("hidden", !showCourseTools);
  elements.viewToggle.classList.toggle("hidden", !showCourseTools);
  elements.resultSummary.textContent = summary;
  document.querySelectorAll(".page-tabs [data-route]").forEach((item) => {
    const route = item.dataset.route;
    const active = state.activePage === route || (state.activePage === "organization" && route === "organizations");
    item.classList.toggle("active", active);
  });
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
  const requestMap = [
    ["organizations", supabase.from("organizations").select("*").order("sort_order", { ascending: true })],
    ["instructors", supabase.from("instructors").select("*").order("name", { ascending: true })],
    ["venues", supabase.from("venues").select("*").order("name", { ascending: true })],
    ["courses", supabase.from("courses").select("*").order("starts_at", { ascending: true })],
    ["sessions", supabase.from("course_sessions").select("*").order("starts_at", { ascending: true })],
    ["archives", supabase.from("course_archives").select("*").order("sort_order", { ascending: true })],
    ["reviews", supabase.from("reviews").select("id, course_id, author_name, body, verification_status, created_at").order("created_at", { ascending: false })],
  ];

  const requests = await Promise.allSettled(requestMap.map(([, request]) => request));
  const failed = [];
  const dataByKey = new Map();

  requests.forEach((result, index) => {
    const key = requestMap[index][0];
    if (result.status === "rejected") {
      failed.push(`${key}: ${result.reason?.message || "요청 실패"}`);
      console.error(`[모두의 인문학] ${key} 데이터 요청 실패`, result.reason);
      dataByKey.set(key, []);
      return;
    }
    if (result.value.error) {
      failed.push(`${key}: ${result.value.error.message}`);
      console.error(`[모두의 인문학] ${key} 데이터 로딩 실패`, result.value.error);
      dataByKey.set(key, []);
      return;
    }
    dataByKey.set(key, result.value.data || []);
  });

  state.organizations = dataByKey.get("organizations") || [];
  state.instructors = dataByKey.get("instructors") || [];
  state.venues = dataByKey.get("venues") || [];
  state.courses = dataByKey.get("courses") || [];
  state.sessions = dataByKey.get("sessions") || [];
  state.archives = dataByKey.get("archives") || [];
  state.reviews = dataByKey.get("reviews") || [];

  composeCourses();
  populateFilters();
  render();

  if (failed.length) {
    showToast("일부 정보를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.");
    elements.resultSummary.textContent += " 일부 정보는 일시적으로 표시되지 않을 수 있습니다.";
  }
}

function populateFilters() {
  const orgNames = state.organizations.map((org) => org.name);
  const topics = [...new Set(state.courses.map((course) => course.topic))].sort((a, b) => a.localeCompare(b, "ko"));
  populateSelect(elements.orgFilter, "전체 단체", orgNames);
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
  elements.orgCount.textContent = publicOrganizations().length.toLocaleString("ko-KR");
  elements.courseCount.textContent = state.courses.length.toLocaleString("ko-KR");
  elements.reviewCount.textContent = state.reviews.length.toLocaleString("ko-KR");
  elements.archiveCount.textContent = publicArchiveItems().length.toLocaleString("ko-KR");
}

function courseCardHtml(course) {
  const firstSession = course.sessions[0];
  const orgSlug = course.organization?.slug || "";
  const orgName = course.organization?.name || "단체 미정";
  const instructorName = course.instructor?.name || "강사 미정";
  return `
      <article class="course-card">
        <div class="badge-row">
          <span class="badge ${getStatusClass(course.status)}">${escapeHtml(statusLabels[course.status] || course.status)}</span>
          <span class="badge">${escapeHtml(course.topic)}</span>
          <span class="badge gray">${escapeHtml(course.timeLabel || "시간 미정")}</span>
        </div>
        <h3>${escapeHtml(course.title)}</h3>
        <div class="meta">
          <span>🏛️ ${orgSlug ? `<button class="text-link" type="button" data-open-organization="${escapeHtml(orgSlug)}">${escapeHtml(orgName)}</button>` : escapeHtml(orgName)}</span>
          <span>🎙️ ${course.instructor?.id ? `<button class="text-link" type="button" data-open-instructor="${course.instructor.id}">${escapeHtml(instructorName)}</button>` : escapeHtml(instructorName)} 강사</span>
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
}

function organizationCardHtml(organization) {
  const courses = coursesForOrganization(organization.id);
  return `
      <article class="organization-card">
        ${organization.logo_url ? `<img class="org-logo" src="${escapeHtml(organization.logo_url)}" alt="${escapeHtml(organization.name)} 로고">` : ""}
        <div>
          <h3>${escapeHtml(organization.name)}</h3>
          <p>${escapeHtml(organization.description || "단체 소개가 곧 업데이트됩니다.")}</p>
          ${organization.contact_email ? `<p class="muted">연락처: ${escapeHtml(organization.contact_email)}</p>` : ""}
        </div>
        <div class="footer">
          <span class="review-note">교육 ${courses.length}개</span>
          <div class="actions">
            ${organization.website_url ? `<a class="btn small secondary" href="${escapeHtml(organization.website_url)}" target="_blank" rel="noreferrer">홈페이지</a>` : ""}
            <button class="btn small" type="button" data-open-organization="${escapeHtml(organization.slug)}">자세히 보기</button>
          </div>
        </div>
      </article>
    `;
}

function renderCards(courses) {
  elements.courseResults.className = "course-grid";
  if (!courses.length) {
    const organizations = publicOrganizations();
    if (!state.courses.length && organizations.length) {
      elements.courseResults.className = "content-stack";
      elements.courseResults.innerHTML = `
        <div class="empty">
          아직 등록된 교육이 없습니다. 먼저 참여 단체를 확인해 보세요.
          <div class="actions" style="justify-content:center;margin-top:14px;">
            <button class="btn small" type="button" data-route="organizations">참여 단체 전체 보기</button>
          </div>
        </div>
        <div class="organization-grid">
          ${organizations.map(organizationCardHtml).join("")}
        </div>
      `;
      return;
    }
    elements.courseResults.innerHTML = `<div class="empty">조건에 맞는 교육이 없습니다. 검색어나 필터를 다시 확인해 주세요.</div>`;
    return;
  }

  elements.courseResults.innerHTML = courses.map(courseCardHtml).join("");
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
    const orgSlug = course.organization?.slug || "";
    const orgName = course.organization?.name || "";
    return `
      <article class="calendar-item">
        <div class="date-box">${escapeHtml(formatDate(firstSession?.starts_at || course.starts_at))}<small>${escapeHtml(course.timeLabel || "")}</small></div>
        <div>
          <div class="badge-row">
            <span class="badge ${getStatusClass(course.status)}">${escapeHtml(statusLabels[course.status] || course.status)}</span>
            <span class="badge">${orgSlug ? `<button class="badge-link" type="button" data-open-organization="${escapeHtml(orgSlug)}">${escapeHtml(orgName)}</button>` : escapeHtml(orgName)}</span>
          </div>
          <h3>${escapeHtml(course.title)}</h3>
          <p>${escapeHtml(course.instructor?.name || "강사 미정")} 강사 · ${escapeHtml(course.venue?.name || "장소 미정")}</p>
        </div>
        <button class="btn small" type="button" data-open-course="${course.id}">상세 보기</button>
      </article>
    `;
  }).join("");
}

function renderCoursesPage() {
  const courses = filteredCourses();
  const organizations = publicOrganizations();
  setPageHeader({
    title: "교육 검색",
    description: "관심 있는 교육을 주제, 강사, 장소, 단체명으로 찾아보세요.",
    showCourseTools: true,
    summary: state.courses.length
      ? `${courses.length.toLocaleString("ko-KR")}개 교육이 표시됩니다.`
      : `등록된 교육은 아직 없고, ${organizations.length.toLocaleString("ko-KR")}개 단체가 등록되어 있습니다.`,
  });
  if (state.activeView === "calendar") renderCalendar(courses);
  else renderCards(courses);
}

function renderOrganizationsPage() {
  const organizations = publicOrganizations();
  setPageHeader({
    title: "참여 단체",
    description: "모두의 인문학에 함께하는 단체를 소개합니다. 단체를 선택하면 해당 단체의 교육만 모아볼 수 있습니다.",
    summary: `${organizations.length.toLocaleString("ko-KR")}개 단체가 함께합니다.`,
  });
  elements.courseResults.className = "organization-grid";
  elements.courseResults.innerHTML = organizations.map(organizationCardHtml).join("") || `<div class="empty">등록된 참여 단체가 없습니다.</div>`;
}

function renderOrganizationPage() {
  const organization = publicOrganizations().find((item) => item.slug === state.activeOrganizationSlug);
  if (!organization) {
    setPageHeader({
      title: "참여 단체",
      description: "요청한 단체 정보를 찾을 수 없습니다.",
      summary: "",
    });
    elements.courseResults.className = "content-stack";
    elements.courseResults.innerHTML = `<div class="empty">단체 정보를 찾을 수 없습니다.</div>`;
    return;
  }

  const courses = coursesForOrganization(organization.id);
  setPageHeader({
    title: organization.name,
    description: "단체 소개와 이 단체가 운영하는 교육을 함께 볼 수 있습니다.",
    summary: `${courses.length.toLocaleString("ko-KR")}개 교육이 있습니다.`,
  });
  elements.courseResults.className = "content-stack";
  elements.courseResults.innerHTML = `
    <article class="organization-detail section">
      ${organization.logo_url ? `<img class="org-logo large" src="${escapeHtml(organization.logo_url)}" alt="${escapeHtml(organization.name)} 로고">` : ""}
      <div>
        <h3>${escapeHtml(organization.name)}</h3>
        <p>${escapeHtml(organization.description || "단체 소개가 곧 업데이트됩니다.")}</p>
        ${organization.contact_email ? `<p class="muted">연락처: ${escapeHtml(organization.contact_email)}</p>` : ""}
        <div class="actions">
          <button class="btn small secondary" type="button" data-route="organizations">참여 단체 목록</button>
          ${organization.website_url ? `<a class="btn small" href="${escapeHtml(organization.website_url)}" target="_blank" rel="noreferrer">단체 홈페이지</a>` : ""}
        </div>
      </div>
    </article>
    <div class="course-grid">
      ${courses.length ? courses.map(courseCardHtml).join("") : `<div class="empty">이 단체의 등록된 교육이 없습니다.</div>`}
    </div>
  `;
}

function renderReviewsPage() {
  setPageHeader({
    title: "후기 모아보기",
    description: "교육에 참여한 사람들이 남긴 후기를 한곳에서 볼 수 있습니다.",
    summary: `${state.reviews.length.toLocaleString("ko-KR")}개 후기가 있습니다.`,
  });
  elements.courseResults.className = "content-stack";
  elements.courseResults.innerHTML = `
    <div class="table-list">
      ${state.reviews.map((review) => {
        const course = courseById(review.course_id);
        return `
          <article class="review-card">
            <div class="row-top">
              <strong>${escapeHtml(review.author_name || "참여자")}</strong>
              <span class="badge ${review.verification_status === "verified" ? "green" : "gray"}">${review.verification_status === "verified" ? "참여 확인" : "후기"}</span>
            </div>
            <p>${escapeHtml(review.body)}</p>
            <div class="footer">
              <span class="muted">${escapeHtml(course?.title || "교육 정보")} · ${escapeHtml(course?.organization?.name || "")}</span>
              ${course ? `<button class="btn small secondary" type="button" data-open-course="${course.id}">교육 보기</button>` : ""}
            </div>
          </article>
        `;
      }).join("") || `<div class="empty">아직 등록된 후기가 없습니다.</div>`}
    </div>
  `;
}

function openInstructorProfile(instructorId) {
  const instructor = state.instructors.find((item) => item.id === instructorId);
  if (!instructor) return;
  elements.profileTitle.textContent = instructor.name;
  elements.profileBody.innerHTML = `
    <div class="profile-card">
      ${instructor.photo_url ? `<img class="profile-photo" src="${escapeHtml(instructor.photo_url)}" alt="${escapeHtml(instructor.name)} 사진">` : `<div class="profile-photo placeholder">人</div>`}
      <div>
        <h3>${escapeHtml(instructor.name)}</h3>
        <p class="muted">${escapeHtml(instructor.title || "강사")}</p>
        <p>${escapeHtml(instructor.bio || "프로필 소개가 곧 업데이트됩니다.")}</p>
      </div>
    </div>
  `;
  openModal(elements.profileModal);
}

function renderArchivePage() {
  const items = publicArchiveItems();
  setPageHeader({
    title: "사진·영상 기록",
    description: "교육 현장의 사진과 영상을 모아볼 수 있습니다.",
    summary: `${items.length.toLocaleString("ko-KR")}개 기록이 있습니다.`,
  });
  elements.courseResults.className = "resource-grid";
  elements.courseResults.innerHTML = items.map((item) => {
    const course = courseById(item.course_id);
    return `
      <a class="media resource-card" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">
        <span class="badge">${item.type === "video" ? "영상" : "사진"}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.caption || course?.title || "자료 보기")}</small>
        ${course ? `<small>${escapeHtml(course.title)} · ${escapeHtml(course.organization?.name || "")}</small>` : ""}
      </a>
    `;
  }).join("") || `<div class="empty">등록된 사진·영상 기록이 없습니다.</div>`;
}

function render() {
  renderStats();
  if (state.activePage === "organizations") renderOrganizationsPage();
  else if (state.activePage === "organization") renderOrganizationPage();
  else if (state.activePage === "reviews") renderReviewsPage();
  else if (state.activePage === "archive") renderArchivePage();
  else renderCoursesPage();
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
  const orgSlug = course.organization?.slug || "";
  const orgName = course.organization?.name || "";
  const kakaoUrl = kakaoMapUrl(course.venue);
  const naverUrl = naverPlaceUrl(course.venue);

  elements.detailBadges.innerHTML = `
    <span class="badge ${getStatusClass(course.status)}">${escapeHtml(statusLabels[course.status] || course.status)}</span>
    <span class="badge">${escapeHtml(course.topic)}</span>
    <span class="badge gray">${orgSlug ? `<button class="badge-link" type="button" data-open-organization="${escapeHtml(orgSlug)}">${escapeHtml(orgName)}</button>` : escapeHtml(orgName)}</span>
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
          <button class="btn small secondary" type="button" data-add-calendar="${course.id}">캘린더 등록</button>
          <button class="btn small secondary" type="button" data-login-for-review>후기 쓰기</button>
        </div>
      </div>
      <aside class="section">
        <h3>강사·장소</h3>
        <p><strong>${course.instructor?.id ? `<button class="text-link" type="button" data-open-instructor="${course.instructor.id}">${escapeHtml(course.instructor.name)}</button>` : escapeHtml(course.instructor?.name || "강사 미정")}</strong> ${escapeHtml(course.instructor?.title || "")}</p>
        <p>${escapeHtml(course.instructor?.bio || "")}</p>
        <p>📍 ${escapeHtml(course.venue?.name || "장소 미정")} ${course.venue?.address ? `· ${escapeHtml(course.venue.address)}` : ""} ${course.venue?.detail ? `· ${escapeHtml(course.venue.detail)}` : ""}</p>
        <div class="actions" style="margin: 10px 0 14px;">
          ${course.instructor?.id ? `<button class="btn small secondary" type="button" data-open-instructor="${course.instructor.id}">강사 프로필</button>` : ""}
          ${kakaoUrl ? `<a class="btn small secondary" href="${escapeHtml(kakaoUrl)}" target="_blank" rel="noreferrer">카카오맵</a>` : ""}
          ${naverUrl ? `<a class="btn small secondary" href="${escapeHtml(naverUrl)}" target="_blank" rel="noreferrer">네이버플레이스</a>` : ""}
        </div>
        <p>주관 단체: ${orgSlug ? `<button class="text-link" type="button" data-open-organization="${escapeHtml(orgSlug)}">${escapeHtml(orgName)}</button>` : escapeHtml(orgName)}</p>
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

  const form = getSubmitForm(event);
  if (!form) return;
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
    const routeControl = event.target.closest("[data-route]");
    const openButton = event.target.closest("[data-open-course]");
    const organizationButton = event.target.closest("[data-open-organization]");
    const instructorButton = event.target.closest("[data-open-instructor]");
    const calendarButton = event.target.closest("[data-add-calendar]");
    const closeButton = event.target.closest("[data-close-modal]");
    const loginForReview = event.target.closest("[data-login-for-review]");
    if (routeControl) {
      event.preventDefault();
      navigate(routeControl.dataset.route);
      return;
    }
    if (organizationButton) {
      navigate("organization", organizationButton.dataset.openOrganization);
      return;
    }
    if (instructorButton) {
      openInstructorProfile(instructorButton.dataset.openInstructor);
      return;
    }
    if (calendarButton) {
      const course = state.composedCourses.find((item) => item.id === calendarButton.dataset.addCalendar);
      if (course) downloadCalendar(course);
      return;
    }
    if (openButton) openCourseDetail(openButton.dataset.openCourse);
    if (closeButton) closeModal(closeButton.closest(".modal"));
    if (loginForReview) openModal(elements.loginModal);
  });

  document.body.addEventListener("submit", (event) => {
    if (event.target.id === "reviewForm") return handleReviewSubmit(event);
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
  window.addEventListener("hashchange", () => {
    applyRouteFromHash();
    render();
  });
  supabase.auth.onAuthStateChange(async () => {
    await refreshSession();
  });
}

async function initialize() {
  applyRouteFromHash();
  bindEvents();
  await refreshSession();
  await loadData();
}

initialize().catch((error) => {
  console.error("Public page initialization failed", error);
  elements.resultSummary.textContent = "교육을 불러오지 못했습니다.";
  elements.courseResults.innerHTML = `<div class="empty">일시적으로 교육 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>`;
});
