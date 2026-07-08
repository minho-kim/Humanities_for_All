import {
  APP_VERSION,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  URL_RULES,
  byId,
  escapeHtml,
  formatDate,
  formatDateTime,
  groupBy,
  normalizeSafeUrl,
  statusLabels,
} from "./shared.js";

const PUBLIC_FETCH_TIMEOUT_MS = 9000;
const LANDING_SUMMARY_TIMEOUT_MS = 7000;
const STATUS_SYNC_TIMEOUT_MS = 3500;
const FULL_PAGE_PATH = "./index.html";
const EMBED_HEIGHT_MESSAGE = "humanities-for-all:embed-height";

const state = {
  organizations: [],
  instructors: [],
  venues: [],
  courses: [],
  sessions: [],
  reviews: [],
  composedCourses: [],
  landingCourses: [],
  stats: {
    courses: null,
    organizations: null,
    instructors: null,
    reviews: null,
  },
  featuredMode: "",
  fullDataLoaded: false,
  fullDataLoadingPromise: null,
  searchActivated: false,
  filters: {
    q: "",
    time: "",
    status: "",
  },
};

const elements = {
  courseCount: document.getElementById("embedCourseCount"),
  orgCount: document.getElementById("embedOrgCount"),
  instructorCount: document.getElementById("embedInstructorCount"),
  reviewCount: document.getElementById("embedReviewCount"),
  searchForm: document.getElementById("embedSearchForm"),
  searchInput: document.getElementById("embedSearchInput"),
  timeFilter: document.getElementById("embedTimeFilter"),
  statusFilter: document.getElementById("embedStatusFilter"),
  resetButton: document.getElementById("embedResetButton"),
  summary: document.getElementById("embedSummary"),
  results: document.getElementById("embedResults"),
  detailModal: document.getElementById("embedDetailModal"),
  detailBadges: document.getElementById("embedDetailBadges"),
  detailTitle: document.getElementById("embedDetailTitle"),
  detailBody: document.getElementById("embedDetailBody"),
  toast: document.getElementById("embedToast"),
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function notifyParentHeight() {
  if (window.parent === window) return;
  const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  window.parent.postMessage({ type: EMBED_HEIGHT_MESSAGE, height }, "*");
}

function openModal(modal) {
  modal.classList.add("open");
  modal.querySelector("button, a")?.focus();
  notifyParentHeight();
}

function closeModal(modal) {
  modal.classList.remove("open");
  notifyParentHeight();
}

function numberText(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("ko-KR") : "-";
}

function getStatusClass(status) {
  if (status === "open") return "green";
  if (status === "finished") return "gray";
  if (status === "cancelled") return "red";
  return "";
}

function courseStartAt(course) {
  return course?.sessions?.[0]?.starts_at || course?.starts_at || "";
}

function seoulDateKey(value) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function hasNoExplicitCourseEndElapsed(startsAt) {
  const courseDate = seoulDateKey(startsAt);
  const today = seoulDateKey(new Date());
  return Boolean(courseDate && today && today > courseDate);
}

function courseEndAt(course) {
  return course?.ends_at || course?.sessions?.[course.sessions.length - 1]?.ends_at || "";
}

function hasCourseStarted(course) {
  const startsAt = courseStartAt(course);
  return startsAt ? new Date(startsAt).getTime() <= Date.now() : false;
}

function hasCourseEnded(course) {
  if (course?.status === "finished") return true;
  const startsAt = courseStartAt(course);
  const endsAt = courseEndAt(course);
  if (endsAt) return new Date(endsAt).getTime() <= Date.now();
  return hasNoExplicitCourseEndElapsed(startsAt);
}

function effectiveCourseStatus(course) {
  if (!course) return "";
  if (course.status === "cancelled") return "cancelled";
  if (course.status === "finished" || hasCourseEnded(course)) return "finished";
  return "open";
}

function getTimeLabel(course) {
  const first = course.sessions?.[0];
  if (!first?.starts_at) return "";
  const hour = new Date(first.starts_at).getHours();
  if (hour < 12) return "오전";
  if (hour < 18) return "오후";
  return "저녁";
}

function courseById(courseId) {
  return state.composedCourses.find((course) => course.id === courseId);
}

function isPublicReview(review) {
  return review?.verification_status !== "rejected";
}

function publicOrganizations() {
  return state.organizations.filter((organization) => organization.is_active !== false);
}

function publicInstructors() {
  return state.instructors.filter((instructor) => instructor.is_active !== false && instructor.name);
}

function uniqueById(items) {
  const map = new Map();
  items.forEach((item) => {
    if (item?.id && !map.has(item.id)) map.set(item.id, item);
  });
  return [...map.values()];
}

function fullPageUrl(courseId = "") {
  const url = new URL(FULL_PAGE_PATH, window.location.href);
  if (courseId) url.searchParams.set("course", courseId);
  url.hash = "courses";
  return url.href;
}

function goToFullPage(courseId = "") {
  const url = fullPageUrl(courseId);
  try {
    window.top.location.assign(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function fetchPublicRows(table, { select = "*", order = "" } = {}) {
  const params = new URLSearchParams({ select });
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

async function fetchPublicRpc(functionName, payload = {}, timeoutMs = PUBLIC_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.text();
    let data = null;
    if (body) {
      try {
        data = JSON.parse(body);
      } catch (error) {
        return { data: null, error: { message: `응답 형식 확인 필요: ${error.message}` } };
      }
    }
    if (!response.ok) {
      return { data: null, error: { message: `HTTP ${response.status}: ${body.slice(0, 160)}` } };
    }
    return { data, error: null };
  } catch (error) {
    const message = error.name === "AbortError" ? "응답 대기 시간이 초과되었습니다." : error.message;
    return { data: null, error: { message } };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function syncFinishedCourseStatuses() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), STATUS_SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_finished_course_statuses`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      console.warn("[모두의 인문학] embed 교육 종료 상태 동기화 실패", `HTTP ${response.status}: ${body.slice(0, 160)}`);
    }
  } catch (error) {
    const message = error.name === "AbortError" ? "응답 대기 시간이 초과되었습니다." : error.message;
    console.warn("[모두의 인문학] embed 교육 종료 상태 동기화 지연", message);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function resolveDataRequests(requestMap) {
  const requests = await Promise.allSettled(requestMap.map(([, request]) => request));
  const dataByKey = new Map();
  requests.forEach((result, index) => {
    const key = requestMap[index][0];
    if (result.status === "rejected") {
      console.warn(`[모두의 인문학] embed ${key} 공개 데이터 확인 필요`, result.reason);
      dataByKey.set(key, []);
      return;
    }
    if (result.value.error) {
      console.warn(`[모두의 인문학] embed ${key} 공개 데이터 확인 필요`, result.value.error);
    }
    dataByKey.set(key, result.value.data || []);
  });
  return dataByKey;
}

function composeCourses() {
  const organizations = byId(state.organizations);
  const instructors = byId(state.instructors);
  const venues = byId(state.venues);
  const sessionsByCourse = groupBy(state.sessions, "course_id");
  const reviewsByCourse = groupBy(state.reviews.filter(isPublicReview), "course_id");

  state.composedCourses = state.courses.map((course) => {
    const sessions = (sessionsByCourse.get(course.id) || []).slice().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const reviews = (reviewsByCourse.get(course.id) || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const composedCourse = { ...course, sessions };
    return {
      ...course,
      status: effectiveCourseStatus(composedCourse),
      organization: organizations.get(course.organization_id),
      instructor: instructors.get(course.instructor_id),
      venue: venues.get(course.venue_id),
      sessions,
      reviews,
      reviewCount: Number(course.review_count ?? reviews.length),
      archiveCount: Number(course.archive_count ?? 0),
      timeLabel: getTimeLabel({ ...course, sessions }),
    };
  });
}

function applyLandingSummary(summary = {}) {
  const counts = summary.counts || {};
  state.stats = {
    courses: Number.isFinite(Number(counts.courses)) ? Number(counts.courses) : null,
    organizations: Number.isFinite(Number(counts.organizations)) ? Number(counts.organizations) : null,
    instructors: Number.isFinite(Number(counts.instructors)) ? Number(counts.instructors) : null,
    reviews: Number.isFinite(Number(counts.reviews)) ? Number(counts.reviews) : null,
  };
  state.featuredMode = summary.featured_mode || "";

  const featuredCourses = Array.isArray(summary.featured_courses) ? summary.featured_courses : [];
  state.organizations = uniqueById(featuredCourses.map((course) => course.organization).filter(Boolean));
  state.instructors = uniqueById(featuredCourses.map((course) => course.instructor).filter(Boolean));
  state.venues = uniqueById(featuredCourses.map((course) => course.venue).filter(Boolean));
  state.courses = featuredCourses.map((course) => ({
    ...course,
    organization_id: course.organization_id || course.organization?.id || null,
    instructor_id: course.instructor_id || course.instructor?.id || null,
    venue_id: course.venue_id || course.venue?.id || null,
    review_count: Number(course.review_count || 0),
    archive_count: Number(course.archive_count || 0),
  }));
  state.sessions = featuredCourses.flatMap((course) => Array.isArray(course.sessions) ? course.sessions : []);
  state.reviews = [];
  composeCourses();
  state.landingCourses = state.composedCourses.slice();
}

async function loadLandingData() {
  elements.summary.textContent = "교육 요약을 불러오는 중입니다.";
  await syncFinishedCourseStatuses();
  const { data, error } = await fetchPublicRpc("get_public_landing_summary", { p_limit: 6 }, LANDING_SUMMARY_TIMEOUT_MS);
  if (error) {
    console.warn("[모두의 인문학] embed 첫 화면 요약 확인 필요", error);
    elements.summary.textContent = "검색어를 입력하고 검색하기를 눌러 교육 정보를 확인해 주세요.";
    renderStats();
    renderResults();
    return;
  }

  applyLandingSummary(data || {});
  render();
}

async function loadFullData() {
  elements.summary.textContent = "교육 정보를 불러오는 중입니다.";
  const requestMap = [
    ["organizations", fetchPublicRows("organizations", { order: "sort_order.asc" })],
    ["instructors", fetchPublicRows("instructors", { order: "name.asc" })],
    ["venues", fetchPublicRows("venues", { order: "name.asc" })],
    ["courses", fetchPublicRows("courses", { order: "starts_at.asc" })],
    ["sessions", fetchPublicRows("course_sessions", { order: "starts_at.asc" })],
    ["reviews", fetchPublicRows("reviews", {
      select: "id,course_id,author_name,body,verification_status,created_at",
      order: "created_at.desc",
    })],
  ];
  const dataByKey = await resolveDataRequests(requestMap);
  state.organizations = dataByKey.get("organizations") || [];
  state.instructors = dataByKey.get("instructors") || [];
  state.venues = dataByKey.get("venues") || [];
  state.courses = dataByKey.get("courses") || [];
  state.sessions = dataByKey.get("sessions") || [];
  state.reviews = (dataByKey.get("reviews") || []).filter(isPublicReview);
  state.fullDataLoaded = true;
  composeCourses();
}

async function ensureFullDataLoaded() {
  if (state.fullDataLoaded) return;
  if (!state.fullDataLoadingPromise) {
    state.fullDataLoadingPromise = loadFullData().finally(() => {
      state.fullDataLoadingPromise = null;
    });
  }
  await state.fullDataLoadingPromise;
}

function readFilters() {
  return {
    q: elements.searchInput.value.trim().toLowerCase(),
    time: elements.timeFilter.value,
    status: elements.statusFilter.value,
  };
}

function filteredCourses() {
  const filters = state.filters;
  return state.composedCourses.filter((course) => {
    const haystack = [
      course.title,
      course.topic,
      course.summary,
      course.description,
      course.organization?.name,
      course.instructor?.name,
      course.instructor?.title,
      course.venue?.name,
      course.venue?.address,
      course.timeLabel,
    ].join(" ").toLowerCase();

    return (!filters.q || haystack.includes(filters.q))
      && (!filters.time || course.timeLabel === filters.time)
      && (!filters.status || course.status === filters.status);
  });
}

function renderStats() {
  const courseCount = state.stats.courses ?? state.courses.length;
  const orgCount = state.stats.organizations ?? publicOrganizations().length;
  const instructorCount = state.stats.instructors ?? publicInstructors().length;
  const reviewCount = state.stats.reviews ?? state.reviews.length;
  elements.courseCount.textContent = numberText(courseCount);
  elements.orgCount.textContent = numberText(orgCount);
  elements.instructorCount.textContent = numberText(instructorCount);
  elements.reviewCount.textContent = numberText(reviewCount);
}

function canShowPostCourseContent(course) {
  return course?.status === "finished";
}

function canApplyToCourse(course) {
  return course?.status === "open" && !hasCourseStarted(course);
}

function courseCardNoteHtml(course) {
  if (canShowPostCourseContent(course)) {
    return `<span class="review-note">후기 ${numberText(course.reviewCount)}개 · 기록 ${numberText(course.archiveCount)}개</span>`;
  }
  if (course.status === "cancelled") {
    return `<span class="review-note">취소된 교육</span>`;
  }
  if (canApplyToCourse(course)) {
    return `<span class="review-note">신청 가능 · 사전 질문 접수</span>`;
  }
  return `<span class="review-note">교육 종료 후 후기·기록 공개</span>`;
}

function courseCardHtml(course) {
  const firstSession = course.sessions[0];
  const orgName = course.organization?.name || "단체 미정";
  const instructorName = course.instructor?.name || "강사 미정";
  return `
    <article class="course-card">
      <div class="badge-row">
        <span class="badge ${getStatusClass(course.status)}">${escapeHtml(statusLabels[course.status] || course.status)}</span>
        ${course.topic ? `<span class="badge">${escapeHtml(course.topic)}</span>` : ""}
        <span class="badge gray">${escapeHtml(course.timeLabel || "시간 미정")}</span>
      </div>
      <h3>${escapeHtml(course.title || "교육명 없음")}</h3>
      <div class="meta">
        <span>🏛️ ${escapeHtml(orgName)}</span>
        <span>🎙️ ${escapeHtml(instructorName)}${course.instructor?.title ? ` · ${escapeHtml(course.instructor.title)}` : ""}</span>
        <span>📍 ${escapeHtml(course.venue?.name || "장소 미정")}</span>
        <span>🗓️ ${escapeHtml(formatDate(firstSession?.starts_at || course.starts_at))}</span>
      </div>
      <p>${escapeHtml(course.summary || "")}</p>
      <div class="footer">
        ${courseCardNoteHtml(course)}
        <div class="embed-course-actions">
          <button class="btn small secondary" type="button" data-open-embed-course="${escapeHtml(course.id)}">상세 보기</button>
          <button class="btn small" type="button" data-go-full-course="${escapeHtml(course.id)}">${canApplyToCourse(course) ? "신청하러 가기" : "전체 페이지에서 보기"}</button>
        </div>
      </div>
    </article>
  `;
}

function renderResults() {
  const source = state.searchActivated ? filteredCourses() : state.landingCourses;
  if (!source.length) {
    elements.results.innerHTML = `<div class="empty">${state.searchActivated ? "조건에 맞는 교육이 없습니다." : "표시할 추천 교육이 없습니다. 검색하기를 눌러 전체 교육을 확인해 주세요."}</div>`;
    elements.summary.textContent = state.searchActivated
      ? "검색 결과가 없습니다. 검색어를 줄이거나 필터를 바꿔 보세요."
      : "검색어를 입력하거나 검색하기를 눌러 전체 교육을 확인해 주세요.";
    notifyParentHeight();
    return;
  }

  const sorted = state.searchActivated
    ? source.slice().sort((a, b) => new Date(courseStartAt(a) || 0) - new Date(courseStartAt(b) || 0))
    : source.slice();
  elements.results.innerHTML = sorted.map(courseCardHtml).join("");
  if (state.searchActivated) {
    elements.summary.textContent = `${source.length.toLocaleString("ko-KR")}개 교육을 찾았습니다. 신청과 로그인은 전체 서비스 페이지에서 진행됩니다.`;
  } else {
    const label = state.featuredMode === "reviewed" ? "후기가 많은 종료 교육" : "곧 진행될 교육";
    elements.summary.textContent = `${label} ${source.length.toLocaleString("ko-KR")}개를 먼저 보여드립니다. 더 보려면 검색하기를 눌러 주세요.`;
  }
  notifyParentHeight();
}

function render() {
  renderStats();
  renderResults();
}

function reviewListHtml(course) {
  const reviews = course.reviews.slice(0, 3);
  if (!reviews.length) return `<li class="review-item">아직 등록된 후기가 없습니다.</li>`;
  return reviews.map((review) => `
    <li class="review-item">
      <strong>${escapeHtml(review.author_name || "참여자")}님의 후기</strong><br>
      ${escapeHtml(review.body || "")}
    </li>
  `).join("");
}

function sessionListHtml(course) {
  const sessions = course.sessions.length ? course.sessions : [{ title: "교육", starts_at: course.starts_at, ends_at: course.ends_at, room: course.venue?.name || "" }];
  return sessions.map((session) => `
    <li>
      <strong>${escapeHtml(session.title || "교육")} · ${escapeHtml(formatDateTime(session.starts_at))}</strong><br>
      ${escapeHtml(session.room || course.venue?.name || "")}
    </li>
  `).join("");
}

function openCourseDetail(courseId) {
  const course = courseById(courseId);
  if (!course) {
    showToast("교육 정보를 찾지 못했습니다.");
    return;
  }

  const orgWebsiteUrl = normalizeSafeUrl(course.organization?.website_url, URL_RULES.external);
  const instructorProfileUrl = normalizeSafeUrl(course.instructor?.profile_url, URL_RULES.external);
  const kakaoUrl = normalizeSafeUrl(course.venue?.kakao_map_url, URL_RULES.kakaoMap);
  const naverUrl = normalizeSafeUrl(course.venue?.naver_place_url, URL_RULES.naverPlace);
  const reviewSectionHtml = canShowPostCourseContent(course)
    ? `
      <div class="section">
        <h3>후기 ${numberText(course.reviews.length)}개</h3>
        <ul class="review-list">${reviewListHtml(course)}</ul>
      </div>
    `
    : `
      <div class="section">
        <h3>교육 후 기록</h3>
        <p class="embed-detail-note">후기와 사진·영상·자료는 교육 종료 후 공개됩니다. 신청할 때 기대하는 점이나 강사에게 하고 싶은 질문을 남길 수 있습니다.</p>
      </div>
    `;

  elements.detailBadges.innerHTML = `
    <span class="badge ${getStatusClass(course.status)}">${escapeHtml(statusLabels[course.status] || course.status)}</span>
    ${course.topic ? `<span class="badge">${escapeHtml(course.topic)}</span>` : ""}
    ${course.organization?.name ? `<span class="badge gray">${escapeHtml(course.organization.name)}</span>` : ""}
  `;
  elements.detailTitle.textContent = course.title || "교육 상세";
  elements.detailBody.innerHTML = `
    <div class="detail-grid">
      <div class="section">
        <h3>교육 정보</h3>
        <p>${escapeHtml(course.description || course.summary || "")}</p>
        <ul class="session-list">${sessionListHtml(course)}</ul>
        <div class="actions" style="margin-top: 14px;">
          <button class="btn small" type="button" data-go-full-course="${escapeHtml(course.id)}">${canApplyToCourse(course) ? "전체 페이지에서 신청하기" : "전체 페이지에서 보기"}</button>
        </div>
      </div>
      <aside class="section">
        <h3>강사</h3>
        <p><strong>${escapeHtml(course.instructor?.name || "강사 미정")}</strong> ${escapeHtml(course.instructor?.title || "")}</p>
        ${course.instructor?.bio ? `<p>${escapeHtml(course.instructor.bio)}</p>` : ""}
        ${instructorProfileUrl ? `<a class="btn small secondary" href="${escapeHtml(instructorProfileUrl)}" target="_blank" rel="noreferrer">홈페이지/SNS</a>` : ""}
      </aside>
      <div class="section">
        <h3>장소</h3>
        <p><strong>${escapeHtml(course.venue?.name || "장소 미정")}</strong></p>
        ${course.venue?.address ? `<p class="muted">${escapeHtml(course.venue.address)}</p>` : ""}
        ${course.venue?.detail ? `<p>${escapeHtml(course.venue.detail)}</p>` : ""}
        <div class="actions" style="margin-top: 10px;">
          ${kakaoUrl ? `<a class="btn small secondary" href="${escapeHtml(kakaoUrl)}" target="_blank" rel="noreferrer">카카오맵</a>` : ""}
          ${naverUrl ? `<a class="btn small secondary" href="${escapeHtml(naverUrl)}" target="_blank" rel="noreferrer">네이버플레이스</a>` : ""}
        </div>
      </div>
      <div class="section">
        <h3>주관 단체</h3>
        <p><strong>${escapeHtml(course.organization?.name || "단체 미정")}</strong></p>
        ${course.organization?.description ? `<p>${escapeHtml(course.organization.description)}</p>` : ""}
        ${course.organization?.contact_email ? `<p class="muted">연락처: ${escapeHtml(course.organization.contact_email)}</p>` : ""}
        ${orgWebsiteUrl ? `<a class="btn small secondary" href="${escapeHtml(orgWebsiteUrl)}" target="_blank" rel="noreferrer">홈페이지</a>` : ""}
      </div>
      ${reviewSectionHtml}
      <div class="section">
        <h3>안내</h3>
        <p class="embed-detail-note">이 화면은 워드프레스 페이지 안에서 보는 조회 전용 화면입니다. 교육 신청, 로그인, 후기 작성은 전체 서비스 페이지에서 진행됩니다.</p>
      </div>
    </div>
  `;
  openModal(elements.detailModal);
}

async function handleSearch(event) {
  event.preventDefault();
  state.filters = readFilters();
  state.searchActivated = true;
  await ensureFullDataLoaded();
  renderResults();
}

function resetSearch() {
  elements.searchInput.value = "";
  elements.timeFilter.value = "";
  elements.statusFilter.value = "";
  state.filters = { q: "", time: "", status: "" };
  state.searchActivated = false;
  renderResults();
}

function bindEvents() {
  elements.searchForm.addEventListener("submit", (event) => {
    handleSearch(event).catch((error) => {
      console.error("Embed search failed", error);
      showToast("검색 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.");
    });
  });
  elements.resetButton.addEventListener("click", resetSearch);

  document.body.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-open-embed-course]");
    const fullButton = event.target.closest("[data-go-full-course]");
    const closeButton = event.target.closest("[data-close-embed-modal]");

    if (openButton) {
      openCourseDetail(openButton.dataset.openEmbedCourse);
      return;
    }
    if (fullButton) {
      goToFullPage(fullButton.dataset.goFullCourse || "");
      return;
    }
    if (closeButton || event.target === elements.detailModal) {
      closeModal(elements.detailModal);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal(elements.detailModal);
  });

  if ("ResizeObserver" in window) {
    new ResizeObserver(notifyParentHeight).observe(document.body);
  } else {
    window.addEventListener("resize", notifyParentHeight);
  }
}

async function initialize() {
  console.info(`[모두의 인문학] embed ready ${APP_VERSION}`);
  bindEvents();
  await loadLandingData();
  notifyParentHeight();
}

initialize().catch((error) => {
  console.error("Embed page initialization failed", error);
  elements.summary.textContent = "현재 표시할 교육이 없습니다.";
  elements.results.innerHTML = `<div class="empty">교육 정보를 불러오지 못했습니다.</div>`;
  notifyParentHeight();
});
