import {
  escapeHtml,
  formatDate,
  formatDateTime,
  getCurrentUrlWithoutHash,
  getDisplayName,
  getMaskedEmailName,
  getReviewAuthorName,
  groupBy,
  byId,
  normalizeSafeUrl,
  shortDate,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  statusLabels,
  URL_RULES,
  verificationLabels,
} from "./shared.js";

const state = {
  organizations: [],
  instructors: [],
  venues: [],
  courses: [],
  sessions: [],
  archives: [],
  reviews: [],
  myReviews: [],
  applications: [],
  composedCourses: [],
  activePage: "courses",
  activeOrganizationSlug: "",
  activeView: "cards",
  activeCourseId: null,
  user: null,
  applicantProfile: null,
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
  instructorFilter: document.getElementById("instructorFilter"),
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
  profileEyebrow: document.getElementById("profileEyebrow"),
  profileTitle: document.getElementById("profileTitle"),
  profileBody: document.getElementById("profileBody"),
  toast: document.getElementById("toast"),
};

const PUBLIC_FETCH_TIMEOUT_MS = 7000;
const PUBLIC_FETCH_RETRIES = 1;
const SESSION_TIMEOUT_MS = 2500;
const APPLICATION_TERMS_VERSION = "2026-06-29";
let supplementaryLoadSequence = 0;
let supabaseClientPromise = null;

function getSupabaseClient() {
  if (!supabaseClientPromise) {
    supabaseClientPromise = import("./supabaseClient.js").then(({ supabase }) => supabase);
  }
  return supabaseClientPromise;
}

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
  const savedUrl = normalizeSafeUrl(venue.kakao_map_url, URL_RULES.kakaoMap);
  if (savedUrl) return savedUrl;
  const query = mapQuery(venue);
  return query ? normalizeSafeUrl(`https://map.kakao.com/?q=${encodeURIComponent(query)}`, URL_RULES.kakaoMap) : "";
}

function naverPlaceUrl(venue) {
  if (!venue || venue.is_online) return "";
  const savedUrl = normalizeSafeUrl(venue.naver_place_url, URL_RULES.naverPlace);
  if (savedUrl) return savedUrl;
  const query = mapQuery(venue);
  return query ? normalizeSafeUrl(`https://map.naver.com/p/search/${encodeURIComponent(query)}`, URL_RULES.naverPlace) : "";
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
  link.download = `${String(course.title || "course").replace(/[\\/:*?"<>|]/g, "_")}.ics`;
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

async function withTimeoutResult(promise, timeoutMs, fallback) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutId = window.setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch (error) {
    return { data: { session: null }, error };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchPublicRows(table, { select = "*", order = "" } = {}) {
  const params = new URLSearchParams({
    select,
  });
  if (order) params.set("order", order);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PUBLIC_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const body = await response.text();
    let payload = [];
    if (body) {
      try {
        payload = JSON.parse(body);
      } catch (error) {
        return { data: [], error: { message: `응답 형식 확인 필요: ${error.message}` } };
      }
    }
    if (!response.ok) {
      return { data: [], error: { message: `HTTP ${response.status}: ${body.slice(0, 160)}` } };
    }
    return { data: Array.isArray(payload) ? payload : [], error: null };
  } catch (error) {
    const message = error.name === "AbortError" ? "응답 대기 시간이 초과되었습니다." : error.message;
    return { data: [], error: { message } };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function loadPublicRows(table, options) {
  let lastResult = { data: [], error: null };
  for (let attempt = 0; attempt <= PUBLIC_FETCH_RETRIES; attempt += 1) {
    lastResult = await fetchPublicRows(table, options);
    if (!lastResult.error) return lastResult;
  }
  return lastResult;
}

function loadPublicReviews() {
  return loadPublicRows("reviews", {
    select: "id,course_id,author_name,body,verification_status,created_at",
    order: "created_at.desc",
  });
}

function publicOrganizations() {
  return state.organizations.filter((organization) => organization.is_active !== false);
}

function publicArchiveItems() {
  return state.archives.filter((item) => ["photo", "video", "file", "link"].includes(item.type) && normalizeSafeUrl(item.url, URL_RULES.archive));
}

function archiveTypeLabel(type) {
  if (type === "video") return "영상";
  if (type === "photo") return "사진";
  if (type === "file") return "자료";
  return "링크";
}

function reviewStatusLabel(review) {
  if (review.is_hidden) return "비공개";
  return verificationLabels[review.verification_status] || "후기";
}

function reviewStatusClass(review) {
  if (review.is_hidden) return "red";
  if (review.verification_status === "verified") return "green";
  if (review.verification_status === "rejected") return "red";
  return "gray";
}

function applicationStatusLabel(application) {
  if (isCancelledApplication(application)) return "취소";
  if (isAttendanceConfirmed(application)) return "참석 확인";
  return "신청";
}

function applicationStatusClass(application) {
  if (isCancelledApplication(application)) return "red";
  if (isAttendanceConfirmed(application)) return "green";
  return "gray";
}

function canApplyToCourse(course) {
  return ["scheduled", "open"].includes(course.status);
}

function isCancelledApplication(application) {
  return application?.status === "cancelled";
}

function isAttendanceConfirmed(application) {
  return Boolean(application?.attendance_confirmed_at);
}

function activeApplicationForCourse(courseId) {
  return state.applications.find((application) => application.course_id === courseId && !isCancelledApplication(application));
}

function cancelledApplicationForCourse(courseId) {
  return state.applications.find((application) => application.course_id === courseId && isCancelledApplication(application));
}

function userApplicationForCourse(courseId) {
  return activeApplicationForCourse(courseId);
}

function formatPhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";

  if (digits.startsWith("02")) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }

  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  const middleEnd = digits.length === 10 ? 6 : 7;
  return `${digits.slice(0, 3)}-${digits.slice(3, middleEnd)}-${digits.slice(middleEnd)}`;
}

function normalizePhone(value) {
  return formatPhoneNumber(value);
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidPhone(value) {
  const digits = phoneDigits(value);
  return /^0\d+$/.test(digits) && digits.length >= 9 && digits.length <= 11;
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

async function loadData({ waitForSupplementary = false } = {}) {
  elements.resultSummary.textContent = "교육 정보를 불러오는 중입니다.";
  state.archives = [];
  state.reviews = [];

  const coreRequestMap = [
    ["organizations", loadPublicRows("organizations", { order: "sort_order.asc" })],
    ["instructors", loadPublicRows("instructors", { order: "name.asc" })],
    ["venues", loadPublicRows("venues", { order: "name.asc" })],
    ["courses", loadPublicRows("courses", { order: "starts_at.asc" })],
    ["sessions", loadPublicRows("course_sessions", { order: "starts_at.asc" })],
  ];

  const dataByKey = await resolveDataRequests(coreRequestMap);

  state.organizations = dataByKey.get("organizations") || [];
  state.instructors = dataByKey.get("instructors") || [];
  state.venues = dataByKey.get("venues") || [];
  state.courses = dataByKey.get("courses") || [];
  state.sessions = dataByKey.get("sessions") || [];

  composeCourses();
  populateFilters();
  render();

  const supplementaryPromise = loadSupplementaryData();
  if (waitForSupplementary) await supplementaryPromise;
}

async function resolveDataRequests(requestMap) {
  const requests = await Promise.allSettled(requestMap.map(([, request]) => request));
  const dataByKey = new Map();
  requests.forEach((result, index) => {
    const key = requestMap[index][0];
    if (result.status === "rejected") {
      console.warn(`[모두의 인문학] ${key} 공개 데이터 확인 필요`, result.reason);
      dataByKey.set(key, []);
      return;
    }
    if (result.value.error) {
      console.warn(`[모두의 인문학] ${key} 공개 데이터 확인 필요`, result.value.error);
      dataByKey.set(key, []);
      return;
    }
    dataByKey.set(key, result.value.data || []);
  });
  return dataByKey;
}

async function loadSupplementaryData() {
  const sequence = ++supplementaryLoadSequence;
  const supplementaryRequestMap = [
    ["archives", loadPublicRows("course_archives", { order: "sort_order.asc" })],
    ["reviews", loadPublicReviews()],
  ];
  const dataByKey = await resolveDataRequests(supplementaryRequestMap);
  if (sequence !== supplementaryLoadSequence) return;
  state.archives = dataByKey.get("archives") || [];
  state.reviews = dataByKey.get("reviews") || [];

  composeCourses();
  render();
  if (elements.detailModal.classList.contains("open") && state.activeCourseId) {
    openCourseDetail(state.activeCourseId);
  }
}

function clearApplicationState() {
  state.applicantProfile = null;
  state.applications = [];
  state.myReviews = [];
}

async function loadApplicationState(supabase) {
  if (!state.user) {
    clearApplicationState();
    return;
  }

  const [profileResult, applicationsResult, myReviewsResult] = await Promise.allSettled([
    supabase
      .from("applicant_profiles")
      .select("user_id,applicant_name,phone,privacy_agreed_at,sms_notice_agreed_at,terms_version,updated_at")
      .eq("user_id", state.user.id)
      .maybeSingle(),
    supabase
      .from("course_applications")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.rpc("get_my_reviews"),
  ]);

  if (profileResult.status === "fulfilled" && !profileResult.value.error) {
    state.applicantProfile = profileResult.value.data || null;
  } else {
    console.warn("[모두의 인문학] 신청자 정보 확인 지연", profileResult.reason || profileResult.value?.error);
    state.applicantProfile = null;
  }

  if (applicationsResult.status === "fulfilled" && !applicationsResult.value.error) {
    state.applications = applicationsResult.value.data || [];
  } else {
    console.warn("[모두의 인문학] 교육 신청 내역 확인 지연", applicationsResult.reason || applicationsResult.value?.error);
    state.applications = [];
  }

  if (myReviewsResult.status === "fulfilled" && !myReviewsResult.value.error) {
    state.myReviews = myReviewsResult.value.data || [];
  } else {
    console.warn("[모두의 인문학] 내 후기 내역 확인 지연", myReviewsResult.reason || myReviewsResult.value?.error);
    state.myReviews = [];
  }
}

function populateFilters() {
  const orgNames = state.organizations.map((org) => org.name);
  const instructorsById = new Map();
  state.composedCourses.forEach((course) => {
    if (course.instructor?.id && course.instructor?.name) instructorsById.set(course.instructor.id, course.instructor);
  });
  const instructors = [...instructorsById.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  populateSelect(elements.orgFilter, "전체 단체", orgNames);
  elements.instructorFilter.innerHTML = `<option value="">전체 강사</option>${instructors.map((instructor) => `<option value="${escapeHtml(instructor.id)}">${escapeHtml(instructor.name)}</option>`).join("")}`;
}

function getFilters() {
  return {
    q: elements.searchInput.value.trim().toLowerCase(),
    org: elements.orgFilter.value,
    instructor: elements.instructorFilter.value,
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
      course.organization?.name,
      course.instructor?.name,
      course.venue?.name,
      course.venue?.address,
      course.timeLabel,
    ].join(" ").toLowerCase();

    return (!filters.q || haystack.includes(filters.q))
      && (!filters.org || course.organization?.name === filters.org)
      && (!filters.instructor || course.instructor?.id === filters.instructor)
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
  const logoUrl = normalizeSafeUrl(organization.logo_url, URL_RULES.image);
  const websiteUrl = normalizeSafeUrl(organization.website_url, URL_RULES.external);
  return `
      <article class="organization-card">
        ${logoUrl ? `<img class="org-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(organization.name)} 로고">` : ""}
        <div>
          <h3>${escapeHtml(organization.name)}</h3>
          <p>${escapeHtml(organization.description || "단체 소개가 곧 업데이트됩니다.")}</p>
          ${organization.contact_email ? `<p class="muted">연락처: ${escapeHtml(organization.contact_email)}</p>` : ""}
        </div>
        <div class="footer">
          <span class="review-note">교육 ${courses.length}개</span>
          <div class="actions">
            ${websiteUrl ? `<a class="btn small secondary" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noreferrer">홈페이지</a>` : ""}
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
    description: "관심 있는 교육을 교육명, 강사, 장소, 단체명으로 찾아보세요.",
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
  const logoUrl = normalizeSafeUrl(organization.logo_url, URL_RULES.image);
  const websiteUrl = normalizeSafeUrl(organization.website_url, URL_RULES.external);
  setPageHeader({
    title: organization.name,
    description: "단체 소개와 이 단체가 운영하는 교육을 함께 볼 수 있습니다.",
    summary: `${courses.length.toLocaleString("ko-KR")}개 교육이 있습니다.`,
  });
  elements.courseResults.className = "content-stack";
  elements.courseResults.innerHTML = `
    <article class="organization-detail section">
      ${logoUrl ? `<img class="org-logo large" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(organization.name)} 로고">` : ""}
      <div>
        <h3>${escapeHtml(organization.name)}</h3>
        <p>${escapeHtml(organization.description || "단체 소개가 곧 업데이트됩니다.")}</p>
        ${organization.contact_email ? `<p class="muted">연락처: ${escapeHtml(organization.contact_email)}</p>` : ""}
        <div class="actions">
          <button class="btn small secondary" type="button" data-route="organizations">참여 단체 목록</button>
          ${websiteUrl ? `<a class="btn small" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noreferrer">단체 홈페이지</a>` : ""}
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
              <strong>${escapeHtml(getMaskedEmailName(review.author_name))}님의 후기</strong>
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
  const photoUrl = normalizeSafeUrl(instructor.photo_url, URL_RULES.image);
  elements.profileEyebrow.textContent = "강사 프로필";
  elements.profileTitle.textContent = instructor.name;
  elements.profileBody.innerHTML = `
    <div class="profile-card">
      ${photoUrl ? `<img class="profile-photo" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(instructor.name)} 사진">` : `<div class="profile-photo placeholder">人</div>`}
      <div>
        <h3>${escapeHtml(instructor.name)}</h3>
        <p class="muted">${escapeHtml(instructor.title || "강사")}</p>
        <p>${escapeHtml(instructor.bio || "프로필 소개가 곧 업데이트됩니다.")}</p>
      </div>
    </div>
  `;
  openModal(elements.profileModal);
}

function renderApplicationHistory() {
  if (!state.applications.length) return `<div class="empty">아직 신청한 교육이 없습니다.</div>`;
  return `
    <div class="table-list">
      ${state.applications.map((application) => {
        const course = courseById(application.course_id);
        return `
          <div class="table-row">
            <div class="row-top">
              <strong>${escapeHtml(course?.title || "교육 정보")}</strong>
              <span class="badge ${applicationStatusClass(application)}">${escapeHtml(applicationStatusLabel(application))}</span>
            </div>
            <p class="muted">신청일 ${escapeHtml(shortDate(application.created_at))} · 신청자 ${escapeHtml(application.applicant_name || "")}</p>
            ${isAttendanceConfirmed(application) ? `<p class="muted">참석 확인: ${escapeHtml(shortDate(application.attendance_confirmed_at))}</p>` : ""}
            ${application.note ? `<p>${escapeHtml(application.note)}</p>` : ""}
            ${course ? `<button class="btn small secondary" type="button" data-open-course="${course.id}">교육 보기</button>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderMyReviewHistory() {
  if (!state.myReviews.length) return `<div class="empty">아직 작성한 후기가 없습니다.</div>`;
  return `
    <div class="table-list">
      ${state.myReviews.map((review) => {
        const course = courseById(review.course_id);
        return `
          <div class="table-row">
            <div class="row-top">
              <strong>${escapeHtml(course?.title || "교육 정보")}</strong>
              <span class="badge ${reviewStatusClass(review)}">${escapeHtml(reviewStatusLabel(review))}</span>
            </div>
            <p>${escapeHtml(review.body)}</p>
            <p class="muted">작성일 ${escapeHtml(shortDate(review.created_at))}</p>
            ${course ? `<button class="btn small secondary" type="button" data-open-course="${course.id}">교육 보기</button>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function openMyInfo() {
  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }

  elements.profileEyebrow.textContent = "나의 정보";
  elements.profileTitle.textContent = "나의 활동";
  elements.profileBody.innerHTML = `
    <div class="my-info-grid">
      <section class="section">
        <h3>인증 정보</h3>
        <p class="muted">인증 이메일</p>
        <p><strong>${escapeHtml(state.user.email || getReviewAuthorName(state.user))}</strong></p>
        <div class="actions">
          <button class="btn small secondary" type="button" data-logout-account>로그아웃</button>
        </div>
      </section>
      <section class="section">
        <h3>신청자 정보</h3>
        ${state.applicantProfile ? `
          <p>이름: <strong>${escapeHtml(state.applicantProfile.applicant_name)}</strong></p>
          <p>전화번호: <strong>${escapeHtml(state.applicantProfile.phone)}</strong></p>
          <p class="muted">마지막 확인: ${escapeHtml(shortDate(state.applicantProfile.updated_at))}</p>
        ` : `<p class="muted">아직 저장된 신청자 정보가 없습니다. 교육을 신청하면 다음 신청 때 자동 입력됩니다.</p>`}
      </section>
    </div>
    <section class="section" style="margin-top: 14px;">
      <h3>교육 신청 현황</h3>
      ${renderApplicationHistory()}
    </section>
    <section class="section" style="margin-top: 14px;">
      <h3>후기 작성 현황</h3>
      ${renderMyReviewHistory()}
    </section>
  `;
  openModal(elements.profileModal);
}

function renderArchivePage() {
  const items = publicArchiveItems();
  setPageHeader({
    title: "사진·영상·자료",
    description: "교육 현장의 사진과 영상, PDF 자료를 모아볼 수 있습니다.",
    summary: `${items.length.toLocaleString("ko-KR")}개 자료가 있습니다.`,
  });
  elements.courseResults.className = "resource-grid";
  elements.courseResults.innerHTML = items.map((item) => {
    const course = courseById(item.course_id);
    return `
      <a class="media resource-card" href="${escapeHtml(normalizeSafeUrl(item.url, URL_RULES.archive))}" target="_blank" rel="noreferrer">
        <span class="badge">${archiveTypeLabel(item.type)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.caption || course?.title || "자료 보기")}</small>
        ${course ? `<small>${escapeHtml(course.title)} · ${escapeHtml(course.organization?.name || "")}</small>` : ""}
      </a>
    `;
  }).join("") || `<div class="empty">등록된 사진·영상·자료가 없습니다.</div>`;
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
      <strong>${escapeHtml(getMaskedEmailName(review.author_name))}님의 후기 <span class="badge ${review.verification_status === "verified" ? "green" : "gray"}">${review.verification_status === "verified" ? "참여 확인" : "후기"}</span></strong><br>
      ${escapeHtml(review.body)}
    </li>
  `).join("");
}

function renderReviewForm(course) {
  if (!state.user) {
    return `<p>후기를 남기려면 이메일 인증이 필요합니다. 교육 정보는 인증 없이 볼 수 있습니다.</p><button class="btn" type="button" data-login-for-review>이메일 인증 후 후기 쓰기</button>`;
  }

  const application = activeApplicationForCourse(course.id);
  const cancelledApplication = cancelledApplicationForCourse(course.id);
  if (!application) {
    if (cancelledApplication) return `<p>취소한 신청은 후기를 작성할 수 없습니다. 문의가 필요하면 운영자에게 연락해 주세요.</p>`;
    return `<p>후기는 교육 신청 후 관리자의 참석 확인이 완료된 참여자만 작성할 수 있습니다.</p>`;
  }
  if (!isAttendanceConfirmed(application)) {
    return `<p>교육 참석 후 관리자가 참석 확인을 마치면 후기를 작성할 수 있습니다.</p>`;
  }
  return `
    <form id="reviewForm">
      <label>후기<textarea name="body" placeholder="교육에서 좋았던 점, 기억에 남은 질문, 다음 참여자에게 전하고 싶은 말을 적어주세요." required minlength="10"></textarea></label>
      <div class="actions" style="margin-top: 12px;">
        <button class="btn" type="submit">후기 등록</button>
        <span class="badge green">참석 확인 완료</span>
      </div>
    </form>
  `;
}

function renderApplicationForm(course) {
  const existingApplication = userApplicationForCourse(course.id);
  if (!state.user) {
    if (!canApplyToCourse(course)) {
      return `<p>현재 이 교육은 신청을 받지 않습니다. 상태: <strong>${escapeHtml(statusLabels[course.status] || course.status)}</strong></p>`;
    }
    return `
      <p>교육 신청에는 이메일 인증이 필요합니다. 인증 후 이름과 전화번호를 입력해 주세요.</p>
      <button class="btn" type="button" data-login-for-application>이메일 인증 후 신청하기</button>
    `;
  }

  if (existingApplication) {
    const attendanceConfirmed = isAttendanceConfirmed(existingApplication);
    return `
      <div class="table-row">
        <div class="row-top">
          <strong>이미 신청한 교육입니다.</strong>
          <span class="badge ${attendanceConfirmed ? "green" : "gray"}">${attendanceConfirmed ? "참석 확인" : "신청"}</span>
        </div>
        <p class="muted">신청자: ${escapeHtml(existingApplication.applicant_name)} · 연락처: ${escapeHtml(existingApplication.phone)}</p>
        ${existingApplication.note ? `<p>${escapeHtml(existingApplication.note)}</p>` : ""}
        ${attendanceConfirmed
          ? `<p class="muted">참석 확인이 완료되어 후기를 작성할 수 있습니다.</p>`
          : `<p class="muted">신청 취소는 아래 버튼으로 처리할 수 있습니다. 신청 내용 수정이 필요하면 운영자에게 문의해 주세요.</p>
             <button class="btn small secondary" type="button" data-cancel-application="${escapeHtml(existingApplication.id)}">신청 취소</button>`}
      </div>
    `;
  }

  const cancelledApplication = cancelledApplicationForCourse(course.id);
  if (cancelledApplication) {
    return `
      <div class="table-row">
        <div class="row-top">
          <strong>신청을 취소한 교육입니다.</strong>
          <span class="badge red">취소</span>
        </div>
        <p class="muted">취소된 신청은 현재 신청 명단에서 제외됩니다. 다시 신청해야 한다면 운영자에게 문의해 주세요.</p>
      </div>
    `;
  }

  if (!canApplyToCourse(course)) {
    return `<p>현재 이 교육은 신청을 받지 않습니다. 상태: <strong>${escapeHtml(statusLabels[course.status] || course.status)}</strong></p>`;
  }

  const defaultName = state.applicantProfile?.applicant_name || "";
  const defaultPhone = formatPhoneNumber(state.applicantProfile?.phone || "");
  return `
    <form id="applicationForm">
      <input type="hidden" name="course_id" value="${escapeHtml(course.id)}">
      <div class="admin-grid">
        <label>신청자명<input name="applicant_name" value="${escapeHtml(defaultName)}" required maxlength="80" autocomplete="name"></label>
        <label>휴대전화번호<input name="phone" value="${escapeHtml(defaultPhone)}" required inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" maxlength="13"></label>
      </div>
      <label style="margin-top: 10px;">이메일<input value="${escapeHtml(state.user.email || "")}" readonly></label>
      <label style="margin-top: 10px;">요청사항(선택)<textarea name="note" placeholder="접근성 지원, 문의사항 등이 있으면 적어주세요."></textarea></label>
      <div class="section privacy-consent" style="margin-top: 12px;">
        <h3>개인정보 수집·이용 동의</h3>
        <p class="muted">교육 신청 접수와 운영 안내를 위해 필요한 최소한의 개인정보를 수집합니다.</p>
        <details>
          <summary>개인정보 수집·이용 안내 자세히 보기</summary>
          <ul class="plain-list">
            <li><strong>관련 근거</strong><br>개인정보 보호법 제15조 제1항 제1호에 따른 정보주체의 동의</li>
            <li><strong>수집·이용 목적</strong><br>교육 신청 접수, 신청자 본인 확인, 일정·장소·변경·취소 안내, 신청 이력 확인, 운영 문의 응대</li>
            <li><strong>수집 항목</strong><br>필수: 신청자명, 이메일, 휴대전화번호 · 선택: 요청사항</li>
            <li><strong>보유·이용 기간</strong><br>교육 종료 후 6개월 또는 사업 정산·민원 응대 종료 시까지 보관한 뒤 파기합니다. 관련 법령에 따라 더 보관해야 하는 경우에는 해당 법령에서 정한 기간 동안 보관할 수 있습니다.</li>
            <li><strong>동의 거부권과 불이익</strong><br>개인정보 수집·이용에 동의하지 않을 권리가 있습니다. 다만 필수 항목 동의를 거부하면 교육 신청 접수와 운영 안내가 어려워 신청이 제한될 수 있습니다.</li>
            <li><strong>전화번호 안내</strong><br>휴대전화번호는 유료 본인 인증 없이 신청자가 입력한 값을 저장하며, 교육 운영 안내 연락에만 사용합니다.</li>
          </ul>
        </details>
        <label><span><input name="privacy_agreement" type="checkbox" required style="width:auto;min-height:auto;"> 개인정보 수집 및 이용에 동의합니다.</span></label>
        <label style="margin-top: 8px;"><span><input name="sms_notice_agreement" type="checkbox" required style="width:auto;min-height:auto;"> 교육 운영 안내를 문자로 받을 수 있음에 동의합니다.</span></label>
      </div>
      <div class="actions" style="margin-top: 12px;">
        <button class="btn" type="submit">교육 신청하기</button>
        <span class="badge green">다음 신청 때 이름과 전화번호가 자동 입력됩니다</span>
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
  const applicationUrl = normalizeSafeUrl(course.application_url, URL_RULES.external);

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
          <button class="btn small" type="button" data-apply-course="${course.id}">신청하기</button>
          ${applicationUrl ? `<a class="btn small secondary" href="${escapeHtml(applicationUrl)}" target="_blank" rel="noreferrer">외부 신청 링크</a>` : ""}
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
      <div class="section" id="applicationSection" style="grid-column: 1 / -1;">
        <h3>교육 신청</h3>
        ${renderApplicationForm(course)}
      </div>
      <div class="section">
        <h3>후기 ${course.reviews.length}개</h3>
        <ul class="review-list">${renderReviews(course)}</ul>
      </div>
      <div class="section">
        <h3>사진·영상·자료</h3>
        <div class="media-grid">
          ${course.archives.filter((item) => normalizeSafeUrl(item.url, URL_RULES.archive)).length ? course.archives.filter((item) => normalizeSafeUrl(item.url, URL_RULES.archive)).map((item) => `<a class="media" href="${escapeHtml(normalizeSafeUrl(item.url, URL_RULES.archive))}" target="_blank" rel="noreferrer"><strong>${archiveTypeLabel(item.type)} · ${escapeHtml(item.title)}</strong><small>${escapeHtml(item.caption || "자료 보기")}</small></a>`).join("") : `<p class="muted">등록된 사진·영상·자료가 없습니다.</p>`}
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

async function handleApplicationSubmit(event) {
  event.preventDefault();
  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }

  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const courseId = String(formData.get("course_id") || "");
  const course = state.composedCourses.find((item) => item.id === courseId);
  if (!course || !canApplyToCourse(course)) {
    showToast("현재 신청할 수 없는 교육입니다.");
    return;
  }
  if (userApplicationForCourse(courseId)) {
    showToast("이미 이 교육을 신청했습니다.");
    return;
  }
  if (cancelledApplicationForCourse(courseId)) {
    showToast("취소한 신청을 다시 열려면 운영자에게 문의해 주세요.");
    return;
  }

  const applicantName = String(formData.get("applicant_name") || "").trim();
  const phone = normalizePhone(formData.get("phone"));
  const note = String(formData.get("note") || "").trim();
  if (!applicantName) {
    showToast("신청자명을 입력해 주세요.");
    return;
  }
  if (!isValidPhone(phone)) {
    showToast("전화번호를 확인해 주세요. 예: 010-0000-0000");
    return;
  }
  if (formData.get("privacy_agreement") !== "on" || formData.get("sms_notice_agreement") !== "on") {
    showToast("교육 신청을 위해 개인정보 수집 및 문자 안내 동의가 필요합니다.");
    return;
  }

  const now = new Date().toISOString();
  const email = state.user.email || "";
  const supabase = await getSupabaseClient();
  const profilePayload = {
    user_id: state.user.id,
    applicant_name: applicantName,
    phone,
    privacy_agreed_at: now,
    sms_notice_agreed_at: now,
    terms_version: APPLICATION_TERMS_VERSION,
  };

  const { error: profileError } = await supabase
    .from("applicant_profiles")
    .upsert(profilePayload, { onConflict: "user_id" });
  if (profileError) {
    console.error("Applicant profile save failed", profileError);
    showToast("신청자 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }

  const { error } = await supabase.from("course_applications").insert({
    course_id: course.id,
    user_id: state.user.id,
    applicant_name: applicantName,
    email,
    phone,
    note: note || null,
    privacy_agreed_at: now,
    sms_notice_agreed_at: now,
    terms_version: APPLICATION_TERMS_VERSION,
  });

  if (error) {
    if (error.code === "23505") showToast("이미 이 교육을 신청했습니다.");
    else {
      console.error("Course application failed", error);
      showToast("교육 신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    await loadApplicationState(supabase);
    openCourseDetail(course.id);
    return;
  }

  await loadApplicationState(supabase);
  showToast("교육 신청이 접수되었습니다.");
  openCourseDetail(course.id);
}

async function handleCancelApplication(button) {
  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }

  const applicationId = button.dataset.cancelApplication;
  if (!applicationId) return;

  if (button.dataset.confirmCancel !== "true") {
    button.dataset.confirmCancel = "true";
    button.textContent = "한 번 더 누르면 취소됩니다";
    window.setTimeout(() => {
      if (button.dataset.confirmCancel === "true") {
        button.dataset.confirmCancel = "false";
        button.textContent = "신청 취소";
      }
    }, 3000);
    return;
  }

  button.disabled = true;
  button.textContent = "취소 중...";
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc("cancel_my_course_application", {
    p_application_id: applicationId,
  });

  if (error || data !== true) {
    console.error("Course application cancel failed", error);
    showToast("신청을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    button.disabled = false;
    button.textContent = "신청 취소";
    return;
  }

  await loadApplicationState(supabase);
  showToast("교육 신청을 취소했습니다.");
  if (state.activeCourseId) openCourseDetail(state.activeCourseId);
  if (elements.profileModal.classList.contains("open") && elements.profileEyebrow.textContent === "나의 정보") {
    openMyInfo();
  }
}

async function handleReviewSubmit(event) {
  event.preventDefault();
  const course = state.composedCourses.find((item) => item.id === state.activeCourseId);
  if (!course || !state.user) return;

  const application = activeApplicationForCourse(course.id);
  if (!application || !isAttendanceConfirmed(application)) {
    showToast("참석 확인이 완료된 뒤 후기를 작성할 수 있습니다.");
    return;
  }

  const form = getSubmitForm(event);
  if (!form) return;
  const body = form.elements.body.value.trim();
  if (body.length < 10) {
    showToast("후기는 10자 이상 입력해주세요.");
    return;
  }

  const supabase = await getSupabaseClient();
  const { error } = await supabase.from("reviews").insert({
    course_id: course.id,
    user_id: state.user.id,
    author_name: getReviewAuthorName(state.user),
    body,
  });

  if (error) {
    if (error.code === "23505") showToast("이미 이 교육에 후기를 작성했습니다.");
    else {
      console.error("Review submission failed", error);
      showToast("후기를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    return;
  }

  showToast("후기가 등록되었습니다.");
  await loadData({ waitForSupplementary: true });
  openCourseDetail(course.id);
}

function updateSessionUi(user) {
  state.user = user || null;
  elements.loginButton.textContent = state.user ? `${getReviewAuthorName(state.user)}님` : "로그인";
  elements.loginButton.setAttribute("aria-label", state.user ? "나의 정보 보기" : "이메일 인증 로그인");
  elements.loginStatus.textContent = state.user ? `${getReviewAuthorName(state.user)}님으로 인증되었습니다.` : "이메일 인증 전입니다.";
}

async function refreshSession(supabaseClient = null) {
  try {
    const client = supabaseClient || await getSupabaseClient();
    const { data, error } = await withTimeoutResult(
      client.auth.getSession(),
      SESSION_TIMEOUT_MS,
      { data: { session: null }, error: new Error("session timeout") },
    );
    if (error) console.warn("[모두의 인문학] 로그인 상태 확인 지연", error);
    updateSessionUi(data.session?.user || null);
    return state.user;
  } catch (error) {
    console.warn("[모두의 인문학] 로그인 모듈 확인 지연", error);
    updateSessionUi(null);
    return null;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const email = elements.loginEmail.value.trim();
  if (!email) return;
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: getCurrentUrlWithoutHash() },
  });
  if (error) {
    console.error("Magic link request failed", error);
    showToast("인증 링크를 보내지 못했습니다. 이메일을 확인한 뒤 다시 시도해 주세요.");
    return;
  }
  showToast("이메일로 인증 링크를 보냈습니다.");
}

async function handleLogout() {
  const supabase = await getSupabaseClient();
  await supabase.auth.signOut();
  await refreshSession(supabase);
  closeModal(elements.profileModal);
  showToast("로그아웃했습니다.");
}

function startAuthMonitor() {
  async function syncAuth(supabase) {
    const user = await refreshSession(supabase);
    if (user) await loadApplicationState(supabase);
    else clearApplicationState();
    render();
    if (elements.detailModal.classList.contains("open") && state.activeCourseId) {
      openCourseDetail(state.activeCourseId);
    }
    if (elements.profileModal.classList.contains("open") && elements.profileEyebrow.textContent === "나의 정보") {
      openMyInfo();
    }
  }

  getSupabaseClient()
    .then((supabase) => {
      supabase.auth.onAuthStateChange(() => {
        syncAuth(supabase);
      });
      syncAuth(supabase);
    })
    .catch((error) => {
      console.warn("[모두의 인문학] 로그인 모듈 준비 지연", error);
      updateSessionUi(null);
      clearApplicationState();
    });
}

function bindEvents() {
  [elements.searchInput, elements.orgFilter, elements.instructorFilter, elements.timeFilter, elements.statusFilter].forEach((element) => {
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
    const loginForApplication = event.target.closest("[data-login-for-application]");
    const applyButton = event.target.closest("[data-apply-course]");
    const cancelApplicationButton = event.target.closest("[data-cancel-application]");
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
    if (applyButton) {
      if (!state.user) openModal(elements.loginModal);
      else document.getElementById("applicationSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (cancelApplicationButton) {
      handleCancelApplication(cancelApplicationButton).catch((error) => showToast(`신청 취소 실패: ${error.message}`));
      return;
    }
    if (openButton) {
      closeModal(elements.profileModal);
      openCourseDetail(openButton.dataset.openCourse);
      return;
    }
    if (closeButton) closeModal(closeButton.closest(".modal"));
    if (loginForReview) {
      if (state.user) document.getElementById("reviewForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
      else openModal(elements.loginModal);
      return;
    }
    if (loginForApplication) {
      if (state.user) document.getElementById("applicationSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      else openModal(elements.loginModal);
      return;
    }
    if (event.target.closest("[data-logout-account]")) {
      handleLogout().catch((error) => showToast(`로그아웃 실패: ${error.message}`));
    }
  });

  document.body.addEventListener("input", (event) => {
    const phoneInput = event.target.closest("#applicationForm input[name='phone']");
    if (!phoneInput) return;

    const originalValue = phoneInput.value;
    const selectionStart = phoneInput.selectionStart ?? originalValue.length;
    const digitsBeforeCursor = originalValue.slice(0, selectionStart).replace(/\D/g, "").length;
    const formattedValue = formatPhoneNumber(originalValue);
    phoneInput.value = formattedValue;

    let cursor = digitsBeforeCursor === 0 ? 0 : formattedValue.length;
    let seenDigits = 0;
    if (digitsBeforeCursor > 0) {
      for (let index = 0; index < formattedValue.length; index += 1) {
        if (/\d/.test(formattedValue[index])) seenDigits += 1;
        if (seenDigits >= digitsBeforeCursor) {
          cursor = index + 1;
          break;
        }
      }
    }
    phoneInput.setSelectionRange(cursor, cursor);
  });

  document.body.addEventListener("submit", (event) => {
    if (event.target.id === "applicationForm") return handleApplicationSubmit(event);
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

  elements.loginButton.addEventListener("click", () => {
    if (state.user) openMyInfo();
    else openModal(elements.loginModal);
  });
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.logoutButton.addEventListener("click", handleLogout);
  window.addEventListener("hashchange", () => {
    applyRouteFromHash();
    render();
  });
}

async function initialize() {
  applyRouteFromHash();
  bindEvents();
  await loadData();
  startAuthMonitor();
}

initialize().catch((error) => {
  console.error("Public page initialization failed", error);
  elements.resultSummary.textContent = "현재 표시할 교육이 없습니다.";
  elements.courseResults.innerHTML = `<div class="empty">등록된 교육이 없습니다.</div>`;
});
