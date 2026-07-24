import {
  escapeHtml,
  formatDate,
  formatDateTime,
  formatSchedule,
  formatTimeRange,
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
} from "./shared.js";

const state = {
  organizations: [],
  instructors: [],
  venues: [],
  courses: [],
  sessions: [],
  archives: [],
  reviews: [],
  expectations: [],
  myReviews: [],
  applications: [],
  interestSubscriptions: [],
  interestOptions: {
    instructors: [],
    topics: [],
  },
  interestSearch: "",
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
  supplementaryLoaded: false,
  searchActivated: false,
  appliedFilters: {
    q: "",
    org: "",
    instructor: "",
    time: "",
    status: "",
  },
  activePage: "courses",
  activeOrganizationSlug: "",
  activeInstructorId: "",
  activeView: "cards",
  activeCourseId: null,
  user: null,
  applicantProfile: null,
  demographics: null,
  guestContact: null,
  guestAccessTokens: {},
  guestAccessByCourse: {},
};

const elements = {
  searchTitle: document.getElementById("searchTitle"),
  viewDescription: document.getElementById("viewDescription"),
  courseFilters: document.getElementById("courseFilters"),
  courseViewOptions: document.getElementById("courseViewOptions"),
  viewToggle: document.querySelector(".toggle"),
  orgCount: document.getElementById("orgCount"),
  courseCount: document.getElementById("courseCount"),
  instructorCount: document.getElementById("instructorCount"),
  reviewCount: document.getElementById("reviewCount"),
  searchInput: document.getElementById("searchInput"),
  orgFilter: document.getElementById("orgFilter"),
  instructorFilter: document.getElementById("instructorFilter"),
  timeFilter: document.getElementById("timeFilter"),
  statusFilter: document.getElementById("statusFilter"),
  searchResetButton: document.getElementById("searchResetButton"),
  resultSummary: document.getElementById("resultSummary"),
  courseResults: document.getElementById("courseResults"),
  detailModal: document.getElementById("detailModal"),
  detailBadges: document.getElementById("detailBadges"),
  detailTitle: document.getElementById("detailTitle"),
  detailBody: document.getElementById("detailBody"),
  loginModal: document.getElementById("loginModal"),
  loginButton: document.getElementById("loginButton"),
  googleLoginButton: document.getElementById("googleLoginButton"),
  loginForm: document.getElementById("loginForm"),
  loginEmail: document.getElementById("loginEmail"),
  logoutButton: document.getElementById("logoutButton"),
  loginStatus: document.getElementById("loginStatus"),
  profileModal: document.getElementById("profileModal"),
  profileEyebrow: document.getElementById("profileEyebrow"),
  profileTitle: document.getElementById("profileTitle"),
  profileBody: document.getElementById("profileBody"),
  demographicBanner: document.getElementById("demographicBanner"),
  reportModal: document.getElementById("reportModal"),
  reportForm: document.getElementById("reportForm"),
  reportTitle: document.getElementById("reportTitle"),
  reportDescription: document.getElementById("reportDescription"),
  toast: document.getElementById("toast"),
};

const PUBLIC_FETCH_TIMEOUT_MS = 7000;
const PUBLIC_FETCH_RETRIES = 1;
const LANDING_SUMMARY_TIMEOUT_MS = 4500;
const STATUS_SYNC_TIMEOUT_MS = 4000;
const SESSION_TIMEOUT_MS = 2500;
const APPLICATION_TERMS_VERSION = "2026-07-24-v6";
const DEMOGRAPHICS_TERMS_VERSION = "2026-07-24-v3";
const INTEREST_NOTIFICATION_CONSENT_VERSION = "2026-07-24-v1";
const COURSE_NOTIFICATION_TERMS_VERSION = "2026-07-24-v2";
const GUEST_CONTACT_SESSION_KEY = "humanities-guest-contact";
const GUEST_ACCESS_TOKEN_SESSION_KEY = "humanities-guest-access-tokens";
const DEMOGRAPHIC_BANNER_DISMISS_KEY = "humanities-demographic-banner-dismissed";
const OAUTH_RETURN_STATE_KEY = "humanities-google-oauth-return";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let supplementaryLoadSequence = 0;
let supabaseClientPromise = null;
let residenceSearchPopup = null;
let residenceSearchForm = null;

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

function readGuestContact() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(GUEST_CONTACT_SESSION_KEY) || "null");
    const applicantName = String(parsed?.applicant_name || "").trim();
    const phone = formatPhoneNumber(parsed?.phone || "");
    const email = String(parsed?.email || "").trim();
    if (!applicantName || !isValidPhone(phone)) return null;
    return { applicant_name: applicantName, phone, email };
  } catch (error) {
    console.warn("[모두의 인문학] 비회원 신청 정보 확인 실패", error);
    return null;
  }
}

function rememberGuestContact({ applicant_name: applicantName, phone, email = "" }) {
  const contact = {
    applicant_name: String(applicantName || "").trim(),
    phone: formatPhoneNumber(phone),
    email: String(email || "").trim(),
  };
  state.guestContact = contact;
  try {
    window.sessionStorage.setItem(GUEST_CONTACT_SESSION_KEY, JSON.stringify(contact));
  } catch (error) {
    console.warn("[모두의 인문학] 비회원 신청 정보 임시 저장 실패", error);
  }
}

function validGuestAccessToken(value) {
  const token = String(value || "").trim();
  return /^[0-9a-f-]{36}\.[0-9a-f]{64}$/i.test(token) && token.length === 101 ? token : "";
}

function readGuestAccessTokens() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(GUEST_ACCESS_TOKEN_SESSION_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .map(([courseId, token]) => [courseId, validGuestAccessToken(token)])
      .filter(([courseId, token]) => /^[0-9a-f-]{36}$/i.test(courseId) && token));
  } catch (error) {
    console.warn("[모두의 인문학] 비회원 접근 링크 확인 실패", error);
    return {};
  }
}

function rememberGuestAccessToken(courseId, accessToken) {
  const token = validGuestAccessToken(accessToken);
  if (!/^[0-9a-f-]{36}$/i.test(String(courseId || "")) || !token) return false;
  state.guestAccessTokens[courseId] = token;
  try {
    window.sessionStorage.setItem(GUEST_ACCESS_TOKEN_SESSION_KEY, JSON.stringify(state.guestAccessTokens));
  } catch (error) {
    console.warn("[모두의 인문학] 비회원 접근 링크 임시 저장 실패", error);
  }
  return true;
}

function captureGuestAccessTokenFromUrl() {
  const url = new URL(window.location.href);
  const courseId = String(url.searchParams.get("course") || "");
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const token = validGuestAccessToken(hashParams.get("guest") || url.searchParams.get("guest"));
  if (!courseId || !token || !rememberGuestAccessToken(courseId, token)) return;
  hashParams.delete("guest");
  url.searchParams.delete("guest");
  url.hash = hashParams.toString() ? `#${hashParams.toString()}` : "";
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

async function requestNotificationDispatch(supabase, sourceType, sourceId) {
  if (!sourceId) return;
  const { error } = await supabase.functions.invoke("notification-dispatch", {
    body: {
      action: "dispatch_source",
      source_type: sourceType,
      source_id: sourceId,
    },
  });
  if (error) console.warn("[모두의 인문학] 알림 메일 즉시 발송 요청 실패", error);
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

function hasCourseStarted(course) {
  const startsAt = courseStartAt(course);
  return startsAt ? new Date(startsAt).getTime() <= Date.now() : false;
}

function courseEndAt(course) {
  return course?.ends_at || course?.sessions?.[course.sessions.length - 1]?.ends_at || "";
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
  const first = course.sessions[0];
  if (!first?.starts_at) return "";
  const hour = Number(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(first.starts_at)));
  if (hour < 12) return "오전";
  if (hour < 18) return "오후";
  return "저녁";
}

function courseScheduleStart(course) {
  return course?.sessions?.[0]?.starts_at || course?.starts_at || "";
}

function courseScheduleEnd(course) {
  return course?.sessions?.[0]?.ends_at || course?.ends_at || "";
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
      console.warn("[모두의 인문학] 교육 종료 상태 동기화 실패", `HTTP ${response.status}: ${body.slice(0, 160)}`);
    }
  } catch (error) {
    const message = error.name === "AbortError" ? "응답 대기 시간이 초과되었습니다." : error.message;
    console.warn("[모두의 인문학] 교육 종료 상태 동기화 지연", message);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function loadPublicReviews() {
  return loadPublicRows("reviews", {
    select: "id,course_id,author_name,body,verification_status,created_at",
    order: "created_at.desc",
  });
}

function loadPublicExpectations() {
  return fetchPublicRpc("get_public_expectations", {}, PUBLIC_FETCH_TIMEOUT_MS);
}

function publicOrganizations() {
  return state.organizations.filter((organization) => organization.is_active !== false);
}

function publicInstructors() {
  return state.instructors
    .filter((instructor) => instructor.is_active !== false && instructor.name)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function publicArchiveItems() {
  return state.archives.filter((item) => item.is_public !== false && ["photo", "video", "file", "link"].includes(item.type) && normalizeSafeUrl(item.url, URL_RULES.archive));
}

function uniqueById(items) {
  const map = new Map();
  items.forEach((item) => {
    if (item?.id && !map.has(item.id)) map.set(item.id, item);
  });
  return [...map.values()];
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
  state.archives = [];
  state.reviews = [];
  state.expectations = [];
  state.supplementaryLoaded = false;
  composeCourses();
  state.landingCourses = state.composedCourses.slice();
  populateFilters();
}

function archiveTypeLabel(type) {
  if (type === "video") return "영상";
  if (type === "photo") return "사진";
  if (type === "file") return "자료";
  return "링크";
}

function archiveMediaHtml(item, className = "media") {
  const url = normalizeSafeUrl(item.url, URL_RULES.archive);
  const label = archiveTypeLabel(item.type);
  const caption = item.caption || "자료 보기";
  if (item.type === "photo") {
    return `
      <button class="${escapeHtml(className)} media-button media-photo" type="button" data-open-archive-photo="${escapeHtml(item.id)}" style="background-image: linear-gradient(135deg, rgba(24, 32, 41, 0.58), rgba(24, 32, 41, 0.18)), url('${escapeHtml(url)}');">
        <span class="badge">${escapeHtml(label)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(caption)}</small>
      </button>
    `;
  }

  return `
    <a class="${escapeHtml(className)}" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
      <span class="badge">${escapeHtml(label)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(caption)}</small>
    </a>
  `;
}

function isPublicReview(review) {
  return review?.is_hidden !== true && review?.verification_status !== "rejected";
}

function reviewStatusLabel(review) {
  if (!isPublicReview(review)) return "비공개";
  return "후기";
}

function reviewStatusClass(review) {
  if (!isPublicReview(review)) return "red";
  return "green";
}

function applicationStatusLabel(application) {
  if (isCancelledApplication(application)) return "취소";
  if (isAttendanceConfirmed(application)) return "참석 인증";
  return "신청";
}

function applicationStatusClass(application) {
  if (isCancelledApplication(application)) return "red";
  if (isAttendanceConfirmed(application)) return "green";
  return "gray";
}

function canApplyToCourse(course) {
  return ["scheduled", "open"].includes(course.status) && !hasCourseStarted(course);
}

function isCancelledApplication(application) {
  return application?.status === "cancelled";
}

function isAttendanceConfirmed(application) {
  return Boolean(application?.attendance_confirmed_at);
}

function activeApplications() {
  return state.applications.filter((application) => !isCancelledApplication(application));
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

function myReviewForCourse(courseId) {
  return state.myReviews.find((review) => review.course_id === courseId);
}

function guestAccessForCourse(courseId) {
  const access = state.guestAccessByCourse[courseId];
  return access && !access.loading ? access : null;
}

function activeGuestAccessForCourse(courseId) {
  const access = guestAccessForCourse(courseId);
  return access && access.application_status !== "cancelled" ? access : null;
}

function currentReviewForCourse(courseId) {
  if (state.user) {
    const signedInReview = myReviewForCourse(courseId);
    if (signedInReview) return { ...signedInReview, identity: "user" };
  }
  const guestAccess = activeGuestAccessForCourse(courseId);
  if (!guestAccess?.review_id) return null;
  return {
    id: guestAccess.review_id,
    course_id: courseId,
    body: guestAccess.review_body || "",
    identity: "guest",
  };
}

function canWriteReviewForCourse(course) {
  if (!course) return false;
  const application = state.user ? activeApplicationForCourse(course.id) : null;
  if (application && isAttendanceConfirmed(application)) return true;
  return Boolean(activeGuestAccessForCourse(course.id)?.attendance_confirmed_at);
}

async function loadGuestAccessForCourse(courseId, { force = false } = {}) {
  const accessToken = validGuestAccessToken(state.guestAccessTokens[courseId]);
  if (!courseId || !accessToken) return null;
  if (!force && Object.prototype.hasOwnProperty.call(state.guestAccessByCourse, courseId)) {
    return guestAccessForCourse(courseId);
  }

  state.guestAccessByCourse[courseId] = { loading: true };
  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.rpc("get_guest_course_access_v4", {
      p_course_id: courseId,
      p_access_token: accessToken,
    });
    if (error) throw error;
    const access = Array.isArray(data) ? data[0] || null : data || null;
    state.guestAccessByCourse[courseId] = access;
    return access;
  } catch (error) {
    delete state.guestAccessByCourse[courseId];
    console.warn("[모두의 인문학] 비회원 신청·후기 상태 확인 지연", error);
    return null;
  }
}

function refreshGuestAccessInOpenCourse(courseId) {
  loadGuestAccessForCourse(courseId)
    .then(() => {
      if (elements.detailModal.classList.contains("open") && state.activeCourseId === courseId) {
        openCourseDetail(courseId);
      }
    })
    .catch((error) => console.warn("[모두의 인문학] 비회원 상태 화면 반영 지연", error));
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
  return /^010\d{8}$/.test(digits);
}

function coursesForOrganization(organizationId) {
  return state.composedCourses.filter((course) => course.organization_id === organizationId);
}

function coursesForInstructor(instructorId) {
  return state.composedCourses
    .filter((course) => course.instructor_id === instructorId)
    .slice()
    .sort((a, b) => new Date(a.starts_at || 0) - new Date(b.starts_at || 0));
}

function courseById(courseId) {
  return state.composedCourses.find((course) => course.id === courseId);
}

function requestedCourseIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const courseParam = params.get("course");
  if (courseParam) return courseParam;
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (hash.startsWith("course/")) return hash.replace("course/", "");
  return "";
}

function routeHash(page, slug = "") {
  if (page === "organization" && slug) return `#organization/${encodeURIComponent(slug)}`;
  if (page === "instructor" && slug) return `#instructor/${encodeURIComponent(slug)}`;
  if (page === "organizations") return "#organizations";
  if (page === "instructors") return "#instructors";
  if (page === "reviews") return "#reviews";
  if (page === "expectations") return "#expectations";
  if (page === "archive") return "#archive";
  return "#courses";
}

function applyRouteFromHash() {
  const value = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (value.startsWith("organization/")) {
    state.activePage = "organization";
    state.activeOrganizationSlug = value.replace("organization/", "");
    state.activeInstructorId = "";
    return;
  }
  if (value.startsWith("instructor/")) {
    state.activePage = "instructor";
    state.activeInstructorId = value.replace("instructor/", "");
    state.activeOrganizationSlug = "";
    return;
  }
  if (["organizations", "instructors", "reviews", "expectations", "archive"].includes(value)) {
    state.activePage = value;
    state.activeOrganizationSlug = "";
    state.activeInstructorId = "";
    return;
  }
  state.activePage = "courses";
  state.activeOrganizationSlug = "";
  state.activeInstructorId = "";
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

function pageNeedsSupplementaryData(page) {
  return ["reviews", "expectations", "archive"].includes(page);
}

function setPageHeader({ title, description, showCourseTools = false, summary = "" }) {
  elements.searchTitle.textContent = title;
  elements.viewDescription.textContent = description;
  elements.courseFilters.classList.toggle("hidden", !showCourseTools);
  elements.viewToggle.classList.toggle("hidden", !showCourseTools);
  elements.resultSummary.textContent = summary;
  document.querySelectorAll(".page-tabs [data-route]").forEach((item) => {
    const route = item.dataset.route;
    const active = state.activePage === route
      || (state.activePage === "organization" && route === "organizations")
      || (state.activePage === "instructor" && route === "instructors");
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
  const expectationsByCourse = groupBy(state.expectations, "course_id");
  const coursesBySeries = groupBy(state.courses.filter((course) => course.series_id), "series_id");

  state.composedCourses = state.courses.map((course) => {
    const sessions = (sessionsByCourse.get(course.id) || []).slice().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const archives = (archivesByCourse.get(course.id) || [])
      .filter((item) => item.is_public !== false && normalizeSafeUrl(item.url, URL_RULES.archive))
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order);
    const reviews = (reviewsByCourse.get(course.id) || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const expectations = (expectationsByCourse.get(course.id) || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const composedCourse = {
      ...course,
      sessions,
    };
    const seriesCourses = (coursesBySeries.get(course.series_id) || [])
      .slice()
      .sort((a, b) => Number(a.series_order || 0) - Number(b.series_order || 0));
    const computedSeriesPosition = seriesCourses.findIndex((item) => item.id === course.id) + 1;
    return {
      ...course,
      originalStatus: course.status,
      status: effectiveCourseStatus(composedCourse),
      organization: organizations.get(course.organization_id),
      instructor: instructors.get(course.instructor_id),
      venue: venues.get(course.venue_id),
      sessions,
      archives,
      reviews,
      expectations,
      reviewCount: Number(course.review_count ?? reviews.length),
      archiveCount: Number(course.archive_count ?? archives.length),
      timeLabel: getTimeLabel({ ...course, sessions }),
      seriesPosition: Number(course.series_position || computedSeriesPosition || 0),
      seriesTotal: Number(course.series_total || seriesCourses.length || 0),
    };
  });
}

async function loadLandingData() {
  elements.resultSummary.textContent = "교육 요약을 불러오는 중입니다.";
  const { data, error } = await fetchPublicRpc("get_public_landing_summary", { p_limit: 6 }, LANDING_SUMMARY_TIMEOUT_MS);
  if (error) {
    console.warn("[모두의 인문학] 첫 화면 요약 확인 필요", error);
    state.stats = {
      courses: null,
      organizations: null,
      instructors: null,
      reviews: null,
    };
    state.courses = [];
    state.organizations = [];
    state.instructors = [];
    state.venues = [];
    state.sessions = [];
    state.composedCourses = [];
    state.landingCourses = [];
    populateFilters();
    render();
    return;
  }

  applyLandingSummary(data || {});
  render();
}

async function loadData({ waitForSupplementary = false } = {}) {
  elements.resultSummary.textContent = "교육 정보를 불러오는 중입니다.";
  state.archives = [];
  state.reviews = [];
  state.expectations = [];
  state.supplementaryLoaded = false;
  await syncFinishedCourseStatuses();

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
  state.fullDataLoaded = true;

  composeCourses();
  populateFilters();
  render();

  const supplementaryPromise = loadSupplementaryData();
  if (waitForSupplementary) await supplementaryPromise;
}

async function ensureFullDataLoaded({ waitForSupplementary = false } = {}) {
  if (!state.fullDataLoaded) {
    if (!state.fullDataLoadingPromise) {
      state.fullDataLoadingPromise = loadData({ waitForSupplementary })
        .finally(() => {
          state.fullDataLoadingPromise = null;
        });
    }
    await state.fullDataLoadingPromise;
  }
  if (waitForSupplementary && !state.supplementaryLoaded) {
    await loadSupplementaryData();
  }
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
    ["expectations", loadPublicExpectations()],
  ];
  const dataByKey = await resolveDataRequests(supplementaryRequestMap);
  if (sequence !== supplementaryLoadSequence) return;
  state.archives = dataByKey.get("archives") || [];
  state.reviews = (dataByKey.get("reviews") || []).filter(isPublicReview);
  state.expectations = dataByKey.get("expectations") || [];
  state.supplementaryLoaded = true;

  composeCourses();
  render();
  if (elements.detailModal.classList.contains("open") && state.activeCourseId) {
    openCourseDetail(state.activeCourseId);
  }
}

function clearApplicationState() {
  state.applicantProfile = null;
  state.demographics = null;
  state.applications = [];
  state.myReviews = [];
  state.interestSubscriptions = [];
  state.interestOptions = { instructors: [], topics: [] };
  state.interestSearch = "";
}

async function loadApplicationState(supabase) {
  if (!state.user) {
    clearApplicationState();
    return;
  }

  const [
    profileResult,
    demographicsResult,
    applicationsResult,
    myReviewsResult,
    interestSubscriptionsResult,
    interestOptionsResult,
  ] = await Promise.allSettled([
    supabase
      .from("applicant_profiles")
      .select("user_id,applicant_name,phone,privacy_agreed_at,sms_notice_agreed_at,terms_version,updated_at")
      .eq("user_id", state.user.id)
      .maybeSingle(),
    supabase
      .from("user_demographics")
      .select("user_id,residence_district,residence_neighborhood,birth_year,gender,marital_status,children_count,optional_consent_at,terms_version,updated_at")
      .eq("user_id", state.user.id)
      .maybeSingle(),
    supabase
      .from("course_applications")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.rpc("get_my_reviews"),
    supabase.rpc("get_my_interest_subscriptions"),
    supabase.rpc("get_interest_subscription_options"),
  ]);

  if (profileResult.status === "fulfilled" && !profileResult.value.error) {
    state.applicantProfile = profileResult.value.data || null;
  } else {
    console.warn("[모두의 인문학] 신청자 정보 확인 지연", profileResult.reason || profileResult.value?.error);
    state.applicantProfile = null;
  }

  if (demographicsResult.status === "fulfilled" && !demographicsResult.value.error) {
    state.demographics = demographicsResult.value.data || null;
  } else {
    console.warn("[모두의 인문학] 선택 이용자 정보 확인 지연", demographicsResult.reason || demographicsResult.value?.error);
    state.demographics = null;
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

  if (interestSubscriptionsResult.status === "fulfilled" && !interestSubscriptionsResult.value.error) {
    state.interestSubscriptions = (interestSubscriptionsResult.value.data || []).map((subscription) => ({
      ...subscription,
      email_enabled: subscription.email_enabled === true,
      sms_enabled: subscription.sms_enabled === true,
    }));
  } else {
    console.warn("[모두의 인문학] 관심 알림 설정 확인 지연", interestSubscriptionsResult.reason || interestSubscriptionsResult.value?.error);
    state.interestSubscriptions = [];
  }

  if (interestOptionsResult.status === "fulfilled" && !interestOptionsResult.value.error) {
    const options = interestOptionsResult.value.data || {};
    state.interestOptions = {
      instructors: Array.isArray(options.instructors) ? options.instructors : [],
      topics: Array.isArray(options.topics) ? options.topics : [],
    };
  } else {
    console.warn("[모두의 인문학] 관심 알림 대상 확인 지연", interestOptionsResult.reason || interestOptionsResult.value?.error);
    state.interestOptions = { instructors: [], topics: [] };
  }
}

function populateFilters() {
  if (!state.fullDataLoaded) {
    populateSelect(elements.orgFilter, "전체 단체", []);
    elements.instructorFilter.innerHTML = `<option value="">전체 강사</option>`;
    syncCourseFilterInputs();
    return;
  }
  const orgNames = state.organizations.map((org) => org.name);
  const instructorsById = new Map();
  state.composedCourses.forEach((course) => {
    if (course.instructor?.id && course.instructor?.name) instructorsById.set(course.instructor.id, course.instructor);
  });
  const instructors = [...instructorsById.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  populateSelect(elements.orgFilter, "전체 단체", orgNames);
  elements.instructorFilter.innerHTML = `<option value="">전체 강사</option>${instructors.map((instructor) => `<option value="${escapeHtml(instructor.id)}">${escapeHtml(instructor.name)}</option>`).join("")}`;
  syncCourseFilterInputs();
}

function emptyCourseFilters() {
  return {
    q: "",
    org: "",
    instructor: "",
    time: "",
    status: "",
  };
}

function readCourseFilterInputs() {
  return {
    q: elements.searchInput.value.trim().toLowerCase(),
    org: elements.orgFilter.value,
    instructor: elements.instructorFilter.value,
    time: elements.timeFilter.value,
    status: elements.statusFilter.value,
  };
}

function syncCourseFilterInputs(filters = state.appliedFilters) {
  elements.searchInput.value = filters.q || "";
  elements.orgFilter.value = filters.org || "";
  elements.instructorFilter.value = filters.instructor || "";
  elements.timeFilter.value = filters.time || "";
  elements.statusFilter.value = filters.status || "";
}

async function applyCourseFilters() {
  state.appliedFilters = readCourseFilterInputs();
  state.searchActivated = true;
  await ensureFullDataLoaded();
  if (state.activePage !== "courses") {
    navigate("courses");
    return;
  }
  renderCoursesPage();
}

function resetCourseFilters() {
  state.appliedFilters = emptyCourseFilters();
  state.searchActivated = false;
  syncCourseFilterInputs();
  if (state.activePage !== "courses") {
    navigate("courses");
    return;
  }
  renderCoursesPage();
}

function getFilters() {
  return state.appliedFilters;
}

function filteredCourses() {
  const filters = getFilters();
  return state.composedCourses.filter((course) => {
    const haystack = [
      course.title,
      course.subtitle,
      course.topic,
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
  const courseCount = state.stats.courses ?? state.courses.length;
  const orgCount = state.stats.organizations ?? publicOrganizations().length;
  const instructorCount = state.stats.instructors ?? publicInstructors().length;
  const reviewCount = state.stats.reviews ?? state.reviews.length;
  if (elements.courseCount) elements.courseCount.textContent = courseCount.toLocaleString("ko-KR");
  if (elements.orgCount) elements.orgCount.textContent = orgCount.toLocaleString("ko-KR");
  if (elements.instructorCount) elements.instructorCount.textContent = instructorCount.toLocaleString("ko-KR");
  if (elements.reviewCount) elements.reviewCount.textContent = reviewCount.toLocaleString("ko-KR");
}

function canShowPostCourseContent(course) {
  return course?.status === "finished";
}

function courseCardNoteHtml(course) {
  if (canShowPostCourseContent(course)) {
    const reviewCount = course.reviewCount ?? course.review_count ?? course.reviews.length;
    const archiveCount = course.archiveCount ?? course.archive_count ?? course.archives.length;
    return `<span class="review-note">후기 ${Number(reviewCount).toLocaleString("ko-KR")}개 · 기록 ${Number(archiveCount).toLocaleString("ko-KR")}개</span>`;
  }
  if (course.status === "cancelled") {
    return `<span class="review-note">취소된 교육</span>`;
  }
  if (canApplyToCourse(course)) {
    return `<span class="review-note">신청 가능 · 사전 질문 접수</span>`;
  }
  return `<span class="review-note">교육 종료 후 후기·기록 공개</span>`;
}

function courseSeriesBadgeHtml(course) {
  if (!course?.series_id || course.seriesTotal < 2 || course.seriesPosition < 1) return "";
  return `<span class="badge series-badge">연강 ${course.seriesPosition}/${course.seriesTotal}</span>`;
}

function courseCardHtml(course) {
  const orgSlug = course.organization?.slug || "";
  const orgName = course.organization?.name || "단체 미정";
  const instructorName = course.instructor?.name || "강사 미정";
  return `
      <article class="course-card status-${escapeHtml(course.status)}">
        <div class="badge-row">
          <span class="badge ${getStatusClass(course.status)}">${escapeHtml(statusLabels[course.status] || course.status)}</span>
          ${course.topic ? `<span class="badge">${escapeHtml(course.topic)}</span>` : ""}
          ${courseSeriesBadgeHtml(course)}
        </div>
        <div class="course-schedule"><span aria-hidden="true">📅</span><strong>${escapeHtml(formatSchedule(courseScheduleStart(course), courseScheduleEnd(course)))}</strong></div>
        <h3>${escapeHtml(course.title)}</h3>
        ${course.subtitle ? `<p class="course-subtitle">${escapeHtml(course.subtitle)}</p>` : ""}
        <div class="meta">
          <span>🏛️ ${orgSlug ? `<button class="text-link" type="button" data-open-organization="${escapeHtml(orgSlug)}">${escapeHtml(orgName)}</button>` : escapeHtml(orgName)}</span>
          <span>🎙️ ${course.instructor?.id ? `<button class="text-link" type="button" data-open-instructor="${course.instructor.id}">${escapeHtml(instructorName)}</button>` : escapeHtml(instructorName)} 강사</span>
          <span>📍 ${escapeHtml(course.venue?.name || "장소 미정")}</span>
        </div>
        ${course.summary ? `<p class="course-summary">${escapeHtml(course.summary)}</p>` : ""}
        <div class="footer">
          ${courseCardNoteHtml(course)}
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

function instructorCardHtml(instructor) {
  const courses = coursesForInstructor(instructor.id);
  const photoUrl = normalizeSafeUrl(instructor.photo_url, URL_RULES.image);
  const profileUrl = normalizeSafeUrl(instructor.profile_url, URL_RULES.external);
  return `
      <article class="organization-card">
        ${photoUrl ? `<img class="org-logo" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(instructor.name)} 사진">` : ""}
        <div>
          <h3>${escapeHtml(instructor.name)}</h3>
          ${instructor.title ? `<p>${escapeHtml(instructor.title)}</p>` : ""}
          ${instructor.bio ? `<p>${escapeHtml(instructor.bio)}</p>` : ""}
        </div>
        <div class="footer">
          <span class="review-note">교육 ${courses.length}개</span>
          <div class="actions">
            <button class="btn small secondary" type="button" data-open-instructor="${escapeHtml(instructor.id)}">프로필</button>
            ${profileUrl ? `<a class="btn small secondary" href="${escapeHtml(profileUrl)}" target="_blank" rel="noreferrer">홈페이지/SNS</a>` : ""}
            <button class="btn small" type="button" data-open-instructor-courses="${escapeHtml(instructor.id)}">교육 보기</button>
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

  const sorted = courses.slice().sort((a, b) => new Date(courseScheduleStart(a) || 0) - new Date(courseScheduleStart(b) || 0));
  const coursesByMonth = new Map();
  sorted.forEach((course) => {
    const firstSession = course.sessions[0];
    const startsAt = firstSession?.starts_at || course.starts_at;
    const date = new Date(startsAt || 0);
    const monthParts = Number.isNaN(date.getTime())
      ? null
      : new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          year: "numeric",
          month: "2-digit",
        }).formatToParts(date);
    const year = monthParts?.find((part) => part.type === "year")?.value || "";
    const month = monthParts?.find((part) => part.type === "month")?.value || "";
    const key = year && month ? `${year}-${month}` : "undated";
    if (!coursesByMonth.has(key)) {
      coursesByMonth.set(key, {
        label: year && month ? `${year}년 ${Number(month)}월` : "일정 미정",
        courses: [],
      });
    }
    coursesByMonth.get(key).courses.push(course);
  });

  const calendarItemHtml = (course) => {
    const orgSlug = course.organization?.slug || "";
    const orgName = course.organization?.name || "";
    const startsAt = courseScheduleStart(course);
    const endsAt = courseScheduleEnd(course);
    return `
      <article class="calendar-item status-${escapeHtml(course.status)}">
        <div class="date-box"><span>${escapeHtml(formatDate(startsAt))}</span><small>${escapeHtml(formatTimeRange(startsAt, endsAt))}</small></div>
        <div class="calendar-content">
          <div class="badge-row">
            <span class="badge ${getStatusClass(course.status)}">${escapeHtml(statusLabels[course.status] || course.status)}</span>
            <span class="badge">${orgSlug ? `<button class="badge-link" type="button" data-open-organization="${escapeHtml(orgSlug)}">${escapeHtml(orgName)}</button>` : escapeHtml(orgName)}</span>
            ${courseSeriesBadgeHtml(course)}
          </div>
          <h3>${escapeHtml(course.title)}</h3>
          ${course.subtitle ? `<p class="calendar-subtitle">${escapeHtml(course.subtitle)}</p>` : ""}
          <p>${escapeHtml(course.instructor?.name || "강사 미정")} 강사 · ${escapeHtml(course.venue?.name || "장소 미정")}</p>
        </div>
        <button class="btn small" type="button" data-open-course="${course.id}">상세 보기</button>
      </article>
    `;
  };

  elements.courseResults.innerHTML = [...coursesByMonth.entries()].map(([key, group]) => `
    <section class="calendar-month" aria-labelledby="calendar-month-${escapeHtml(key)}">
      <h3 class="calendar-month-heading" id="calendar-month-${escapeHtml(key)}">${escapeHtml(group.label)}</h3>
      <div class="calendar-month-list">
        ${group.courses.map(calendarItemHtml).join("")}
      </div>
    </section>
  `).join("");
}

function renderLandingCoursesPage() {
  const featured = state.landingCourses.slice();
  const hasFeatured = featured.length > 0;
  const featuredLabel = state.featuredMode === "reviewed" ? "후기가 많은 종료 교육" : "곧 진행될 교육";
  setPageHeader({
    title: "교육 검색",
    description: "필요한 교육을 바로 검색해 보세요. 첫 화면은 전체 목록 대신 가벼운 요약과 추천 교육만 보여줍니다.",
    showCourseTools: true,
    summary: hasFeatured
      ? `${featuredLabel} ${featured.length.toLocaleString("ko-KR")}개를 먼저 보여드립니다. 더 보려면 검색하기를 눌러 주세요.`
      : "검색어를 입력하거나 필터를 선택한 뒤 검색하기를 눌러 주세요.",
  });
  if (hasFeatured) {
    if (state.activeView === "calendar") renderCalendar(featured);
    else renderCards(featured);
    return;
  }
  elements.courseResults.className = "content-stack";
  elements.courseResults.innerHTML = `<div class="empty">아직 추천할 교육이 없습니다. 검색하기를 누르면 등록된 교육을 확인할 수 있습니다.</div>`;
}

function renderCoursesPage() {
  if (!state.searchActivated) {
    renderLandingCoursesPage();
    return;
  }
  const courses = filteredCourses();
  const organizations = publicOrganizations();
  setPageHeader({
    title: "교육 검색",
    description: "관심 있는 교육을 교육명, 부제, 주제, 강사, 장소, 단체명으로 찾아보세요.",
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

function renderInstructorsPage() {
  const instructors = publicInstructors();
  setPageHeader({
    title: "강사",
    description: "강사를 선택하면 해당 강사의 교육을 모아볼 수 있습니다.",
    summary: `${instructors.length.toLocaleString("ko-KR")}명의 강사가 함께합니다.`,
  });
  elements.courseResults.className = "organization-grid";
  elements.courseResults.innerHTML = instructors.map(instructorCardHtml).join("") || `<div class="empty">등록된 강사가 없습니다.</div>`;
}

function renderInstructorPage() {
  const instructor = publicInstructors().find((item) => item.id === state.activeInstructorId);
  if (!instructor) {
    setPageHeader({
      title: "강사",
      description: "요청한 강사 정보를 찾을 수 없습니다.",
      summary: "",
    });
    elements.courseResults.className = "content-stack";
    elements.courseResults.innerHTML = `<div class="empty">강사 정보를 찾을 수 없습니다.</div>`;
    return;
  }

  const courses = coursesForInstructor(instructor.id);
  const photoUrl = normalizeSafeUrl(instructor.photo_url, URL_RULES.image);
  const profileUrl = normalizeSafeUrl(instructor.profile_url, URL_RULES.external);
  setPageHeader({
    title: instructor.name,
    description: "강사 소개와 이 강사가 진행하는 교육을 함께 볼 수 있습니다.",
    summary: `${courses.length.toLocaleString("ko-KR")}개 교육이 있습니다.`,
  });
  elements.courseResults.className = "content-stack";
  elements.courseResults.innerHTML = `
    <article class="organization-detail section">
      ${photoUrl ? `<img class="profile-photo" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(instructor.name)} 사진">` : `<div class="profile-photo placeholder" aria-hidden="true"></div>`}
      <div>
        <h3>${escapeHtml(instructor.name)}</h3>
        ${instructor.title ? `<p class="muted">${escapeHtml(instructor.title)}</p>` : ""}
        ${instructor.bio ? `<p>${escapeHtml(instructor.bio)}</p>` : ""}
        <div class="actions">
          <button class="btn small secondary" type="button" data-route="instructors">강사 목록</button>
          ${profileUrl ? `<a class="btn small" href="${escapeHtml(profileUrl)}" target="_blank" rel="noreferrer">홈페이지/SNS</a>` : ""}
        </div>
      </div>
    </article>
    <div class="course-grid">
      ${courses.length ? courses.map(courseCardHtml).join("") : `<div class="empty">이 강사의 등록된 교육이 없습니다.</div>`}
    </div>
  `;
}

function reportButtonHtml(contentType, contentId) {
  if (!contentId) return "";
  return `<button class="btn small secondary" type="button" data-report-content="${escapeHtml(contentType)}" data-report-id="${escapeHtml(contentId)}">신고</button>`;
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
              <span class="badge green">후기</span>
            </div>
            <p>${escapeHtml(review.body)}</p>
            <div class="footer">
              <span class="muted">${escapeHtml(course?.title || "교육 정보")} · ${escapeHtml(course?.organization?.name || "")}</span>
              <div class="actions">
                ${course ? `<button class="btn small secondary" type="button" data-open-course="${course.id}">교육 보기</button>` : ""}
                ${reportButtonHtml("review", review.id)}
              </div>
            </div>
          </article>
        `;
      }).join("") || `<div class="empty">아직 등록된 후기가 없습니다.</div>`}
    </div>
  `;
}

function renderExpectationsPage() {
  setPageHeader({
    title: "기대평·질문 모아보기",
    description: "교육 신청자가 남긴 기대평과 강사에게 하고 싶은 질문을 모아볼 수 있습니다.",
    summary: state.expectations.length ? "공개된 기대평과 질문을 최신순으로 보여드립니다." : "아직 공개된 기대평이나 질문이 없습니다.",
  });
  elements.courseResults.className = "content-stack";
  elements.courseResults.innerHTML = `
    <div class="table-list">
      ${state.expectations.map((expectation) => {
        const course = courseById(expectation.course_id);
        return `
          <article class="review-card">
            <div class="row-top">
              <strong>${escapeHtml(getMaskedEmailName(expectation.author_name))}님의 기대평·질문</strong>
              <span class="badge green">기대평·질문</span>
            </div>
            <p>${escapeHtml(expectation.body)}</p>
            <div class="footer">
              <span class="muted">${escapeHtml(course?.title || "교육 정보")} · ${escapeHtml(course?.organization?.name || "")}</span>
              <div class="actions">
                ${course ? `<button class="btn small secondary" type="button" data-open-course="${course.id}">교육 보기</button>` : ""}
                ${reportButtonHtml("expectation", expectation.id)}
              </div>
            </div>
          </article>
        `;
      }).join("") || `<div class="empty">아직 공개된 기대평이나 질문이 없습니다.</div>`}
    </div>
  `;
}

function openInstructorProfile(instructorId) {
  const instructor = state.instructors.find((item) => item.id === instructorId);
  if (!instructor) return;
  const photoUrl = normalizeSafeUrl(instructor.photo_url, URL_RULES.image);
  const profileUrl = normalizeSafeUrl(instructor.profile_url, URL_RULES.external);
  elements.profileEyebrow.textContent = "강사 프로필";
  elements.profileTitle.textContent = instructor.name;
  elements.profileBody.innerHTML = `
    <div class="profile-card">
      ${photoUrl ? `<img class="profile-photo" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(instructor.name)} 사진">` : `<div class="profile-photo placeholder" aria-hidden="true"></div>`}
      <div>
        <h3>${escapeHtml(instructor.name)}</h3>
        <p class="muted">${escapeHtml(instructor.title || "강사")}</p>
        ${instructor.bio ? `<p>${escapeHtml(instructor.bio)}</p>` : ""}
        ${profileUrl ? `<div class="actions"><a class="btn small secondary" href="${escapeHtml(profileUrl)}" target="_blank" rel="noreferrer">홈페이지/SNS</a></div>` : ""}
      </div>
    </div>
  `;
  openModal(elements.profileModal);
}

function openArchivePhoto(archiveId) {
  const item = state.archives.find((archive) => archive.id === archiveId);
  const url = normalizeSafeUrl(item?.url, URL_RULES.archive);
  if (!item || item.type !== "photo" || !url) {
    showToast("사진 정보를 찾지 못했습니다.");
    return;
  }

  const course = courseById(item.course_id);
  elements.profileEyebrow.textContent = "사진";
  elements.profileTitle.textContent = item.title || "사진 보기";
  elements.profileBody.innerHTML = `
    <figure class="photo-viewer">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(item.title || "교육 사진")}">
      <figcaption>
        ${item.caption ? `<p>${escapeHtml(item.caption)}</p>` : ""}
        ${course ? `<p class="muted">${escapeHtml(course.title)} · ${escapeHtml(course.organization?.name || "")}</p>` : ""}
      </figcaption>
    </figure>
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
            ${isAttendanceConfirmed(application) ? `<p class="muted">참석 인증: ${escapeHtml(shortDate(application.attendance_confirmed_at))}</p>` : ""}
            ${application.note ? `<p><strong>기대평 / 강사에게 하고 싶은 질문</strong><br>${escapeHtml(application.note)}</p>` : ""}
            ${renderCourseNotificationPreferences(application)}
            ${course ? `<button class="btn small secondary" type="button" data-open-course="${course.id}">교육 보기</button>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCourseNotificationPreferences(application) {
  if (!application || isCancelledApplication(application)) return "";
  const emailEnabled = application.email_course_notice_enabled !== false;
  const smsEnabled = application.sms_course_notice_enabled !== false;
  return `
    <form data-course-notification-form class="course-notice-form">
      <input type="hidden" name="application_id" value="${escapeHtml(application.id)}">
      <div>
        <strong>이 교육의 일정 안내</strong>
        <p class="muted">교육 정보 변경과 교육 시작 전 안내를 받을 채널을 선택하세요.</p>
      </div>
      <div class="course-notice-controls">
        <label><span><input type="checkbox" name="email_enabled" ${emailEnabled ? "checked" : ""}> 이메일</span></label>
        <label><span><input type="checkbox" name="sms_enabled" ${smsEnabled ? "checked" : ""}> 문자</span></label>
        <button class="btn small secondary" type="submit">알림 저장</button>
      </div>
      <p class="muted">체크를 끄고 저장하면 이후 해당 채널의 변경·리마인드 안내는 발송하지 않습니다. 신청·취소 완료와 교육 취소 같은 필수 운영 안내는 별도로 발송될 수 있습니다.</p>
    </form>
  `;
}

function canEditApplicationNote(application, course = null) {
  const targetCourse = course || courseById(application?.course_id);
  return Boolean(
    application
    && targetCourse
    && !isCancelledApplication(application)
    && !isAttendanceConfirmed(application)
    && canApplyToCourse(targetCourse)
  );
}

function canDeleteApplicationNote(application) {
  return Boolean(application && !isCancelledApplication(application) && String(application.note || "").trim());
}

function renderApplicationNoteForm(application, course = null) {
  const targetCourse = course || courseById(application?.course_id);
  const note = String(application?.note || "");
  const canEdit = canEditApplicationNote(application, targetCourse);
  if (!application) return "";
  if (!canEdit) {
    return note
      ? `<div>
          <p><strong>기대평 / 강사에게 하고 싶은 질문</strong><br>${escapeHtml(note)}</p>
          ${canDeleteApplicationNote(application) ? `<button class="btn small danger" type="button" data-delete-application-note="${escapeHtml(application.id)}">기대평·질문 삭제</button>` : ""}
        </div>`
      : `<p class="muted">교육 시작 후에는 기대평이나 질문을 새로 작성할 수 없습니다.</p>`;
  }
  return `
    <form data-application-note-form>
      <input type="hidden" name="application_id" value="${escapeHtml(application.id)}">
      <label>기대평 / 강사에게 하고 싶은 질문<textarea name="note" maxlength="1000" placeholder="교육에서 기대하는 점이나 강사에게 미리 묻고 싶은 내용을 적어주세요.">${escapeHtml(note)}</textarea></label>
      <div class="actions" style="margin-top: 10px;">
        <button class="btn small" type="submit">${note ? "수정 저장" : "작성 저장"}</button>
        ${note ? `<button class="btn small danger" type="button" data-delete-application-note="${escapeHtml(application.id)}">삭제</button>` : ""}
        <span class="badge gray">선택 입력</span>
      </div>
    </form>
  `;
}

function renderApplicationNoteHistory() {
  const applications = activeApplications();
  if (!applications.length) return `<div class="empty">아직 신청한 교육이 없습니다.</div>`;
  return `
    <div class="table-list">
      ${applications.map((application) => {
        const course = courseById(application.course_id);
        return `
          <div class="table-row">
            <div class="row-top">
              <strong>${escapeHtml(course?.title || "교육 정보")}</strong>
              <span class="badge ${application.note ? "green" : "gray"}">${application.note ? "작성" : "미작성"}</span>
            </div>
            <p class="muted">신청일 ${escapeHtml(shortDate(application.created_at))}</p>
            ${renderApplicationNoteForm(application, course)}
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

function demographicOption(value, label, selectedValue) {
  return `<option value="${escapeHtml(value)}" ${selectedValue === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function openResidencePostcodeSearch(button) {
  const form = button.closest("#demographicsForm");
  if (!form) return;
  residenceSearchForm = form;
  residenceSearchPopup = window.open(
    "./address-search.html",
    "humanities-address-search",
    "popup=yes,width=520,height=720,resizable=yes,scrollbars=yes",
  );
  if (!residenceSearchPopup) {
    residenceSearchForm = null;
    showToast("주소검색 팝업이 차단되었습니다. 브라우저에서 팝업을 허용한 뒤 다시 시도해 주세요.");
  }
}

function handleResidenceSearchMessage(event) {
  if (event.origin !== window.location.origin || event.source !== residenceSearchPopup) return;
  const message = event.data;
  if (!message || message.type !== "humanities:residence-selected") return;
  const form = residenceSearchForm;
  residenceSearchPopup = null;
  residenceSearchForm = null;
  if (!form || !document.body.contains(form)) return;

  const selection = message.selection;
  if (!selection?.district || !selection?.neighborhood || !selection?.storedLabel) {
    showToast("선택한 주소에서 읍·면·동을 확인하지 못했습니다. 다른 검색 결과를 선택해 주세요.");
    return;
  }

  form.elements.residence_district.value = selection.district;
  form.elements.residence_neighborhood.value = selection.neighborhood;
  const preview = form.querySelector("[data-residence-stored-preview]");
  const storedLabel = form.querySelector("[data-residence-stored-label]");
  const summary = form.querySelector("[data-residence-selection-summary]");
  const discardedRow = form.querySelector("[data-residence-discarded-row]");
  const discardedValue = form.querySelector("[data-residence-discarded-value]");
  if (preview) preview.value = selection.storedLabel;
  if (storedLabel) storedLabel.textContent = selection.storedLabel;
  if (summary) summary.hidden = false;
  if (discardedRow) discardedRow.hidden = !selection.discardedAddress;
  if (discardedValue) discardedValue.textContent = selection.discardedAddress || "";
  showToast("읍·면·동까지만 선택했습니다. 상세주소는 저장하지 않습니다.");
}

function clearResidenceSelection(button) {
  const form = button.closest("#demographicsForm");
  if (!form) return;
  form.elements.residence_district.value = "";
  form.elements.residence_neighborhood.value = "";
  const preview = form.querySelector("[data-residence-stored-preview]");
  const storedLabel = form.querySelector("[data-residence-stored-label]");
  const summary = form.querySelector("[data-residence-selection-summary]");
  const discardedRow = form.querySelector("[data-residence-discarded-row]");
  const discardedValue = form.querySelector("[data-residence-discarded-value]");
  if (preview) preview.value = "";
  if (storedLabel) storedLabel.textContent = "";
  if (summary) summary.hidden = true;
  if (discardedRow) discardedRow.hidden = true;
  if (discardedValue) discardedValue.textContent = "";
  showToast("거주지역을 저장하지 않도록 비웠습니다.");
}

function renderDemographicsForm() {
  const profile = state.demographics || {};
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Seoul" }).format(new Date()));
  const storedResidence = [profile.residence_district, profile.residence_neighborhood].filter(Boolean).join(" ");
  return `
    <form id="demographicsForm" class="demographics-form">
      <div class="row-top">
        <div>
          <h3>선택 이용자 정보</h3>
          <p class="muted">참여자 구성을 통계로 파악하기 위한 선택 항목입니다. 입력하지 않아도 교육 신청과 이용에 불이익이 없습니다.</p>
        </div>
        <span class="badge gray">모든 항목 선택 입력</span>
      </div>
      <div class="residence-search-panel">
        <input name="residence_district" type="hidden" value="${escapeHtml(profile.residence_district || "")}">
        <input name="residence_neighborhood" type="hidden" value="${escapeHtml(profile.residence_neighborhood || "")}">
        <label>거주지역(선택)
          <input type="text" value="${escapeHtml(storedResidence)}" data-residence-stored-preview readonly placeholder="주소검색으로 읍·면·동을 선택하세요" aria-describedby="residenceStorageGuide">
        </label>
        <div class="actions">
          <button class="btn small secondary" type="button" data-search-residence>주소검색</button>
          <button class="btn small secondary" type="button" data-clear-residence>거주지역 비우기</button>
        </div>
        <p class="muted" id="residenceStorageGuide">카카오 주소검색에서 도로명주소와 지번주소 모두 검색할 수 있습니다. 검색 과정은 카카오 서비스에서 처리되며, 우리 서비스는 선택 결과 중 시·도, 시·군·구, 법정동 또는 읍·면까지만 저장합니다.</p>
        <div class="residence-selection-summary" data-residence-selection-summary aria-live="polite" ${storedResidence ? "" : "hidden"}>
          <p><strong>저장되는 지역</strong><span data-residence-stored-label>${escapeHtml(storedResidence)}</span></p>
          <p data-residence-discarded-row hidden><strong>저장하지 않고 버리는 주소</strong><span class="residence-discarded-value" data-residence-discarded-value></span><small>이 값은 현재 화면에서 확인한 뒤 DB·세션·로그에 저장하지 않습니다.</small></p>
        </div>
      </div>
      <div class="admin-grid demographic-fields-grid">
        <label>출생연도(선택)<input name="birth_year" type="number" min="1900" max="${currentYear}" value="${escapeHtml(profile.birth_year ?? "")}" inputmode="numeric" placeholder="예: 1985"></label>
        <label>성별(선택)
          <select name="gender">
            ${demographicOption("", "선택하지 않음", profile.gender || "")}
            ${demographicOption("female", "여성", profile.gender || "")}
            ${demographicOption("male", "남성", profile.gender || "")}
            ${demographicOption("other", "그 외", profile.gender || "")}
            ${demographicOption("prefer_not", "응답하고 싶지 않음", profile.gender || "")}
          </select>
        </label>
        <label>결혼 여부(선택)
          <select name="marital_status">
            ${demographicOption("", "선택하지 않음", profile.marital_status || "")}
            ${demographicOption("married", "기혼", profile.marital_status || "")}
            ${demographicOption("unmarried", "미혼", profile.marital_status || "")}
            ${demographicOption("other", "그 외", profile.marital_status || "")}
            ${demographicOption("prefer_not", "응답하고 싶지 않음", profile.marital_status || "")}
          </select>
        </label>
        <label>자녀 수(선택)<input name="children_count" type="number" min="0" max="20" value="${escapeHtml(profile.children_count ?? "")}" inputmode="numeric" placeholder="없으면 0"></label>
      </div>
      <details class="privacy-details" style="margin-top: 12px;">
        <summary>선택 정보 수집·이용 안내</summary>
        <ul class="plain-list">
          <li><strong>목적</strong><br>참여자 구성에 대한 통계 작성과 교육 기획·서비스 개선</li>
          <li><strong>항목</strong><br>거주지역(시·도, 시·군·구, 법정동 또는 읍·면까지만 저장), 출생연도, 성별, 결혼 여부, 자녀 수 중 이용자가 선택한 항목</li>
          <li><strong>주소검색 처리</strong><br>검색어와 검색 화면은 카카오 우편번호 서비스에서 처리합니다. 우리 서비스는 선택 결과 중 전체 주소·건물번호·상세주소·우편번호를 저장하지 않습니다.</li>
          <li><strong>열람 범위</strong><br>개별 응답 원문은 본인만 열람·수정할 수 있고, 전체 관리자는 5명 이상인 범주의 집계만 확인합니다.</li>
          <li><strong>보유 기간</strong><br>동의 철회·계정 삭제 또는 교육 신청 개인정보의 마지막 참석·신청 기준 6개월 보유기간 도래 중 먼저 발생하는 시점까지입니다. 나의 정보에서 언제든 삭제할 수 있습니다.</li>
          <li><strong>거부권</strong><br>동의를 거부하거나 일부 항목만 입력할 수 있으며, 교육 신청과 서비스 이용에 불이익이 없습니다.</li>
        </ul>
      </details>
      <label class="consent-check"><span><input name="optional_consent" type="checkbox" required style="width:auto;min-height:auto;"> 선택 정보 수집·이용에 동의합니다.</span></label>
      <div class="actions" style="margin-top: 12px;">
        <button class="btn small" type="submit">${state.demographics ? "선택 정보 수정" : "선택 정보 저장"}</button>
        ${state.demographics ? `<button class="btn small danger" type="button" data-delete-demographics>선택 정보 삭제</button>` : ""}
      </div>
    </form>
  `;
}

function renderDemographicBanner() {
  if (!elements.demographicBanner) return;
  let dismissed = false;
  try {
    dismissed = window.sessionStorage.getItem(DEMOGRAPHIC_BANNER_DISMISS_KEY) === "true";
  } catch (error) {
    console.warn("[모두의 인문학] 선택 정보 안내 상태 확인 실패", error);
  }
  const visible = Boolean(state.user && !state.demographics && !dismissed);
  elements.demographicBanner.hidden = !visible;
  if (!visible) {
    elements.demographicBanner.innerHTML = "";
    return;
  }
  elements.demographicBanner.innerHTML = `
    <div>
      <strong>선택 이용자 정보를 알려주세요</strong>
      <p>거주 동, 출생연도, 성별, 결혼 여부, 자녀 수 중 원하는 항목만 입력하면 교육 기획에 통계로 활용합니다.</p>
    </div>
    <div class="actions">
      <button class="btn small" type="button" data-open-demographics>입력하기</button>
      <button class="btn small secondary" type="button" data-dismiss-demographics>이번 접속에서 숨기기</button>
    </div>
  `;
}

function interestOptionId(targetType, targetKey) {
  return `${targetType}:${targetKey}`;
}

function allInterestOptions() {
  return [
    ...(state.interestOptions.instructors || []),
    ...(state.interestOptions.topics || []),
  ];
}

function renderInterestSearchResults(query = state.interestSearch) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase("ko-KR");
  if (!normalizedQuery) {
    return `<p class="muted">강사명이나 주제를 입력하면 추가할 대상을 보여드립니다.</p>`;
  }

  const selectedIds = new Set(state.interestSubscriptions.map((subscription) => (
    interestOptionId(subscription.target_type, subscription.target_key)
  )));
  const results = allInterestOptions()
    .filter((option) => !selectedIds.has(interestOptionId(option.target_type, option.target_key)))
    .filter((option) => [option.label, option.description, option.target_type === "instructor" ? "강사" : "주제"]
      .join(" ")
      .toLocaleLowerCase("ko-KR")
      .includes(normalizedQuery))
    .slice(0, 10);

  if (!results.length) return `<p class="muted">추가할 수 있는 강사나 주제를 찾지 못했습니다.</p>`;
  return results.map((option) => `
    <button class="interest-search-result" type="button"
      data-add-interest
      data-target-type="${escapeHtml(option.target_type)}"
      data-target-key="${escapeHtml(option.target_key)}">
      <span>
        <strong>${escapeHtml(option.label)}</strong>
        ${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}
      </span>
      <span class="badge gray">${option.target_type === "instructor" ? "강사" : "주제"}</span>
    </button>
  `).join("");
}

function renderInterestSubscriptionRows() {
  const hasSmsPhone = /^010\d{8}$/.test(String(state.applicantProfile?.phone || "").replace(/\D/g, ""));
  if (!state.interestSubscriptions.length) {
    return `<div class="empty">등록한 관심 강사나 주제가 없습니다.</div>`;
  }

  return state.interestSubscriptions.map((subscription) => {
    const smsEnabled = hasSmsPhone && subscription.sms_enabled === true;
    return `
      <article class="interest-subscription-row"
        data-interest-row
        data-target-type="${escapeHtml(subscription.target_type)}"
        data-target-key="${escapeHtml(subscription.target_key)}">
        <div class="interest-subscription-target">
          <span class="badge gray">${subscription.target_type === "instructor" ? "강사" : "주제"}</span>
          <span>
            <strong>${escapeHtml(subscription.target_label || subscription.target_key)}</strong>
            ${subscription.target_description ? `<small>${escapeHtml(subscription.target_description)}</small>` : ""}
          </span>
        </div>
        <div class="interest-channel-controls" aria-label="${escapeHtml(subscription.target_label || subscription.target_key)} 알림 채널">
          <label><span><input type="checkbox" data-interest-channel="email" ${subscription.email_enabled ? "checked" : ""}> 이메일</span></label>
          <label title="${hasSmsPhone ? "" : "교육 신청 시 저장한 010 휴대전화번호가 필요합니다."}"><span><input type="checkbox" data-interest-channel="sms" ${smsEnabled ? "checked" : ""} ${hasSmsPhone ? "" : "disabled"}> 문자</span></label>
          <button class="btn small secondary" type="button" data-remove-interest>삭제</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderInterestNotificationsForm() {
  const hasSmsPhone = /^010\d{8}$/.test(String(state.applicantProfile?.phone || "").replace(/\D/g, ""));
  return `
    <form id="interestNotificationsForm" class="interest-notifications-form">
      <div class="row-top">
        <div>
          <h3>관심 강사·주제 새 교육 알림</h3>
          <p class="muted">새 교육이 공개되면 다음 오전 10시에 관심 항목과 일치하는 교육을 한 번에 모아 알려드립니다.</p>
        </div>
        <span class="badge gray">선택 알림</span>
      </div>
      <div class="interest-subscription-list" data-interest-subscription-list>
        ${renderInterestSubscriptionRows()}
      </div>
      ${hasSmsPhone
        ? `<p class="muted">문자 수신 번호: ${escapeHtml(formatPhoneNumber(state.applicantProfile.phone))}</p>`
        : `<p class="muted">문자 알림을 선택하려면 먼저 교육을 신청해 010 휴대전화번호를 저장해 주세요. 이메일 알림은 바로 선택할 수 있습니다.</p>`}
      <div class="interest-search-panel">
        <label>관심 강사·주제 추가
          <input type="search" data-interest-search value="${escapeHtml(state.interestSearch)}" placeholder="예: 김민호, 철학">
        </label>
        <div class="interest-search-results" data-interest-search-results aria-live="polite">
          ${renderInterestSearchResults()}
        </div>
      </div>
      <details class="privacy-details">
        <summary>관심 알림 수신 동의 안내</summary>
        <ul class="plain-list">
          <li><strong>목적·내용</strong><br>선택한 강사 또는 주제의 새 교육 안내</li>
          <li><strong>수신 채널</strong><br>항목별로 이메일, 문자 또는 두 채널 모두 선택할 수 있습니다.</li>
          <li><strong>이용 정보</strong><br>인증 이메일, 교육 신청 시 저장한 휴대전화번호, 관심 강사·주제, 채널별 동의·철회 시각</li>
          <li><strong>보유 기간</strong><br>수신 동의 철회 또는 계정 삭제 때까지 보유합니다. 발송 이력은 중복 방지와 장애 확인을 위해 필요한 기간 동안 제한적으로 보관합니다.</li>
          <li><strong>선택 동의</strong><br>동의하지 않거나 언제든 해지해도 교육 검색·신청·참여에 불이익이 없습니다.</li>
        </ul>
      </details>
      <label class="consent-check"><span><input name="interest_consent" type="checkbox" style="width:auto;min-height:auto;"> 선택한 채널로 새 교육 알림을 받는 데 동의합니다.</span></label>
      <div class="actions">
        <button class="btn small" type="submit">관심 알림 설정 저장</button>
        <span class="muted">모든 항목을 삭제하고 저장하면 전체 해지됩니다.</span>
      </div>
    </form>
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
    <section class="section" id="interestNotificationsSection" style="margin-top: 14px;">
      ${renderInterestNotificationsForm()}
    </section>
    <section class="section" id="demographicsSection" style="margin-top: 14px;">
      ${renderDemographicsForm()}
    </section>
    <section class="section" style="margin-top: 14px;">
      <h3>교육 신청 현황</h3>
      ${renderApplicationHistory()}
    </section>
    <section class="section" style="margin-top: 14px;">
      <h3>기대평·질문 작성 현황</h3>
      ${renderApplicationNoteHistory()}
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
    return archiveMediaHtml({ ...item, caption: item.caption || course?.title || "자료 보기" }, "media resource-card");
  }).join("") || `<div class="empty">등록된 사진·영상·자료가 없습니다.</div>`;
}

function render() {
  renderDemographicBanner();
  renderStats();
  if (state.activePage === "organizations") renderOrganizationsPage();
  else if (state.activePage === "organization") renderOrganizationPage();
  else if (state.activePage === "instructors") renderInstructorsPage();
  else if (state.activePage === "instructor") renderInstructorPage();
  else if (state.activePage === "reviews") renderReviewsPage();
  else if (state.activePage === "expectations") renderExpectationsPage();
  else if (state.activePage === "archive") renderArchivePage();
  else renderCoursesPage();
}

function renderReviews(course) {
  if (!course.reviews.length) {
    const canReview = canWriteReviewForCourse(course);
    return `<li class="review-item">${canReview ? "아직 등록된 후기가 없습니다. 교육 후 첫 후기를 남겨보세요." : "아직 등록된 후기가 없습니다."}</li>`;
  }
  return course.reviews.map((review) => `
    <li class="review-item">
      <strong>${escapeHtml(getMaskedEmailName(review.author_name))}님의 후기 <span class="badge green">후기</span></strong><br>
      ${escapeHtml(review.body)}
      <div class="actions" style="margin-top: 8px;">${reportButtonHtml("review", review.id)}</div>
    </li>
  `).join("");
}

function renderCourseExpectations(course) {
  if (!course.expectations?.length) return `<p class="muted">아직 공개된 기대평이나 질문이 없습니다.</p>`;
  return `
    <ul class="review-list">
      ${course.expectations.map((expectation) => `
        <li class="review-item">
          <strong>${escapeHtml(getMaskedEmailName(expectation.author_name))}님의 기대평·질문 <span class="badge green">기대평·질문</span></strong><br>
          ${escapeHtml(expectation.body)}
          <div class="actions" style="margin-top: 8px;">${reportButtonHtml("expectation", expectation.id)}</div>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderReviewForm(course) {
  const signedInApplication = state.user ? activeApplicationForCourse(course.id) : null;
  const signedInEligible = Boolean(signedInApplication && isAttendanceConfirmed(signedInApplication));
  const guestAccess = activeGuestAccessForCourse(course.id);
  const guestEligible = Boolean(guestAccess?.attendance_confirmed_at);
  const reviewIdentity = signedInEligible ? "user" : guestEligible ? "guest" : "";
  const existingReview = reviewIdentity === "user"
    ? myReviewForCourse(course.id)
    : reviewIdentity === "guest" && guestAccess?.review_id
      ? { id: guestAccess.review_id, body: guestAccess.review_body || "" }
      : null;

  if (!reviewIdentity) {
    if (!canShowPostCourseContent(course)) return "";
    return `
      <div class="table-row">
        <p>비회원 참여자는 신청 확인 문자에 포함된 안전한 확인 링크로 접속하면 참석 확인 후 후기를 작성할 수 있습니다.</p>
        <span class="badge gray">이름과 전화번호만으로는 후기 권한을 확인하지 않습니다</span>
      </div>
    `;
  }

  if (existingReview) {
    return `
      <form id="reviewForm">
        <input type="hidden" name="review_id" value="${escapeHtml(existingReview.id)}">
        <input type="hidden" name="review_identity" value="${escapeHtml(reviewIdentity)}">
        <label>내 후기<textarea name="body" required minlength="10">${escapeHtml(existingReview.body || "")}</textarea></label>
        <p class="muted">후기는 글로만 작성합니다. 현장 사진과 영상은 운영자가 확인한 뒤 사진·영상·자료 아카이브에 올립니다.</p>
        <div class="actions" style="margin-top: 12px;">
          <button class="btn" type="submit">후기 수정</button>
          <button class="btn danger" type="button" ${reviewIdentity === "guest" ? "data-delete-guest-review" : `data-delete-review="${escapeHtml(existingReview.id)}"`}>후기 삭제</button>
          <span class="badge green">이미 작성한 후기</span>
        </div>
      </form>
    `;
  }

  return `
    <form id="reviewForm">
      <input type="hidden" name="review_identity" value="${escapeHtml(reviewIdentity)}">
      <label>후기<textarea name="body" placeholder="교육에서 좋았던 점, 기억에 남은 질문, 다음 참여자에게 전하고 싶은 말을 적어주세요." required minlength="10"></textarea></label>
      <p class="muted">후기는 글로만 작성합니다. 사진과 영상은 운영자가 확인한 뒤 사진·영상·자료 아카이브에 올립니다.</p>
      <div class="actions" style="margin-top: 12px;">
        <button class="btn" type="submit">후기 등록</button>
        <span class="badge green">참석 인증 완료</span>
      </div>
    </form>
  `;
}

function applicationPrivacyConsentHtml({ guest = false } = {}) {
  return `
    <div class="section privacy-consent" style="margin-top: 12px;">
      <h3>개인정보 수집·이용 동의</h3>
      <p class="muted">교육 신청 접수와 이메일·문자 운영 안내를 위해 필요한 최소한의 개인정보를 수집합니다.${guest ? " 이메일은 선택 항목입니다." : ""}</p>
      <details>
        <summary>개인정보 수집·이용 안내 자세히 보기</summary>
        <ul class="plain-list">
          <li><strong>관련 근거</strong><br>개인정보 보호법 제15조 제1항 제1호에 따른 정보주체의 동의</li>
          <li><strong>수집·이용 목적</strong><br>교육 신청 접수, 신청자 본인 확인, 신청 확인과 교육 전 리마인드, 일정·장소 변경 및 취소 안내, 참석 확인, 신청 이력 확인, 운영 문의 응대</li>
          <li><strong>수집 항목</strong><br>필수: 신청자명, 휴대전화번호${guest ? " · 선택: 이메일, 기대평 또는 강사에게 하고 싶은 질문" : ", 인증 이메일 · 선택: 기대평 또는 강사에게 하고 싶은 질문"}. 현장 참석 명단을 작성하는 경우 성명, 휴대전화번호 끝 4자리와 서명을 별도로 수집할 수 있습니다.</li>
          <li><strong>공개되는 선택 내용</strong><br>기대평 또는 강사에게 하고 싶은 질문을 작성하면 작성자 표시를 일부 가린 뒤 공개 페이지에 게시합니다. 연락처나 사적인 정보는 입력하지 마세요.</li>
          <li><strong>운영 안내 방법</strong><br>휴대전화번호로 문자를 발송할 수 있고${guest ? ", 이메일을 선택 입력하고 교육별 이메일 안내를 켜면 일정 변경·리마인드 운영 안내를 발송할 수 있습니다" : ", 인증 이메일로도 신청 확인과 운영 안내를 발송할 수 있습니다"}. 광고성 정보는 별도 동의 없이 발송하지 않습니다.</li>
          <li><strong>신청 개인정보 보유·이용 기간</strong><br>참석 확인된 교육이 있는 경우 마지막 참석 교육 종료일로부터 6개월, 참석 확인 기록이 없는 경우 마지막 신청 교육 종료일 또는 취소일로부터 6개월까지 보관합니다. 이후 이름·전화번호·이메일과 직접적인 신청자 식별정보를 파기하고 통계에 필요한 비식별 기록만 남깁니다. 진행 전이거나 최근에 신청한 교육이 있으면 해당 교육을 기준으로 기간을 다시 계산합니다.</li>
          <li><strong>공개 콘텐츠 보유기간</strong><br>기대평·질문과 공개 후기는 작성자 또는 관리자가 삭제하거나 서비스가 종료될 때까지 보관합니다. 작성자의 수정·삭제 권한을 유지하는 데 필요한 최소한의 계정 연결 또는 비회원 서명 확인정보도 해당 콘텐츠와 함께 보관합니다. 관계 법령에 따라 별도 보관이 필요한 경우에는 해당 기간 동안 분리 보관합니다.</li>
          <li><strong>만 14세 이상 이용</strong><br>온라인 신청은 만 14세 이상만 이용할 수 있습니다. 생년월일이나 유료 본인인증 정보를 추가로 수집하지 않고 신청자가 직접 확인하는 방식이며, 실제 연령을 인증하는 절차는 아닙니다.</li>
          <li><strong>동의 거부권과 불이익</strong><br>개인정보 수집·이용에 동의하지 않을 권리가 있습니다. 다만 필수 항목 동의를 거부하거나 만 14세 이상임을 확인하지 않으면 온라인 교육 신청 접수와 운영 안내가 어렵습니다.</li>
          <li><strong>전화번호 안내</strong><br>휴대전화번호는 유료 본인 인증 없이 신청자가 입력한 값을 저장하며, 교육 운영 안내 연락에만 사용합니다.</li>
        </ul>
      </details>
      <label><span><input name="privacy_agreement" type="checkbox" required style="width:auto;min-height:auto;"> 개인정보 수집 및 이용에 동의합니다.</span></label>
      <label style="margin-top: 8px;"><span><input name="age_14_confirmation" type="checkbox" required style="width:auto;min-height:auto;"> <strong>필수:</strong> 만 14세 이상입니다.</span></label>
      <p class="muted">생년월일이나 유료 본인인증을 받지 않는 자기확인 항목입니다.</p>
      <label style="margin-top: 8px;"><span><input name="review_request_agreement" type="checkbox" style="width:auto;min-height:auto;"> <strong>선택:</strong> 참석 확인 후 교육 종료 2일 뒤 후기 작성 요청 문자 1회를 받는 데 동의합니다.</span></label>
      <p class="muted">선택 동의를 하지 않아도 교육 신청·참여와 참석 확인 후 후기 작성에는 불이익이 없습니다.</p>
    </div>
  `;
}

function renderGuestCourseNotificationPreferences(course, access) {
  if (!course || !access || access.application_status === "cancelled") return "";
  const emailAvailable = access.email_available === true;
  const smsAvailable = access.sms_available === true;
  return `
    <form data-guest-course-notification-form class="course-notice-form">
      <input type="hidden" name="course_id" value="${escapeHtml(course.id)}">
      <div>
        <strong>이 교육의 일정 안내</strong>
        <p class="muted">교육 정보 변경과 교육 시작 전 안내를 받을 채널을 선택하세요.</p>
      </div>
      <div class="course-notice-controls">
        <label title="${emailAvailable ? "" : "신청할 때 입력한 이메일이 필요합니다."}"><span><input type="checkbox" name="email_enabled" ${access.email_course_notice_enabled === true ? "checked" : ""} ${emailAvailable ? "" : "disabled"}> 이메일</span></label>
        <label title="${smsAvailable ? "" : "신청할 때 입력한 010 휴대전화번호가 필요합니다."}"><span><input type="checkbox" name="sms_enabled" ${access.sms_course_notice_enabled === true ? "checked" : ""} ${smsAvailable ? "" : "disabled"}> 문자</span></label>
        <button class="btn small secondary" type="submit">알림 저장</button>
      </div>
      <p class="muted">체크를 끄고 저장하면 이후 해당 채널의 변경·리마인드 안내는 발송하지 않습니다. 확인 링크를 잃은 경우 운영자에게 변경을 요청할 수 있습니다.</p>
    </form>
  `;
}

function renderGuestApplicationForm(course) {
  const guestAccess = guestAccessForCourse(course.id);
  const activeGuestAccess = activeGuestAccessForCourse(course.id);
  const contact = state.guestContact || {};

  if (activeGuestAccess) {
    const attendanceConfirmed = Boolean(activeGuestAccess.attendance_confirmed_at);
    const canCancelApplication = !attendanceConfirmed && canApplyToCourse(course);
    const expectationBody = String(activeGuestAccess.expectation_body || "").trim();
    return `
      <div class="table-row">
        <div class="row-top">
          <strong>비회원 신청이 확인되었습니다.</strong>
          <span class="badge ${attendanceConfirmed ? "green" : "gray"}">${attendanceConfirmed ? "참석 인증" : "신청"}</span>
        </div>
        <p class="muted">신청자: ${escapeHtml(contact.applicant_name || "비회원 신청자")} · 연락처: ${escapeHtml(contact.phone || "확인됨")}</p>
        ${expectationBody ? `
          <p><strong>내 기대평 / 강사에게 하고 싶은 질문</strong><br>${escapeHtml(expectationBody)}</p>
          <button class="btn small danger" type="button" data-delete-guest-application-note>기대평·질문 삭제</button>
        ` : ""}
        ${renderGuestCourseNotificationPreferences(course, activeGuestAccess)}
        ${attendanceConfirmed ? `<p class="muted">참석 인증이 완료되어 후기를 작성할 수 있습니다.</p>` : ""}
        ${canCancelApplication ? `<button class="btn small secondary" type="button" data-cancel-guest-application>신청 취소</button>` : ""}
      </div>
    `;
  }

  const isReapplication = guestAccess?.application_status === "cancelled";
  return `
    <form id="applicationForm">
      <input type="hidden" name="course_id" value="${escapeHtml(course.id)}">
      <input type="hidden" name="application_mode" value="guest">
      ${isReapplication ? `<div class="table-row" style="margin-bottom: 12px;"><div class="row-top"><strong>이전에 취소한 신청이 있습니다.</strong><span class="badge gray">재신청 가능</span></div></div>` : ""}
      <div class="admin-grid application-contact-grid">
        <label>신청자명<input name="applicant_name" value="${escapeHtml(contact.applicant_name || "")}" required maxlength="80" autocomplete="name"></label>
        <label>휴대전화번호
          <input name="phone" type="tel" value="${escapeHtml(contact.phone || "")}" required inputmode="numeric" autocomplete="tel-national" pattern="[0-9-]*" placeholder="010-0000-0000" maxlength="13" aria-describedby="guestApplicationPhoneHint">
          <small class="muted application-phone-hint" id="guestApplicationPhoneHint">010으로 시작하는 숫자 11자리를 입력해 주세요. 하이픈(-)은 자동으로 입력됩니다.</small>
        </label>
      </div>
      <label style="margin-top: 10px;">이메일(선택)<input name="email" type="email" value="${escapeHtml(contact.email || "")}" autocomplete="email" maxlength="320" placeholder="운영 문의 연락용 이메일"></label>
      <label style="margin-top: 10px;">기대평 / 강사에게 하고 싶은 질문(선택)<textarea name="note" maxlength="1000" placeholder="교육에서 기대하는 점이나 강사에게 미리 묻고 싶은 내용을 적어주세요."></textarea><small class="muted">작성 내용은 작성자 표시를 일부 가린 뒤 공개됩니다. 연락처나 사적인 정보는 적지 마세요.</small></label>
      <fieldset class="course-notice-signup-options">
        <legend>이 교육의 일정 안내</legend>
        <p class="muted">교육 정보 변경과 교육 시작 전 안내를 받을 채널을 선택하세요. 신청 후 확인 링크를 연 브라우저에서 다시 끌 수 있습니다.</p>
        <div class="course-notice-controls">
          <label><span><input type="checkbox" name="course_email_notice" ${contact.email ? "checked" : ""}> 이메일</span></label>
          <label><span><input type="checkbox" name="course_sms_notice" checked> 문자</span></label>
        </div>
        <p class="muted">이메일을 선택하려면 위 이메일 입력란도 작성해 주세요. 링크를 잃은 경우 운영자에게 설정 변경을 요청할 수 있습니다.</p>
      </fieldset>
      ${applicationPrivacyConsentHtml({ guest: true })}
      <div class="actions" style="margin-top: 12px;">
        <button class="btn" type="submit">${isReapplication ? "비회원으로 다시 신청하기" : "비회원으로 신청하기"}</button>
        <span class="badge gray">이 접속 중 이름·연락처를 다시 입력하지 않아도 됩니다</span>
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
      <div class="application-paths">
        <section class="application-path-card">
          <span class="badge green">다음 신청이 편리해요</span>
          <h4>로그인하고 신청</h4>
          <p>Google 또는 이메일로 로그인하면 이름과 전화번호를 저장하고 나의 신청·기대평·후기 현황을 모아볼 수 있습니다.</p>
          <button class="btn small" type="button" data-login-for-application>로그인 후 신청하기</button>
        </section>
        <section class="application-path-card">
          <span class="badge gray">로그인 없이</span>
          <h4>비회원 신청</h4>
          <p>이름과 휴대전화번호를 매번 확인해 신청합니다. 이메일은 선택이며, 입력값은 현재 브라우저 탭에서만 임시 보관합니다.</p>
          ${renderGuestApplicationForm(course)}
        </section>
      </div>
    `;
  }

  if (existingApplication) {
    const attendanceConfirmed = isAttendanceConfirmed(existingApplication);
    const canCancelApplication = !attendanceConfirmed && canApplyToCourse(course);
    return `
      <div class="table-row">
        <div class="row-top">
          <strong>이미 신청한 교육입니다.</strong>
          <span class="badge ${attendanceConfirmed ? "green" : "gray"}">${attendanceConfirmed ? "참석 인증" : "신청"}</span>
        </div>
        <p class="muted">신청자: ${escapeHtml(existingApplication.applicant_name)} · 연락처: ${escapeHtml(existingApplication.phone)}</p>
        ${renderCourseNotificationPreferences(existingApplication)}
        ${renderApplicationNoteForm(existingApplication, course)}
        ${attendanceConfirmed
          ? `<p class="muted">참석 인증이 완료되어 후기를 작성할 수 있습니다.</p>`
          : canCancelApplication
            ? `<p class="muted">신청 취소는 아래 버튼으로 처리할 수 있습니다. 신청 내용 수정이 필요하면 운영자에게 문의해 주세요.</p>
               <button class="btn small secondary" type="button" data-cancel-application="${escapeHtml(existingApplication.id)}">신청 취소</button>`
            : ""}
      </div>
    `;
  }

  if (!canApplyToCourse(course)) {
    return `<p>현재 이 교육은 신청을 받지 않습니다. 상태: <strong>${escapeHtml(statusLabels[course.status] || course.status)}</strong></p>`;
  }

  const cancelledApplication = cancelledApplicationForCourse(course.id);
  const defaultName = state.applicantProfile?.applicant_name || cancelledApplication?.applicant_name || "";
  const defaultPhone = formatPhoneNumber(state.applicantProfile?.phone || cancelledApplication?.phone || "");
  const defaultNote = cancelledApplication?.note || "";
  const defaultEmailCourseNotice = cancelledApplication?.email_course_notice_enabled !== false;
  const defaultSmsCourseNotice = cancelledApplication?.sms_course_notice_enabled !== false;
  return `
    <form id="applicationForm">
      <input type="hidden" name="course_id" value="${escapeHtml(course.id)}">
      <input type="hidden" name="application_mode" value="account">
      ${cancelledApplication ? `
        <div class="table-row" style="margin-bottom: 12px;">
          <div class="row-top">
            <strong>이전에 신청을 취소한 교육입니다.</strong>
            <span class="badge gray">재신청 가능</span>
          </div>
          <p class="muted">아래 정보를 확인하고 다시 신청하면 현재 신청자 명단에 등록됩니다.</p>
        </div>
      ` : ""}
      <div class="admin-grid application-contact-grid">
        <label>신청자명<input name="applicant_name" value="${escapeHtml(defaultName)}" required maxlength="80" autocomplete="name"></label>
        <label>휴대전화번호
          <input name="phone" type="tel" value="${escapeHtml(defaultPhone)}" required inputmode="numeric" autocomplete="tel-national" pattern="[0-9-]*" placeholder="010-0000-0000" maxlength="13" aria-describedby="applicationPhoneHint">
          <small class="muted application-phone-hint" id="applicationPhoneHint">010으로 시작하는 숫자 11자리를 입력해 주세요. 하이픈(-)은 자동으로 입력됩니다.</small>
        </label>
      </div>
      <label style="margin-top: 10px;">이메일<input value="${escapeHtml(state.user.email || "")}" readonly></label>
      <label style="margin-top: 10px;">기대평 / 강사에게 하고 싶은 질문(선택)<textarea name="note" placeholder="교육에서 기대하는 점이나 강사에게 미리 묻고 싶은 내용을 적어주세요.">${escapeHtml(defaultNote)}</textarea><small class="muted">작성 내용은 작성자 표시를 일부 가린 뒤 공개됩니다. 연락처나 사적인 정보는 적지 마세요.</small></label>
      <fieldset class="course-notice-signup-options">
        <legend>이 교육의 일정 안내</legend>
        <p class="muted">교육 정보 변경과 교육 시작 전 안내를 받을 채널을 선택하세요. 신청 후에도 교육 상세 또는 나의 정보에서 끌 수 있습니다.</p>
        <div class="course-notice-controls">
          <label><span><input type="checkbox" name="course_email_notice" ${defaultEmailCourseNotice ? "checked" : ""}> 이메일</span></label>
          <label><span><input type="checkbox" name="course_sms_notice" ${defaultSmsCourseNotice ? "checked" : ""}> 문자</span></label>
        </div>
      </fieldset>
      ${applicationPrivacyConsentHtml()}
      <div class="actions" style="margin-top: 12px;">
        <button class="btn" type="submit">${cancelledApplication ? "교육 다시 신청하기" : "교육 신청하기"}</button>
        <span class="badge green">다음 신청 때 이름과 전화번호가 자동 입력됩니다</span>
      </div>
    </form>
  `;
}

function isGenericSessionTitle(value) {
  return /^\s*(?:\d+\s*강|교육)\s*$/u.test(String(value || ""));
}

function courseSessionListHtml(course) {
  const sessions = course.sessions.length
    ? course.sessions
    : [{ starts_at: course.starts_at, ends_at: course.ends_at, room: course.venue?.name || "" }];
  return sessions.map((session, index) => {
    const title = !isGenericSessionTitle(session.title) ? String(session.title || "").trim() : "";
    const endsAt = session.ends_at || (index === 0 ? course.ends_at : "");
    return `
      <li>
        ${title ? `<strong class="session-title">${escapeHtml(title)}</strong>` : ""}
        <strong class="session-schedule">${escapeHtml(formatSchedule(session.starts_at, endsAt, { includeYear: true }))}</strong>
        ${session.room || course.venue?.name ? `<span class="session-room">${escapeHtml(session.room || course.venue?.name || "")}</span>` : ""}
      </li>
    `;
  }).join("");
}

function courseSeriesSectionHtml(course) {
  if (!course?.series_id || course.seriesTotal < 2) return "";
  const linkedCourses = state.composedCourses
    .filter((item) => item.series_id === course.series_id)
    .slice()
    .sort((a, b) => Number(a.series_order || 0) - Number(b.series_order || 0));
  if (linkedCourses.length < 2) return "";
  return `
    <div class="section series-section" style="grid-column: 1 / -1;">
      <div class="row-top">
        <h3>연강 교육</h3>
        <span class="badge series-badge">현재 ${course.seriesPosition}/${course.seriesTotal}</span>
      </div>
      <ol class="series-course-list">
        ${linkedCourses.map((linkedCourse, index) => `
          <li class="${linkedCourse.id === course.id ? "current" : ""}">
            <button type="button" data-open-course="${escapeHtml(linkedCourse.id)}" ${linkedCourse.id === course.id ? "aria-current=\"true\"" : ""}>
              <span class="series-course-number">${index + 1}</span>
              <span class="series-course-copy">
                <strong>${escapeHtml(linkedCourse.title || "교육명 없음")}</strong>
                ${linkedCourse.subtitle ? `<small>${escapeHtml(linkedCourse.subtitle)}</small>` : ""}
                <small>${escapeHtml(formatSchedule(courseScheduleStart(linkedCourse), courseScheduleEnd(linkedCourse)))}</small>
              </span>
              <span class="badge ${getStatusClass(linkedCourse.status)}">${linkedCourse.id === course.id ? "현재" : escapeHtml(statusLabels[linkedCourse.status] || linkedCourse.status)}</span>
            </button>
          </li>
        `).join("")}
      </ol>
    </div>
  `;
}

function openCourseDetail(courseId) {
  const course = state.composedCourses.find((item) => item.id === courseId);
  if (!course) return;
  state.activeCourseId = courseId;
  const orgSlug = course.organization?.slug || "";
  const orgName = course.organization?.name || "";
  const orgWebsiteUrl = normalizeSafeUrl(course.organization?.website_url, URL_RULES.external);
  const instructorProfileUrl = normalizeSafeUrl(course.instructor?.profile_url, URL_RULES.external);
  const kakaoUrl = kakaoMapUrl(course.venue);
  const naverUrl = naverPlaceUrl(course.venue);
  const canApply = canApplyToCourse(course);
  const canReview = canWriteReviewForCourse(course);
  const canAddCalendar = !["finished", "cancelled"].includes(course.status);
  const reviewEditorHtml = renderReviewForm(course);
  const postCourseContentHtml = canShowPostCourseContent(course)
    ? `
      <div class="section">
        <h3>후기 ${course.reviews.length}개</h3>
        <ul class="review-list">${renderReviews(course)}</ul>
      </div>
      <div class="section">
        <h3>사진·영상·자료</h3>
        <div class="media-grid">
          ${course.archives.length ? course.archives.map((item) => archiveMediaHtml(item)).join("") : `<p class="muted">등록된 사진·영상·자료가 없습니다.</p>`}
        </div>
      </div>
    `
    : "";

  elements.detailBadges.innerHTML = `
    <span class="badge ${getStatusClass(course.status)}">${escapeHtml(statusLabels[course.status] || course.status)}</span>
    ${course.topic ? `<span class="badge">${escapeHtml(course.topic)}</span>` : ""}
    ${courseSeriesBadgeHtml(course)}
    <span class="badge gray">${orgSlug ? `<button class="badge-link" type="button" data-open-organization="${escapeHtml(orgSlug)}">${escapeHtml(orgName)}</button>` : escapeHtml(orgName)}</span>
  `;
  elements.detailTitle.textContent = course.title;
  elements.detailBody.innerHTML = `
    ${course.subtitle ? `<p class="detail-subtitle">${escapeHtml(course.subtitle)}</p>` : ""}
    <div class="detail-grid">
      <div class="section">
        <h3>교육 정보</h3>
        <p>${escapeHtml(course.description || course.summary || "")}</p>
        <ul class="session-list">
          ${courseSessionListHtml(course)}
        </ul>
        <div class="actions" style="margin-top: 14px;">
          ${canApply ? `<button class="btn small" type="button" data-apply-course="${course.id}">신청하기</button>` : `<button class="btn small secondary" type="button" disabled>신청 마감</button>`}
          ${canAddCalendar ? `<button class="btn small secondary" type="button" data-add-calendar="${course.id}">캘린더 등록</button>` : ""}
          ${canReview ? `<button class="btn small secondary" type="button" data-login-for-review>${currentReviewForCourse(course.id) ? "내 후기 수정" : "후기 쓰기"}</button>` : ""}
        </div>
      </div>
      <aside class="section">
        <h3>강사</h3>
        <p><strong>${course.instructor?.id ? `<button class="text-link" type="button" data-open-instructor="${course.instructor.id}">${escapeHtml(course.instructor.name)}</button>` : escapeHtml(course.instructor?.name || "강사 미정")}</strong> ${escapeHtml(course.instructor?.title || "")}</p>
        ${course.instructor?.bio ? `<p>${escapeHtml(course.instructor.bio)}</p>` : ""}
        <div class="actions" style="margin-top: 10px;">
          ${course.instructor?.id ? `<button class="btn small secondary" type="button" data-open-instructor="${course.instructor.id}">강사 프로필</button>` : ""}
          ${instructorProfileUrl ? `<a class="btn small secondary" href="${escapeHtml(instructorProfileUrl)}" target="_blank" rel="noreferrer">홈페이지/SNS</a>` : ""}
        </div>
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
        <p><strong>${orgSlug ? `<button class="text-link" type="button" data-open-organization="${escapeHtml(orgSlug)}">${escapeHtml(orgName)}</button>` : escapeHtml(orgName || "단체 미정")}</strong></p>
        <p>${escapeHtml(course.organization?.description || "단체 소개가 곧 업데이트됩니다.")}</p>
        ${course.organization?.contact_email ? `<p class="muted">연락처: ${escapeHtml(course.organization.contact_email)}</p>` : ""}
        <div class="actions" style="margin-top: 10px;">
          ${orgSlug ? `<button class="btn small secondary" type="button" data-open-organization="${escapeHtml(orgSlug)}">단체 소개</button>` : ""}
          ${orgWebsiteUrl ? `<a class="btn small secondary" href="${escapeHtml(orgWebsiteUrl)}" target="_blank" rel="noreferrer">홈페이지</a>` : ""}
        </div>
      </div>
      ${courseSeriesSectionHtml(course)}
      <div class="section" id="applicationSection" style="grid-column: 1 / -1;">
        <h3>교육 신청</h3>
        <div class="walk-in-notice"><strong>현장 참여도 가능합니다.</strong><span>사전 신청 없이 교육 당일 현장에서 참여할 수 있습니다. 미리 신청하면 일정 변경과 교육 안내를 받을 수 있습니다.</span></div>
        ${renderApplicationForm(course)}
      </div>
      <div class="section" style="grid-column: 1 / -1;">
        <h3>기대평·질문</h3>
        ${renderCourseExpectations(course)}
      </div>
      ${postCourseContentHtml}
      ${reviewEditorHtml ? `<div class="section" style="grid-column: 1 / -1;">
        <h3>후기 작성</h3>
        ${reviewEditorHtml}
      </div>` : ""}
    </div>
  `;
  openModal(elements.detailModal);
  if (state.guestAccessTokens[course.id] && !Object.prototype.hasOwnProperty.call(state.guestAccessByCourse, course.id)) {
    refreshGuestAccessInOpenCourse(course.id);
  }
}

async function openRequestedCourseFromUrl() {
  const courseId = requestedCourseIdFromUrl();
  if (!courseId) return;
  state.activePage = "courses";
  if (!courseById(courseId)) {
    await ensureFullDataLoaded({ waitForSupplementary: true });
  } else if (!state.supplementaryLoaded) {
    loadSupplementaryData().catch((error) => console.warn("[모두의 인문학] 교육 상세 보조 데이터 확인 필요", error));
  }
  render();
  window.setTimeout(() => {
    if (courseById(courseId)) openCourseDetail(courseId);
    else showToast("연결된 교육 정보를 찾지 못했습니다.");
  }, 0);
}

async function handleApplicationSubmit(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const applicationMode = String(formData.get("application_mode") || (state.user ? "account" : "guest"));
  const courseId = String(formData.get("course_id") || "");
  const course = state.composedCourses.find((item) => item.id === courseId);
  if (!course || !canApplyToCourse(course)) {
    showToast("현재 신청할 수 없는 교육입니다.");
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
    showToast("010으로 시작하는 휴대전화번호 11자리를 입력해 주세요.");
    return;
  }
  if (formData.get("privacy_agreement") !== "on") {
    showToast("교육 신청을 위해 개인정보 수집·이용 동의가 필요합니다.");
    return;
  }
  if (formData.get("age_14_confirmation") !== "on") {
    showToast("온라인 신청을 위해 만 14세 이상임을 확인해 주세요.");
    return;
  }
  const reviewRequestAgreed = formData.get("review_request_agreement") === "on";
  const emailCourseNoticeEnabled = formData.get("course_email_notice") === "on";
  const smsCourseNoticeEnabled = formData.get("course_sms_notice") === "on";

  if (applicationMode === "guest") {
    const email = String(formData.get("email") || "").trim().toLowerCase();
    if (emailCourseNoticeEnabled && !email) {
      showToast("이메일 일정 안내를 받으려면 이메일을 입력해 주세요.");
      form.elements.email?.focus();
      return;
    }
    const submitButton = form.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "신청 중...";
    }
    try {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase.rpc("submit_guest_course_application_v4", {
        p_course_id: course.id,
        p_applicant_name: applicantName,
        p_phone: phone,
        p_email: email || null,
        p_note: note || null,
        p_terms_version: APPLICATION_TERMS_VERSION,
        p_review_request_agreed: reviewRequestAgreed,
        p_age_14_confirmed: true,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.application_id || !rememberGuestAccessToken(course.id, result.access_token)) {
        throw new Error("신청 확인 링크를 저장하지 못했습니다.");
      }

      rememberGuestContact({ applicant_name: applicantName, phone, email });
      let preferenceSaveFailed = false;
      const { error: preferenceError } = await supabase.rpc("set_guest_course_notification_preferences_v1", {
        p_course_id: course.id,
        p_access_token: result.access_token,
        p_email_enabled: emailCourseNoticeEnabled,
        p_sms_enabled: smsCourseNoticeEnabled,
        p_terms_version: COURSE_NOTIFICATION_TERMS_VERSION,
      });
      if (preferenceError) {
        preferenceSaveFailed = true;
        console.error("Guest course notification preferences save after application failed", preferenceError);
      }
      state.guestAccessByCourse[course.id] = { ...result, expectation_body: note || null };
      await loadGuestAccessForCourse(course.id, { force: true });
      if (state.supplementaryLoaded && note) await loadSupplementaryData();
      showToast(preferenceSaveFailed
        ? "교육 신청은 완료됐지만 일정 알림 설정은 저장하지 못했습니다. 확인 링크 화면에서 다시 저장해 주세요."
        : result.result_state === "existing"
        ? "이미 접수된 비회원 신청을 확인했습니다."
        : result.result_state === "reapplied"
          ? "비회원 신청을 다시 접수했습니다. 확인 문자를 보내드립니다."
          : "비회원 교육 신청이 접수되었습니다. 확인 문자를 보내드립니다.");
      openCourseDetail(course.id);
    } catch (error) {
      console.error("Guest course application failed", error);
      const publicMessage = error?.code === "23505"
        ? "같은 전화번호의 신청 정보가 있습니다. 신청자명을 확인하거나 운영자에게 문의해 주세요."
        : error?.code === "22023"
          ? error.message
          : "비회원 신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      showToast(publicMessage);
    } finally {
      if (submitButton && document.body.contains(submitButton)) {
        submitButton.disabled = false;
        submitButton.textContent = "비회원으로 신청하기";
      }
    }
    return;
  }

  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }
  if (userApplicationForCourse(courseId)) {
    showToast("이미 이 교육을 신청했습니다.");
    return;
  }
  const cancelledApplication = cancelledApplicationForCourse(courseId);
  const supabase = await getSupabaseClient();
  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "신청 중...";
  }

  try {
    const { data, error } = await supabase.rpc("submit_my_course_application_v3", {
      p_course_id: course.id,
      p_applicant_name: applicantName,
      p_phone: phone,
      p_note: note || null,
      p_terms_version: APPLICATION_TERMS_VERSION,
      p_review_request_agreed: reviewRequestAgreed,
      p_age_14_confirmed: true,
    });
    if (error) throw error;
    const application = Array.isArray(data) ? data[0] : data;
    if (!application?.application_id) throw new Error("신청 저장 결과를 확인하지 못했습니다.");

    let preferenceSaveFailed = false;
    const { error: preferenceError } = await supabase.rpc("set_my_course_notification_preferences", {
      p_application_id: application.application_id,
      p_email_enabled: emailCourseNoticeEnabled,
      p_sms_enabled: smsCourseNoticeEnabled,
      p_terms_version: COURSE_NOTIFICATION_TERMS_VERSION,
    });
    if (preferenceError) {
      preferenceSaveFailed = true;
      console.error("Course notification preferences save after application failed", preferenceError);
    }

    await loadApplicationState(supabase);
    void requestNotificationDispatch(supabase, "course_application", application.application_id);
    showToast(preferenceSaveFailed
      ? "교육 신청은 완료됐지만 일정 알림 설정은 저장하지 못했습니다. 아래 알림 설정을 다시 확인해 주세요."
      : application.result_state === "existing"
        ? "이미 접수된 교육 신청과 알림 설정을 확인했습니다."
        : application.result_state === "reapplied" || cancelledApplication
          ? "교육을 다시 신청했습니다. 확인 메일과 문자를 보내드립니다."
          : "교육 신청이 접수되었습니다. 확인 메일과 문자를 보내드립니다.");
    openCourseDetail(course.id);
  } catch (error) {
    if (error?.code === "23505") {
      showToast("신청자 정보를 저장하지 못했습니다. 이전에 사용한 로그인 계정이 있다면 그 계정으로 다시 시도하거나 운영자에게 문의해 주세요.");
    } else if (error?.code === "22023") {
      showToast(error.message || "신청 정보를 다시 확인해 주세요.");
    } else {
      console.error("Course application failed", error);
      showToast(cancelledApplication
        ? "교육 재신청을 저장하지 못했습니다. 신청 가능 시간을 확인한 뒤 다시 시도해 주세요."
        : "교육 신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    await loadApplicationState(supabase);
    openCourseDetail(course.id);
  } finally {
    if (submitButton && document.body.contains(submitButton)) {
      submitButton.disabled = false;
      submitButton.textContent = cancelledApplication ? "다시 신청하기" : "신청하기";
    }
  }
}

async function handleCourseNotificationPreferencesSubmit(event) {
  event.preventDefault();
  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }
  const form = getSubmitForm(event);
  if (!form) return;
  const applicationId = String(form.elements.application_id?.value || "");
  const application = state.applications.find((item) => item.id === applicationId && !isCancelledApplication(item));
  if (!application) {
    showToast("알림을 변경할 교육 신청을 찾지 못했습니다.");
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "저장 중...";
  }
  try {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.rpc("set_my_course_notification_preferences", {
      p_application_id: applicationId,
      p_email_enabled: form.elements.email_enabled?.checked === true,
      p_sms_enabled: form.elements.sms_enabled?.checked === true,
      p_terms_version: COURSE_NOTIFICATION_TERMS_VERSION,
    });
    if (error) throw error;
    await loadApplicationState(supabase);
    if (elements.profileModal.classList.contains("open") && elements.profileEyebrow.textContent === "나의 정보") openMyInfo();
    if (elements.detailModal.classList.contains("open") && state.activeCourseId) openCourseDetail(state.activeCourseId);
    showToast("이 교육의 이메일·문자 알림 설정을 저장했습니다.");
  } catch (error) {
    console.error("Course notification preferences save failed", error);
    showToast(error?.message || "교육별 알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  } finally {
    if (submitButton && document.body.contains(submitButton)) {
      submitButton.disabled = false;
      submitButton.textContent = "알림 저장";
    }
  }
}

async function handleGuestCourseNotificationPreferencesSubmit(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const courseId = String(form.elements.course_id?.value || "");
  const accessToken = validGuestAccessToken(state.guestAccessTokens[courseId]);
  if (!courseId || !accessToken || !activeGuestAccessForCourse(courseId)) {
    showToast("비회원 신청 확인 링크를 다시 열어 주세요.");
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "저장 중...";
  }
  try {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.rpc("set_guest_course_notification_preferences_v1", {
      p_course_id: courseId,
      p_access_token: accessToken,
      p_email_enabled: form.elements.email_enabled?.checked === true,
      p_sms_enabled: form.elements.sms_enabled?.checked === true,
      p_terms_version: COURSE_NOTIFICATION_TERMS_VERSION,
    });
    if (error) throw error;
    await loadGuestAccessForCourse(courseId, { force: true });
    if (elements.detailModal.classList.contains("open") && state.activeCourseId === courseId) openCourseDetail(courseId);
    showToast("이 교육의 이메일·문자 알림 설정을 저장했습니다.");
  } catch (error) {
    console.error("Guest course notification preferences save failed", error);
    showToast(error?.message || "비회원 교육별 알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  } finally {
    if (submitButton && document.body.contains(submitButton)) {
      submitButton.disabled = false;
      submitButton.textContent = "알림 저장";
    }
  }
}

async function handleApplicationNoteSubmit(event) {
  event.preventDefault();
  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }
  const form = getSubmitForm(event);
  if (!form) return;
  const applicationId = String(form.elements.application_id?.value || "");
  const note = String(form.elements.note?.value || "").trim();
  if (note.length > 1000) {
    showToast("기대평/질문은 1000자 이내로 적어주세요.");
    return;
  }
  const application = state.applications.find((item) => item.id === applicationId);
  if (!canEditApplicationNote(application)) {
    showToast("현재 이 신청에는 기대평/질문을 수정할 수 없습니다.");
    return;
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc("update_my_application_note", {
    p_application_id: applicationId,
    p_note: note || null,
  });
  if (error || data !== true) {
    console.error("Application note update failed", error);
    showToast("기대평/질문을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }

  await loadApplicationState(supabase);
  if (state.supplementaryLoaded) await loadSupplementaryData();
  showToast(note ? "기대평/질문을 저장했습니다." : "기대평/질문을 비웠습니다.");
  if (elements.detailModal.classList.contains("open") && state.activeCourseId) openCourseDetail(state.activeCourseId);
  if (elements.profileModal.classList.contains("open") && elements.profileEyebrow.textContent === "나의 정보") {
    openMyInfo();
  }
}

async function handleApplicationNoteDelete(button) {
  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }

  const applicationId = button.dataset.deleteApplicationNote;
  const application = state.applications.find((item) => item.id === applicationId);
  if (!canDeleteApplicationNote(application)) {
    showToast("삭제할 기대평/질문을 찾지 못했습니다.");
    return;
  }

  if (button.dataset.confirmDelete !== "true") {
    const defaultDeleteLabel = button.dataset.defaultLabel || button.textContent;
    button.dataset.defaultLabel = defaultDeleteLabel;
    button.dataset.confirmDelete = "true";
    button.textContent = "한 번 더 누르면 삭제";
    window.setTimeout(() => {
      if (button.dataset.confirmDelete === "true") {
        button.dataset.confirmDelete = "false";
        button.textContent = defaultDeleteLabel;
      }
    }, 3000);
    return;
  }

  button.disabled = true;
  button.textContent = "삭제 중...";
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc("update_my_application_note", {
    p_application_id: applicationId,
    p_note: null,
  });
  if (error || data !== true) {
    console.error("Application note delete failed", error);
    showToast("기대평/질문을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    button.disabled = false;
    button.textContent = button.dataset.defaultLabel || "삭제";
    return;
  }

  await loadApplicationState(supabase);
  if (state.supplementaryLoaded) await loadSupplementaryData();
  showToast("기대평/질문을 삭제했습니다.");
  if (elements.detailModal.classList.contains("open") && state.activeCourseId) openCourseDetail(state.activeCourseId);
  if (elements.profileModal.classList.contains("open") && elements.profileEyebrow.textContent === "나의 정보") {
    openMyInfo();
  }
}

async function handleGuestApplicationNoteDelete(button) {
  const course = state.composedCourses.find((item) => item.id === state.activeCourseId);
  const accessToken = validGuestAccessToken(state.guestAccessTokens[course?.id]);
  if (!course || !accessToken) {
    showToast("비회원 신청 확인 링크를 다시 열어 주세요.");
    return;
  }

  if (button.dataset.confirmDelete !== "true") {
    button.dataset.confirmDelete = "true";
    button.textContent = "한 번 더 누르면 삭제";
    window.setTimeout(() => {
      if (button.dataset.confirmDelete === "true") {
        button.dataset.confirmDelete = "false";
        button.textContent = "기대평·질문 삭제";
      }
    }, 3000);
    return;
  }

  button.disabled = true;
  button.textContent = "삭제 중...";
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc("delete_guest_application_note_v2", {
    p_course_id: course.id,
    p_access_token: accessToken,
  });
  if (error || data !== true) {
    console.error("Guest application note delete failed", error);
    showToast("기대평/질문을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    button.disabled = false;
    button.textContent = "기대평·질문 삭제";
    return;
  }

  await loadGuestAccessForCourse(course.id, { force: true });
  if (state.supplementaryLoaded) await loadSupplementaryData();
  showToast("기대평/질문을 삭제했습니다.");
  openCourseDetail(course.id);
}

async function handleCancelApplication(button) {
  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }

  const applicationId = button.dataset.cancelApplication;
  if (!applicationId) return;

  const course = state.composedCourses.find((item) => item.id === state.activeCourseId);
  if (course && !canApplyToCourse(course)) {
    openCourseDetail(course.id);
    return;
  }

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

  void requestNotificationDispatch(supabase, "course_application", applicationId);
  await loadApplicationState(supabase);
  showToast("교육 신청을 취소했습니다. 취소 완료 메일과 문자를 보내드립니다.");
  if (state.activeCourseId) openCourseDetail(state.activeCourseId);
  if (elements.profileModal.classList.contains("open") && elements.profileEyebrow.textContent === "나의 정보") {
    openMyInfo();
  }
}

async function handleGuestApplicationCancel(button) {
  const course = state.composedCourses.find((item) => item.id === state.activeCourseId);
  const accessToken = validGuestAccessToken(state.guestAccessTokens[course?.id]);
  if (!course || !accessToken || !canApplyToCourse(course)) {
    if (course) openCourseDetail(course.id);
    return;
  }

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
  const { data, error } = await supabase.rpc("cancel_guest_course_application_v2", {
    p_course_id: course.id,
    p_access_token: accessToken,
  });
  if (error || data !== true) {
    console.error("Guest application cancel failed", error);
    showToast("비회원 신청을 취소하지 못했습니다. 신청 정보와 교육 시간을 확인해 주세요.");
    button.disabled = false;
    button.textContent = "신청 취소";
    return;
  }

  await loadGuestAccessForCourse(course.id, { force: true });
  showToast("비회원 교육 신청을 취소했습니다. 취소 완료 문자를 보내드리며 같은 정보로 다시 신청할 수 있습니다.");
  openCourseDetail(course.id);
}

async function handleGuestReviewAccessSubmit(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  const course = state.composedCourses.find((item) => item.id === state.activeCourseId);
  if (!form || !course) return;

  const applicantName = String(form.elements.applicant_name?.value || "").trim();
  const phone = normalizePhone(form.elements.phone?.value || "");
  if (!applicantName || !isValidPhone(phone)) {
    showToast("신청자명과 010 휴대전화번호 11자리를 확인해 주세요.");
    return;
  }

  const button = form.querySelector("button[type='submit']");
  if (button) {
    button.disabled = true;
    button.textContent = "확인 중...";
  }
  try {
    rememberGuestContact({
      applicant_name: applicantName,
      phone,
      email: state.guestContact?.email || "",
    });
    const access = await loadGuestAccessForCourse(course.id, { force: true });
    if (!access || access.application_status === "cancelled") {
      showToast("일치하는 비회원 신청 또는 현장 참석 정보를 찾지 못했습니다.");
      return;
    }
    if (!access.attendance_confirmed_at) {
      showToast("신청은 확인했지만 아직 관리자의 참석 확인이 완료되지 않았습니다.");
      return;
    }
    showToast("참석 정보를 확인했습니다. 후기를 작성해 주세요.");
    openCourseDetail(course.id);
  } finally {
    if (button && document.body.contains(button)) {
      button.disabled = false;
      button.textContent = "참석 확인하고 후기 쓰기";
    }
  }
}

async function handleReviewSubmit(event) {
  event.preventDefault();
  const course = state.composedCourses.find((item) => item.id === state.activeCourseId);
  const form = getSubmitForm(event);
  if (!course || !form) return;
  const reviewIdentity = String(form.elements.review_identity?.value || "user");
  const body = form.elements.body.value.trim();
  if (body.length < 10) {
    showToast("후기는 10자 이상 입력해주세요.");
    return;
  }

  const supabase = await getSupabaseClient();
  const reviewId = String(form.elements.review_id?.value || "");
  if (reviewIdentity === "guest") {
    const accessToken = validGuestAccessToken(state.guestAccessTokens[course.id]);
    const access = activeGuestAccessForCourse(course.id);
    if (!accessToken || !access?.attendance_confirmed_at) {
      showToast("신청 확인 문자에 포함된 안전한 링크로 참석 정보를 다시 확인해 주세요.");
      return;
    }
    const { error } = await supabase.rpc("save_guest_review_v2", {
      p_course_id: course.id,
      p_access_token: accessToken,
      p_body: body,
    });
    if (error) {
      console.error("Guest review submission failed", error);
      showToast(["22023", "42501"].includes(error?.code)
        ? error.message
        : "비회원 후기를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    showToast(reviewId ? "후기를 수정했습니다." : "후기가 등록되었습니다.");
    await loadGuestAccessForCourse(course.id, { force: true });
    await loadData({ waitForSupplementary: true });
    openCourseDetail(course.id);
    return;
  }

  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }
  const application = activeApplicationForCourse(course.id);
  if (!application || !isAttendanceConfirmed(application)) {
    showToast("참석 인증이 완료된 뒤 후기를 작성할 수 있습니다.");
    return;
  }

  const request = reviewId
    ? supabase.rpc("update_my_review", { p_review_id: reviewId, p_body: body })
    : supabase.from("reviews").insert({
      course_id: course.id,
      user_id: state.user.id,
      author_name: getReviewAuthorName(state.user),
      body,
    });
  const { data, error } = await request;

  if (error || (reviewId && data !== true)) {
    if (error?.code === "23505") showToast("이미 이 교육에 후기를 작성했습니다.");
    else {
      console.error("Review submission failed", error);
      showToast(reviewId ? "후기를 수정하지 못했습니다. 잠시 후 다시 시도해 주세요." : "후기를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    return;
  }

  showToast(reviewId ? "후기를 수정했습니다." : "후기가 등록되었습니다.");
  await loadData({ waitForSupplementary: true });
  await loadApplicationState(supabase);
  openCourseDetail(course.id);
}

async function handleReviewDelete(button) {
  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }

  const reviewId = button.dataset.deleteReview;
  if (!reviewId) return;

  if (button.dataset.confirmDelete !== "true") {
    button.dataset.confirmDelete = "true";
    button.textContent = "한 번 더 누르면 삭제됩니다";
    window.setTimeout(() => {
      if (button.dataset.confirmDelete === "true") {
        button.dataset.confirmDelete = "false";
        button.textContent = "후기 삭제";
      }
    }, 3000);
    return;
  }

  button.disabled = true;
  button.textContent = "삭제 중...";
  const courseId = state.activeCourseId;
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc("delete_my_review", { p_review_id: reviewId });
  if (error || data !== true) {
    console.error("Review delete failed", error);
    showToast("후기를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    button.disabled = false;
    button.textContent = "후기 삭제";
    return;
  }

  showToast("후기를 삭제했습니다.");
  await loadData({ waitForSupplementary: true });
  await loadApplicationState(supabase);
  if (courseId) openCourseDetail(courseId);
  if (elements.profileModal.classList.contains("open") && elements.profileEyebrow.textContent === "나의 정보") {
    openMyInfo();
  }
}

async function handleGuestReviewDelete(button) {
  const course = state.composedCourses.find((item) => item.id === state.activeCourseId);
  const accessToken = validGuestAccessToken(state.guestAccessTokens[course?.id]);
  if (!course || !accessToken) return;

  if (button.dataset.confirmDelete !== "true") {
    button.dataset.confirmDelete = "true";
    button.textContent = "한 번 더 누르면 삭제됩니다";
    window.setTimeout(() => {
      if (button.dataset.confirmDelete === "true") {
        button.dataset.confirmDelete = "false";
        button.textContent = "후기 삭제";
      }
    }, 3000);
    return;
  }

  button.disabled = true;
  button.textContent = "삭제 중...";
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc("delete_guest_review_v2", {
    p_course_id: course.id,
    p_access_token: accessToken,
  });
  if (error || data !== true) {
    console.error("Guest review delete failed", error);
    showToast("비회원 후기를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    button.disabled = false;
    button.textContent = "후기 삭제";
    return;
  }

  showToast("후기를 삭제했습니다.");
  await loadGuestAccessForCourse(course.id, { force: true });
  await loadData({ waitForSupplementary: true });
  openCourseDetail(course.id);
}

async function handleDemographicsSubmit(event) {
  event.preventDefault();
  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }
  const form = getSubmitForm(event);
  if (!form) return;

  const formData = new FormData(form);
  const residenceDistrict = String(formData.get("residence_district") || "").trim();
  const residenceNeighborhood = String(formData.get("residence_neighborhood") || "").trim();
  const birthYearRaw = String(formData.get("birth_year") || "").trim();
  const gender = String(formData.get("gender") || "").trim();
  const maritalStatus = String(formData.get("marital_status") || "").trim();
  const childrenCountRaw = String(formData.get("children_count") || "").trim();
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Seoul" }).format(new Date()));
  const birthYear = birthYearRaw ? Number(birthYearRaw) : null;
  const childrenCount = childrenCountRaw ? Number(childrenCountRaw) : null;

  if (!residenceDistrict && !residenceNeighborhood && birthYear === null && !gender && !maritalStatus && childrenCount === null) {
    showToast("저장할 선택 항목을 하나 이상 입력해 주세요.");
    return;
  }
  if (Boolean(residenceDistrict) !== Boolean(residenceNeighborhood)) {
    showToast("거주지역은 주소검색으로 읍·면·동까지 선택하거나 비워 주세요.");
    return;
  }
  if (birthYear !== null && (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > currentYear)) {
    showToast(`출생연도는 1900년부터 ${currentYear}년 사이로 입력해 주세요.`);
    return;
  }
  if (childrenCount !== null && (!Number.isInteger(childrenCount) || childrenCount < 0 || childrenCount > 20)) {
    showToast("자녀 수는 0명부터 20명 사이로 입력해 주세요.");
    return;
  }
  if (formData.get("optional_consent") !== "on") {
    showToast("선택 정보 수집·이용 동의를 확인해 주세요.");
    return;
  }

  const supabase = await getSupabaseClient();
  const { error } = await supabase.from("user_demographics").upsert({
    user_id: state.user.id,
    residence_district: residenceDistrict || null,
    residence_neighborhood: residenceNeighborhood || null,
    birth_year: birthYear,
    gender: gender || null,
    marital_status: maritalStatus || null,
    children_count: childrenCount,
    optional_consent_at: new Date().toISOString(),
    terms_version: DEMOGRAPHICS_TERMS_VERSION,
  }, { onConflict: "user_id" });
  if (error) {
    console.error("Demographics save failed", error);
    showToast("선택 이용자 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }

  await loadApplicationState(supabase);
  render();
  openMyInfo();
  showToast("선택 이용자 정보를 저장했습니다.");
}

async function handleDemographicsDelete(button) {
  if (!state.user || !state.demographics) return;
  if (button.dataset.confirmDelete !== "true") {
    button.dataset.confirmDelete = "true";
    button.textContent = "한 번 더 누르면 삭제됩니다";
    window.setTimeout(() => {
      if (button.dataset.confirmDelete === "true") {
        button.dataset.confirmDelete = "false";
        button.textContent = "선택 정보 삭제";
      }
    }, 3000);
    return;
  }

  const supabase = await getSupabaseClient();
  const { error } = await supabase.from("user_demographics").delete().eq("user_id", state.user.id);
  if (error) {
    console.error("Demographics delete failed", error);
    showToast("선택 이용자 정보를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }
  state.demographics = null;
  render();
  openMyInfo();
  showToast("선택 이용자 정보를 삭제했습니다.");
}

function addInterestSubscription(button) {
  const targetType = String(button.dataset.targetType || "");
  const targetKey = String(button.dataset.targetKey || "");
  const option = allInterestOptions().find((item) => (
    item.target_type === targetType && item.target_key === targetKey
  ));
  if (!option) {
    showToast("추가할 관심 대상을 찾지 못했습니다.");
    return;
  }
  if (state.interestSubscriptions.some((subscription) => (
    subscription.target_type === targetType && subscription.target_key === targetKey
  ))) {
    showToast("이미 추가한 관심 대상입니다.");
    return;
  }

  state.interestSubscriptions.push({
    target_type: option.target_type,
    target_key: option.target_key,
    target_label: option.label,
    target_description: option.description || "",
    email_enabled: true,
    sms_enabled: false,
  });
  state.interestSearch = "";
  openMyInfo();
  window.setTimeout(() => document.querySelector("[data-interest-search]")?.focus(), 0);
  showToast("관심 대상을 추가했습니다. 채널을 확인한 뒤 설정을 저장해 주세요.");
}

function removeInterestSubscription(button) {
  const row = button.closest("[data-interest-row]");
  if (!row) return;
  const targetType = row.dataset.targetType || "";
  const targetKey = row.dataset.targetKey || "";
  state.interestSubscriptions = state.interestSubscriptions.filter((subscription) => !(
    subscription.target_type === targetType && subscription.target_key === targetKey
  ));
  openMyInfo();
  showToast("관심 대상을 삭제했습니다. 설정 저장을 누르면 반영됩니다.");
}

async function handleInterestNotificationsSubmit(event) {
  event.preventDefault();
  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }
  const form = getSubmitForm(event);
  if (!form) return;
  const rows = [...form.querySelectorAll("[data-interest-row]")];
  const subscriptions = rows.map((row) => ({
    target_type: String(row.dataset.targetType || ""),
    target_key: String(row.dataset.targetKey || ""),
    email_enabled: row.querySelector('[data-interest-channel="email"]')?.checked === true,
    sms_enabled: row.querySelector('[data-interest-channel="sms"]')?.checked === true,
  }));
  if (subscriptions.some((subscription) => !subscription.email_enabled && !subscription.sms_enabled)) {
    showToast("각 관심 항목에서 이메일이나 문자 중 하나 이상을 선택해 주세요. 알림을 받지 않을 항목은 삭제할 수 있습니다.");
    return;
  }
  if (subscriptions.length && form.elements.interest_consent?.checked !== true) {
    showToast("관심 알림 수신 동의를 확인해 주세요.");
    form.elements.interest_consent?.focus();
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "저장 중...";
  }
  try {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.rpc("replace_my_interest_subscriptions", {
      p_subscriptions: subscriptions,
      p_consent_version: INTEREST_NOTIFICATION_CONSENT_VERSION,
    });
    if (error) throw error;
    await loadApplicationState(supabase);
    openMyInfo();
    showToast(subscriptions.length ? "관심 알림 설정을 저장했습니다." : "관심 알림을 모두 해지했습니다.");
  } catch (error) {
    console.error("Interest notification settings save failed", error);
    showToast(error?.message || "관심 알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  } finally {
    if (submitButton && document.body.contains(submitButton)) {
      submitButton.disabled = false;
      submitButton.textContent = "관심 알림 설정 저장";
    }
  }
}

function takeInterestUnsubscribeToken() {
  const match = window.location.hash.match(/^#unsubscribe-interest=([0-9a-f-]{36})$/i);
  if (!match || !UUID_PATTERN.test(match[1])) return "";
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#courses`);
  return match[1];
}

async function processInterestUnsubscribe(token) {
  if (!token) return;
  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.rpc("unsubscribe_interest_notifications", { p_token: token });
    if (error) throw error;
    showToast(data === true
      ? "관심 강사·주제 알림을 모두 해지했습니다."
      : "해지 링크가 만료되었거나 올바르지 않습니다. 로그인 후 나의 정보에서 설정을 확인해 주세요.");
  } catch (error) {
    console.error("Interest notification unsubscribe failed", error);
    showToast("관심 알림을 해지하지 못했습니다. 로그인 후 나의 정보에서 다시 시도해 주세요.");
  }
}

function contentTypeLabel(contentType) {
  if (contentType === "review") return "후기";
  if (contentType === "expectation") return "기대평·질문";
  return "콘텐츠";
}

function openReportModal(contentType, contentId) {
  if (!state.user) {
    showToast("신고하려면 이메일 인증이 필요합니다.");
    openModal(elements.loginModal);
    return;
  }
  if (!contentId || !["review", "expectation"].includes(contentType)) {
    showToast("신고할 콘텐츠 정보를 찾지 못했습니다.");
    return;
  }

  elements.reportForm.reset();
  elements.reportForm.elements.content_type.value = contentType;
  elements.reportForm.elements.content_id.value = contentId;
  elements.reportTitle.textContent = `${contentTypeLabel(contentType)}를 신고하시겠습니까?`;
  elements.reportDescription.textContent = "신고가 접수되면 관리자가 내용을 확인한 뒤 숨김, 삭제 등 필요한 조치를 합니다.";
  openModal(elements.reportModal);
}

async function handleReportSubmit(event) {
  event.preventDefault();
  if (!state.user) {
    openModal(elements.loginModal);
    return;
  }

  const form = getSubmitForm(event);
  if (!form) return;
  const contentType = String(form.elements.content_type?.value || "");
  const contentId = String(form.elements.content_id?.value || "");
  const reason = String(form.elements.reason?.value || "").trim();
  if (!contentType || !contentId) {
    showToast("신고할 콘텐츠 정보를 찾지 못했습니다.");
    return;
  }
  if (reason.length > 500) {
    showToast("신고 사유는 500자 이내로 적어주세요.");
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "신고 중...";
  }

  try {
    const supabase = await getSupabaseClient();
    const { data: reportId, error } = await supabase.rpc("submit_content_report", {
      p_content_type: contentType,
      p_content_id: contentId,
      p_reason: reason || null,
    });
    if (error) throw error;
    void requestNotificationDispatch(supabase, "content_report", reportId);
    closeModal(elements.reportModal);
    showToast("신고가 접수되었습니다.");
  } catch (error) {
    console.error("Content report failed", error);
    showToast("신고를 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "신고하기";
    }
  }
}

function updateSessionUi(user) {
  state.user = user || null;
  elements.loginButton.textContent = state.user ? `${getReviewAuthorName(state.user)}님` : "로그인";
  elements.loginButton.setAttribute("aria-label", state.user ? "나의 정보 보기" : "로그인");
  elements.loginStatus.textContent = state.user ? `${getReviewAuthorName(state.user)}님으로 로그인되었습니다.` : "로그인 전입니다.";
  elements.logoutButton.hidden = !state.user;
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

function rememberOAuthReturnState() {
  const returnState = {
    hash: window.location.hash || "",
    courseId: state.activeCourseId || requestedCourseIdFromUrl() || "",
  };
  try {
    window.sessionStorage.setItem(OAUTH_RETURN_STATE_KEY, JSON.stringify(returnState));
  } catch (error) {
    console.warn("[모두의 인문학] Google 로그인 복귀 위치 저장 실패", error);
  }
}

function takeOAuthReturnState() {
  try {
    const raw = window.sessionStorage.getItem(OAUTH_RETURN_STATE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(OAUTH_RETURN_STATE_KEY);
    const parsed = JSON.parse(raw);
    return {
      hash: typeof parsed?.hash === "string" && parsed.hash.startsWith("#") ? parsed.hash : "",
      courseId: typeof parsed?.courseId === "string" ? parsed.courseId : "",
    };
  } catch (error) {
    console.warn("[모두의 인문학] Google 로그인 복귀 위치 확인 실패", error);
    return null;
  }
}

async function handleGoogleLogin() {
  const button = elements.googleLoginButton;
  button.disabled = true;
  rememberOAuthReturnState();
  try {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getCurrentUrlWithoutHash(),
      },
    });
    if (error) throw error;
  } catch (error) {
    window.sessionStorage.removeItem(OAUTH_RETURN_STATE_KEY);
    console.error("Google login failed", error);
    showToast("Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    button.disabled = false;
  }
}

async function handleLogout() {
  const supabase = await getSupabaseClient();
  await supabase.auth.signOut();
  await refreshSession(supabase);
  closeModal(elements.profileModal);
  showToast("로그아웃했습니다.");
}

function startAuthMonitor() {
  let authSyncQueue = Promise.resolve();

  async function syncAuth(supabase, session) {
    const user = session?.user || null;
    updateSessionUi(user);
    if (user) await loadApplicationState(supabase);
    else clearApplicationState();
    const oauthReturnState = user ? takeOAuthReturnState() : null;
    if (oauthReturnState?.hash && window.location.hash !== oauthReturnState.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${oauthReturnState.hash}`);
      applyRouteFromHash();
    }
    render();
    if (oauthReturnState?.courseId) {
      await ensureFullDataLoaded({ waitForSupplementary: true });
      if (courseById(oauthReturnState.courseId)) openCourseDetail(oauthReturnState.courseId);
    }
    if (elements.detailModal.classList.contains("open") && state.activeCourseId) {
      openCourseDetail(state.activeCourseId);
    }
    if (elements.profileModal.classList.contains("open") && elements.profileEyebrow.textContent === "나의 정보") {
      openMyInfo();
    }
  }

  getSupabaseClient()
    .then((supabase) => {
      supabase.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => {
          authSyncQueue = authSyncQueue
            .then(() => syncAuth(supabase, session))
            .catch((error) => {
              console.warn("[모두의 인문학] 로그인 상태 반영 지연", error);
              updateSessionUi(null);
              clearApplicationState();
              render();
            });
        }, 0);
      });
    })
    .catch((error) => {
      console.warn("[모두의 인문학] 로그인 모듈 준비 지연", error);
      updateSessionUi(null);
      clearApplicationState();
    });
}

function bindEvents() {
  elements.courseFilters.addEventListener("submit", async (event) => {
    event.preventDefault();
    await applyCourseFilters();
  });
  elements.searchResetButton.addEventListener("click", resetCourseFilters);

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });

  document.body.addEventListener("click", async (event) => {
    const routeControl = event.target.closest("[data-route]");
    const openButton = event.target.closest("[data-open-course]");
    const organizationButton = event.target.closest("[data-open-organization]");
    const instructorButton = event.target.closest("[data-open-instructor]");
    const instructorCoursesButton = event.target.closest("[data-open-instructor-courses]");
    const calendarButton = event.target.closest("[data-add-calendar]");
    const closeButton = event.target.closest("[data-close-modal]");
    const loginForReview = event.target.closest("[data-login-for-review]");
    const loginForApplication = event.target.closest("[data-login-for-application]");
    const applyButton = event.target.closest("[data-apply-course]");
    const cancelApplicationButton = event.target.closest("[data-cancel-application]");
    const cancelGuestApplicationButton = event.target.closest("[data-cancel-guest-application]");
    const archivePhotoButton = event.target.closest("[data-open-archive-photo]");
    const deleteReviewButton = event.target.closest("[data-delete-review]");
    const deleteGuestReviewButton = event.target.closest("[data-delete-guest-review]");
    const deleteApplicationNoteButton = event.target.closest("[data-delete-application-note]");
    const deleteGuestApplicationNoteButton = event.target.closest("[data-delete-guest-application-note]");
    const deleteDemographicsButton = event.target.closest("[data-delete-demographics]");
    const openDemographicsButton = event.target.closest("[data-open-demographics]");
    const dismissDemographicsButton = event.target.closest("[data-dismiss-demographics]");
    const searchResidenceButton = event.target.closest("[data-search-residence]");
    const clearResidenceButton = event.target.closest("[data-clear-residence]");
    const reportButton = event.target.closest("[data-report-content]");
    const addInterestButton = event.target.closest("[data-add-interest]");
    const removeInterestButton = event.target.closest("[data-remove-interest]");
    if (addInterestButton) {
      addInterestSubscription(addInterestButton);
      return;
    }
    if (removeInterestButton) {
      removeInterestSubscription(removeInterestButton);
      return;
    }
    if (searchResidenceButton) {
      openResidencePostcodeSearch(searchResidenceButton);
      return;
    }
    if (clearResidenceButton) {
      clearResidenceSelection(clearResidenceButton);
      return;
    }
    if (routeControl) {
      event.preventDefault();
      const route = routeControl.dataset.route;
      if (route !== "courses") {
        await ensureFullDataLoaded({ waitForSupplementary: pageNeedsSupplementaryData(route) });
      }
      navigate(route);
      return;
    }
    if (reportButton) {
      openReportModal(reportButton.dataset.reportContent, reportButton.dataset.reportId);
      return;
    }
    if (organizationButton) {
      await ensureFullDataLoaded();
      navigate("organization", organizationButton.dataset.openOrganization);
      return;
    }
    if (instructorButton) {
      openInstructorProfile(instructorButton.dataset.openInstructor);
      return;
    }
    if (instructorCoursesButton) {
      await ensureFullDataLoaded();
      navigate("instructor", instructorCoursesButton.dataset.openInstructorCourses);
      return;
    }
    if (calendarButton) {
      const course = state.composedCourses.find((item) => item.id === calendarButton.dataset.addCalendar);
      if (course) downloadCalendar(course);
      return;
    }
    if (applyButton) {
      document.getElementById("applicationSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (cancelApplicationButton) {
      handleCancelApplication(cancelApplicationButton).catch((error) => showToast(`신청 취소 실패: ${error.message}`));
      return;
    }
    if (cancelGuestApplicationButton) {
      handleGuestApplicationCancel(cancelGuestApplicationButton).catch((error) => showToast(`비회원 신청 취소 실패: ${error.message}`));
      return;
    }
    if (deleteReviewButton) {
      handleReviewDelete(deleteReviewButton).catch((error) => showToast(`후기 삭제 실패: ${error.message}`));
      return;
    }
    if (deleteGuestReviewButton) {
      handleGuestReviewDelete(deleteGuestReviewButton).catch((error) => showToast(`후기 삭제 실패: ${error.message}`));
      return;
    }
    if (deleteApplicationNoteButton) {
      handleApplicationNoteDelete(deleteApplicationNoteButton).catch((error) => showToast(`기대평/질문 삭제 실패: ${error.message}`));
      return;
    }
    if (deleteGuestApplicationNoteButton) {
      handleGuestApplicationNoteDelete(deleteGuestApplicationNoteButton).catch((error) => showToast(`기대평/질문 삭제 실패: ${error.message}`));
      return;
    }
    if (deleteDemographicsButton) {
      handleDemographicsDelete(deleteDemographicsButton).catch((error) => showToast(`선택 정보 삭제 실패: ${error.message}`));
      return;
    }
    if (openDemographicsButton) {
      openMyInfo();
      window.setTimeout(() => document.getElementById("demographicsSection")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      return;
    }
    if (dismissDemographicsButton) {
      try {
        window.sessionStorage.setItem(DEMOGRAPHIC_BANNER_DISMISS_KEY, "true");
      } catch (error) {
        console.warn("[모두의 인문학] 선택 정보 안내 숨김 저장 실패", error);
      }
      renderDemographicBanner();
      return;
    }
    if (archivePhotoButton) {
      openArchivePhoto(archivePhotoButton.dataset.openArchivePhoto);
      return;
    }
    if (openButton) {
      closeModal(elements.profileModal);
      await ensureFullDataLoaded({ waitForSupplementary: true });
      openCourseDetail(openButton.dataset.openCourse);
      return;
    }
    if (closeButton) closeModal(closeButton.closest(".modal"));
    if (loginForReview) {
      const reviewForm = document.getElementById("reviewForm") || document.getElementById("guestReviewAccessForm");
      if (reviewForm) reviewForm.scrollIntoView({ behavior: "smooth", block: "start" });
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
    const interestSearchInput = event.target.closest("[data-interest-search]");
    if (interestSearchInput) {
      state.interestSearch = interestSearchInput.value;
      const results = interestSearchInput.closest("#interestNotificationsForm")?.querySelector("[data-interest-search-results]");
      if (results) results.innerHTML = renderInterestSearchResults(state.interestSearch);
      return;
    }
    const phoneInput = event.target.closest("#applicationForm input[name='phone'], #guestReviewAccessForm input[name='phone']");
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
    if (event.target.id === "guestReviewAccessForm") return handleGuestReviewAccessSubmit(event);
    if (event.target.id === "demographicsForm") return handleDemographicsSubmit(event);
    if (event.target.id === "interestNotificationsForm") return handleInterestNotificationsSubmit(event);
    if (event.target.matches("[data-course-notification-form]")) return handleCourseNotificationPreferencesSubmit(event);
    if (event.target.matches("[data-guest-course-notification-form]")) return handleGuestCourseNotificationPreferencesSubmit(event);
    if (event.target.matches("[data-application-note-form]")) return handleApplicationNoteSubmit(event);
    if (event.target.id === "reviewForm") return handleReviewSubmit(event);
    if (event.target.id === "reportForm") return handleReportSubmit(event);
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
  elements.googleLoginButton.addEventListener("click", handleGoogleLogin);
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.logoutButton.addEventListener("click", handleLogout);
  window.addEventListener("message", handleResidenceSearchMessage);
  window.addEventListener("hashchange", async () => {
    applyRouteFromHash();
    if (state.activePage !== "courses") {
      await ensureFullDataLoaded({ waitForSupplementary: pageNeedsSupplementaryData(state.activePage) });
    }
    render();
  });
}

async function initialize() {
  state.guestContact = readGuestContact();
  state.guestAccessTokens = readGuestAccessTokens();
  captureGuestAccessTokenFromUrl();
  const interestUnsubscribeToken = takeInterestUnsubscribeToken();
  applyRouteFromHash();
  bindEvents();
  await processInterestUnsubscribe(interestUnsubscribeToken);
  await loadLandingData();
  if (state.activePage !== "courses") {
    await ensureFullDataLoaded({ waitForSupplementary: pageNeedsSupplementaryData(state.activePage) });
  }
  await openRequestedCourseFromUrl();
  startAuthMonitor();
}

initialize().catch((error) => {
  console.error("Public page initialization failed", error);
  elements.resultSummary.textContent = "현재 표시할 교육이 없습니다.";
  elements.courseResults.innerHTML = `<div class="empty">등록된 교육이 없습니다.</div>`;
});
