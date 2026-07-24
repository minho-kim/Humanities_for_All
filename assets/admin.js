import {
  ARCHIVE_BUCKET,
  ATTENDANCE_DOCUMENT_BUCKET,
  SITE_MEDIA_BUCKET,
  escapeHtml,
  formatDateTime,
  getCurrentUrlWithoutHash,
  getDisplayName,
  normalizeSafeUrl,
  randomPick,
  requireSafeUrl,
  shortDate,
  statusLabels,
  supabase,
  URL_RULES,
} from "./supabaseClient.js";

const state = {
  tab: "dashboard",
  user: null,
  adminProfile: null,
  adminProfileError: null,
  organizationAdminLinks: [],
  organizationAdmins: [],
  organizationAdminsError: "",
  organizationAdminsLoading: false,
  isLoggingIn: false,
  isPasswordRecovery: false,
  applicationFilters: {
    courseId: "",
    applicantQuery: "",
  },
  expectationFilters: {
    courseId: "",
  },
  walkInSearch: {
    courseId: "",
    query: "",
    candidates: [],
    isLoading: false,
    error: "",
  },
  adminSelections: {
    organizationId: "",
    instructorId: "",
    venueId: "",
    courseId: "",
  },
  adminSearch: {
    organization: "",
    instructor: "",
    venue: "",
    course: "",
  },
  coursePicker: {
    kind: "",
    query: "",
  },
  courseFilterPicker: {
    target: "",
    query: "",
  },
  courseTemplate: {
    query: "",
    sourceCourseId: "",
    sourceTitle: "",
    draft: null,
  },
  courseManagement: {
    mode: "courses",
    seriesQuery: "",
    selectedSeriesId: "",
    draftPreviousCourseId: "",
    createQuery: "",
    createCourseIds: [],
  },
  dashboardStatsSearch: {
    organization: "",
    instructor: "",
  },
  selectedArchiveId: "",
  organizations: [],
  instructors: [],
  venues: [],
  courses: [],
  sessions: [],
  archives: [],
  applications: [],
  attendanceDocuments: [],
  reviews: [],
  contentReports: [],
  draws: [],
  winners: [],
  smsDeliveries: [],
  demographicSummary: null,
};

const elements = {
  adminLoginForm: document.getElementById("adminLoginForm"),
  adminEmail: document.getElementById("adminEmail"),
  adminPassword: document.getElementById("adminPassword"),
  adminPasswordResetButton: document.getElementById("adminPasswordResetButton"),
  adminEmailHelp: document.getElementById("adminEmailHelp"),
  adminPasswordUpdateForm: document.getElementById("adminPasswordUpdateForm"),
  adminNewPassword: document.getElementById("adminNewPassword"),
  adminNewPasswordConfirm: document.getElementById("adminNewPasswordConfirm"),
  adminLogoutButton: document.getElementById("adminLogoutButton"),
  adminStatus: document.getElementById("adminStatus"),
  permissionNotice: document.getElementById("permissionNotice"),
  adminContent: document.getElementById("adminContent"),
  refreshButton: document.getElementById("refreshButton"),
  adminNoticeModal: document.getElementById("adminNoticeModal"),
  adminNoticeTitle: document.getElementById("adminNoticeTitle"),
  adminNoticeBody: document.getElementById("adminNoticeBody"),
  toast: document.getElementById("toast"),
};

const SITE_IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);
const SITE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ARCHIVE_FILE_TYPES = new Map([
  ["image/jpeg", { extension: ".jpg", type: "photo" }],
  ["image/png", { extension: ".png", type: "photo" }],
  ["image/webp", { extension: ".webp", type: "photo" }],
  ["image/gif", { extension: ".gif", type: "photo" }],
  ["image/heic", { extension: ".heic", type: "photo" }],
  ["image/heif", { extension: ".heif", type: "photo" }],
  ["application/pdf", { extension: ".pdf", type: "file" }],
]);
const ARCHIVE_FILE_MAX_BYTES = 15 * 1024 * 1024;
const ATTENDANCE_DOCUMENT_TYPES = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"],
  ["image/tiff", ".tiff"],
]);
const ATTENDANCE_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
const ADMIN_SEARCH_LIMIT = 10;
const COURSE_NOTIFICATION_TERMS_VERSION = "2026-07-24-v2";
const COURSE_PICKER_LIMIT = 12;
const SMS_TEST_MESSAGE = "[모두의 인문학] 문자 발송 연동 테스트입니다.";
const rosterNameSorter = new Intl.Collator("ko-KR", {
  numeric: true,
  sensitivity: "base",
});
const FINISHED_COURSE_DELETE_EXCEPTIONS = new Set(["테스트교육", "테스트교육2"]);

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 3000);
}

function openModal(modal) {
  modal.classList.add("open");
  const focusTarget = modal.querySelector("button, input, textarea, select");
  if (focusTarget) focusTarget.focus();
}

function closeModal(modal) {
  modal.classList.remove("open");
}

function openAdminNotice(title, bodyHtml) {
  elements.adminNoticeTitle.textContent = title;
  elements.adminNoticeBody.innerHTML = bodyHtml;
  openModal(elements.adminNoticeModal);
}

function setLoginBusy(isBusy) {
  const button = elements.adminLoginForm.querySelector("button[type='submit']");
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? "로그인 중..." : "로그인";
}

function updateAdminLoginFormVisibility() {
  const isSignedIn = Boolean(state.user);
  elements.adminLoginForm.querySelectorAll("label, button[type='submit']").forEach((element) => {
    element.classList.toggle("hidden", isSignedIn);
  });
  elements.adminPasswordResetButton?.classList.toggle("hidden", isSignedIn);
  elements.adminEmailHelp?.classList.toggle("hidden", isSignedIn);
  elements.adminLogoutButton.classList.toggle("hidden", !isSignedIn);
  elements.adminPasswordUpdateForm?.classList.toggle("hidden", !state.isPasswordRecovery);
}

function isAdmin() {
  return Boolean(state.user && (isOwner() || state.organizationAdminLinks.length));
}

function isOwner() {
  return state.adminProfile?.role === "owner";
}

function managedOrganizationIds() {
  return new Set(state.organizationAdminLinks.map((link) => link.organization_id).filter(Boolean));
}

function canAccessAdminTab(tab) {
  if (isOwner()) return true;
  return ["dashboard", "organizations", "venues", "courses", "applications", "expectations", "archive", "reviews", "reports"].includes(tab);
}

function updateAdminNavigationVisibility() {
  document.querySelectorAll("[data-owner-only]").forEach((element) => {
    element.classList.toggle("hidden", !isOwner());
  });
  if (!canAccessAdminTab(state.tab)) state.tab = "dashboard";
}

function isPasswordSetupUrl() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const authType = hashParams.get("type") || queryParams.get("type");
  return authType === "recovery" || authType === "invite";
}

function optionList(items, selectedId = "") {
  return items.map((item) => `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name || item.title)}</option>`).join("");
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function itemMatchesSearch(item, query, textBuilder) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeSearchText(textBuilder(item));
  return normalizedQuery.split(" ").every((token) => haystack.includes(token));
}

function searchItems(items, query, textBuilder, limit = ADMIN_SEARCH_LIMIT) {
  return items
    .filter((item) => itemMatchesSearch(item, query, textBuilder))
    .slice(0, limit);
}

function courseName(courseId) {
  return state.courses.find((course) => course.id === courseId)?.title || "교육 미정";
}

function courseById(courseId) {
  return state.courses.find((course) => course.id === courseId);
}

function coursesInSeries(seriesId) {
  if (!seriesId) return [];
  return state.courses
    .filter((course) => course.series_id === seriesId)
    .slice()
    .sort((a, b) => {
      const orderDifference = Number(a.series_order || 0) - Number(b.series_order || 0);
      if (orderDifference) return orderDifference;
      return new Date(a.starts_at || 0) - new Date(b.starts_at || 0);
    });
}

function courseSeriesPosition(course) {
  if (!course?.series_id) return null;
  const courses = coursesInSeries(course.series_id);
  const index = courses.findIndex((item) => item.id === course.id);
  return index >= 0 ? { position: index + 1, total: courses.length } : null;
}

function isLastSeriesCourse(course) {
  if (!course?.series_id) return true;
  return coursesInSeries(course.series_id).at(-1)?.id === course.id;
}

function courseSeriesGroups() {
  const groups = new Map();
  state.courses.forEach((course) => {
    if (!course.series_id) return;
    if (!groups.has(course.series_id)) groups.set(course.series_id, []);
    groups.get(course.series_id).push(course);
  });

  return [...groups.entries()]
    .map(([id, courses]) => ({
      id,
      courses: courses.slice().sort((a, b) => {
        const orderDifference = Number(a.series_order || 0) - Number(b.series_order || 0);
        if (orderDifference) return orderDifference;
        return new Date(a.starts_at || 0) - new Date(b.starts_at || 0);
      }),
    }))
    .filter((series) => series.courses.length >= 2)
    .sort((a, b) => new Date(a.courses[0]?.starts_at || 0) - new Date(b.courses[0]?.starts_at || 0));
}

function courseSeriesSearchText(series) {
  return [
    "연강",
    ...series.courses.flatMap((course) => [courseSearchText(course), course.series_order]),
  ].join(" ");
}

function courseSeriesOrganizationLabel(series) {
  const names = [...new Set(series.courses
    .map((course) => organizationById(course.organization_id)?.name)
    .filter(Boolean))];
  return names.join(" · ") || "단체 미정";
}

function organizationById(organizationId) {
  return state.organizations.find((organization) => organization.id === organizationId);
}

function instructorById(instructorId) {
  return state.instructors.find((instructor) => instructor.id === instructorId);
}

function venueById(venueId) {
  return state.venues.find((venue) => venue.id === venueId);
}

function canManageVenue(venue) {
  if (isOwner()) return true;
  return Boolean(venue?.organization_id && managedOrganizationIds().has(venue.organization_id));
}

function venueOwnershipLabel(venue) {
  if (!venue?.organization_id) return "공용 장소";
  const organization = organizationById(venue.organization_id);
  if (organization?.name) return `${organization.name} 장소`;
  if (managedOrganizationIds().has(venue.organization_id)) return "담당 단체 장소";
  return "다른 단체 장소";
}

function instructorSearchText(instructor) {
  return [
    instructor.name,
    instructor.title,
    instructor.bio,
    instructor.profile_url,
    instructor.is_active === false ? "숨김 비공개" : "사용 공개",
  ].join(" ");
}

function venueSearchText(venue) {
  return [
    venue.name,
    venue.address,
    venue.detail,
    venue.kakao_map_url,
    venue.naver_place_url,
    venue.is_online ? "온라인" : "오프라인",
    venueOwnershipLabel(venue),
  ].join(" ");
}

function organizationSearchText(organization) {
  return [
    organization.name,
    organization.slug,
    organization.description,
    organization.website_url,
    organization.contact_email,
    organization.is_active === false ? "숨김 비공개" : "사용 공개",
  ].join(" ");
}

function courseSearchText(course) {
  const organization = organizationById(course.organization_id);
  const instructor = instructorById(course.instructor_id);
  const venue = venueById(course.venue_id);
  const status = effectiveCourseStatus(course);
  return [
    course.title,
    course.subtitle,
    course.topic,
    course.summary,
    course.description,
    statusLabels[status],
    organization?.name,
    instructor?.name,
    instructor?.title,
    instructor?.bio,
    venue?.name,
    venue?.address,
    shortDate(course.starts_at),
  ].join(" ");
}

function archiveById(archiveId) {
  return state.archives.find((archive) => archive.id === archiveId);
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

function hasCourseTimeEnded(startsAt, endsAt) {
  if (endsAt) return new Date(endsAt).getTime() <= Date.now();
  return hasNoExplicitCourseEndElapsed(startsAt);
}

function hasCourseDateArrived(course) {
  const courseDate = seoulDateKey(course?.starts_at);
  if (!courseDate) return false;
  return courseDate <= seoulDateKey(new Date());
}

function hasCourseStarted(course) {
  if (!course?.starts_at) return false;
  return new Date(course.starts_at).getTime() <= Date.now();
}

function hasCourseEnded(course) {
  if (course?.status === "finished") return true;
  if (!course?.starts_at) return false;
  return hasCourseTimeEnded(course.starts_at, course.ends_at);
}

function effectiveCourseStatus(course) {
  if (!course) return "";
  if (course.status === "cancelled") return "cancelled";
  if (course.status === "finished" || hasCourseEnded(course)) return "finished";
  return "open";
}

function archiveTypeLabel(type) {
  if (type === "photo") return "사진";
  if (type === "video") return "영상";
  if (type === "file") return "자료";
  return "링크";
}

function attendanceDocumentsForCourse(courseId) {
  return state.attendanceDocuments.filter((document) => document.course_id === courseId);
}

function applicationCountBadges(applications) {
  return `<span class="badge green">참가자 ${applications.length}</span>`;
}

function isActiveApplication(application) {
  return application.status !== "cancelled";
}

function activeApplications() {
  return state.applications.filter(isActiveApplication);
}

function normalizedIdentifier(value) {
  return String(value || "").trim();
}

function normalizedTimestamp(value) {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? String(timestamp) : String(value);
}

function courseChangeNotificationPlan(existingCourse, payload) {
  if (!existingCourse?.id || existingCourse.status === "cancelled") return null;

  const changedLabels = [];
  if (String(existingCourse.title || "").trim() !== String(payload.title || "").trim()) changedLabels.push("교육명");
  if (
    normalizedTimestamp(existingCourse.starts_at) !== normalizedTimestamp(payload.starts_at)
    || normalizedTimestamp(existingCourse.ends_at) !== normalizedTimestamp(payload.ends_at)
  ) changedLabels.push("일시");
  if (normalizedIdentifier(existingCourse.venue_id) !== normalizedIdentifier(payload.venue_id)) changedLabels.push("장소");
  if (normalizedIdentifier(existingCourse.instructor_id) !== normalizedIdentifier(payload.instructor_id)) changedLabels.push("강사");
  if (!changedLabels.length) return null;

  const wasRelevant = !hasCourseEnded(existingCourse);
  const willBeRelevant = !hasCourseTimeEnded(payload.starts_at, payload.ends_at);
  if (!wasRelevant && !willBeRelevant) return null;

  const recipientCount = activeApplications().filter((application) => application.course_id === existingCourse.id).length;
  if (!recipientCount) return null;
  return {
    changedLabels,
    recipientCount,
    affectedCourses: [existingCourse],
  };
}

function hasMaterialVenueChange(existingVenue, payload) {
  if (!existingVenue?.id) return false;
  return ["name", "address", "detail"].some(
    (key) => String(existingVenue[key] || "").trim() !== String(payload[key] || "").trim(),
  ) || Boolean(existingVenue.is_online) !== Boolean(payload.is_online);
}

function venueChangeNotificationPlan(existingVenue, payload, impact = null) {
  if (!existingVenue?.id) return null;
  if (!hasMaterialVenueChange(existingVenue, payload)) return null;

  const affectedCourses = state.courses.filter((course) => (
    course.venue_id === existingVenue.id
    && course.status !== "cancelled"
    && !hasCourseEnded(course)
    && activeApplications().some((application) => application.course_id === course.id)
  ));
  const recipientCount = Number(impact?.recipient_count || 0);
  if (!recipientCount) return null;
  return {
    changedLabels: ["장소명·주소·세부 장소"],
    recipientCount,
    affectedCourses,
    affectedCourseCount: Number(impact?.affected_course_count || affectedCourses.length),
  };
}

async function loadVenueChangeImpact(venueId) {
  if (!venueId) return null;
  const { data, error } = await supabase.rpc("get_managed_venue_change_impact", {
    p_venue_id: venueId,
  }).single();
  if (error) throw error;
  return data || null;
}

function requireChangeNotificationConfirmation(form, plan) {
  if (!plan) return false;
  if (form.dataset.changeNotificationConfirmed === "true") {
    delete form.dataset.changeNotificationConfirmed;
    return false;
  }

  const affectedCourseCount = Number(plan.affectedCourseCount || plan.affectedCourses.length);
  const courseItems = plan.affectedCourses.slice(0, 5).map((course) => (
    `<li><strong>${escapeHtml(course.title || "교육명 없음")}</strong> · ${escapeHtml(shortDate(course.starts_at))}</li>`
  )).join("");
  const remainingCourseCount = Math.max(0, affectedCourseCount - Math.min(5, plan.affectedCourses.length));
  openAdminNotice(
    "신청자 변경 안내",
    `
      <p><strong>${escapeHtml(plan.changedLabels.join(", "))}</strong> 정보가 변경됩니다.</p>
      <p>저장하면 관련 교육 ${escapeHtml(affectedCourseCount)}개, 활성 신청 ${escapeHtml(plan.recipientCount)}건에 변경 안내 메일·문자가 등록됩니다.</p>
      ${courseItems || remainingCourseCount ? `<ul>${courseItems}${remainingCourseCount ? `<li>그 외 ${escapeHtml(remainingCourseCount)}개 교육</li>` : ""}</ul>` : ""}
      <p class="muted">변경 전·후 내용을 함께 안내하며, 즉시 발송에 실패해도 예약 작업이 자동으로 다시 시도합니다.</p>
      <div class="actions" style="margin-top: 16px;">
        <button class="btn" type="button" data-confirm-change-notification="${escapeHtml(form.id)}">저장하고 안내 등록</button>
      </div>
    `,
  );
  return true;
}

async function requestCourseChangeNotificationDispatch() {
  const { data, error } = await supabase.functions.invoke("notification-dispatch", {
    body: { action: "dispatch_actor_course_changes" },
  });
  if (error) {
    console.warn("[모두의 인문학] 교육 변경 안내 즉시 발송 요청 실패", error);
    return null;
  }
  return data || null;
}

function visibleReviews() {
  return state.reviews.filter(isReviewPublic);
}

function isReviewPublic(review) {
  return review?.is_hidden !== true && review?.verification_status !== "rejected";
}

function reviewVisibilityLabel(review) {
  return isReviewPublic(review) ? "공개" : "숨김";
}

function reviewVisibilityClass(review) {
  return isReviewPublic(review) ? "green" : "red";
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function formatDecimal(value, digits = 1) {
  const number = Number(value || 0);
  return number.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${formatDecimal(Number(value) * 100, 1)}%`;
}

function courseIdsSet(courses) {
  return new Set(courses.map((course) => course.id).filter(Boolean));
}

function applicationsForCourseIds(courseIds) {
  return activeApplications().filter((application) => courseIds.has(application.course_id));
}

function reviewsForCourseIds(courseIds) {
  return visibleReviews().filter((review) => courseIds.has(review.course_id));
}

function attendanceCount(applications) {
  return applications.filter((application) => Boolean(application.attendance_confirmed_at)).length;
}

function courseAttendanceRate(courseId) {
  const applications = applicationsForCourseIds(new Set([courseId]));
  if (!applications.length) return null;
  return attendanceCount(applications) / applications.length;
}

function average(values) {
  const valid = values.filter((value) => value !== null && value !== undefined && !Number.isNaN(Number(value)));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + Number(value), 0) / valid.length;
}

const ORGANIZATION_METRIC_HEADERS = ["단체", "등록 교육", "총 신청자", "평균 신청자", "참석 확인", "참석률", "후기", "교육당 후기"];
const INSTRUCTOR_METRIC_HEADERS = ["강사", "교육", "총 신청자", "총 참석자", "평균 참석률", "후기", "교육당 후기", "연결 단체"];

function organizationStats() {
  return state.organizations.map((organization) => {
    const courses = state.courses.filter((course) => course.organization_id === organization.id);
    const courseIds = courseIdsSet(courses);
    const applications = applicationsForCourseIds(courseIds);
    const attended = attendanceCount(applications);
    const reviews = reviewsForCourseIds(courseIds);
    return {
      name: organization.name || "단체명 없음",
      courseCount: courses.length,
      applicationCount: applications.length,
      averageApplications: courses.length ? applications.length / courses.length : 0,
      attendedCount: attended,
      attendanceRate: applications.length ? attended / applications.length : null,
      reviewCount: reviews.length,
      averageReviews: courses.length ? reviews.length / courses.length : 0,
    };
  }).sort((a, b) => b.courseCount - a.courseCount || b.applicationCount - a.applicationCount || a.name.localeCompare(b.name, "ko"));
}

function instructorStats() {
  const rows = state.instructors.map((instructor) => {
    const courses = state.courses.filter((course) => course.instructor_id === instructor.id);
    const courseIds = courseIdsSet(courses);
    const applications = applicationsForCourseIds(courseIds);
    const attended = attendanceCount(applications);
    const reviews = reviewsForCourseIds(courseIds);
    const connectedOrganizationCount = new Set(courses.map((course) => course.organization_id).filter(Boolean)).size;
    return {
      name: `${instructor.name || "이름 없음"}${instructor.title ? ` · ${instructor.title}` : ""}`,
      courseCount: courses.length,
      applicationCount: applications.length,
      attendedCount: attended,
      averageAttendanceRate: average(courses.map((course) => courseAttendanceRate(course.id))),
      reviewCount: reviews.length,
      averageReviews: courses.length ? reviews.length / courses.length : 0,
      connectedOrganizationCount,
    };
  });
  return (isOwner() ? rows : rows.filter((item) => item.courseCount > 0))
    .sort((a, b) => b.courseCount - a.courseCount || b.applicationCount - a.applicationCount || a.name.localeCompare(b.name, "ko"));
}

function organizationMetricRows(items = organizationStats()) {
  return items.map((item) => [
    item.name,
    formatNumber(item.courseCount),
    formatNumber(item.applicationCount),
    formatDecimal(item.averageApplications),
    formatNumber(item.attendedCount),
    formatPercent(item.attendanceRate),
    formatNumber(item.reviewCount),
    formatDecimal(item.averageReviews),
  ]);
}

function instructorMetricRows(items = instructorStats()) {
  return items.map((item) => [
    item.name,
    formatNumber(item.courseCount),
    formatNumber(item.applicationCount),
    formatNumber(item.attendedCount),
    formatPercent(item.averageAttendanceRate),
    formatNumber(item.reviewCount),
    formatDecimal(item.averageReviews),
    formatNumber(item.connectedOrganizationCount),
  ]);
}

function metricTable(headers, rows, emptyText) {
  if (!rows.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return `
    <div class="metric-table-wrap">
      <table class="metric-table">
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td class="${index === 0 ? "" : "numeric"}">${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function dashboardMetricConfig(kind) {
  if (kind === "organization") {
    return {
      title: "단체별 운영 통계",
      label: "단체 검색",
      placeholder: "단체명을 입력하세요",
      query: state.dashboardStatsSearch.organization,
      headers: ORGANIZATION_METRIC_HEADERS,
      items: organizationStats(),
      rowsFor: organizationMetricRows,
      emptyText: "검색어에 맞는 단체 통계가 없습니다.",
      guideText: "단체명을 검색하면 해당 단체의 운영 통계만 표시됩니다.",
      filename: "모두의인문학_단체별_운영통계.csv",
    };
  }
  return {
    title: "강사별 운영 통계",
    label: "강사 검색",
    placeholder: "강사명이나 직함을 입력하세요",
    query: state.dashboardStatsSearch.instructor,
    headers: INSTRUCTOR_METRIC_HEADERS,
    items: instructorStats(),
    rowsFor: instructorMetricRows,
    emptyText: "검색어에 맞는 강사 통계가 없습니다.",
    guideText: "강사명이나 직함을 검색하면 해당 강사의 운영 통계만 표시됩니다.",
    filename: "모두의인문학_강사별_운영통계.csv",
  };
}

function filteredDashboardMetricItems(kind) {
  const config = dashboardMetricConfig(kind);
  const query = normalizeSearchText(config.query);
  if (!query) return [];
  return config.items.filter((item) => itemMatchesSearch(item, query, (value) => value.name));
}

function dashboardMetricResultsHtml(kind) {
  const config = dashboardMetricConfig(kind);
  if (!normalizeSearchText(config.query)) return `<div class="empty compact-empty">${escapeHtml(config.guideText)}</div>`;
  return metricTable(config.headers, config.rowsFor(filteredDashboardMetricItems(kind)), config.emptyText);
}

function renderDashboardMetricSection(kind) {
  const config = dashboardMetricConfig(kind);
  return `
    <div class="section" style="margin-top: 16px;">
      <div class="row-top">
        <div>
          <h3>${escapeHtml(config.title)}</h3>
          <p class="muted">숨김 처리되지 않은 후기와 취소되지 않은 신청을 기준으로 계산합니다.</p>
        </div>
        <button class="btn small secondary" type="button" data-download-dashboard-stats="${escapeHtml(kind)}">전체 엑셀 다운로드</button>
      </div>
      <label class="dashboard-stat-search">${escapeHtml(config.label)}
        <input type="search" data-dashboard-stat-search="${escapeHtml(kind)}" value="${escapeHtml(config.query)}" placeholder="${escapeHtml(config.placeholder)}" autocomplete="off">
      </label>
      <div data-dashboard-stat-results="${escapeHtml(kind)}">
        ${dashboardMetricResultsHtml(kind)}
      </div>
    </div>
  `;
}

function updateDashboardMetricResults(kind) {
  const results = document.querySelector(`[data-dashboard-stat-results="${kind}"]`);
  if (!results) return;
  results.innerHTML = dashboardMetricResultsHtml(kind);
}

function safeCsvCell(value) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows]
    .map((row) => row.map(safeCsvCell).join(","))
    .join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadDashboardStats(kind) {
  const config = dashboardMetricConfig(kind);
  downloadCsv(config.filename, config.headers, config.rowsFor(config.items));
}

const REVIEW_KEYWORD_STOPWORDS = new Set([
  "그리고", "하지만", "그래서", "또한", "정말", "너무", "매우", "조금", "많이", "더욱", "아주",
  "있는", "없는", "있어", "있고", "있다", "했다", "하는", "하여", "해서", "하면", "되었", "되었습니다",
  "좋았습니다", "좋았어요", "좋았", "좋은", "좋고", "감사합니다", "감사", "생각", "시간", "오늘",
  "교육", "강의", "수업", "프로그램", "참여", "참석", "후기", "강사", "단체", "이번",
]);

function normalizeReviewKeyword(token) {
  let value = String(token || "").toLowerCase().trim();
  value = value.replace(/(입니다|합니다|했습니다|였습니다|스럽습니다|스럽네요|스럽다|네요|어요|아요|였다|했다|한다|하게|하고|하여|해서)$/u, "");
  value = value.replace(/(으로서|으로써|으로|에서|에게|보다|까지|부터|처럼|만큼|이고|이며|하고|들과|들의|으로|와|과|을|를|이|가|은|는|도|만|의|에|로)$/u, "");
  return value.trim();
}

function reviewKeywordStats(limit = 18) {
  const counts = new Map();
  visibleReviews().forEach((review) => {
    const text = String(review.body || "")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ");
    const tokens = text.match(/[\p{L}\p{N}]{2,}/gu) || [];
    tokens.forEach((token) => {
      const keyword = normalizeReviewKeyword(token);
      if (keyword.length < 2 || REVIEW_KEYWORD_STOPWORDS.has(keyword)) return;
      counts.set(keyword, (counts.get(keyword) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "ko"))
    .slice(0, limit);
}

function renderReviewKeywordChart() {
  const keywords = reviewKeywordStats();
  if (!keywords.length) return `<div class="empty">분석할 후기가 아직 없습니다.</div>`;
  const maxCount = keywords[0].count || 1;
  return `
    <div class="keyword-chart" aria-label="후기 주요 단어">
      ${keywords.map((item) => `
        <div class="keyword-row">
          <span class="keyword-label">${escapeHtml(item.word)}</span>
          <span class="keyword-bar" style="--keyword-width:${Math.max(8, Math.round((item.count / maxCount) * 100))}%"></span>
          <span class="keyword-count">${formatNumber(item.count)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function filteredApplications() {
  const applicantQuery = normalizeSearchText(state.applicationFilters.applicantQuery);
  return activeApplications().filter((application) => {
    if (state.applicationFilters.courseId && application.course_id !== state.applicationFilters.courseId) return false;
    if (applicantQuery && !normalizeSearchText(application.applicant_name).includes(applicantQuery)) return false;
    return true;
  });
}

function applicationGroups(applications) {
  const groupsByCourse = new Map();
  applications.forEach((application) => {
    const key = application.course_id || "unknown";
    if (!groupsByCourse.has(key)) groupsByCourse.set(key, []);
    groupsByCourse.get(key).push(application);
  });

  return [...groupsByCourse.entries()]
    .map(([courseId, groupApplications]) => ({
      courseId,
      course: courseById(courseId),
      applications: groupApplications.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    }))
    .sort((a, b) => {
      const aTime = a.course?.starts_at ? new Date(a.course.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.course?.starts_at ? new Date(b.course.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return courseName(a.courseId).localeCompare(courseName(b.courseId), "ko");
    });
}

function activeApplicationForCourseUser(courseId, userId) {
  return state.applications.find((application) => (
    application.course_id === courseId
    && application.user_id === userId
    && isActiveApplication(application)
  ));
}

function renderAdminCourseNotificationPreferences(application) {
  if (!application || application.status === "cancelled" || application.registration_source === "anonymized") return "";
  const emailAvailable = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(application.email || ""));
  const smsAvailable = application.sms_notice_agreed_at
    && /^010\d{8}$/.test(String(application.phone || "").replace(/\D/g, ""));
  return `
    <form data-admin-course-notification-form class="course-notice-form">
      <input type="hidden" name="application_id" value="${escapeHtml(application.id)}">
      <div>
        <strong>교육별 일정 안내</strong>
        <p class="muted">신청자가 연락해 변경을 요청한 경우에만 이메일·문자를 대신 켜거나 끄세요.</p>
      </div>
      <div class="course-notice-controls">
        <label title="${emailAvailable ? "" : "신청자 이메일이 없습니다."}"><span><input type="checkbox" name="email_enabled" ${application.email_course_notice_enabled === true ? "checked" : ""} ${emailAvailable ? "" : "disabled"}> 이메일</span></label>
        <label title="${smsAvailable ? "" : "유효한 010 번호 또는 문자 안내 동의를 확인하지 못했습니다."}"><span><input type="checkbox" name="sms_enabled" ${application.sms_course_notice_enabled === true ? "checked" : ""} ${smsAvailable ? "" : "disabled"}> 문자</span></label>
      </div>
      <label class="consent-check"><span><input type="checkbox" name="participant_request_confirmed" required style="width:auto;min-height:auto;"> 신청자의 알림 설정 변경 요청을 확인했습니다.</span></label>
      <div class="actions"><button class="btn small secondary" type="submit">알림 설정 저장</button><span class="muted">관리자·변경 전후 값·시각이 감사 기록에 남습니다.</span></div>
    </form>
  `;
}

function renderApplicationRow(application) {
  const attendanceConfirmed = Boolean(application.attendance_confirmed_at);
  const course = courseById(application.course_id);
  const canConfirmAttendance = hasCourseDateArrived(course);
  const sourceLabels = {
    public: "로그인 신청",
    guest: "비회원 신청",
    admin_walk_in: "로그인 현장 등록",
    admin_guest_walk_in: "비회원 현장 등록",
    anonymized: "개인정보 파기 완료",
  };
  const sourceLabel = sourceLabels[application.registration_source] || "신청";
  const sourceBadge = application.registration_source === "guest"
    ? "비회원"
    : application.registration_source === "admin_walk_in"
      ? "현장 등록"
      : application.registration_source === "admin_guest_walk_in"
        ? "비회원 현장 등록"
        : application.registration_source === "anonymized"
          ? "비식별 기록"
          : "";
  return `
    <div class="table-row">
      <div class="row-top">
        <strong>${escapeHtml(application.applicant_name || "신청자")}</strong>
        <span class="badge ${attendanceConfirmed ? "green" : "gray"}">${attendanceConfirmed ? "참석 확인" : "신청"}</span>
        ${sourceBadge ? `<span class="badge gray">${escapeHtml(sourceBadge)}</span>` : ""}
      </div>
      <div class="muted">${escapeHtml(sourceLabel)}일 ${escapeHtml(shortDate(application.created_at))}</div>
      <p class="muted">이메일: ${escapeHtml(application.email || "없음")} · 전화: ${escapeHtml(application.phone || "없음")}</p>
      ${application.note ? `<p><strong>기대평 / 강사에게 하고 싶은 질문</strong><br>${escapeHtml(application.note)}</p>` : ""}
      <p class="muted">개인정보 수집 동의 완료 · 교육별 선택 안내: 이메일 ${application.email_course_notice_enabled === true ? "수신" : "미수신"}, 문자 ${application.sms_course_notice_enabled === true ? "수신" : "미수신"}</p>
      ${renderAdminCourseNotificationPreferences(application)}
      <div class="actions">
        ${attendanceConfirmed
          ? `<span class="badge green">참석 확인 ${escapeHtml(shortDate(application.attendance_confirmed_at))}</span>
             <button class="btn small secondary" type="button" data-unconfirm-attendance="${escapeHtml(application.id)}">참석 확인 취소</button>`
          : `<button class="btn small" type="button" data-confirm-attendance="${escapeHtml(application.id)}" ${canConfirmAttendance ? "" : "disabled"}>${canConfirmAttendance ? "참석 확인" : "교육일 전"}</button>`}
      </div>
    </div>
  `;
}

function applicationsWithNotes() {
  return activeApplications()
    .filter((application) => String(application.note || "").trim())
    .slice()
    .sort((a, b) => {
      const aCourse = courseById(a.course_id);
      const bCourse = courseById(b.course_id);
      const aCourseTime = aCourse?.starts_at ? new Date(aCourse.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bCourseTime = bCourse?.starts_at ? new Date(bCourse.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (aCourseTime !== bCourseTime) return aCourseTime - bCourseTime;
      return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
    });
}

function filteredExpectationApplications() {
  return applicationsWithNotes().filter((application) => (
    !state.expectationFilters.courseId || application.course_id === state.expectationFilters.courseId
  ));
}

function renderExpectationRow(application) {
  const course = courseById(application.course_id);
  return `
    <div class="table-row">
      <div class="row-top">
        <strong>${escapeHtml(course?.title || "교육 정보")}</strong>
        <span class="badge gray">${escapeHtml(course?.starts_at ? shortDate(course.starts_at) : "일정 미정")}</span>
      </div>
      <p><strong>${escapeHtml(application.applicant_name || "신청자")}</strong> · ${escapeHtml(application.email || "이메일 없음")} · ${escapeHtml(application.phone || "전화 없음")}</p>
      <p><strong>기대평 / 강사에게 하고 싶은 질문</strong><br>${escapeHtml(application.note)}</p>
      <p class="muted">신청일 ${escapeHtml(shortDate(application.created_at))}${application.updated_at ? ` · 마지막 수정 ${escapeHtml(shortDate(application.updated_at))}` : ""}</p>
      <div class="actions">
        <button class="btn small danger" type="button" data-clear-application-note-admin="${escapeHtml(application.id)}">기대평·질문 삭제</button>
      </div>
    </div>
  `;
}

function reportContentTypeLabel(type) {
  if (type === "review") return "후기";
  if (type === "expectation") return "기대평·질문";
  return "콘텐츠";
}

function reportStatusLabel(status) {
  if (status === "resolved") return "처리 완료";
  if (status === "dismissed") return "기각";
  return "접수";
}

function reportStatusClass(status) {
  if (status === "resolved") return "green";
  if (status === "dismissed") return "gray";
  return "red";
}

function reportCourseLabel(report) {
  const course = courseById(report.course_id);
  return course ? `${course.title}${course.starts_at ? ` · ${shortDate(course.starts_at)}` : ""}` : "교육 정보 없음";
}

function sortedContentReports() {
  return state.contentReports.slice().sort((a, b) => {
    const statusWeight = { open: 0, resolved: 1, dismissed: 2 };
    const aWeight = statusWeight[a.status] ?? 0;
    const bWeight = statusWeight[b.status] ?? 0;
    if (aWeight !== bWeight) return aWeight - bWeight;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
}

function renderReportRow(report) {
  return `
    <div class="table-row">
      <div class="row-top">
        <strong>${escapeHtml(reportContentTypeLabel(report.content_type))} 신고</strong>
        <span class="badge ${reportStatusClass(report.status)}">${escapeHtml(reportStatusLabel(report.status))}</span>
      </div>
      <p class="muted">${escapeHtml(reportCourseLabel(report))} · 신고일 ${escapeHtml(shortDate(report.created_at))}</p>
      <p><strong>신고된 내용</strong><br>${escapeHtml(report.content_excerpt)}</p>
      ${report.reason ? `<p><strong>신고 사유</strong><br>${escapeHtml(report.reason)}</p>` : `<p class="muted">신고 사유는 입력되지 않았습니다.</p>`}
      <p class="muted">신고자: ${escapeHtml(report.reporter_email || "이메일 정보 없음")}</p>
      <div class="actions">
        ${report.content_type === "review"
          ? `<button class="btn small danger" type="button" data-review-action="hide" data-review-id="${escapeHtml(report.content_id)}">후기 숨김</button>`
          : `<button class="btn small danger" type="button" data-clear-application-note-admin="${escapeHtml(report.content_id)}">기대평·질문 삭제</button>`}
        <button class="btn small secondary" type="button" data-report-status="resolved" data-report-id="${escapeHtml(report.id)}">처리 완료</button>
        <button class="btn small secondary" type="button" data-report-status="dismissed" data-report-id="${escapeHtml(report.id)}">기각</button>
        ${report.status !== "open" ? `<button class="btn small secondary" type="button" data-report-status="open" data-report-id="${escapeHtml(report.id)}">다시 접수</button>` : ""}
      </div>
    </div>
  `;
}

function phoneLastFour(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.slice(-4);
}

function formatMobilePhone(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function isValidMobilePhone(value) {
  return /^010\d{8}$/.test(String(value || "").replace(/\D/g, ""));
}

function compareRosterApplications(a, b) {
  const nameCompare = rosterNameSorter.compare(a.applicant_name || "", b.applicant_name || "");
  if (nameCompare !== 0) return nameCompare;

  const emailCompare = rosterNameSorter.compare(a.email || "", b.email || "");
  if (emailCompare !== 0) return emailCompare;

  return new Date(a.created_at || 0) - new Date(b.created_at || 0);
}

function printApplicationRoster(courseId) {
  const course = courseById(courseId);
  const applications = activeApplications()
    .filter((application) => application.course_id === courseId)
    .slice()
    .sort(compareRosterApplications);

  const title = courseName(courseId);
  const totalRowCount = Math.max(30, applications.length + 10);
  const blankRowCount = totalRowCount - applications.length;
  const densePrintClass = totalRowCount >= 40 ? "dense" : "";
  const rows = Array.from({ length: totalRowCount }, (_, index) => {
    const application = applications[index];
    return `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(title)}</td>
      <td>${escapeHtml(application?.applicant_name || "")}</td>
      <td>${escapeHtml(phoneLastFour(application?.phone))}</td>
      <td class="signature"></td>
    </tr>
  `;
  }).join("");
  const printWindow = window.open("", "_blank", "width=980,height=720");
  if (!printWindow) {
    showToast("팝업 차단을 해제한 뒤 다시 시도해 주세요.");
    return;
  }

  printWindow.document.write(`<!doctype html>
    <html lang="ko">
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(title)} 참가자 명단</title>
      <style>
        @page { size: A4 portrait; margin: 12mm; }
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #111; }
        h1 { margin: 0 0 6px; font-size: 22px; }
        p { margin: 0 0 14px; color: #555; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        thead { display: table-header-group; }
        tr { break-inside: avoid; page-break-inside: avoid; }
        th, td { border: 1px solid #222; padding: 9px 8px; text-align: center; min-height: 38px; }
        th { background: #f1f3f5; font-weight: 800; }
        th:nth-child(1), td:nth-child(1) { width: 52px; }
        th:nth-child(2), td:nth-child(2) { width: 36%; text-align: left; }
        th:nth-child(5), td:nth-child(5) { width: 22%; }
        .signature { height: 42px; }
        body.dense h1 { font-size: 20px; }
        body.dense p { margin-bottom: 10px; }
        body.dense th, body.dense td { padding: 6px 6px; font-size: 12px; min-height: 30px; }
        body.dense .signature { height: 32px; }
        @media print { button { display: none; } body { margin: 0; } }
      </style>
    </head>
    <body class="${densePrintClass}">
      <h1>${escapeHtml(title)} 참가자 명단</h1>
      <p>${escapeHtml(course?.starts_at ? shortDate(course.starts_at) : "일정 미정")} · 등록 참가자 ${applications.length}명 · 현장 기입칸 ${blankRowCount}개 · 총 ${totalRowCount}칸</p>
      <table>
        <thead><tr><th>번호</th><th>교육제목</th><th>성명</th><th>본인확인</th><th>서명</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.addEventListener("load", () => window.print());</script>
    </body>
    </html>`);
  printWindow.document.close();
}

function localDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function currentMinuteDate() {
  const date = new Date();
  date.setSeconds(0, 0);
  return date;
}

function currentMinuteLocalDateTimeValue() {
  return localDateTimeValue(currentMinuteDate());
}

function isBeforeCurrentMinute(date) {
  return date.getTime() < currentMinuteDate().getTime();
}

function validateCourseTiming(courseId, formData) {
  const existingCourse = courseById(courseId);
  const firstSession = state.sessions.find((session) => session.course_id === courseId && session.session_order === 1);
  const existingStartValue = localDateTimeValue(existingCourse?.starts_at || firstSession?.starts_at);
  const rawStart = String(formData.get("starts_at") || "").trim();
  const rawEnd = String(formData.get("ends_at") || "").trim();

  if (!rawStart) {
    showToast("교육 시작 일시는 반드시 입력해 주세요.");
    return null;
  }

  const startDate = new Date(rawStart);
  if (Number.isNaN(startDate.getTime())) {
    showToast("교육 시작 일시를 확인해 주세요.");
    return null;
  }

  const keepsExistingPastStart = Boolean(courseId && existingStartValue && rawStart === existingStartValue && isBeforeCurrentMinute(startDate));
  if (isBeforeCurrentMinute(startDate) && !keepsExistingPastStart) {
    showToast("교육 시작 일시는 현재 이후로 선택해 주세요.");
    return null;
  }

  let endDate = null;
  if (rawEnd) {
    endDate = new Date(rawEnd);
    if (Number.isNaN(endDate.getTime())) {
      showToast("교육 종료 일시를 확인해 주세요.");
      return null;
    }
    if (endDate.getTime() < startDate.getTime()) {
      showToast("교육 종료 일시는 시작 일시보다 빠를 수 없습니다.");
      return null;
    }
  }

  return {
    startsAt: startDate.toISOString(),
    endsAt: endDate ? endDate.toISOString() : null,
    hasStarted: startDate.getTime() <= Date.now(),
    hasEnded: hasCourseTimeEnded(startDate, endDate),
  };
}

function hasSelectedFile(file) {
  return file instanceof File && file.size > 0;
}

function safeStorageSegment(value, fallback) {
  const segment = String(value || fallback)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48);
  return segment || fallback;
}

function makeSlugSegment(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48);
}

function makeUniqueOrganizationSlug(proposedSlug, organizationName, organizationId = "") {
  const generatedFallback = `org-${Date.now().toString(36)}`;
  const base = makeSlugSegment(proposedSlug) || makeSlugSegment(organizationName) || generatedFallback;
  let candidate = base;
  let suffix = 2;
  while (state.organizations.some((organization) => organization.slug === candidate && organization.id !== organizationId)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 48 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

async function uploadSiteImage(file, folder, baseName) {
  if (!hasSelectedFile(file)) return "";
  if (!SITE_IMAGE_TYPES.has(file.type)) {
    throw new Error("이미지는 JPG, PNG, WEBP, GIF 형식만 업로드할 수 있습니다.");
  }
  if (file.size > SITE_IMAGE_MAX_BYTES) {
    throw new Error("이미지는 5MB 이하로 업로드해 주세요.");
  }

  const extension = SITE_IMAGE_TYPES.get(file.type);
  const uniqueId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `${folder}/${safeStorageSegment(baseName, "image")}-${uniqueId}${extension}`;
  const { error } = await supabase.storage.from(SITE_MEDIA_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(SITE_MEDIA_BUCKET).getPublicUrl(path);
  return { publicUrl: data.publicUrl, path };
}

async function removeUploadedSiteImage(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(SITE_MEDIA_BUCKET).remove([path]);
  if (error) console.warn("[모두의 인문학] 업로드 롤백 파일 삭제 실패", error);
}

function siteMediaStoragePathFromUrl(url) {
  const safeUrl = normalizeSafeUrl(url, URL_RULES.image);
  if (!safeUrl) return "";
  try {
    const parsed = new URL(safeUrl);
    const prefix = `/storage/v1/object/public/${SITE_MEDIA_BUCKET}/`;
    if (!parsed.pathname.startsWith(prefix)) return "";
    return decodeURIComponent(parsed.pathname.slice(prefix.length));
  } catch {
    return "";
  }
}

async function uploadArchiveFile(file, courseId, baseName) {
  if (!hasSelectedFile(file)) return null;
  const fileRule = ARCHIVE_FILE_TYPES.get(file.type);
  if (!fileRule) {
    throw new Error("아카이브 파일은 이미지 또는 PDF만 업로드할 수 있습니다.");
  }
  if (file.size > ARCHIVE_FILE_MAX_BYTES) {
    throw new Error("아카이브 파일은 15MB 이하로 업로드해 주세요.");
  }

  const originalName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `${courseId}/${safeStorageSegment(baseName, "archive")}-${uniqueId}-${originalName}`;
  const { error } = await supabase.storage.from(ARCHIVE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(ARCHIVE_BUCKET).getPublicUrl(path);
  return { publicUrl: data.publicUrl, path, archiveType: fileRule.type };
}

async function removeUploadedArchiveFile(path, { strict = false } = {}) {
  if (!path) return;
  const { error } = await supabase.storage.from(ARCHIVE_BUCKET).remove([path]);
  if (error) {
    console.warn("[모두의 인문학] 아카이브 파일 삭제 실패", error);
    if (strict) throw error;
  }
}

function archiveStoragePathFromUrl(url) {
  const safeUrl = normalizeSafeUrl(url, URL_RULES.archive);
  if (!safeUrl) return "";
  try {
    const parsed = new URL(safeUrl);
    const prefix = `/storage/v1/object/public/${ARCHIVE_BUCKET}/`;
    if (!parsed.pathname.startsWith(prefix)) return "";
    return decodeURIComponent(parsed.pathname.slice(prefix.length));
  } catch {
    return "";
  }
}

async function uploadAttendanceDocument(file, courseId, baseName) {
  if (!hasSelectedFile(file)) return null;
  const extension = ATTENDANCE_DOCUMENT_TYPES.get(file.type);
  if (!extension) {
    throw new Error("참석자 명단 스캔본은 PDF 또는 이미지 파일만 업로드할 수 있습니다.");
  }
  if (file.size > ATTENDANCE_DOCUMENT_MAX_BYTES) {
    throw new Error("참석자 명단 스캔본은 15MB 이하로 업로드해 주세요.");
  }

  const originalName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `${courseId}/${safeStorageSegment(baseName, "attendance")}-${uniqueId}-${originalName || `scan${extension}`}`;
  const { error } = await supabase.storage.from(ATTENDANCE_DOCUMENT_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return { path, originalName, contentType: file.type, fileSize: file.size };
}

async function removeUploadedAttendanceDocument(path, { strict = false } = {}) {
  if (!path) return;
  const { error } = await supabase.storage.from(ATTENDANCE_DOCUMENT_BUCKET).remove([path]);
  if (error) {
    console.warn("[모두의 인문학] 참석자 명단 스캔본 파일 삭제 실패", error);
    if (strict) throw error;
  }
}

function statusBadge(status) {
  const className = status === "open" ? "green" : status === "finished" ? "gray" : status === "cancelled" ? "red" : "";
  return `<span class="badge ${className}">${escapeHtml(statusLabels[status] || status)}</span>`;
}

function managedEntityConfig(kind) {
  return {
    organization: {
      label: "단체",
      table: "organizations",
      tab: "organizations",
      foreignKey: "organization_id",
      itemById: organizationById,
      mediaUrlKey: "logo_url",
    },
    instructor: {
      label: "강사",
      table: "instructors",
      tab: "instructors",
      foreignKey: "instructor_id",
      itemById: instructorById,
      mediaUrlKey: "photo_url",
    },
    venue: {
      label: "장소",
      table: "venues",
      tab: "venues",
      foreignKey: "venue_id",
      itemById: venueById,
      mediaUrlKey: "",
    },
  }[kind];
}

function connectedCoursesForEntity(kind, entityId) {
  const config = managedEntityConfig(kind);
  if (!config || !entityId) return [];
  return state.courses
    .filter((course) => course[config.foreignKey] === entityId)
    .slice()
    .sort((a, b) => {
      const aTime = a.starts_at ? new Date(a.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.starts_at ? new Date(b.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return (a.title || "").localeCompare(b.title || "", "ko");
    });
}

function connectedCoursesHtml(courses) {
  return `
    <ul class="plain-list" style="margin-top: 12px;">
      ${courses.map((course) => `
        <li>
          <strong>${escapeHtml(course.title || "교육명 없음")}</strong><br>
          <span class="muted">${escapeHtml(shortDate(course.starts_at))} · ${escapeHtml(statusLabels[effectiveCourseStatus(course)] || effectiveCourseStatus(course) || "상태 없음")}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function instructorResultHtml(instructor, selectedId = "", actionAttribute = "data-admin-select=\"instructor\"") {
  const courseCount = connectedCoursesForEntity("instructor", instructor.id).length;
  return `
    <button class="admin-search-result ${instructor.id === selectedId ? "selected" : ""}" type="button" ${actionAttribute} data-entity-id="${escapeHtml(instructor.id)}">
      <span class="admin-search-title">
        <strong>${escapeHtml(instructor.name || "이름 없음")}</strong>
        <span>${escapeHtml(instructor.title || "직함 없음")}</span>
      </span>
      <span class="muted">연결 교육 ${courseCount}개${instructor.bio ? ` · ${escapeHtml(instructor.bio)}` : ""}</span>
    </button>
  `;
}

function organizationResultHtml(organization, selectedId = "") {
  const courseCount = connectedCoursesForEntity("organization", organization.id).length;
  const logoUrl = normalizeSafeUrl(organization.logo_url, URL_RULES.image);
  return `
    <button class="admin-search-result ${organization.id === selectedId ? "selected" : ""}" type="button" data-admin-select="organization" data-entity-id="${escapeHtml(organization.id)}">
      <span class="admin-search-title">
        <strong>${escapeHtml(organization.name || "단체명 없음")}</strong>
        <span>${escapeHtml(organization.is_active !== false ? "공개" : "숨김")}</span>
      </span>
      <span class="muted">연결 교육 ${courseCount}개 · ${escapeHtml(organization.slug || "주소 이름 없음")}${organization.contact_email ? ` · ${escapeHtml(organization.contact_email)}` : ""}</span>
      ${logoUrl ? `<span class="muted">로고 등록됨</span>` : ""}
    </button>
  `;
}

function venueResultHtml(venue, selectedId = "") {
  const courseCount = connectedCoursesForEntity("venue", venue.id).length;
  const ownershipLabel = venueOwnershipLabel(venue);
  return `
    <button class="admin-search-result ${venue.id === selectedId ? "selected" : ""}" type="button" data-admin-select="venue" data-entity-id="${escapeHtml(venue.id)}">
      <span class="admin-search-title">
        <strong>${escapeHtml(venue.name || "장소명 없음")}</strong>
        <span>${escapeHtml(venue.is_online ? "온라인" : "오프라인")} · ${escapeHtml(ownershipLabel)}</span>
      </span>
      <span class="muted">연결 교육 ${courseCount}개 · ${escapeHtml(venue.address || "주소 없음")}${venue.detail ? ` · ${escapeHtml(venue.detail)}` : ""}</span>
    </button>
  `;
}

function courseResultHtml(course, selectedId = "") {
  const organization = organizationById(course.organization_id);
  const instructor = instructorById(course.instructor_id);
  const venue = venueById(course.venue_id);
  const status = effectiveCourseStatus(course);
  return `
    <button class="admin-search-result ${course.id === selectedId ? "selected" : ""}" type="button" data-admin-select="course" data-entity-id="${escapeHtml(course.id)}">
      <span class="admin-search-title">
        <strong>${escapeHtml(course.title || "교육명 없음")}</strong>
        ${statusBadge(status)}
      </span>
      ${course.subtitle ? `<span>${escapeHtml(course.subtitle)}</span>` : ""}
      <span class="muted">${escapeHtml(shortDate(course.starts_at))} · ${escapeHtml(course.topic || "주제 없음")} · ${escapeHtml(organization?.name || "단체 미정")} · ${escapeHtml(instructor?.name || "강사 미정")} ${instructor?.title ? `(${escapeHtml(instructor.title)})` : ""} · ${escapeHtml(venue?.name || "장소 미정")}</span>
    </button>
  `;
}

function courseFilterTargetLabel(target) {
  return {
    application: "신청 관리 교육",
    expectation: "기대평·문의 교육",
    archive: "아카이브 교육",
  }[target] || "교육";
}

function currentCourseFilterSelectedId(target) {
  if (target === "application") return state.applicationFilters.courseId || "";
  if (target === "expectation") return state.expectationFilters.courseId || "";
  if (target === "archive") return document.querySelector("#archiveForm input[name='course_id']")?.value || "";
  return "";
}

function selectedCourseSummaryHtml(courseId, emptyLabel = "전체 교육") {
  const course = courseById(courseId);
  if (!course) return `<span class="muted">${escapeHtml(emptyLabel)}</span>`;
  return `
    <span>
      선택한 교육: <strong>${escapeHtml(course.title || "교육명 없음")}</strong>
      <br><span class="muted">${escapeHtml(shortDate(course.starts_at))} · ${escapeHtml(statusLabels[effectiveCourseStatus(course)] || effectiveCourseStatus(course))}</span>
    </span>
  `;
}

function renderCourseFilterControl(target, selectedId = "", { emptyLabel = "전체 교육", required = false } = {}) {
  return `
    <div class="admin-search-selected">
      ${target === "archive" ? `<input type="hidden" name="course_id" value="${escapeHtml(selectedId || "")}" ${required ? "required" : ""}>` : ""}
      <span id="courseFilterSelected-${escapeHtml(target)}">${selectedCourseSummaryHtml(selectedId, emptyLabel)}</span>
      <span class="actions">
        <button class="btn small secondary" type="button" data-open-course-filter-picker="${escapeHtml(target)}">교육 검색</button>
        ${selectedId ? `<button class="btn small secondary" type="button" data-clear-course-filter="${escapeHtml(target)}">${target === "archive" ? "선택 해제" : "전체 보기"}</button>` : ""}
      </span>
    </div>
  `;
}

function courseFilterResultsHtml(target) {
  const query = state.courseFilterPicker.target === target ? state.courseFilterPicker.query : "";
  if (!normalizeSearchText(query)) {
    return `<p class="muted">교육명, 부제, 주제, 단체, 강사, 장소, 상태 중 하나를 입력하면 검색 결과가 표시됩니다.</p>`;
  }
  const selectedId = currentCourseFilterSelectedId(target);
  const results = searchItems(state.courses, query, courseSearchText, COURSE_PICKER_LIMIT);
  return `
    <div class="admin-search-results">
      ${results.map((course) => courseFilterResultHtml(target, course, selectedId)).join("") || `<div class="empty">검색어에 맞는 교육이 없습니다.</div>`}
    </div>
  `;
}

function courseFilterResultHtml(target, course, selectedId = "") {
  const organization = organizationById(course.organization_id);
  const instructor = instructorById(course.instructor_id);
  const venue = venueById(course.venue_id);
  const status = effectiveCourseStatus(course);
  return `
    <button class="admin-search-result ${course.id === selectedId ? "selected" : ""}" type="button" data-course-filter-select="${escapeHtml(target)}" data-course-id="${escapeHtml(course.id)}">
      <span class="admin-search-title">
        <strong>${escapeHtml(course.title || "교육명 없음")}</strong>
        ${statusBadge(status)}
      </span>
      ${course.subtitle ? `<span>${escapeHtml(course.subtitle)}</span>` : ""}
      <span class="muted">${escapeHtml(shortDate(course.starts_at))} · ${escapeHtml(course.topic || "주제 없음")} · ${escapeHtml(organization?.name || "단체 미정")} · ${escapeHtml(instructor?.name || "강사 미정")} ${instructor?.title ? `(${escapeHtml(instructor.title)})` : ""} · ${escapeHtml(venue?.name || "장소 미정")}</span>
    </button>
  `;
}

function renderCourseFilterModalBody(target) {
  const query = state.courseFilterPicker.target === target ? state.courseFilterPicker.query : "";
  return `
    <div class="admin-search-picker">
      <label>${escapeHtml(courseFilterTargetLabel(target))} 검색<input type="search" data-course-filter-search="${escapeHtml(target)}" value="${escapeHtml(query)}" placeholder="교육명, 부제, 주제, 단체, 강사, 장소, 상태로 검색" autocomplete="off"></label>
      <div data-course-filter-results="${escapeHtml(target)}">${courseFilterResultsHtml(target)}</div>
    </div>
  `;
}

function openCourseFilterPicker(target) {
  state.courseFilterPicker.target = target;
  state.courseFilterPicker.query = "";
  openAdminNotice(`${courseFilterTargetLabel(target)} 선택`, renderCourseFilterModalBody(target));
  window.requestAnimationFrame(() => {
    document.querySelector(`[data-course-filter-search="${target}"]`)?.focus();
  });
}

function updateCourseFilterResults(target) {
  const resultsContainer = document.querySelector(`[data-course-filter-results="${target}"]`);
  if (!resultsContainer) return;
  resultsContainer.innerHTML = courseFilterResultsHtml(target);
}

function updateArchiveCourseFilterSelected() {
  const selectedContainer = document.getElementById("courseFilterSelected-archive");
  if (!selectedContainer) return;
  selectedContainer.innerHTML = selectedCourseSummaryHtml(currentCourseFilterSelectedId("archive"), "교육을 선택하지 않았습니다.");
}

function setCourseFilterSelection(target, courseId = "") {
  if (target === "application") {
    state.applicationFilters.courseId = courseId;
    closeModal(elements.adminNoticeModal);
    renderApplications();
    return;
  }
  if (target === "expectation") {
    state.expectationFilters.courseId = courseId;
    closeModal(elements.adminNoticeModal);
    renderExpectations();
    return;
  }
  if (target === "archive") {
    const hiddenInput = document.querySelector("#archiveForm input[name='course_id']");
    if (hiddenInput) hiddenInput.value = courseId;
    updateArchiveCourseFilterSelected();
    closeModal(elements.adminNoticeModal);
  }
}

function courseTemplateResultHtml(course) {
  const organization = organizationById(course.organization_id);
  const instructor = instructorById(course.instructor_id);
  const venue = venueById(course.venue_id);
  const status = effectiveCourseStatus(course);
  return `
    <button class="admin-search-result" type="button" data-load-course-template="${escapeHtml(course.id)}">
      <span class="admin-search-title">
        <strong>${escapeHtml(course.title || "교육명 없음")}</strong>
        ${statusBadge(status)}
      </span>
      ${course.subtitle ? `<span>${escapeHtml(course.subtitle)}</span>` : ""}
      <span class="muted">${escapeHtml(shortDate(course.starts_at))} · ${escapeHtml(course.topic || "주제 없음")} · ${escapeHtml(organization?.name || "단체 미정")} · ${escapeHtml(instructor?.name || "강사 미정")} · ${escapeHtml(venue?.name || "장소 미정")}</span>
      <span class="muted">선택하면 단체, 강사, 장소, 주제, 요약, 상세 설명만 새 교육 입력폼에 복사합니다.</span>
    </button>
  `;
}

function courseTemplateResultsHtml() {
  const query = state.courseTemplate.query || "";
  if (!normalizeSearchText(query)) {
    return `<p class="muted">교육명, 부제, 주제, 단체, 강사, 장소 중 하나를 입력하면 불러올 교육이 표시됩니다.</p>`;
  }
  const results = searchItems(state.courses, query, courseSearchText, ADMIN_SEARCH_LIMIT);
  return `
    <div class="admin-search-results">
      ${results.map(courseTemplateResultHtml).join("") || `<div class="empty">검색어에 맞는 교육이 없습니다.</div>`}
    </div>
  `;
}

function renderCourseTemplateModalBody() {
  return `
    <div class="admin-search-picker">
      <p class="muted">기존 교육의 운영 정보만 새 교육 입력폼으로 가져옵니다. 교육명, 시작·종료 일시, 자료, 신청자, 후기, 아카이브는 복사하지 않습니다.</p>
      <label>불러올 교육 검색<input type="search" data-course-template-search value="${escapeHtml(state.courseTemplate.query || "")}" placeholder="교육명, 부제, 주제, 단체, 강사, 장소로 검색" autocomplete="off"></label>
      <div data-course-template-results>${courseTemplateResultsHtml()}</div>
    </div>
  `;
}

function openCourseTemplateModal() {
  state.courseTemplate.query = "";
  openAdminNotice("기존 교육 불러오기", renderCourseTemplateModalBody());
  window.requestAnimationFrame(() => {
    document.querySelector("[data-course-template-search]")?.focus();
  });
}

function updateCourseTemplateResults() {
  const resultsContainer = document.querySelector("[data-course-template-results]");
  if (!resultsContainer) return;
  resultsContainer.innerHTML = courseTemplateResultsHtml();
}

function clearCourseTemplateDraft() {
  state.courseTemplate.sourceCourseId = "";
  state.courseTemplate.sourceTitle = "";
  state.courseTemplate.draft = null;
}

function courseTemplateDraftFrom(course) {
  return {
    title: "",
    subtitle: "",
    topic: course.topic || "",
    organization_id: course.organization_id || "",
    instructor_id: course.instructor_id || "",
    venue_id: course.venue_id || "",
    starts_at: null,
    ends_at: null,
    summary: course.summary || "",
    description: course.description || "",
    published: course.published !== false,
  };
}

function loadCourseTemplate(courseId) {
  const course = courseById(courseId);
  if (!course) {
    showToast("불러올 교육을 찾지 못했습니다.");
    return;
  }
  state.adminSelections.courseId = "";
  state.adminSearch.course = "";
  state.courseTemplate.sourceCourseId = course.id;
  state.courseTemplate.sourceTitle = course.title || "교육명 없음";
  state.courseTemplate.draft = courseTemplateDraftFrom(course);
  closeModal(elements.adminNoticeModal);
  renderCourses();
  showToast("기존 교육 내용을 새 교육 입력폼에 불러왔습니다.");
}

function coursePickerFieldName(kind) {
  return {
    organization: "organization_id",
    instructor: "instructor_id",
    venue: "venue_id",
    series: "series_previous_course_id",
  }[kind] || "";
}

function coursePickerLabel(kind) {
  return {
    organization: "단체",
    instructor: "강사",
    venue: "장소",
    series: "앞 교육",
  }[kind] || "항목";
}

function coursePickerItem(kind, itemId) {
  if (kind === "organization") return organizationById(itemId);
  if (kind === "instructor") return instructorById(itemId);
  if (kind === "venue") return venueById(itemId);
  if (kind === "series") return courseById(itemId);
  return null;
}

function coursePickerItems(kind) {
  if (kind === "organization") return state.organizations;
  if (kind === "instructor") return state.instructors;
  if (kind === "venue") return state.venues;
  if (kind === "series") {
    const currentCourseId = document.querySelector("#courseForm input[name='course_id']")?.value || "";
    const currentCourse = courseById(currentCourseId);
    const rawStart = document.querySelector("#courseForm input[name='starts_at']")?.value || "";
    const targetStartTime = rawStart ? new Date(rawStart).getTime() : Number.NaN;
    return state.courses.filter((course) => {
      if (course.id === currentCourseId || !isLastSeriesCourse(course)) return false;
      if (currentCourse?.series_id && course.series_id === currentCourse.series_id) return false;
      if (Number.isFinite(targetStartTime) && course.starts_at) {
        return new Date(course.starts_at).getTime() < targetStartTime;
      }
      return true;
    });
  }
  return [];
}

function coursePickerTextBuilder(kind) {
  if (kind === "organization") return organizationSearchText;
  if (kind === "instructor") return instructorSearchText;
  if (kind === "venue") return venueSearchText;
  if (kind === "series") return courseSearchText;
  return () => "";
}

function coursePickerSelectedLabel(kind, item) {
  if (!item) return "";
  if (kind === "organization") return item.name || "단체명 없음";
  if (kind === "venue") return `${item.name || "장소명 없음"}${item.address ? ` · ${item.address}` : ""}`;
  if (kind === "series") return `${item.title || "교육명 없음"}${item.subtitle ? ` · ${item.subtitle}` : ""} · ${shortDate(item.starts_at)}`;
  return `${item.name || "이름 없음"}${item.title ? ` · ${item.title}` : ""}`;
}

function coursePickerSearchPlaceholder(kind) {
  if (kind === "organization") return "단체명, 소개, 홈페이지, 연락처로 검색";
  if (kind === "venue") return "장소명, 주소, 세부 장소, 지도 URL로 검색";
  if (kind === "series") return "교육명, 부제, 주제, 단체, 강사, 장소로 검색";
  return "강사명, 직함, 소개, 홈페이지/SNS로 검색";
}

function coursePickerResultMeta(kind, item) {
  if (kind === "series") {
    const organization = organizationById(item.organization_id);
    const series = courseSeriesPosition(item);
    return `${shortDate(item.starts_at)} · ${organization?.name || "단체 미정"}${series ? ` · 기존 연강 ${series.position}/${series.total}` : " · 단독 교육"}`;
  }
  const courseCount = connectedCoursesForEntity(kind, item.id).length;
  if (kind === "organization") {
    return `연결 교육 ${courseCount}개${item.description ? ` · ${item.description}` : ""}${item.contact_email ? ` · ${item.contact_email}` : ""}`;
  }
  if (kind === "venue") {
    return `연결 교육 ${courseCount}개 · ${venueOwnershipLabel(item)} · ${item.address || "주소 없음"}${item.detail ? ` · ${item.detail}` : ""}`;
  }
  return `연결 교육 ${courseCount}개${item.bio ? ` · ${item.bio}` : ""}`;
}

function coursePickerResultHtml(kind, item, selectedId = "") {
  if (kind === "series") {
    const status = effectiveCourseStatus(item);
    return `
      <button class="admin-search-result ${item.id === selectedId ? "selected" : ""}" type="button" data-course-picker-select="series" data-entity-id="${escapeHtml(item.id)}">
        <span class="admin-search-title">
          <strong>${escapeHtml(item.title || "교육명 없음")}</strong>
          ${statusBadge(status)}
        </span>
        ${item.subtitle ? `<span>${escapeHtml(item.subtitle)}</span>` : ""}
        <span class="muted">${escapeHtml(coursePickerResultMeta(kind, item))}</span>
      </button>
    `;
  }
  const badge = kind === "venue"
    ? (item.is_online ? "온라인" : "오프라인")
    : (item.is_active === false ? "숨김" : "사용");
  const title = kind === "instructor" ? item.name || "이름 없음" : item.name || `${coursePickerLabel(kind)}명 없음`;
  const subtitle = kind === "instructor" ? item.title || "직함 없음" : badge;
  return `
    <button class="admin-search-result ${item.id === selectedId ? "selected" : ""}" type="button" data-course-picker-select="${escapeHtml(kind)}" data-entity-id="${escapeHtml(item.id)}">
      <span class="admin-search-title">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(subtitle)}</span>
      </span>
      <span class="muted">${escapeHtml(coursePickerResultMeta(kind, item))}</span>
    </button>
  `;
}

function coursePickerSelectedHtml(kind, selectedId = "") {
  const item = coursePickerItem(kind, selectedId);
  const label = coursePickerLabel(kind);
  if (!item) {
    return `
      <div class="admin-search-selected">
        <span class="muted">${escapeHtml(label)}를 선택하지 않았습니다.</span>
        <button class="btn small secondary" type="button" data-open-course-picker="${escapeHtml(kind)}">${escapeHtml(label)} 검색</button>
      </div>
    `;
  }
  return `
    <div class="admin-search-selected">
      <span>선택한 ${escapeHtml(label)}: <strong>${escapeHtml(coursePickerSelectedLabel(kind, item))}</strong></span>
      <span class="actions">
        <button class="btn small secondary" type="button" data-open-course-picker="${escapeHtml(kind)}">변경</button>
        ${kind === "organization" ? "" : `<button class="btn small secondary" type="button" data-clear-course-picker="${escapeHtml(kind)}">선택 해제</button>`}
      </span>
    </div>
  `;
}

function renderCoursePickerField(kind, selectedId = "") {
  const fieldName = coursePickerFieldName(kind);
  const label = coursePickerLabel(kind);
  return `
    <div class="course-picker-field ${kind === "organization" ? "" : "admin-grid-wide"}">
      <span class="course-picker-label">${escapeHtml(label)}${kind === "organization" ? " *" : ""}${kind === "series" ? "(선택)" : ""}</span>
      <input type="hidden" name="${escapeHtml(fieldName)}" value="${escapeHtml(selectedId || "")}">
      <div id="coursePickerSelected-${escapeHtml(kind)}">${coursePickerSelectedHtml(kind, selectedId)}</div>
      ${kind === "series" ? `<span class="muted">후속 교육을 등록할 때 기존 연강의 마지막 교육을 선택하면 자동으로 다음 순서에 연결됩니다.</span>` : ""}
    </div>
  `;
}

function currentCoursePickerSelectedId(kind) {
  const fieldName = coursePickerFieldName(kind);
  return document.querySelector(`#courseForm input[name="${fieldName}"]`)?.value || "";
}

function coursePickerResultsHtml(kind) {
  const query = state.coursePicker.kind === kind ? state.coursePicker.query : "";
  if (!normalizeSearchText(query)) {
    return `<p class="muted">${escapeHtml(coursePickerSearchPlaceholder(kind))}해 주세요. 검색어를 입력하면 결과가 표시됩니다.</p>`;
  }
  const selectedId = currentCoursePickerSelectedId(kind);
  const results = searchItems(coursePickerItems(kind), query, coursePickerTextBuilder(kind), COURSE_PICKER_LIMIT);
  return `
    <div class="admin-search-results">
      ${results.map((item) => coursePickerResultHtml(kind, item, selectedId)).join("") || `<div class="empty">검색어에 맞는 ${escapeHtml(coursePickerLabel(kind))}가 없습니다.</div>`}
    </div>
  `;
}

function renderCoursePickerModalBody(kind) {
  const label = coursePickerLabel(kind);
  const query = state.coursePicker.kind === kind ? state.coursePicker.query : "";
  return `
    <div class="admin-search-picker">
      <label>${escapeHtml(label)} 검색<input type="search" data-course-picker-search="${escapeHtml(kind)}" value="${escapeHtml(query)}" placeholder="${escapeHtml(coursePickerSearchPlaceholder(kind))}" autocomplete="off"></label>
      <div data-course-picker-results="${escapeHtml(kind)}">${coursePickerResultsHtml(kind)}</div>
    </div>
  `;
}

function openCoursePicker(kind) {
  state.coursePicker.kind = kind;
  state.coursePicker.query = "";
  openAdminNotice(`${coursePickerLabel(kind)} 선택`, renderCoursePickerModalBody(kind));
  window.requestAnimationFrame(() => {
    document.querySelector(`[data-course-picker-search="${kind}"]`)?.focus();
  });
}

function updateCoursePickerModalResults(kind) {
  const resultsContainer = document.querySelector(`[data-course-picker-results="${kind}"]`);
  if (!resultsContainer) return;
  resultsContainer.innerHTML = coursePickerResultsHtml(kind);
}

function updateCoursePickerSelectedField(kind) {
  const selectedContainer = document.getElementById(`coursePickerSelected-${kind}`);
  if (!selectedContainer) return;
  selectedContainer.innerHTML = coursePickerSelectedHtml(kind, currentCoursePickerSelectedId(kind));
}

function setCoursePickerSelection(kind, itemId = "") {
  const fieldName = coursePickerFieldName(kind);
  const hiddenInput = document.querySelector(`#courseForm input[name="${fieldName}"]`);
  if (hiddenInput) hiddenInput.value = itemId;
  updateCoursePickerSelectedField(kind);
  closeModal(elements.adminNoticeModal);
}

function clearCoursePickerSelection(kind) {
  setCoursePickerSelection(kind, "");
}

function adminSearchSelectedLabel(kind, item) {
  if (!item) return "";
  if (kind === "course") return item.title || "교육명 없음";
  if (kind === "organization") return item.name || "단체명 없음";
  if (kind === "venue") return `${item.name || "장소명 없음"}${item.address ? ` · ${item.address}` : ""}`;
  return `${item.name || "이름 없음"} · ${item.title || "직함 없음"}`;
}

function renderAdminSearchResultsContent({
  query,
  selectedItem,
  items,
  textBuilder,
  resultBuilder,
  emptyText,
  hideResultsUntilQuery = false,
  emptyQueryText = "검색어를 입력하면 결과가 표시됩니다.",
}) {
  const hasQuery = Boolean(normalizeSearchText(query));
  const shouldShowResults = !hideResultsUntilQuery || hasQuery;
  const results = shouldShowResults ? searchItems(items, query, textBuilder) : [];
  if (!shouldShowResults) return `<p class="muted">${escapeHtml(emptyQueryText)}</p>`;
  return `
    <div class="admin-search-results">
      ${results.map((item) => resultBuilder(item, selectedItem?.id || "")).join("") || `<div class="empty">${escapeHtml(emptyText)}</div>`}
    </div>
  `;
}

function renderAdminSearchPicker(config) {
  const { kind, label, placeholder, query, selectedItem } = config;
  return `
    <div class="admin-search-picker">
      <label>${escapeHtml(label)}<input type="search" data-admin-search="${escapeHtml(kind)}" value="${escapeHtml(query || "")}" placeholder="${escapeHtml(placeholder)}" autocomplete="off"></label>
      ${selectedItem?.id ? `
        <div class="admin-search-selected">
          <span>수정 중: <strong>${escapeHtml(adminSearchSelectedLabel(kind, selectedItem))}</strong></span>
          <button class="btn small secondary" type="button" data-admin-clear-selection="${escapeHtml(kind)}">새로 입력</button>
        </div>
      ` : `<p class="muted">검색 결과에서 항목을 선택하면 아래 입력폼에 불러옵니다. 선택하지 않으면 새 항목을 추가합니다.</p>`}
      <div data-admin-search-results="${escapeHtml(kind)}">
        ${renderAdminSearchResultsContent(config)}
      </div>
    </div>
  `;
}

function adminSearchResultConfig(kind) {
  if (kind === "organization") {
    const selectedId = state.adminSelections.organizationId || "";
    return {
      query: state.adminSearch.organization,
      selectedItem: state.organizations.find((organization) => organization.id === selectedId) || {},
      items: state.organizations,
      textBuilder: organizationSearchText,
      resultBuilder: organizationResultHtml,
      emptyText: "검색어에 맞는 단체가 없습니다.",
      hideResultsUntilQuery: true,
      emptyQueryText: "단체명, 소개, 홈페이지, 연락처 중 하나를 입력하면 검색 결과가 표시됩니다.",
    };
  }
  if (kind === "instructor") {
    const selectedId = state.adminSelections.instructorId || "";
    return {
      query: state.adminSearch.instructor,
      selectedItem: state.instructors.find((instructor) => instructor.id === selectedId) || {},
      items: state.instructors,
      textBuilder: instructorSearchText,
      resultBuilder: instructorResultHtml,
      emptyText: "검색어에 맞는 강사가 없습니다.",
      hideResultsUntilQuery: true,
      emptyQueryText: "강사명, 직함, 소개, 홈페이지/SNS 중 하나를 입력하면 검색 결과가 표시됩니다.",
    };
  }
  if (kind === "venue") {
    const selectedId = state.adminSelections.venueId || "";
    return {
      query: state.adminSearch.venue,
      selectedItem: state.venues.find((venue) => venue.id === selectedId) || {},
      items: state.venues,
      textBuilder: venueSearchText,
      resultBuilder: venueResultHtml,
      emptyText: "검색어에 맞는 장소가 없습니다.",
      hideResultsUntilQuery: true,
      emptyQueryText: "장소명, 주소, 세부 장소, 지도 URL 중 하나를 입력하면 검색 결과가 표시됩니다.",
    };
  }
    if (kind === "course") {
      const selectedId = state.adminSelections.courseId || "";
      return {
      query: state.adminSearch.course,
      selectedItem: state.courses.find((course) => course.id === selectedId) || {},
      items: state.courses,
      textBuilder: courseSearchText,
      resultBuilder: courseResultHtml,
      emptyText: "검색어에 맞는 교육이 없습니다.",
      hideResultsUntilQuery: true,
      emptyQueryText: "교육명, 부제, 주제, 단체, 강사, 장소, 상태 중 하나를 입력하면 검색 결과가 표시됩니다.",
    };
  }
  return null;
}

function updateAdminSearchResults(kind) {
  const config = adminSearchResultConfig(kind);
  const resultsContainer = document.querySelector(`[data-admin-search-results="${kind}"]`);
  if (!config || !resultsContainer) return;
  resultsContainer.innerHTML = renderAdminSearchResultsContent(config);
}

function showConnectedEntityNotice(kind, item, courses) {
  const config = managedEntityConfig(kind);
  openAdminNotice(
    `${config.label}를 삭제할 수 없습니다`,
    `
      <p><strong>${escapeHtml(item.name || config.label)}</strong>에 연결된 교육이 있어 삭제하지 않았습니다.</p>
      <p class="muted">교육 관리에서 아래 교육의 ${escapeHtml(config.label)} 연결을 먼저 변경한 뒤 다시 삭제해 주세요.</p>
      ${connectedCoursesHtml(courses)}
    `
  );
}

function isFinishedCourseDeleteException(course) {
  return FINISHED_COURSE_DELETE_EXCEPTIONS.has(String(course?.title || "").trim());
}

function canDeleteCourse(course) {
  if (!course?.id) return false;
  return effectiveCourseStatus(course) !== "finished" || isFinishedCourseDeleteException(course);
}

function courseDeleteBlockNotice(course) {
  openAdminNotice(
    "완료된 교육은 삭제할 수 없습니다",
    `
      <p><strong>${escapeHtml(course?.title || "교육")}</strong>은 이미 완료된 교육이라 삭제하지 않았습니다.</p>
      <p class="muted">완료 교육은 후기, 신청, 아카이브 기록과 연결될 수 있어 보존합니다. 테스트 정리를 위해 <strong>테스트교육</strong>, <strong>테스트교육2</strong>만 예외로 삭제할 수 있습니다.</p>
    `
  );
}

function courseRelatedCounts(courseId) {
  return {
    sessions: state.sessions.filter((session) => session.course_id === courseId).length,
    archives: state.archives.filter((archive) => archive.course_id === courseId).length,
    applications: state.applications.filter((application) => application.course_id === courseId).length,
    attendanceDocuments: state.attendanceDocuments.filter((document) => document.course_id === courseId).length,
    reviews: state.reviews.filter((review) => review.course_id === courseId).length,
  };
}

function courseDeleteSummary(courseId) {
  const counts = courseRelatedCounts(courseId);
  const parts = [
    counts.sessions ? `회차 ${counts.sessions}개` : "",
    counts.archives ? `아카이브 ${counts.archives}개` : "",
    counts.applications ? `신청 ${counts.applications}건` : "",
    counts.attendanceDocuments ? `참석자 스캔본 ${counts.attendanceDocuments}개` : "",
    counts.reviews ? `후기 ${counts.reviews}개` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "연결 데이터 없음";
}

function getSubmitForm(event) {
  return event.target instanceof HTMLFormElement ? event.target : null;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} 시간이 초과되었습니다.`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  state.user = data.session?.user || null;
  state.adminProfile = null;
  state.adminProfileError = null;
  state.organizationAdminLinks = [];

  if (state.user) {
    const [profileResult, organizationLinksResult] = await Promise.all([
      supabase
        .from("admin_profiles")
        .select("*")
        .eq("user_id", state.user.id)
        .maybeSingle(),
      supabase
        .from("organization_admins")
        .select("id,organization_id,user_id,role,created_at")
        .eq("user_id", state.user.id),
    ]);

    if (profileResult.error || organizationLinksResult.error) {
      state.adminProfileError = profileResult.error || organizationLinksResult.error;
      console.error("[모두의 인문학] 관리자 권한 조회 실패", state.adminProfileError);
    }
    state.adminProfile = profileResult.data || null;
    state.organizationAdminLinks = organizationLinksResult.data || [];
  }

  updateAdminNavigationVisibility();
  console.info("[모두의 인문학] 관리자 세션 상태", {
    signedIn: Boolean(state.user),
    email: state.user?.email || null,
    isOwner: isOwner(),
    managedOrganizationCount: managedOrganizationIds().size,
    adminProfileError: state.adminProfileError?.message || null,
  });
  renderAuthStatus();
}

function renderAuthStatus() {
  updateAdminLoginFormVisibility();
  if (!state.user) {
    elements.adminStatus.innerHTML = `<p>로그인하지 않았습니다.</p>`;
    elements.permissionNotice.classList.add("hidden");
    return;
  }

  const role = isOwner()
    ? "전체 관리자"
    : state.organizationAdminLinks.length
      ? `단체 관리자 · 연결 단체 ${managedOrganizationIds().size}곳`
      : "관리자 권한 없음";
  elements.adminStatus.innerHTML = `
    <p><strong>${escapeHtml(state.user.email || getDisplayName(state.user))}</strong></p>
    <p class="muted">${escapeHtml(role)}</p>
  `;

  if (state.adminProfileError) {
    elements.permissionNotice.classList.remove("hidden");
    elements.permissionNotice.innerHTML = `
      <h3>관리자 권한을 확인하지 못했습니다</h3>
      <p>로그인은 되었지만 권한 정보를 불러오지 못했습니다. 페이지를 새로고침하거나 잠시 후 다시 시도해 주세요.</p>
      <p class="muted">${escapeHtml(state.adminProfileError.message)}</p>
    `;
  } else if (!isAdmin()) {
    if (state.organizationAdminLinks.length) {
      elements.permissionNotice.classList.add("hidden");
    } else {
      elements.permissionNotice.classList.remove("hidden");
      elements.permissionNotice.innerHTML = `
        <h3>관리자 권한이 없습니다</h3>
        <p>메인 관리자에게 단체 관리자 초대와 단체 연결을 요청해 주세요.</p>
        <p class="muted">권한이 연결되기 전에는 관리자 데이터를 열람하거나 수정할 수 없습니다.</p>
      `;
    }
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
    supabase.from("course_applications").select("*").order("created_at", { ascending: false }),
    supabase.from("course_attendance_documents").select("*").order("created_at", { ascending: false }),
    supabase.from("reviews").select("*").order("created_at", { ascending: false }),
    supabase.from("content_reports").select("*").order("created_at", { ascending: false }),
    supabase.from("review_draws").select("*").order("created_at", { ascending: false }),
    supabase.from("review_draw_winners").select("*").order("created_at", { ascending: false }),
  ]);

  const error = requests.find((result) => result.error)?.error;
  if (error && isAdmin()) throw error;

  const [
    organizations,
    instructors,
    venues,
    courses,
    sessions,
    archives,
    applications,
    attendanceDocuments,
    reviews,
    contentReports,
    draws,
    winners,
  ] = requests.map((result) => result.data || []);

  if (isOwner()) {
    state.organizations = organizations;
    state.courses = courses;
    state.sessions = sessions;
    state.archives = archives;
    state.applications = applications;
    state.attendanceDocuments = attendanceDocuments;
    state.reviews = reviews;
    state.contentReports = contentReports;
    state.draws = draws;
    state.winners = winners;
  } else {
    const organizationIds = managedOrganizationIds();
    const scopedCourses = courses.filter((course) => organizationIds.has(course.organization_id));
    const courseIds = courseIdsSet(scopedCourses);
    state.organizations = organizations.filter((organization) => organizationIds.has(organization.id));
    state.courses = scopedCourses;
    state.sessions = sessions.filter((session) => courseIds.has(session.course_id));
    state.archives = archives.filter((archive) => courseIds.has(archive.course_id));
    state.applications = applications.filter((application) => courseIds.has(application.course_id));
    state.attendanceDocuments = attendanceDocuments.filter((document) => courseIds.has(document.course_id));
    state.reviews = reviews.filter((review) => courseIds.has(review.course_id));
    state.contentReports = contentReports.filter((report) => courseIds.has(report.course_id));
    state.draws = [];
    state.winners = [];
  }
  state.instructors = instructors;
  state.venues = venues;

  state.demographicSummary = null;
  if (isOwner()) {
    const { data, error: demographicError } = await supabase.rpc("get_demographic_summary");
    if (demographicError) console.warn("[모두의 인문학] 선택 이용자 통계 확인 지연", demographicError);
    else state.demographicSummary = data || null;
  }

  if (isOwner()) await loadOrganizationAdmins();
  else {
    state.organizationAdmins = [];
    state.organizationAdminsError = "";
  }

  const { data: smsDeliveries, error: smsDeliveriesError } = await supabase.rpc("get_managed_sms_deliveries", {
    p_limit: 100,
    p_course_id: null,
  });
  if (smsDeliveriesError) {
    console.warn("[모두의 인문학] 문자 발송 현황 확인 지연", smsDeliveriesError);
    state.smsDeliveries = [];
  } else {
    state.smsDeliveries = smsDeliveries || [];
  }

  renderAuthStatus();
  render();
}

async function syncFinishedCourseStatuses() {
  const { error } = await supabase.rpc("sync_finished_course_statuses");
  if (error) {
    console.warn("[모두의 인문학] 교육 종료 상태 동기화 실패", error);
  }
}

async function invokeOrganizationAdminFunction(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("manage-organization-admins", {
    body: { action, ...payload },
  });
  if (error) {
    let message = error.message || "단체 관리자 작업을 처리하지 못했습니다.";
    try {
      const response = error.context;
      if (response instanceof Response) {
        const body = await response.clone().json();
        if (body?.error) message = body.error;
      }
    } catch {
      // The generic SDK error is kept when the response body is unavailable.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

async function invokeSmsDispatch(payload = {}) {
  const { data, error } = await supabase.functions.invoke("sms-dispatch", { body: payload });
  if (error) {
    let message = error.message || "문자 발송 연동을 확인하지 못했습니다.";
    try {
      const response = error.context;
      if (response instanceof Response) {
        const body = await response.clone().json();
        if (body?.error) message = body.error;
      }
    } catch {
      // The generic SDK error is kept when the response body is unavailable.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

async function handleSmsTestSubmit(event) {
  event.preventDefault();
  if (!isOwner()) throw new Error("전체 관리자만 문자 연동을 시험할 수 있습니다.");
  const form = getSubmitForm(event);
  if (!form) return;

  const submitButton = event.submitter instanceof HTMLButtonElement
    ? event.submitter
    : form.querySelector('button[value="provider_test"]');
  const action = submitButton?.value === "send_test" ? "send_test" : "provider_test";
  if (action === "send_test" && submitButton?.dataset.confirmRealSms !== "true") {
    submitButton.dataset.confirmRealSms = "true";
    submitButton.textContent = "한 번 더 누르면 실제 발송됩니다";
    window.setTimeout(() => {
      if (submitButton.dataset.confirmRealSms === "true") {
        submitButton.dataset.confirmRealSms = "false";
        submitButton.textContent = "실제 테스트 문자 보내기";
      }
    }, 5000);
    return;
  }

  const formData = new FormData(form);
  const recipientPhone = formatMobilePhone(formData.get("recipient_phone"));
  const message = String(formData.get("message") || "").trim();
  if (!isValidMobilePhone(recipientPhone)) throw new Error("010으로 시작하는 휴대전화번호 11자리를 입력해 주세요.");
  if (!message) throw new Error("시험 문자 내용을 입력해 주세요.");

  const resultContainer = form.parentElement?.querySelector("[data-sms-test-result]");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = action === "send_test" ? "실제 발송 중..." : "연동 확인 중...";
  }
  try {
    const result = await invokeSmsDispatch({
      action,
      recipient_phone: recipientPhone,
      message,
      confirmation: action === "send_test" ? "SEND_REAL_SMS" : undefined,
    });
    if (resultContainer) {
      const outcome = result.ok
        ? action === "send_test" ? "실제 테스트 문자가 정상 접수되었습니다." : "시험 모드 요청이 정상 처리되었습니다."
        : result.message || "SkySMS 설정을 확인해 주세요.";
      resultContainer.hidden = false;
      resultContainer.dataset.status = result.ok ? "success" : "error";
      resultContainer.innerHTML = `<strong>${escapeHtml(outcome)}</strong><span>응답 코드 ${escapeHtml(result.code || "-")} · ${escapeHtml(result.message_type || "-")} ${Number(result.message_bytes || 0)}바이트</span>`;
    }
    showToast(result.ok ? "SkySMS 연동 응답을 확인했습니다." : result.message || "SkySMS 설정을 확인해 주세요.");
  } finally {
    if (submitButton && document.body.contains(submitButton)) {
      submitButton.disabled = false;
      submitButton.dataset.confirmRealSms = "false";
      submitButton.textContent = action === "send_test" ? "실제 테스트 문자 보내기" : "시험 모드 확인";
    }
  }
}

async function loadOrganizationAdmins() {
  if (!isOwner()) return;
  state.organizationAdminsLoading = true;
  state.organizationAdminsError = "";
  try {
    const data = await invokeOrganizationAdminFunction("list");
    state.organizationAdmins = data.admins || [];
  } catch (error) {
    state.organizationAdmins = [];
    state.organizationAdminsError = error.message;
    console.error("[모두의 인문학] 단체 관리자 목록 조회 실패", error);
  } finally {
    state.organizationAdminsLoading = false;
  }
}

function renderOrganizationAdmins() {
  if (!isOwner()) {
    elements.adminContent.innerHTML = `<div class="empty">전체 관리자만 단체 관리자를 관리할 수 있습니다.</div>`;
    return;
  }

  elements.adminContent.innerHTML = `
    <h2>단체 관리자</h2>
    <p class="muted">이메일로 관리자를 초대하고 담당 단체를 연결합니다. 초대받은 관리자는 연결된 단체의 교육·신청·후기·아카이브만 관리할 수 있습니다.</p>
    <form id="organizationAdminForm" class="section">
      <div class="admin-grid">
        <label>관리자 이메일<input name="email" type="email" placeholder="manager@example.com" autocomplete="off" required maxlength="320"></label>
        <label>담당 단체<select name="organization_id" required><option value="">단체 선택</option>${optionList(state.organizations)}</select></label>
      </div>
      <div class="actions" style="margin-top: 14px;">
        <button class="btn" type="submit" ${state.organizations.length ? "" : "disabled"}>관리자 초대·연결</button>
        <span class="badge gray">권한: 단체 관리자</span>
      </div>
      <p class="muted" style="margin-top: 10px;">기존 회원 이메일이면 바로 연결하고, 가입하지 않은 이메일이면 관리자 초대 메일을 발송합니다.</p>
    </form>
    <div class="row-top" style="margin: 18px 0 10px;">
      <h3>연결된 관리자</h3>
      <span class="badge gray">${state.organizationAdmins.length.toLocaleString("ko-KR")}건</span>
    </div>
    ${state.organizationAdminsError ? `<div class="empty">목록 조회 실패: ${escapeHtml(state.organizationAdminsError)}</div>` : ""}
    <div class="table-list">
      ${state.organizationAdminsLoading
        ? `<div class="empty">단체 관리자 목록을 불러오는 중입니다.</div>`
        : state.organizationAdmins.map((admin) => `
          <div class="table-row">
            <div class="row-top">
              <strong>${escapeHtml(admin.email)}</strong>
              <span class="badge ${admin.is_confirmed ? "green" : "gray"}">${admin.is_confirmed ? "이메일 확인" : "초대 대기"}</span>
            </div>
            <p class="muted">담당 단체: ${escapeHtml(admin.organization_name)}</p>
            <div class="actions">
              <button class="btn small danger" type="button" data-remove-organization-admin="${escapeHtml(admin.id)}">연결 해제</button>
            </div>
          </div>
        `).join("") || `<div class="empty">연결된 단체 관리자가 없습니다.</div>`}
    </div>
  `;
}

async function inviteOrganizationAdmin(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form || !isOwner()) return;
  const formData = new FormData(form);
  const email = String(formData.get("email") || "").trim();
  const organizationId = String(formData.get("organization_id") || "");
  if (!email || !organizationId) return;

  const button = form.querySelector("button[type='submit']");
  if (button) {
    button.disabled = true;
    button.textContent = "처리 중...";
  }
  try {
    const data = await invokeOrganizationAdminFunction("invite", {
      email,
      organization_id: organizationId,
    });
    await loadOrganizationAdmins();
    renderOrganizationAdmins();
    showToast(data.invited ? "관리자 초대 메일을 보내고 단체를 연결했습니다." : "기존 계정에 단체 관리자 권한을 연결했습니다.");
  } finally {
    if (button && document.body.contains(button)) {
      button.disabled = false;
      button.textContent = "관리자 초대·연결";
    }
  }
}

async function removeOrganizationAdmin(linkId) {
  if (!isOwner()) return;
  await invokeOrganizationAdminFunction("remove", { link_id: linkId });
  await loadOrganizationAdmins();
  renderOrganizationAdmins();
  showToast("단체 관리자 연결을 해제했습니다. 사용자 계정은 삭제하지 않았습니다.");
}

const DEMOGRAPHIC_VALUE_LABELS = {
  female: "여성",
  male: "남성",
  other: "그 외",
  prefer_not: "응답하고 싶지 않음",
  married: "기혼",
  unmarried: "미혼",
};

function demographicGroupHtml(title, items = []) {
  if (!items.length) return "";
  return `
    <div class="demographic-summary-group">
      <h4>${escapeHtml(title)}</h4>
      <div class="demographic-summary-items">
        ${items.map((item) => `
          <span><strong>${escapeHtml(DEMOGRAPHIC_VALUE_LABELS[item.value] || item.value)}</strong><em>${Number(item.count || 0).toLocaleString("ko-KR")}명</em></span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderDemographicSummary() {
  if (!isOwner()) return "";
  const summary = state.demographicSummary;
  if (!summary) {
    return `<div class="section" style="margin-top: 16px;"><h3>선택 이용자 통계</h3><div class="empty compact-empty">선택 이용자 통계를 불러오지 못했습니다.</div></div>`;
  }
  const groups = summary.groups || {};
  const groupSections = [
    demographicGroupHtml("거주지", groups.residence),
    demographicGroupHtml("연령대", groups.age_group),
    demographicGroupHtml("성별", groups.gender),
    demographicGroupHtml("결혼 여부", groups.marital_status),
    demographicGroupHtml("자녀 수", groups.children_count),
  ].filter(Boolean).join("");
  return `
    <div class="section" style="margin-top: 16px;">
      <div class="row-top">
        <div>
          <h3>선택 이용자 통계</h3>
          <p class="muted">로그인 이용자가 선택 동의한 정보만 집계하며 개별 응답 원문은 관리자에게 공개하지 않습니다.</p>
        </div>
        <span class="badge gray">응답 ${Number(summary.respondent_count || 0).toLocaleString("ko-KR")}명</span>
      </div>
      ${groupSections || `<div class="empty compact-empty">같은 범주에 ${Number(summary.minimum_group_size || 5)}명 이상 모이면 집계가 표시됩니다.</div>`}
    </div>
  `;
}

function renderSkySmsTest() {
  if (!isOwner()) return "";
  return `
    <section class="section sms-test-panel" style="margin-top: 16px;">
      <div class="row-top">
        <div>
          <h3>SkySMS 문자 연동 시험</h3>
          <p class="muted">시험 모드는 문자를 발송하지 않고 인증키·회원 아이디·발신번호·발송 IP 설정을 확인합니다.</p>
        </div>
        <span class="badge gray">전체 관리자 전용</span>
      </div>
      <form data-sms-test-form>
        <div class="admin-grid application-contact-grid">
          <label>수신 휴대전화번호
            <input name="recipient_phone" type="tel" required inputmode="numeric" pattern="[0-9-]*" maxlength="13" placeholder="010-0000-0000" autocomplete="off">
          </label>
          <label>시험 문자 내용
            <input name="message" required maxlength="1000" value="${escapeHtml(SMS_TEST_MESSAGE)}">
          </label>
        </div>
        <div class="actions" style="margin-top: 12px;">
          <button class="btn small" type="submit" name="sms_action" value="provider_test">시험 모드 확인</button>
          <button class="btn small danger" type="submit" name="sms_action" value="send_test" data-real-sms-submit>실제 테스트 문자 보내기</button>
        </div>
        <p class="media-upload-note">실제 발송 버튼은 두 번 눌러야 실행되며 SkySMS 잔액이 차감됩니다.</p>
      </form>
      <div class="sms-test-result" data-sms-test-result aria-live="polite" hidden></div>
    </section>
  `;
}

const SMS_EVENT_LABELS = {
  application_confirmation: "신청 확인",
  application_cancellation: "신청 취소",
  application_reminder: "교육 전날 알림",
  course_update: "교육 정보 변경",
  course_cancellation: "교육 취소",
  review_request: "후기 작성 요청",
};

const SMS_STATUS_LABELS = {
  pending: "발송 대기",
  processing: "처리 중",
  sent: "발송 완료",
  skipped: "발송 제외",
  failed: "발송 실패",
};

function renderSmsDeliveryHistory() {
  const deliveries = state.smsDeliveries || [];
  const sentCount = deliveries.filter((item) => item.status === "sent").length;
  const pendingCount = deliveries.filter((item) => ["pending", "processing"].includes(item.status)).length;
  const failedCount = deliveries.filter((item) => item.status === "failed").length;
  return `
    <section class="section" style="margin-top: 16px;">
      <div class="row-top">
        <div>
          <h3>자동 문자 발송 현황</h3>
          <p class="muted">휴대전화번호는 끝 4자리만 표시합니다. 담당 단체 관리자는 자기 교육의 발송 이력만 볼 수 있습니다.</p>
        </div>
        <div class="actions">
          <span class="badge green">완료 ${escapeHtml(sentCount)}건</span>
          <span class="badge gray">대기 ${escapeHtml(pendingCount)}건</span>
          ${failedCount ? `<span class="badge red">실패 ${escapeHtml(failedCount)}건</span>` : ""}
        </div>
      </div>
      <details>
        <summary>자동 발송 시점과 내용 확인</summary>
        <ul class="plain-list">
          <li><strong>신청·재신청</strong><br>접수 직후 신청 교육, 일시, 장소, 확인·취소 링크를 보냅니다.</li>
          <li><strong>신청 취소</strong><br>취소 직후 취소 완료와 재신청 링크를 보냅니다.</li>
          <li><strong>교육 변경·취소</strong><br>교육명·일시·장소·강사가 바뀌거나 교육이 취소되면 변경된 항목을 보냅니다.</li>
          <li><strong>교육 전날</strong><br>교육 전날 오후 6시 이후 일시, 장소, 상세 링크를 보냅니다.</li>
          <li><strong>후기 요청</strong><br>참석 확인된 사람에게 교육 종료 2일 뒤 오전 10시 이후 후기 링크를 보냅니다. 이미 후기를 썼으면 보내지 않습니다.</li>
        </ul>
      </details>
      <div class="table-list" style="margin-top: 12px;">
        ${deliveries.map((delivery) => `
          <div class="table-row">
            <div class="row-top">
              <strong>${escapeHtml(delivery.course_title || "교육")}</strong>
              <span class="badge ${delivery.status === "sent" ? "green" : delivery.status === "failed" ? "red" : "gray"}">${escapeHtml(SMS_STATUS_LABELS[delivery.status] || delivery.status)}</span>
            </div>
            <p class="muted">${escapeHtml(SMS_EVENT_LABELS[delivery.event_type] || delivery.event_type)} · 본인확인 ****${escapeHtml(delivery.phone_last_four || "----")}</p>
            <p class="muted">등록 ${escapeHtml(formatDateTime(delivery.created_at))}${delivery.sent_at ? ` · 발송 ${escapeHtml(formatDateTime(delivery.sent_at))}` : ` · 다음 처리 ${escapeHtml(formatDateTime(delivery.available_at))}`}${delivery.message_type ? ` · ${escapeHtml(delivery.message_type)} ${escapeHtml(delivery.message_bytes || 0)}바이트` : ""}</p>
            ${delivery.message_body ? `<p style="white-space:pre-line;">${escapeHtml(delivery.message_body)}</p>` : ""}
            ${delivery.status === "failed" && delivery.last_error ? `<p class="muted">발송 오류: ${escapeHtml(delivery.last_error)}</p>` : ""}
          </div>
        `).join("") || `<div class="empty compact-empty">아직 자동 문자 발송 이력이 없습니다.</div>`}
      </div>
    </section>
  `;
}

function renderDashboard() {
  const publicReviews = visibleReviews().length;
  const hiddenReviews = state.reviews.length - publicReviews;
  const applications = activeApplications();
  elements.adminContent.innerHTML = `
    <h2>운영 현황</h2>
    <div class="stat-grid" style="margin-bottom: 16px;">
      <div class="stat" style="background:#fff;color:var(--ink);"><strong>${state.organizations.length}</strong><span>단체</span></div>
      <div class="stat" style="background:#fff;color:var(--ink);"><strong>${state.courses.length}</strong><span>교육</span></div>
      <div class="stat" style="background:#fff;color:var(--ink);"><strong>${applications.length}</strong><span>신청</span></div>
      <div class="stat" style="background:#fff;color:var(--ink);"><strong>${state.archives.length}</strong><span>아카이브</span></div>
      <div class="stat" style="background:#fff;color:var(--ink);"><strong>${state.reviews.length}</strong><span>후기</span></div>
    </div>
    <div class="admin-grid">
      <div class="section"><h3>교육 신청</h3><p>현재 신청 ${applications.length}건</p></div>
      <div class="section"><h3>후기 관리</h3><p>공개 후기 ${publicReviews}개 · 숨김 ${hiddenReviews}개</p></div>
      ${isOwner() ? `<div class="section"><h3>관리자 전용 추첨</h3><p>추첨 기록 ${state.draws.length}건 · 당첨 이력 ${state.winners.length}건</p></div>` : ""}
    </div>
    ${renderSmsDeliveryHistory()}
    ${renderSkySmsTest()}
    ${renderDashboardMetricSection("organization")}
    ${renderDashboardMetricSection("instructor")}
    ${renderDemographicSummary()}
    <div class="section" style="margin-top: 16px;">
      <h3>후기 주요 단어</h3>
      <p class="muted">후기 본문에서 자주 등장한 단어를 간단 집계한 결과입니다. 조사와 일부 일반어는 제외했습니다.</p>
      ${renderReviewKeywordChart()}
    </div>
  `;
}

function renderOrganizationForm(organization = {}) {
  const logoUrl = normalizeSafeUrl(organization.logo_url, URL_RULES.image);
  const isEditing = Boolean(organization.id);
  const canManageStructure = isOwner();
  if (!canManageStructure && !isEditing) {
    return `<div class="section empty">연결된 단체가 없습니다. 전체 관리자에게 단체 연결을 요청해 주세요.</div>`;
  }
  return `
    <form id="organizationForm" class="section">
      <input type="hidden" name="organization_id" value="${escapeHtml(organization.id || "")}">
      <div class="admin-grid">
        ${canManageStructure
          ? `<label>단체명<input name="name" value="${escapeHtml(organization.name || "")}" required></label>
             <label>주소 이름(선택)<input name="slug" value="${escapeHtml(organization.slug || "")}" placeholder="비워두면 자동 생성"></label>
             <label>정렬 순서<input name="sort_order" type="number" value="${escapeHtml(organization.sort_order ?? 0)}"></label>`
          : `<label>단체명<input value="${escapeHtml(organization.name || "")}" readonly></label>`}
        <label>홈페이지<input name="website_url" value="${escapeHtml(organization.website_url || "")}" placeholder="https://"></label>
      </div>
      <label style="margin-top: 10px;">단체 소개<textarea name="description" placeholder="공개 페이지에 표시할 단체 소개를 입력하세요.">${escapeHtml(organization.description || "")}</textarea></label>
      ${logoUrl ? `<div class="media-preview"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(organization.name || "단체")} 로고"><a href="${escapeHtml(logoUrl)}" target="_blank" rel="noreferrer">현재 로고 보기</a></div>` : ""}
      <label style="margin-top: 10px;">로고 이미지 업로드<input name="logo_file" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
      <p class="media-upload-note">JPG, PNG, WEBP, GIF 형식 · 5MB 이하. 파일을 선택하면 저장할 때 Supabase Storage에 업로드됩니다.</p>
      <label style="margin-top: 10px;">로고 이미지 URL<input name="logo_url" value="${escapeHtml(organization.logo_url || "")}" placeholder="https://"></label>
      <label style="margin-top: 10px;">연락처<input name="contact_email" value="${escapeHtml(organization.contact_email || "")}" placeholder="이메일, 전화번호, 담당자 연락처 등"></label>
      ${canManageStructure
        ? `<label style="margin-top: 10px;"><span><input name="is_active" type="checkbox" ${organization.is_active !== false ? "checked" : ""} style="width:auto;min-height:auto;"> 공개 페이지에 표시</span></label>`
        : `<p class="muted" style="margin-top: 10px;">단체명, 주소 이름, 정렬 순서와 공개 여부는 전체 관리자가 관리합니다.</p>`}
      <div class="actions" style="margin-top: 14px;">
        <button class="btn" type="submit">${canManageStructure ? (isEditing ? "단체 수정" : "단체 추가") : "단체 정보 저장"}</button>
        ${canManageStructure ? `<button class="btn secondary" type="button" id="newOrganizationButton">새 단체 입력</button>` : ""}
        ${canManageStructure && isEditing ? `<button class="btn danger" type="button" data-delete-entity="organization" data-entity-id="${escapeHtml(organization.id)}">단체 삭제</button>` : ""}
      </div>
    </form>
  `;
}

function renderOrganizations() {
  const defaultManagedId = isOwner() ? "" : (state.organizations[0]?.id || "");
  const requestedId = state.adminSelections.organizationId || "";
  const selectedId = state.organizations.some((organization) => organization.id === requestedId)
    ? requestedId
    : defaultManagedId;
  if (state.adminSelections.organizationId !== selectedId) {
    state.adminSelections.organizationId = selectedId;
  }
  const selectedOrganization = state.organizations.find((organization) => organization.id === selectedId) || {};
  elements.adminContent.innerHTML = `
    <h2>단체 관리</h2>
    <p class="muted">${isOwner()
      ? "공개 페이지의 참여 단체 소개와 단체별 교육 모아보기에 사용됩니다."
      : "연결된 단체의 소개, 홈페이지, 연락처와 로고를 보완할 수 있습니다."}</p>
    ${renderAdminSearchPicker({
      kind: "organization",
      label: "수정할 단체 검색",
      placeholder: "단체명, 소개, 홈페이지, 연락처로 검색",
      query: state.adminSearch.organization,
      selectedItem: selectedOrganization,
      items: state.organizations,
      textBuilder: organizationSearchText,
      resultBuilder: organizationResultHtml,
      emptyText: "검색어에 맞는 단체가 없습니다.",
      hideResultsUntilQuery: true,
      emptyQueryText: "단체명, 소개, 홈페이지, 연락처 중 하나를 입력하면 검색 결과가 표시됩니다.",
    })}
    <div style="margin-top: 14px;">${renderOrganizationForm(selectedOrganization)}</div>
  `;
}

function renderInstructorForm(instructor = {}) {
  const photoUrl = normalizeSafeUrl(instructor.photo_url, URL_RULES.image);
  const profileUrl = normalizeSafeUrl(instructor.profile_url, URL_RULES.external);
  const isEditing = Boolean(instructor.id);
  return `
    <form id="instructorForm" class="section">
      <input type="hidden" name="instructor_id" value="${escapeHtml(instructor.id || "")}">
      <div class="admin-grid">
        <label>강사명<input name="name" value="${escapeHtml(instructor.name || "")}" required></label>
        <label>직함/소개 한 줄<input name="title" value="${escapeHtml(instructor.title || "")}" placeholder="예: 인문학 연구자, 작가, 기획자"></label>
      </div>
      <label style="margin-top: 10px;">프로필 소개<textarea name="bio" placeholder="공개 페이지에 표시할 강사 소개를 입력하세요.">${escapeHtml(instructor.bio || "")}</textarea></label>
      ${photoUrl ? `<div class="media-preview"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(instructor.name || "강사")} 사진"><a href="${escapeHtml(photoUrl)}" target="_blank" rel="noreferrer">현재 사진 보기</a></div>` : ""}
      <label style="margin-top: 10px;">프로필 사진 업로드<input name="photo_file" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
      <p class="media-upload-note">JPG, PNG, WEBP, GIF 형식 · 5MB 이하. 파일을 선택하면 저장할 때 Supabase Storage에 업로드됩니다.</p>
      <label style="margin-top: 10px;">프로필 사진 URL<input name="photo_url" value="${escapeHtml(instructor.photo_url || "")}" placeholder="https://"></label>
      <label style="margin-top: 10px;">홈페이지/SNS URL<input name="profile_url" value="${escapeHtml(instructor.profile_url || "")}" placeholder="https://"></label>
      ${profileUrl ? `<p class="muted"><a href="${escapeHtml(profileUrl)}" target="_blank" rel="noreferrer">현재 홈페이지/SNS 열기</a></p>` : ""}
      <label style="margin-top: 10px;"><span><input name="is_active" type="checkbox" ${instructor.is_active !== false ? "checked" : ""} style="width:auto;min-height:auto;"> 공개 페이지에서 사용</span></label>
      <div class="actions" style="margin-top: 14px;">
        <button class="btn" type="submit">${isEditing ? "강사 수정" : "강사 추가"}</button>
        <button class="btn secondary" type="button" id="newInstructorButton">새 강사 입력</button>
        ${isEditing ? `<button class="btn danger" type="button" data-delete-entity="instructor" data-entity-id="${escapeHtml(instructor.id)}">강사 삭제</button>` : ""}
      </div>
    </form>
  `;
}

function renderInstructors() {
  const selectedId = state.adminSelections.instructorId || "";
  const selectedInstructor = state.instructors.find((instructor) => instructor.id === selectedId) || {};
  elements.adminContent.innerHTML = `
    <h2>강사 관리</h2>
    <p class="muted">교육 상세 화면에서 강사 프로필로 표시됩니다.</p>
    ${renderAdminSearchPicker({
      kind: "instructor",
      label: "수정할 강사 검색",
      placeholder: "강사명, 직함, 소개, 홈페이지/SNS로 검색",
      query: state.adminSearch.instructor,
      selectedItem: selectedInstructor,
      items: state.instructors,
      textBuilder: instructorSearchText,
      resultBuilder: instructorResultHtml,
      emptyText: "검색어에 맞는 강사가 없습니다.",
      hideResultsUntilQuery: true,
      emptyQueryText: "강사명, 직함, 소개, 홈페이지/SNS 중 하나를 입력하면 검색 결과가 표시됩니다.",
    })}
    <div style="margin-top: 14px;">${renderInstructorForm(selectedInstructor)}</div>
  `;
}

function renderVenueForm(venue = {}) {
  const isEditing = Boolean(venue.id);
  const canEdit = !isEditing || canManageVenue(venue);
  const ownershipLabel = venueOwnershipLabel(venue);
  if (!canEdit) {
    const kakaoMapUrl = normalizeSafeUrl(venue.kakao_map_url, URL_RULES.kakaoMap);
    const naverPlaceUrl = normalizeSafeUrl(venue.naver_place_url, URL_RULES.naverPlace);
    return `
      <section class="section">
        <div class="row-top">
          <strong>${escapeHtml(venue.name || "장소명 없음")}</strong>
          <span class="badge gray">${escapeHtml(ownershipLabel)}</span>
        </div>
        <p>${escapeHtml(venue.address || "주소 없음")}${venue.detail ? ` · ${escapeHtml(venue.detail)}` : ""}</p>
        <p class="muted">이 장소는 교육 관리에서 선택할 수 있지만, 수정과 삭제는 소유 단체 관리자 또는 전체 관리자만 할 수 있습니다.</p>
        <div class="actions">
          ${kakaoMapUrl ? `<a class="btn small secondary" href="${escapeHtml(kakaoMapUrl)}" target="_blank" rel="noreferrer">카카오맵 보기</a>` : ""}
          ${naverPlaceUrl ? `<a class="btn small secondary" href="${escapeHtml(naverPlaceUrl)}" target="_blank" rel="noreferrer">네이버플레이스 보기</a>` : ""}
          <button class="btn" type="button" id="newVenueButton">내 단체 장소 추가</button>
        </div>
      </section>
    `;
  }

  const selectedOrganizationId = isEditing
    ? String(venue.organization_id || "")
    : (isOwner() ? "" : (state.organizations.length === 1 ? state.organizations[0].id : ""));
  let ownershipField = "";
  if (isOwner()) {
    ownershipField = `
      <label>장소 소유
        <select name="organization_id">
          <option value="" ${selectedOrganizationId ? "" : "selected"}>공용 장소</option>
          ${state.organizations.map((organization) => `<option value="${escapeHtml(organization.id)}" ${organization.id === selectedOrganizationId ? "selected" : ""}>${escapeHtml(organization.name)}</option>`).join("")}
        </select>
      </label>
    `;
  } else if (isEditing || state.organizations.length === 1) {
    const organization = organizationById(selectedOrganizationId);
    ownershipField = `
      <input type="hidden" name="organization_id" value="${escapeHtml(selectedOrganizationId)}">
      <label>장소 소유<input value="${escapeHtml(organization?.name || "담당 단체")}" readonly></label>
    `;
  } else {
    ownershipField = `
      <label>장소 소유
        <select name="organization_id" required>
          <option value="">담당 단체 선택</option>
          ${state.organizations.map((organization) => `<option value="${escapeHtml(organization.id)}">${escapeHtml(organization.name)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  return `
    <form id="venueForm" class="section">
      <input type="hidden" name="venue_id" value="${escapeHtml(venue.id || "")}">
      <div class="admin-grid">
        <label>장소명<input name="name" value="${escapeHtml(venue.name || "")}" required></label>
        <label>세부 장소<input name="detail" value="${escapeHtml(venue.detail || "")}" placeholder="예: 2층 세미나실"></label>
        ${ownershipField}
      </div>
      <label style="margin-top: 10px;">주소<input name="address" value="${escapeHtml(venue.address || "")}" placeholder="지도 검색에 사용할 주소"></label>
      <div class="admin-grid" style="margin-top: 10px;">
        <label>카카오맵 URL<input name="kakao_map_url" value="${escapeHtml(venue.kakao_map_url || "")}" placeholder="https://map.kakao.com/..."></label>
        <label>네이버플레이스 URL<input name="naver_place_url" value="${escapeHtml(venue.naver_place_url || "")}" placeholder="https://map.naver.com/... 또는 place.naver.com/..."></label>
      </div>
      <label style="margin-top: 10px;"><span><input name="is_online" type="checkbox" ${venue.is_online ? "checked" : ""} style="width:auto;min-height:auto;"> 온라인 장소</span></label>
      <div class="actions" style="margin-top: 14px;">
        <button class="btn" type="submit">${isEditing ? "장소 수정" : "장소 추가"}</button>
        <button class="btn secondary" type="button" id="newVenueButton">새 장소 입력</button>
        ${isEditing ? `<button class="btn danger" type="button" data-delete-entity="venue" data-entity-id="${escapeHtml(venue.id)}">장소 삭제</button>` : ""}
      </div>
    </form>
  `;
}

function renderVenues() {
  const selectedId = state.adminSelections.venueId || "";
  const selectedVenue = state.venues.find((venue) => venue.id === selectedId) || {};
  elements.adminContent.innerHTML = `
    <h2>장소 관리</h2>
    <p class="muted">${isOwner()
      ? "공용 장소와 단체별 장소를 모두 관리합니다. 교육 상세 화면에 정확한 주소와 지도 링크가 표시되도록 입력해 주세요."
      : "담당 단체 장소를 직접 추가·수정할 수 있습니다. 공용 장소와 다른 단체 장소는 교육에서 선택할 수 있지만 수정할 수 없습니다."}</p>
    ${renderAdminSearchPicker({
      kind: "venue",
      label: "수정할 장소 검색",
      placeholder: "장소명, 주소, 세부 장소, 소유 단체, 지도 URL로 검색",
      query: state.adminSearch.venue,
      selectedItem: selectedVenue,
      items: state.venues,
      textBuilder: venueSearchText,
      resultBuilder: venueResultHtml,
      emptyText: "검색어에 맞는 장소가 없습니다.",
      hideResultsUntilQuery: true,
      emptyQueryText: "장소명, 주소, 세부 장소, 소유 단체, 지도 URL 중 하나를 입력하면 검색 결과가 표시됩니다.",
    })}
    <div style="margin-top: 14px;">${renderVenueForm(selectedVenue)}</div>
  `;
}

function renderCourseSeriesAdmin(course = {}) {
  const series = courseSeriesPosition(course);
  if (!series) return "";
  const linkedCourses = coursesInSeries(course.series_id);
  return `
    <div class="series-admin-panel">
      <div class="row-top">
        <strong>현재 연강 ${series.position}/${series.total}</strong>
        <button class="btn small secondary" type="button" data-detach-course-series="${escapeHtml(course.id)}">연강 연결 해제</button>
      </div>
      <ol class="series-admin-list">
        ${linkedCourses.map((linkedCourse, index) => `
          <li class="${linkedCourse.id === course.id ? "current" : ""}">
            <span><strong>${index + 1}. ${escapeHtml(linkedCourse.title || "교육명 없음")}</strong>${linkedCourse.subtitle ? `<br><span class="muted">${escapeHtml(linkedCourse.subtitle)}</span>` : ""}</span>
            <span class="muted">${escapeHtml(shortDate(linkedCourse.starts_at))}${linkedCourse.id === course.id ? " · 현재 교육" : ""}</span>
          </li>
        `).join("")}
      </ol>
    </div>
  `;
}

function courseSeriesDateLabel(series) {
  const firstCourse = series.courses[0];
  const lastCourse = series.courses.at(-1);
  const firstDate = shortDate(firstCourse?.starts_at);
  const lastDate = shortDate(lastCourse?.starts_at);
  return firstDate === lastDate ? firstDate : `${firstDate} ~ ${lastDate}`;
}

function courseSeriesManagementResultHtml(series, selectedSeriesId = "") {
  const firstCourse = series.courses[0];
  return `
    <button class="admin-search-result ${series.id === selectedSeriesId ? "selected" : ""}" type="button" data-select-course-series="${escapeHtml(series.id)}">
      <span class="admin-search-title">
        <strong>${escapeHtml(firstCourse?.title || "교육명 없음")} 외 ${Math.max(0, series.courses.length - 1)}개</strong>
        <span class="badge">연강 ${series.courses.length}회</span>
      </span>
      ${firstCourse?.subtitle ? `<span>${escapeHtml(firstCourse.subtitle)}</span>` : ""}
      <span class="muted">${escapeHtml(courseSeriesDateLabel(series))} · ${escapeHtml(courseSeriesOrganizationLabel(series))}</span>
    </button>
  `;
}

function courseSeriesManagementResultsHtml() {
  const groups = courseSeriesGroups();
  if (!groups.length) {
    return `<div class="empty">현재 연결된 연강이 없습니다. 개별 교육 등록에서 후속 교육의 앞 교육을 선택하면 연강이 만들어집니다.</div>`;
  }

  const query = state.courseManagement.seriesQuery;
  if (!normalizeSearchText(query)) {
    return `<p class="muted">교육명, 부제, 주제, 단체, 강사, 장소 중 하나를 입력하면 연강 검색 결과가 표시됩니다.</p>`;
  }

  const results = searchItems(groups, query, courseSeriesSearchText, COURSE_PICKER_LIMIT);
  return `
    <div class="admin-search-results">
      ${results.map((series) => courseSeriesManagementResultHtml(series, state.courseManagement.selectedSeriesId)).join("") || `<div class="empty">검색어에 맞는 연강이 없습니다.</div>`}
    </div>
  `;
}

function renderSelectedCourseSeries(series) {
  if (!series) return "";
  const lastCourse = series.courses.at(-1);
  return `
    <section class="series-management-panel">
      <div class="section-heading">
        <div>
          <h3>${escapeHtml(series.courses[0]?.title || "교육명 없음")} 연강</h3>
          <p class="muted">${escapeHtml(courseSeriesDateLabel(series))} · ${escapeHtml(courseSeriesOrganizationLabel(series))} · 총 ${series.courses.length}회</p>
        </div>
        <div class="actions">
          <button class="btn small" type="button" data-add-course-to-series="${escapeHtml(lastCourse?.id || "")}">후속 교육 추가</button>
          <button class="btn small danger" type="button" data-dissolve-course-series="${escapeHtml(series.id)}">연강 전체 해제</button>
        </div>
      </div>
      <p class="muted">교육 내용과 일정은 각 교육에서 수정합니다. 교육을 분리하거나 연강 전체를 해제해도 교육·신청·참석·후기·아카이브는 삭제되지 않습니다.</p>
      <ol class="series-management-list">
        ${series.courses.map((course, index) => `
          <li>
            <span class="series-management-order">${index + 1}</span>
            <span class="series-management-copy">
              <strong>${escapeHtml(course.title || "교육명 없음")}</strong>
              ${course.subtitle ? `<span>${escapeHtml(course.subtitle)}</span>` : ""}
              <small>${escapeHtml(shortDate(course.starts_at))} · ${escapeHtml(organizationById(course.organization_id)?.name || "단체 미정")}</small>
            </span>
            <span class="series-management-status">${statusBadge(effectiveCourseStatus(course))}</span>
            <span class="actions">
              <button class="btn small secondary" type="button" data-edit-series-course="${escapeHtml(course.id)}">교육 수정</button>
              <button class="btn small secondary" type="button" data-detach-course-series="${escapeHtml(course.id)}">이 교육 분리</button>
            </span>
          </li>
        `).join("")}
      </ol>
    </section>
  `;
}

function standaloneCoursesForSeriesCreation() {
  return state.courses
    .filter((course) => !course.series_id && course.status !== "cancelled")
    .slice()
    .sort((a, b) => {
      const timeDifference = new Date(a.starts_at || 0) - new Date(b.starts_at || 0);
      if (timeDifference) return timeDifference;
      return (a.title || "").localeCompare(b.title || "", "ko");
    });
}

function selectedCoursesForSeriesCreation() {
  const selectedIds = new Set(state.courseManagement.createCourseIds);
  return standaloneCoursesForSeriesCreation().filter((course) => selectedIds.has(course.id));
}

function courseSeriesCreateResultHtml(course) {
  const isSelected = state.courseManagement.createCourseIds.includes(course.id);
  const organization = organizationById(course.organization_id);
  const instructor = instructorById(course.instructor_id);
  return `
    <button class="admin-search-result ${isSelected ? "selected" : ""}" type="button" data-add-course-series-selection="${escapeHtml(course.id)}" ${isSelected ? "disabled" : ""}>
      <span class="admin-search-title">
        <strong>${escapeHtml(course.title || "교육명 없음")}</strong>
        ${isSelected ? `<span class="badge green">선택됨</span>` : statusBadge(effectiveCourseStatus(course))}
      </span>
      ${course.subtitle ? `<span>${escapeHtml(course.subtitle)}</span>` : ""}
      <span class="muted">${escapeHtml(formatDateTime(course.starts_at))} · ${escapeHtml(organization?.name || "단체 미정")} · ${escapeHtml(instructor?.name || "강사 미정")}</span>
    </button>
  `;
}

function courseSeriesCreateResultsHtml() {
  const query = state.courseManagement.createQuery;
  if (!normalizeSearchText(query)) {
    return `<p class="muted">교육명, 부제, 주제, 단체, 강사, 장소 중 하나를 입력하면 아직 연강에 속하지 않은 교육이 표시됩니다.</p>`;
  }
  const results = searchItems(standaloneCoursesForSeriesCreation(), query, courseSearchText, COURSE_PICKER_LIMIT);
  return `
    <div class="admin-search-results compact">
      ${results.map(courseSeriesCreateResultHtml).join("") || `<div class="empty">검색어에 맞는 단독 교육이 없습니다.</div>`}
    </div>
  `;
}

function courseSeriesCreateSelectedHtml() {
  const courses = selectedCoursesForSeriesCreation();
  return `
    <div class="series-create-selected-header">
      <strong>선택한 교육 ${courses.length}개</strong>
      <span class="muted">교육 시작일 기준으로 자동 정렬됩니다.</span>
    </div>
    ${courses.length ? `
      <ol class="series-create-selected-list">
        ${courses.map((course, index) => `
          <li>
            <span class="series-management-order">${index + 1}</span>
            <span class="series-management-copy">
              <strong>${escapeHtml(course.title || "교육명 없음")}</strong>
              ${course.subtitle ? `<span>${escapeHtml(course.subtitle)}</span>` : ""}
              <small>${escapeHtml(formatDateTime(course.starts_at))} · ${escapeHtml(organizationById(course.organization_id)?.name || "단체 미정")}</small>
            </span>
            <button class="btn small secondary" type="button" data-remove-course-series-selection="${escapeHtml(course.id)}">선택 해제</button>
          </li>
        `).join("")}
      </ol>
    ` : `<div class="empty compact-empty">연강으로 묶을 교육을 2개 이상 선택해 주세요.</div>`}
    <div class="actions" style="margin-top: 14px;">
      <button class="btn" type="button" data-create-course-series-batch ${courses.length >= 2 ? "" : "disabled"}>선택한 교육으로 연강 만들기</button>
      <button class="btn secondary" type="button" data-close-admin-notice>취소</button>
    </div>
  `;
}

function renderCourseSeriesCreateModalBody() {
  return `
    <div class="admin-search-picker">
      <p class="muted">기존 단독 교육을 여러 개 선택한 뒤 한 번만 저장합니다. 교육·신청·후기 데이터는 그대로 두고 연강 연결과 순서만 추가합니다.</p>
      <label>연강에 넣을 교육 검색<input type="search" data-course-series-create-search value="${escapeHtml(state.courseManagement.createQuery)}" placeholder="교육명, 부제, 주제, 단체, 강사, 장소로 검색" autocomplete="off"></label>
      <div data-course-series-create-results>${courseSeriesCreateResultsHtml()}</div>
      <div class="series-create-selected" data-course-series-create-selected>${courseSeriesCreateSelectedHtml()}</div>
    </div>
  `;
}

function openCourseSeriesCreateModal() {
  state.courseManagement.createQuery = "";
  state.courseManagement.createCourseIds = [];
  openAdminNotice("새 연강 만들기", renderCourseSeriesCreateModalBody());
  window.requestAnimationFrame(() => document.querySelector("[data-course-series-create-search]")?.focus());
}

function updateCourseSeriesCreateModal() {
  const resultsContainer = document.querySelector("[data-course-series-create-results]");
  if (resultsContainer) resultsContainer.innerHTML = courseSeriesCreateResultsHtml();
  const selectedContainer = document.querySelector("[data-course-series-create-selected]");
  if (selectedContainer) selectedContainer.innerHTML = courseSeriesCreateSelectedHtml();
}

function addCourseSeriesCreateSelection(courseId) {
  const course = standaloneCoursesForSeriesCreation().find((item) => item.id === courseId);
  if (!course || state.courseManagement.createCourseIds.includes(course.id)) return;
  state.courseManagement.createCourseIds.push(course.id);
  updateCourseSeriesCreateModal();
}

function removeCourseSeriesCreateSelection(courseId) {
  state.courseManagement.createCourseIds = state.courseManagement.createCourseIds.filter((id) => id !== courseId);
  updateCourseSeriesCreateModal();
}

async function createCourseSeriesBatch() {
  const courses = selectedCoursesForSeriesCreation();
  if (courses.length < 2) throw new Error("연강으로 묶을 교육을 2개 이상 선택해 주세요.");
  const startTimes = courses.map((course) => new Date(course.starts_at).getTime());
  if (new Set(startTimes).size !== startTimes.length) {
    throw new Error("시작 일시가 같은 교육은 연강 순서를 정할 수 없습니다. 교육 일시를 먼저 조정해 주세요.");
  }

  const { data, error } = await supabase.rpc("create_course_series", {
    p_course_ids: courses.map((course) => course.id),
  });
  if (error) throw error;
  if (!data) throw new Error("생성된 연강 정보를 확인하지 못했습니다.");

  closeModal(elements.adminNoticeModal);
  state.courseManagement.createQuery = "";
  state.courseManagement.createCourseIds = [];
  await reload();
  state.tab = "courses";
  state.courseManagement.mode = "series";
  state.courseManagement.selectedSeriesId = String(data);
  render();
  showToast(`교육 ${courses.length}개를 한 번에 연강으로 만들었습니다.`);
}

function renderCourseSeriesManagement() {
  const groups = courseSeriesGroups();
  const selectedSeries = groups.find((series) => series.id === state.courseManagement.selectedSeriesId);
  return `
    <div class="row-top">
      <p class="muted">연결된 연강을 검색해 구성 교육을 수정하거나 분리할 수 있습니다. 연강 전체 해제는 연결만 지우며 교육 자체는 보존합니다.</p>
      <button class="btn" type="button" data-open-course-series-create>새 연강 만들기</button>
    </div>
    <div class="admin-search-picker" style="margin-top: 14px;">
      <label>관리할 연강 검색<input type="search" data-course-series-search value="${escapeHtml(state.courseManagement.seriesQuery)}" placeholder="교육명, 부제, 주제, 단체, 강사, 장소로 검색" autocomplete="off"></label>
      <div data-course-series-results>${courseSeriesManagementResultsHtml()}</div>
    </div>
    ${renderSelectedCourseSeries(selectedSeries)}
  `;
}

function renderCourseForm(course = {}) {
  const isEditing = Boolean(course.id);
  const seriesPreviousCourseId = isEditing ? "" : state.courseManagement.draftPreviousCourseId;
  const isDeleteAllowed = canDeleteCourse(course);
  const firstSession = state.sessions.find((session) => session.course_id === course.id) || {};
  const startValue = localDateTimeValue(course.starts_at || firstSession.starts_at);
  const endValue = localDateTimeValue(course.ends_at || firstSession.ends_at);
  const nowValue = currentMinuteLocalDateTimeValue();
  const startMinValue = startValue && isBeforeCurrentMinute(new Date(startValue)) ? "" : nowValue;
  const endMinValue = startValue || nowValue;
  const previewStatus = course.status === "cancelled" ? "cancelled" : (hasCourseEnded({ ...course, starts_at: course.starts_at || firstSession.starts_at, ends_at: course.ends_at || firstSession.ends_at }) ? "finished" : "open");
  const autoStatusNote = `
    <p class="muted" style="margin-top: 8px;">
      상태는 자동으로 관리됩니다. 교육 전에는 ${statusBadge("open")}으로 저장되고, 종료 일시가 지나면 ${statusBadge("finished")}가 됩니다.
      종료 일시가 없으면 시작일 다음날부터 종료로 처리합니다. 현재 저장 기준: ${statusBadge(previewStatus)}
    </p>
  `;
  return `
    <form id="courseForm" class="section">
      <input type="hidden" name="course_id" value="${escapeHtml(course.id || "")}">
      ${!isEditing && state.courseTemplate.sourceCourseId ? `
        <div class="admin-search-selected" style="margin-bottom: 12px;">
          <span><strong>${escapeHtml(state.courseTemplate.sourceTitle)}</strong> 내용을 불러왔습니다. 새 교육으로 저장됩니다.</span>
          <span class="muted">일정·자료·신청·후기·아카이브는 복사하지 않습니다.</span>
        </div>
      ` : ""}
      <div class="admin-grid">
        <label>교육명<input name="title" value="${escapeHtml(course.title || "")}" required></label>
        <label>부제(선택)<input name="subtitle" value="${escapeHtml(course.subtitle || "")}" maxlength="240" placeholder="제목을 보완하는 설명"></label>
        <label>주제(선택)<input name="topic" value="${escapeHtml(course.topic || "")}" maxlength="120"></label>
        ${renderCoursePickerField("organization", course.organization_id || "")}
        ${renderCoursePickerField("instructor", course.instructor_id || "")}
        ${renderCoursePickerField("venue", course.venue_id || "")}
        <label>시작 일시<input name="starts_at" type="datetime-local" value="${escapeHtml(startValue)}" min="${escapeHtml(startMinValue)}" required></label>
        <label>종료 일시(선택)<input name="ends_at" type="datetime-local" value="${escapeHtml(endValue)}" min="${escapeHtml(endMinValue)}"></label>
        ${renderCoursePickerField("series", seriesPreviousCourseId)}
      </div>
      ${renderCourseSeriesAdmin(course)}
      ${autoStatusNote}
      <label style="margin-top: 10px;">요약<textarea name="summary">${escapeHtml(course.summary || "")}</textarea></label>
      <label style="margin-top: 10px;">상세 설명<textarea name="description">${escapeHtml(course.description || "")}</textarea></label>
      <div class="admin-grid" style="margin-top: 10px;">
        <label>교육 자료 제목<input name="course_file_title" placeholder="예: 강의계획서, 읽기 자료"></label>
        <label>교육 자료 PDF 업로드<input name="course_file" type="file" accept="application/pdf,.pdf"></label>
      </div>
      <p class="media-upload-note">PDF 15MB 이하. 저장하면 해당 교육의 공개 자료로 함께 등록됩니다.</p>
      <label style="margin-top: 10px;"><span><input name="published" type="checkbox" ${course.published !== false ? "checked" : ""} style="width:auto;min-height:auto;"> 공개</span></label>
      <div class="actions" style="margin-top: 14px;">
        <button class="btn" type="submit">${isEditing ? "교육 수정" : "교육 추가"}</button>
        <button class="btn secondary" type="button" id="newCourseButton">새 교육 입력</button>
        ${!isEditing ? `<button class="btn secondary" type="button" data-open-course-template>기존 교육 불러오기</button>` : ""}
        ${isEditing && isDeleteAllowed ? `<button class="btn danger" type="button" data-delete-course="${escapeHtml(course.id)}">교육 삭제</button>` : ""}
        ${isEditing && !isDeleteAllowed ? `<button class="btn danger" type="button" disabled>완료 교육 삭제 불가</button>` : ""}
      </div>
      ${isEditing && !isDeleteAllowed ? `<p class="muted" style="margin-top: 8px;">이미 완료된 교육은 삭제할 수 없습니다.</p>` : ""}
      ${isEditing && isDeleteAllowed ? `<p class="muted" style="margin-top: 8px;">삭제하면 ${escapeHtml(courseDeleteSummary(course.id))}도 함께 정리됩니다.</p>` : ""}
    </form>
  `;
}

function renderCourses() {
  const selectedId = state.adminSelections.courseId || "";
  const selectedCourse = selectedId
    ? state.courses.find((course) => course.id === selectedId) || {}
    : state.courseTemplate.draft || {};
  elements.adminContent.innerHTML = `
    <div class="section-heading">
      <div>
        <h2>교육 관리</h2>
        <p class="muted">개별 교육 정보와 여러 교육을 묶은 연강 연결을 나누어 관리합니다.</p>
      </div>
      <div class="page-tabs course-management-tabs" aria-label="교육 관리 구분">
        <button class="btn small ${state.courseManagement.mode === "courses" ? "" : "secondary"}" type="button" data-course-management-mode="courses">개별 교육</button>
        <button class="btn small ${state.courseManagement.mode === "series" ? "" : "secondary"}" type="button" data-course-management-mode="series">연강 관리 ${courseSeriesGroups().length ? `(${courseSeriesGroups().length})` : ""}</button>
      </div>
    </div>
    ${state.courseManagement.mode === "series" ? renderCourseSeriesManagement() : `
      <p class="muted">새 교육을 등록하거나 기존 교육을 수정합니다. 후속 교육은 앞 교육을 선택해 연강으로 연결할 수 있습니다.</p>
      ${renderAdminSearchPicker({
        kind: "course",
        label: "수정할 교육 검색",
        placeholder: "교육명, 부제, 주제, 단체, 강사, 장소, 상태로 검색",
        query: state.adminSearch.course,
        selectedItem: selectedCourse,
        items: state.courses,
        textBuilder: courseSearchText,
        resultBuilder: courseResultHtml,
        emptyText: "검색어에 맞는 교육이 없습니다.",
        hideResultsUntilQuery: true,
        emptyQueryText: "교육명, 부제, 주제, 단체, 강사, 장소, 상태 중 하나를 입력하면 검색 결과가 표시됩니다.",
      })}
      <div style="margin-top: 14px;">${renderCourseForm(selectedCourse)}</div>
    `}
  `;
}

function renderArchive() {
  const selectedId = state.selectedArchiveId || document.getElementById("archivePicker")?.value || "";
  const selectedArchive = archiveById(selectedId) || {};
  state.selectedArchiveId = selectedArchive.id || "";
  const isEditing = Boolean(selectedArchive.id);
  elements.adminContent.innerHTML = `
    <h2>아카이브 등록</h2>
    <p class="muted">영상은 YouTube/Vimeo 등 외부 링크를 권장합니다. 사진이나 PDF는 Supabase Storage에 업로드할 수 있습니다. 등록한 아카이브는 공개 페이지에 노출되므로 참여자 촬영·공개 동의를 확인한 자료만 올려 주세요.</p>
    <label>수정할 아카이브 선택<select id="archivePicker"><option value="">새 아카이브</option>${state.archives.map((item) => `<option value="${item.id}" ${item.id === selectedArchive.id ? "selected" : ""}>${escapeHtml(item.title)} · ${escapeHtml(courseName(item.course_id))}</option>`).join("")}</select></label>
    <form id="archiveForm" class="section">
      <input type="hidden" name="archive_id" value="${escapeHtml(selectedArchive.id || "")}">
      <div>
        <span class="course-picker-label">교육 *</span>
        ${renderCourseFilterControl("archive", selectedArchive.course_id || "", { emptyLabel: "교육을 선택하지 않았습니다.", required: true })}
      </div>
      <div class="admin-grid" style="margin-top: 10px;">
        <label>자료 유형<select name="type"><option value="photo" ${selectedArchive.type === "photo" ? "selected" : ""}>사진</option><option value="video" ${selectedArchive.type === "video" ? "selected" : ""}>영상</option><option value="file" ${selectedArchive.type === "file" ? "selected" : ""}>파일</option><option value="link" ${selectedArchive.type === "link" ? "selected" : ""}>링크</option></select></label>
        <label>제목<input name="title" value="${escapeHtml(selectedArchive.title || "")}" required></label>
      </div>
      <label style="margin-top: 10px;">외부 URL<input name="url" value="${escapeHtml(selectedArchive.url || "")}" placeholder="영상 링크 또는 업로드 파일이 없을 때 입력"></label>
      <label style="margin-top: 10px;">파일 업로드<input name="files" type="file" accept="image/*,.pdf" multiple></label>
      <p class="media-upload-note">사진은 여러 장을 선택할 수 있습니다. 기존 아카이브 수정 중 여러 장을 선택하면 첫 파일은 현재 항목을 대체하고 나머지는 새 항목으로 추가됩니다.</p>
      <label style="margin-top: 10px;">설명(선택)<textarea name="caption">${escapeHtml(selectedArchive.caption || "")}</textarea></label>
      <p class="media-upload-note">아카이브는 공개 자료입니다. 내부 운영 문서나 개인정보가 포함된 파일은 업로드하지 마세요.</p>
      <div class="actions" style="margin-top: 14px;">
        <button class="btn" type="submit">${isEditing ? "아카이브 수정" : "아카이브 등록"}</button>
        <button class="btn secondary" type="button" id="newArchiveButton">새 아카이브 입력</button>
        ${isEditing ? `<button class="btn danger" type="button" data-delete-archive="${escapeHtml(selectedArchive.id)}">삭제</button>` : ""}
      </div>
    </form>
    <h3>최근 아카이브</h3>
    <div class="table-list">
      ${state.archives.slice(0, 15).map((item) => `
        <div class="table-row">
          <div class="row-top">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="badge">${escapeHtml(archiveTypeLabel(item.type))}</span>
          </div>
          <span class="muted">${escapeHtml(courseName(item.course_id))}${item.caption ? ` · ${escapeHtml(item.caption)}` : ""}</span>
          <div class="actions" style="margin-top: 10px;">
            <button class="btn small secondary" type="button" data-edit-archive="${escapeHtml(item.id)}">수정</button>
            <button class="btn small danger" type="button" data-delete-archive="${escapeHtml(item.id)}">삭제</button>
          </div>
        </div>
      `).join("") || `<div class="empty">등록된 자료가 없습니다.</div>`}
    </div>
  `;
}

function renderReviews() {
  elements.adminContent.innerHTML = `
    <h2>후기 관리</h2>
    <p class="muted">후기 작성은 신청 관리에서 참석 확인이 완료된 참여자에게만 열립니다. 문제가 있는 후기는 숨기거나 삭제하세요.</p>
    <div class="table-list">
      ${state.reviews.map((review) => `
        <div class="table-row">
          <div class="row-top">
            <strong>${escapeHtml(review.author_name || "참여자")}</strong>
            <span class="badge ${reviewVisibilityClass(review)}">${reviewVisibilityLabel(review)}</span>
          </div>
          <div class="muted">${escapeHtml(courseName(review.course_id))} · ${escapeHtml(shortDate(review.created_at))}</div>
          <p>${escapeHtml(review.body)}</p>
          <div class="actions">
            <button class="btn small ${isReviewPublic(review) ? "danger" : "secondary"}" type="button" data-review-action="${isReviewPublic(review) ? "hide" : "show"}" data-review-id="${review.id}">${isReviewPublic(review) ? "숨김" : "공개"}</button>
            <button class="btn small danger" type="button" data-delete-review-admin="${escapeHtml(review.id)}">삭제</button>
          </div>
        </div>
      `).join("") || `<div class="empty">아직 후기가 없습니다.</div>`}
    </div>
  `;
}

function renderReports() {
  const reports = sortedContentReports();
  const openCount = reports.filter((report) => report.status === "open").length;
  elements.adminContent.innerHTML = `
    <h2>신고 관리</h2>
    <p class="muted">공개 후기와 기대평·질문에 들어온 신고를 확인합니다. 신고가 접수되어도 자동 숨김 처리되지는 않으며, 관리자가 내용을 확인한 뒤 조치합니다.</p>
    <div class="actions" style="margin: 12px 0 14px;">
      <span class="badge red">접수 ${openCount.toLocaleString("ko-KR")}건</span>
      <span class="badge gray">전체 ${reports.length.toLocaleString("ko-KR")}건</span>
    </div>
    <div class="table-list">
      ${reports.map(renderReportRow).join("") || `<div class="empty">아직 신고 내역이 없습니다.</div>`}
    </div>
  `;
}

function renderAttendanceDocumentSection(courseId) {
  const course = courseById(courseId);
  const documents = attendanceDocumentsForCourse(courseId);
  const defaultTitle = `${courseName(courseId)} 참석자 명단`;
  return `
    <div class="section" style="margin-top: 12px;">
      <h3>참석자 명단 스캔본</h3>
      <p class="muted">서명과 연락처 확인 정보가 포함될 수 있으므로 관리자 전용 비공개 저장소에 보관합니다. 공개 아카이브에는 노출되지 않습니다.</p>
      <form data-attendance-document-form>
        <input type="hidden" name="course_id" value="${escapeHtml(courseId)}">
        <div class="admin-grid">
          <label>문서 제목<input name="title" value="${escapeHtml(defaultTitle)}" required maxlength="120"></label>
          <label>스캔 파일<input name="attendance_document" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/tiff" required></label>
        </div>
        <div class="actions" style="margin-top: 12px;">
          <button class="btn small" type="submit">스캔본 업로드</button>
          <span class="badge gray">PDF·이미지 15MB 이하</span>
        </div>
      </form>
      <div class="table-list" style="margin-top: 12px;">
        ${documents.map((document) => `
          <div class="table-row">
            <div class="row-top">
              <strong>${escapeHtml(document.title || course?.title || "참석자 명단")}</strong>
              <span class="badge gray">${escapeHtml(shortDate(document.created_at))}</span>
            </div>
            <p class="muted">${escapeHtml(document.original_file_name || "스캔 파일")} · ${Math.ceil((document.file_size || 0) / 1024).toLocaleString("ko-KR")}KB</p>
            <div class="actions">
              <button class="btn small secondary" type="button" data-open-attendance-document="${escapeHtml(document.id)}">보기</button>
            </div>
          </div>
        `).join("") || `<div class="empty">업로드된 참석자 명단 스캔본이 없습니다.</div>`}
      </div>
    </div>
  `;
}

function renderWalkInSearchResults(courseId) {
  const search = state.walkInSearch;
  if (search.courseId !== courseId || (!search.query && !search.isLoading && !search.error)) return "";
  if (search.isLoading) return `<div class="empty">참석자 후보를 검색하는 중입니다.</div>`;
  if (search.error) return `<div class="empty">검색 실패: ${escapeHtml(search.error)}</div>`;
  if (!search.candidates.length) return `<div class="empty">"${escapeHtml(search.query)}"에 맞는 기존 신청자 또는 인증 사용자를 찾지 못했습니다.</div>`;

  return `
    <div class="table-list" style="margin-top: 12px;">
      ${search.candidates.map((candidate) => {
        const existingApplication = activeApplicationForCourseUser(courseId, candidate.user_id);
        const alreadyConfirmed = Boolean(existingApplication?.attendance_confirmed_at);
        return `
          <div class="table-row">
            <div class="row-top">
              <strong>${escapeHtml(candidate.applicant_name || "이름 없음")}</strong>
              ${alreadyConfirmed ? `<span class="badge green">이미 참석 확인</span>` : existingApplication ? `<span class="badge gray">신청 있음</span>` : `<span class="badge gray">현장 등록 가능</span>`}
            </div>
            <p class="muted">이메일: ${escapeHtml(candidate.email || "없음")} · 전화 끝자리: ${escapeHtml(phoneLastFour(candidate.phone) || "없음")}</p>
            ${candidate.last_application_at ? `<p class="muted">최근 신청/등록: ${escapeHtml(shortDate(candidate.last_application_at))}</p>` : ""}
            <div class="actions">
              <button class="btn small" type="button" data-add-walk-in-attendee="${escapeHtml(candidate.user_id)}" data-course-id="${escapeHtml(courseId)}" ${alreadyConfirmed ? "disabled" : ""}>${existingApplication ? "참석 확인" : "참석자로 등록"}</button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderWalkInAttendeeSection(courseId) {
  const course = courseById(courseId);
  if (!course) return "";
  const courseEnded = hasCourseEnded(course);
  return `
    <div class="section" style="margin-top: 12px;">
      <h3>현장 참석자 등록</h3>
      <p class="muted">${isOwner()
        ? "사전 신청 없이 참여한 사람은 교육 종료 후 기존 신청자·인증 사용자 정보에서 이름 또는 이메일로 찾아 참석자로 등록할 수 있습니다."
        : "사전 신청 없이 참여한 사람은 교육 종료 후 본인에게 확인한 전체 이메일 주소로 찾아 참석자로 등록할 수 있습니다."}</p>
      ${courseEnded
        ? `<form data-walk-in-search-form>
            <input type="hidden" name="course_id" value="${escapeHtml(courseId)}">
            <div class="admin-grid">
              <label>${isOwner() ? "이름 또는 이메일 검색" : "참여자 전체 이메일"}<input name="query" ${isOwner() ? "" : "type=\"email\""} value="${state.walkInSearch.courseId === courseId ? escapeHtml(state.walkInSearch.query) : ""}" placeholder="${isOwner() ? "예: 홍길동 또는 user@example.com" : "user@example.com"}" minlength="${isOwner() ? "2" : "5"}" required></label>
            </div>
            <div class="actions" style="margin-top: 12px;">
              <button class="btn small" type="submit">검색</button>
              <span class="badge gray">교육 종료 후 등록 가능</span>
            </div>
          </form>
          ${renderWalkInSearchResults(courseId)}
          <div class="guest-walk-in-form">
            <h4>비회원 현장 참석자 바로 등록</h4>
            <p class="muted">인증 계정이나 이전 신청 기록이 없는 참여자는 본인에게 확인한 이름과 휴대전화번호로 등록합니다. 등록과 동시에 참석 확인이 완료되어 비회원 후기 작성이 열립니다.</p>
            <form data-guest-walk-in-form>
              <input type="hidden" name="course_id" value="${escapeHtml(courseId)}">
              <div class="admin-grid application-contact-grid">
                <label>참석자명<input name="applicant_name" required maxlength="80" autocomplete="off"></label>
                <label>휴대전화번호<input name="phone" type="tel" required inputmode="numeric" pattern="[0-9-]*" placeholder="010-0000-0000" maxlength="13" autocomplete="off"></label>
                <label>이메일(선택)<input name="email" type="email" maxlength="320" placeholder="안내 메일이 필요한 경우" autocomplete="off"></label>
              </div>
              <label class="consent-check"><span><input name="privacy_confirmed" type="checkbox" required style="width:auto;min-height:auto;"> 참여자에게 교육 운영을 위한 이름·휴대전화번호·이메일(선택) 수집과 안내 활용 동의를 확인했습니다.</span></label>
              <div class="actions" style="margin-top: 12px;">
                <button class="btn small" type="submit">비회원 참석자로 등록</button>
                <span class="badge gray">교육 종료 후 등록</span>
              </div>
            </form>
          </div>`
        : `<div class="empty">교육 종료 후 현장 참석자 등록이 활성화됩니다.</div>`}
    </div>
  `;
}

function applyApplicationNameSearch(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  state.applicationFilters.applicantQuery = String(form.elements.applicant_query?.value || "").trim();
  renderApplications();
}

function renderApplications() {
  const applications = filteredApplications();
  let groups = applicationGroups(applications);
  if (state.applicationFilters.courseId && !groups.some((group) => group.courseId === state.applicationFilters.courseId)) {
    const selectedCourse = courseById(state.applicationFilters.courseId);
    if (selectedCourse) {
      groups = [{
        courseId: state.applicationFilters.courseId,
        course: selectedCourse,
        applications: [],
      }, ...groups];
    }
  }
  elements.adminContent.innerHTML = `
    <h2>교육 신청 관리</h2>
    <p class="muted">신청자 이름, 이메일, 전화번호는 교육 접수와 안내 목적으로만 사용하세요. 전화번호는 별도 인증 없이 신청자가 입력한 값입니다.</p>
    <div class="section" style="margin: 12px 0 14px;">
      <h3>교육별 보기</h3>
      ${renderCourseFilterControl("application", state.applicationFilters.courseId, { emptyLabel: "전체 교육" })}
      <form data-application-name-search-form style="margin-top: 12px;">
        <div class="admin-grid">
          <label>참가자 이름 검색<input name="applicant_query" type="search" value="${escapeHtml(state.applicationFilters.applicantQuery)}" placeholder="이름 일부 또는 전체" autocomplete="off"></label>
        </div>
        <div class="actions" style="margin-top: 10px;">
          <button class="btn small" type="submit">이름 검색</button>
          ${state.applicationFilters.applicantQuery ? `<button class="btn small secondary" type="button" data-clear-applicant-search>이름 검색 초기화</button>` : ""}
        </div>
      </form>
      <div class="actions" style="margin-top: 12px;">
        ${applicationCountBadges(applications)}
      </div>
    </div>
    <div class="table-list">
      ${groups.map((group) => `
        <details class="table-row" open>
          <summary>
            <div class="row-top" style="display:inline-flex;width:100%;align-items:flex-start;">
              <span>
                <strong>${escapeHtml(courseName(group.courseId))}</strong>
                <br><span class="muted">${escapeHtml(group.course?.starts_at ? shortDate(group.course.starts_at) : "일정 미정")} · ${escapeHtml(group.course ? (statusLabels[effectiveCourseStatus(group.course)] || effectiveCourseStatus(group.course)) : "교육 정보 확인 필요")}</span>
              </span>
              <span class="actions">
                ${applicationCountBadges(group.applications)}
                <button class="btn small secondary" type="button" data-print-roster="${escapeHtml(group.courseId)}">참가자 명단 출력</button>
              </span>
            </div>
          </summary>
          <div class="table-list" style="margin-top: 12px;">
            ${group.applications.map(renderApplicationRow).join("") || `<div class="empty">이 교육의 신청·등록 참가자가 없습니다.</div>`}
          </div>
          ${renderWalkInAttendeeSection(group.courseId)}
          ${renderAttendanceDocumentSection(group.courseId)}
        </details>
      `).join("") || `<div class="empty">${state.applications.length ? "선택한 조건에 맞는 신청이 없습니다." : "아직 교육 신청이 없습니다. 특정 교육을 선택하면 교육 종료 후 현장 참석자를 등록할 수 있습니다."}</div>`}
    </div>
  `;
}

function renderExpectations() {
  const applications = filteredExpectationApplications();
  elements.adminContent.innerHTML = `
    <h2>기대평·문의 관리</h2>
    <p class="muted">교육 신청자가 남긴 기대평과 강사에게 하고 싶은 질문을 모아봅니다. 공개 페이지에는 이 항목의 숫자를 노출하지 않습니다.</p>
    <div class="section" style="margin: 12px 0 14px;">
      <h3>교육별 보기</h3>
      ${renderCourseFilterControl("expectation", state.expectationFilters.courseId, { emptyLabel: "전체 교육" })}
      <div class="actions" style="margin-top: 12px;">
        <span class="badge green">작성 ${applications.length.toLocaleString("ko-KR")}건</span>
      </div>
    </div>
    <div class="table-list">
      ${applications.map(renderExpectationRow).join("") || `<div class="empty">아직 작성된 기대평이나 문의가 없습니다.</div>`}
    </div>
  `;
}

function renderDraws() {
  const eligible = visibleReviews();
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
  updateAdminNavigationVisibility();
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === state.tab);
  });

  if (!state.user) {
    elements.adminContent.innerHTML = `<div class="empty">관리자 기능을 사용하려면 먼저 로그인하세요.</div>`;
    return;
  }

  if (!isAdmin()) {
    elements.adminContent.innerHTML = `<div class="empty">로그인은 되었지만 관리자 권한이 없습니다. 메인 관리자에게 단체 관리자 연결을 요청해 주세요.</div>`;
    return;
  }

  if (!canAccessAdminTab(state.tab)) state.tab = "dashboard";

  if (state.tab === "organizations") renderOrganizations();
  else if (state.tab === "admins") renderOrganizationAdmins();
  else if (state.tab === "instructors") renderInstructors();
  else if (state.tab === "venues") renderVenues();
  else if (state.tab === "courses") renderCourses();
  else if (state.tab === "applications") renderApplications();
  else if (state.tab === "expectations") renderExpectations();
  else if (state.tab === "archive") renderArchive();
  else if (state.tab === "reviews") renderReviews();
  else if (state.tab === "reports") renderReports();
  else if (state.tab === "draws") renderDraws();
  else renderDashboard();
}

async function handleLogin(event) {
  event.preventDefault();
  const email = elements.adminEmail.value.trim();
  const password = elements.adminPassword.value;
  if (!email || !password) return;

  state.isLoggingIn = true;
  setLoginBusy(true);
  elements.adminContent.innerHTML = `<div class="empty">로그인 정보를 확인하는 중입니다.</div>`;

  try {
    const result = await withTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      10000,
      "로그인"
    ).catch(async (error) => {
      console.warn("[모두의 인문학] 로그인 응답 지연, 세션 복구를 시도합니다", error);
      await wait(500);
      const sessionResult = await supabase.auth.getSession();
      if (sessionResult.data.session) return { data: sessionResult.data, error: null };
      throw error;
    });

    const { error } = result;

    if (error) {
      console.error("[모두의 인문학] 로그인 실패", error);
      showToast(`로그인 실패: ${error.message}`);
      elements.adminContent.innerHTML = `<div class="empty">로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.</div>`;
      return;
    }

    elements.adminPassword.value = "";
    await withTimeout(reload(), 10000, "관리자 데이터 로딩");
    showToast(isAdmin() ? "로그인했습니다." : "로그인은 되었지만 관리자 권한이 없습니다.");
  } catch (error) {
    console.error("[모두의 인문학] 로그인 처리 오류", error);
    showToast(`로그인 처리 실패: ${error.message}`);
    elements.adminContent.innerHTML = `<div class="empty">로그인 처리 중 문제가 생겼습니다: ${escapeHtml(error.message)}</div>`;
  } finally {
    state.isLoggingIn = false;
    setLoginBusy(false);
  }
}

async function requestAdminPasswordReset() {
  const email = elements.adminEmail.value.trim();
  if (!email) {
    showToast("비밀번호 재설정 메일을 받을 관리자 이메일을 입력해 주세요.");
    elements.adminEmail.focus();
    return;
  }

  elements.adminPasswordResetButton.disabled = true;
  elements.adminPasswordResetButton.textContent = "메일 발송 중...";
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getCurrentUrlWithoutHash(),
    });
    if (error) throw error;
    showToast("비밀번호 재설정 메일을 보냈습니다. 메일의 링크를 열어 새 비밀번호를 설정하세요.");
  } catch (error) {
    console.error("[모두의 인문학] 비밀번호 재설정 메일 발송 실패", error);
    showToast(`비밀번호 재설정 메일 발송 실패: ${error.message}`);
  } finally {
    elements.adminPasswordResetButton.disabled = false;
    elements.adminPasswordResetButton.textContent = "비밀번호 재설정";
  }
}

async function handlePasswordUpdate(event) {
  event.preventDefault();
  const password = elements.adminNewPassword.value;
  const confirmPassword = elements.adminNewPasswordConfirm.value;
  if (password.length < 8) {
    showToast("새 비밀번호는 8자 이상이어야 합니다.");
    return;
  }
  if (password !== confirmPassword) {
    showToast("새 비밀번호 확인이 일치하지 않습니다.");
    return;
  }

  const button = elements.adminPasswordUpdateForm.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "저장 중...";
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    elements.adminNewPassword.value = "";
    elements.adminNewPasswordConfirm.value = "";
    state.isPasswordRecovery = false;
    window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
    updateAdminLoginFormVisibility();
    await reload();
    showToast("새 비밀번호를 저장했습니다.");
  } catch (error) {
    console.error("[모두의 인문학] 새 비밀번호 저장 실패", error);
    showToast(`새 비밀번호 저장 실패: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "새 비밀번호 저장";
  }
}

async function handleLogout() {
  await supabase.auth.signOut();
  await refreshSession();
  render();
  showToast("로그아웃했습니다.");
}

async function saveOrganization(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const organizationId = String(formData.get("organization_id") || "").trim();
  const canManageStructure = isOwner();
  const isNewOrganization = !organizationId;
  const logoFile = formData.get("logo_file");
  const existingOrganization = organizationById(organizationId);
  const payload = {
    description: String(formData.get("description") || "").trim() || null,
    website_url: requireSafeUrl(formData.get("website_url"), "홈페이지 URL", URL_RULES.external),
    contact_email: String(formData.get("contact_email") || "").trim() || null,
    logo_url: requireSafeUrl(formData.get("logo_url"), "로고 이미지 URL", URL_RULES.image),
  };

  if (!canManageStructure && (!organizationId || !managedOrganizationIds().has(organizationId))) {
    showToast("연결된 단체 정보만 수정할 수 있습니다.");
    return;
  }

  if (canManageStructure) {
    const organizationName = String(formData.get("name") || "").trim();
    const requestedSlug = String(formData.get("slug") || "").trim();
    const sortOrder = Number(formData.get("sort_order") || 0);
    payload.name = organizationName;
    payload.slug = makeUniqueOrganizationSlug(requestedSlug || existingOrganization?.slug || "", organizationName, organizationId);
    payload.sort_order = Number.isFinite(sortOrder) ? sortOrder : 0;
    payload.is_active = formData.get("is_active") === "on";
    if (!payload.name) {
      showToast("단체명을 입력해 주세요.");
      return;
    }
  }

  let uploadedLogoPath = "";
  if (hasSelectedFile(logoFile)) {
    showToast("로고 이미지를 업로드하는 중입니다.");
    const logoFolder = organizationId ? `organization-logos/${organizationId}` : "organization-logos";
    const logoBaseName = payload.slug || payload.name || existingOrganization?.slug || existingOrganization?.name || organizationId;
    const uploaded = await uploadSiteImage(logoFile, logoFolder, logoBaseName);
    payload.logo_url = uploaded.publicUrl;
    uploadedLogoPath = uploaded.path;
  }

  let savedOrganization;
  let error;
  if (canManageStructure) {
    const request = organizationId
      ? supabase.from("organizations").update(payload).eq("id", organizationId)
      : supabase.from("organizations").insert(payload);
    ({ data: savedOrganization, error } = await request.select().single());
  } else {
    ({ data: savedOrganization, error } = await supabase.rpc("update_managed_organization_profile", {
      p_organization_id: organizationId,
      p_description: payload.description,
      p_website_url: payload.website_url,
      p_contact_email: payload.contact_email,
      p_logo_url: payload.logo_url,
    }).single());
  }
  if (error) {
    await removeUploadedSiteImage(uploadedLogoPath);
    throw error;
  }

  const previousLogoPath = siteMediaStoragePathFromUrl(existingOrganization?.logo_url);
  const logoChanged = (payload.logo_url || "") !== (existingOrganization?.logo_url || "");
  const canRemovePreviousLogo = canManageStructure
    || previousLogoPath.startsWith(`organization-logos/${organizationId}/`);
  if (logoChanged && previousLogoPath && previousLogoPath !== uploadedLogoPath && canRemovePreviousLogo) {
    await removeUploadedSiteImage(previousLogoPath);
  }

  showToast("단체 정보를 저장했습니다.");
  await reload();
  state.tab = "organizations";
  if (isNewOrganization) {
    state.adminSelections.organizationId = "";
    state.adminSearch.organization = "";
  } else {
    state.adminSelections.organizationId = savedOrganization?.id || organizationId || "";
    state.adminSearch.organization = payload.name;
  }
  render();
}

async function saveInstructor(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const instructorId = formData.get("instructor_id");
  const isNewInstructor = !instructorId;
  const photoFile = formData.get("photo_file");
  const payload = {
    name: String(formData.get("name") || "").trim(),
    title: String(formData.get("title") || "").trim() || null,
    bio: String(formData.get("bio") || "").trim() || null,
    photo_url: requireSafeUrl(formData.get("photo_url"), "프로필 사진 URL", URL_RULES.image),
    profile_url: requireSafeUrl(formData.get("profile_url"), "홈페이지/SNS URL", URL_RULES.external),
    is_active: formData.get("is_active") === "on",
  };

  if (!payload.name) {
    showToast("강사명을 입력해 주세요.");
    return;
  }

  let uploadedPhotoPath = "";
  if (hasSelectedFile(photoFile)) {
    showToast("프로필 사진을 업로드하는 중입니다.");
    const uploaded = await uploadSiteImage(photoFile, "instructor-photos", payload.name);
    payload.photo_url = uploaded.publicUrl;
    uploadedPhotoPath = uploaded.path;
  }

  const request = instructorId
    ? supabase.from("instructors").update(payload).eq("id", instructorId)
    : supabase.from("instructors").insert(payload);

  const { data: savedInstructor, error } = await request.select().single();
  if (error) {
    await removeUploadedSiteImage(uploadedPhotoPath);
    throw error;
  }

  showToast("강사 정보를 저장했습니다.");
  await reload();
  state.tab = "instructors";
  if (isNewInstructor) {
    state.adminSelections.instructorId = "";
    state.adminSearch.instructor = "";
  } else {
    state.adminSelections.instructorId = savedInstructor?.id || instructorId || "";
    state.adminSearch.instructor = payload.name;
  }
  render();
}

async function saveVenue(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const venueId = String(formData.get("venue_id") || "").trim();
  const isNewVenue = !venueId;
  const existingVenue = state.venues.find((venue) => venue.id === venueId);
  let organizationId = String(formData.get("organization_id") || "").trim();

  if (!isOwner()) {
    if (existingVenue && !canManageVenue(existingVenue)) {
      showToast("이 장소는 소유 단체 또는 전체 관리자만 수정할 수 있습니다.");
      return;
    }
    if (existingVenue) organizationId = String(existingVenue.organization_id || "");
    if (!organizationId || !managedOrganizationIds().has(organizationId)) {
      showToast("장소를 등록할 담당 단체를 선택해 주세요.");
      return;
    }
  }

  const payload = {
    name: String(formData.get("name") || "").trim(),
    address: String(formData.get("address") || "").trim() || null,
    detail: String(formData.get("detail") || "").trim() || null,
    kakao_map_url: requireSafeUrl(formData.get("kakao_map_url"), "카카오맵 URL", URL_RULES.kakaoMap),
    naver_place_url: requireSafeUrl(formData.get("naver_place_url"), "네이버플레이스 URL", URL_RULES.naverPlace),
    is_online: formData.get("is_online") === "on",
    organization_id: organizationId || null,
  };

  if (!payload.name) {
    showToast("장소명을 입력해 주세요.");
    return;
  }

  const changeImpact = existingVenue && hasMaterialVenueChange(existingVenue, payload)
    ? await loadVenueChangeImpact(existingVenue.id)
    : null;
  const notificationPlan = venueChangeNotificationPlan(existingVenue, payload, changeImpact);
  if (requireChangeNotificationConfirmation(form, notificationPlan)) return;

  const request = venueId
    ? supabase.from("venues").update(payload).eq("id", venueId)
    : supabase.from("venues").insert(payload);

  const { data: savedVenue, error } = await request.select().single();
  if (error) throw error;

  if (notificationPlan) await requestCourseChangeNotificationDispatch();

  showToast(notificationPlan ? "장소 정보를 저장하고 신청자 변경 안내 메일·문자를 등록했습니다." : "장소 정보를 저장했습니다.");
  await reload();
  state.tab = "venues";
  if (isNewVenue) {
    state.adminSelections.venueId = "";
    state.adminSearch.venue = "";
  } else {
    state.adminSelections.venueId = savedVenue?.id || venueId || "";
    state.adminSearch.venue = payload.name;
  }
  render();
}

async function deleteManagedEntity(kind, entityId) {
  const config = managedEntityConfig(kind);
  const item = config?.itemById(entityId);
  if (!config || !item) {
    showToast("삭제할 항목을 찾지 못했습니다.");
    return false;
  }

  const connectedCourses = connectedCoursesForEntity(kind, entityId);
  if (connectedCourses.length) {
    showConnectedEntityNotice(kind, item, connectedCourses);
    return false;
  }

  if (kind === "venue") {
    const { data, error } = await supabase.rpc("delete_managed_venue", {
      p_venue_id: entityId,
    }).single();
    if (error) throw error;
    if (!data?.deleted) {
      const connectedCount = Number(data?.connected_course_count || 0);
      openAdminNotice(
        "장소를 삭제할 수 없습니다",
        `
          <p><strong>${escapeHtml(item.name || "장소")}</strong>에 연결된 교육이 있어 삭제하지 않았습니다.</p>
          <p class="muted">현재 연결 교육 ${escapeHtml(connectedCount)}개입니다. 다른 단체 교육이 포함되어 있을 수 있으므로 전체 관리자에게 연결 변경을 요청해 주세요.</p>
        `,
      );
      return false;
    }
  } else {
    const { error } = await supabase.from(config.table).delete().eq("id", entityId);
    if (error) throw error;
  }

  const mediaPath = config.mediaUrlKey ? siteMediaStoragePathFromUrl(item[config.mediaUrlKey]) : "";
  if (mediaPath) await removeUploadedSiteImage(mediaPath);

  showToast(`${config.label}를 삭제했습니다.`);
  await reload();
  state.tab = config.tab;
  render();
  return true;
}

async function saveCourse(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const courseId = formData.get("course_id");
  const isNewCourse = !courseId;
  const seriesPreviousCourseId = String(formData.get("series_previous_course_id") || "").trim();
  const timing = validateCourseTiming(courseId, formData);
  if (!timing) return;
  const existingCourse = courseById(courseId);
  const topic = String(formData.get("topic") || "").trim();
  const payload = {
    title: String(formData.get("title")).trim(),
    subtitle: String(formData.get("subtitle") || "").trim() || null,
    topic: topic || null,
    organization_id: String(formData.get("organization_id") || "").trim(),
    instructor_id: formData.get("instructor_id") || null,
    venue_id: formData.get("venue_id") || null,
    status: existingCourse?.status === "cancelled" ? "cancelled" : (timing.hasEnded ? "finished" : "open"),
    starts_at: timing.startsAt,
    ends_at: timing.endsAt,
    summary: String(formData.get("summary") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    application_url: null,
    published: formData.get("published") === "on",
    tags: topic ? [topic] : [],
  };

  if (!payload.organization_id) {
    showToast("교육을 주관할 단체를 선택해 주세요.");
    return;
  }

  const notificationPlan = courseChangeNotificationPlan(existingCourse, payload);
  if (requireChangeNotificationConfirmation(form, notificationPlan)) return;

  let savedCourse;
  let linkedSeriesId = "";
  if (courseId) {
    const { data, error } = await supabase.from("courses").update(payload).eq("id", courseId).select().single();
    if (error) throw error;
    savedCourse = data;
  } else {
    const { data, error } = await supabase.from("courses").insert(payload).select().single();
    if (error) throw error;
    savedCourse = data;
  }

  if (seriesPreviousCourseId) {
    const previousCourse = courseById(seriesPreviousCourseId);
    if (!previousCourse) {
      if (isNewCourse) await supabase.from("courses").delete().eq("id", savedCourse.id);
      throw new Error("연강으로 연결할 앞 교육을 찾지 못했습니다.");
    }
    const { data: seriesData, error: seriesError } = await supabase.rpc("append_course_to_series", {
      p_course_id: savedCourse.id,
      p_previous_course_id: seriesPreviousCourseId,
    });
    if (seriesError) {
      if (isNewCourse) await supabase.from("courses").delete().eq("id", savedCourse.id);
      throw seriesError;
    }
    linkedSeriesId = Array.isArray(seriesData) ? seriesData[0]?.series_id || "" : seriesData?.series_id || "";
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

  const courseFile = formData.get("course_file");
  if (hasSelectedFile(courseFile)) {
    const courseFileTitle = String(formData.get("course_file_title") || "").trim() || `${payload.title} 교육 자료`;
    const uploaded = await uploadArchiveFile(courseFile, savedCourse.id, courseFileTitle);
    const { error: archiveError } = await supabase.from("course_archives").insert({
      course_id: savedCourse.id,
      type: uploaded.archiveType,
      title: courseFileTitle,
      url: uploaded.publicUrl,
      caption: "교육 관리에서 업로드한 자료입니다.",
      is_public: true,
      created_by: state.user.id,
    });
    if (archiveError) {
      await removeUploadedArchiveFile(uploaded.path);
      throw archiveError;
    }
  }

  if (notificationPlan) await requestCourseChangeNotificationDispatch();

  const savedMessage = seriesPreviousCourseId ? "교육을 저장하고 연강으로 연결했습니다." : "교육을 저장했습니다.";
  const notificationMessage = notificationPlan ? " 신청자 변경 안내 메일·문자도 등록했습니다." : "";
  showToast(`${hasSelectedFile(formData.get("course_file")) ? `${savedMessage} 자료도 등록했습니다.` : savedMessage}${notificationMessage}`);
  await reload();
  state.tab = "courses";
  clearCourseTemplateDraft();
  state.courseManagement.draftPreviousCourseId = "";
  if (linkedSeriesId) state.courseManagement.selectedSeriesId = linkedSeriesId;
  if (isNewCourse) {
    state.adminSelections.courseId = "";
    state.adminSearch.course = "";
  } else {
    state.adminSelections.courseId = savedCourse.id || courseId || "";
    state.adminSearch.course = payload.title;
  }
  render();
}

async function deleteRowsByColumn(table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error) throw error;
}

function openCourseSeriesDetachNotice(courseId) {
  const course = courseById(courseId);
  const series = courseSeriesPosition(course);
  if (!course || !series) {
    showToast("연강 연결 정보를 찾지 못했습니다.");
    return;
  }
  openAdminNotice("연강 연결 해제", `
    <p><strong>${escapeHtml(course.title || "교육")}</strong>을 현재 연강에서 분리할까요?</p>
    <p class="muted">교육, 신청자, 참석 확인, 후기와 아카이브는 삭제되지 않습니다. 남은 교육의 연강 순서는 자동으로 정리됩니다.</p>
    <div class="actions" style="margin-top: 14px;">
      <button class="btn danger" type="button" data-confirm-detach-course-series="${escapeHtml(course.id)}">연결 해제</button>
      <button class="btn secondary" type="button" data-close-admin-notice>취소</button>
    </div>
  `);
}

function updateCourseSeriesManagementResults() {
  const resultsContainer = document.querySelector("[data-course-series-results]");
  if (!resultsContainer) return;
  resultsContainer.innerHTML = courseSeriesManagementResultsHtml();
}

function selectCourseSeries(seriesId) {
  const series = courseSeriesGroups().find((item) => item.id === seriesId);
  if (!series) {
    showToast("관리할 연강을 찾지 못했습니다.");
    return;
  }
  state.courseManagement.selectedSeriesId = series.id;
  renderCourses();
}

function editCourseFromSeries(courseId) {
  const course = courseById(courseId);
  if (!course) {
    showToast("수정할 교육을 찾지 못했습니다.");
    return;
  }
  clearCourseTemplateDraft();
  state.courseManagement.mode = "courses";
  state.courseManagement.draftPreviousCourseId = "";
  state.adminSelections.courseId = course.id;
  state.adminSearch.course = course.title || "";
  renderCourses();
}

function addCourseToSeries(previousCourseId) {
  const previousCourse = courseById(previousCourseId);
  if (!previousCourse || !isLastSeriesCourse(previousCourse)) {
    showToast("연강의 마지막 교육을 찾지 못했습니다.");
    return;
  }
  clearCourseTemplateDraft();
  state.courseManagement.mode = "courses";
  state.courseManagement.draftPreviousCourseId = previousCourse.id;
  state.adminSelections.courseId = "";
  state.adminSearch.course = "";
  renderCourses();
  showToast("앞 교육을 선택했습니다. 후속 교육 정보를 입력해 주세요.");
}

function openCourseSeriesDissolveNotice(seriesId) {
  const series = courseSeriesGroups().find((item) => item.id === seriesId);
  if (!series) {
    showToast("해제할 연강을 찾지 못했습니다.");
    return;
  }
  openAdminNotice("연강 전체 해제", `
    <p><strong>${escapeHtml(series.courses[0]?.title || "교육")}</strong> 외 ${Math.max(0, series.courses.length - 1)}개 교육의 연강 연결을 모두 해제할까요?</p>
    <p class="muted">교육 ${series.courses.length}개와 신청자, 참석 확인, 기대평·질문, 후기, 아카이브는 그대로 보존됩니다. 연강 연결과 순서만 삭제됩니다.</p>
    <div class="actions" style="margin-top: 14px;">
      <button class="btn danger" type="button" data-confirm-dissolve-course-series="${escapeHtml(series.id)}">연강 전체 해제</button>
      <button class="btn secondary" type="button" data-close-admin-notice>취소</button>
    </div>
  `);
}

async function dissolveCourseSeries(seriesId) {
  const { data, error } = await supabase.rpc("dissolve_course_series", {
    p_series_id: seriesId,
  });
  if (error) throw error;
  if (!Number(data)) throw new Error("해제된 연강 교육이 없습니다.");

  closeModal(elements.adminNoticeModal);
  showToast(`연강 연결을 전체 해제했습니다. 교육 ${Number(data)}개는 그대로 보존됩니다.`);
  state.courseManagement.selectedSeriesId = "";
  await reload();
  state.tab = "courses";
  state.courseManagement.mode = "series";
  render();
}

async function detachCourseFromSeries(courseId) {
  const course = courseById(courseId);
  const previousSeriesId = course?.series_id || "";
  const keepSeriesManagementOpen = state.courseManagement.mode === "series";
  const { data, error } = await supabase.rpc("detach_course_from_series", {
    p_course_id: courseId,
  });
  if (error) throw error;
  if (data !== true) throw new Error("연강 연결을 해제할 교육을 찾지 못했습니다.");

  closeModal(elements.adminNoticeModal);
  showToast("연강 연결을 해제했습니다.");
  await reload();
  state.tab = "courses";
  if (keepSeriesManagementOpen) {
    state.courseManagement.selectedSeriesId = courseSeriesGroups().some((series) => series.id === previousSeriesId) ? previousSeriesId : "";
  } else {
    state.adminSelections.courseId = courseId;
  }
  render();
}

async function deleteCourse(courseId) {
  const course = courseById(courseId);
  if (!course) {
    showToast("삭제할 교육을 찾지 못했습니다.");
    return false;
  }

  if (!canDeleteCourse(course)) {
    courseDeleteBlockNotice(course);
    return false;
  }

  const archivePaths = [...new Set(
    state.archives
      .filter((archive) => archive.course_id === course.id)
      .map((archive) => archiveStoragePathFromUrl(archive.url))
      .filter(Boolean)
  )];
  const attendanceDocumentPaths = [...new Set(
    state.attendanceDocuments
      .filter((document) => document.course_id === course.id)
      .map((document) => document.storage_path)
      .filter(Boolean)
  )];

  await deleteRowsByColumn("review_draw_winners", "course_id", course.id);
  await deleteRowsByColumn("reviews", "course_id", course.id);
  await deleteRowsByColumn("course_attendance_documents", "course_id", course.id);
  await deleteRowsByColumn("course_archives", "course_id", course.id);
  await deleteRowsByColumn("course_sessions", "course_id", course.id);
  await deleteRowsByColumn("course_applications", "course_id", course.id);

  const { error } = await supabase.from("courses").delete().eq("id", course.id);
  if (error) throw error;

  for (const path of archivePaths) {
    await removeUploadedArchiveFile(path);
  }
  for (const path of attendanceDocumentPaths) {
    await removeUploadedAttendanceDocument(path);
  }

  showToast(`${course.title || "교육"}을 삭제했습니다.`);
  await reload();
  state.tab = "courses";
  render();
  return true;
}

async function saveArchive(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const archiveId = String(formData.get("archive_id") || "");
  const existingArchive = archiveById(archiveId);
  const courseId = String(formData.get("course_id") || "");
  const title = String(formData.get("title") || "").trim();
  let url = requireSafeUrl(formData.get("url"), "외부 URL", URL_RULES.archive);
  const files = Array.from(form.querySelector("input[name='files']")?.files || []).filter(hasSelectedFile);
  let archiveType = String(formData.get("type"));
  const caption = String(formData.get("caption") || "").trim();
  const isPublic = true;

  if (!courseId) {
    showToast("교육을 선택해 주세요.");
    return;
  }
  if (!title) {
    showToast("아카이브 제목을 입력해 주세요.");
    return;
  }

  const uploadedFiles = [];
  let primarySaved = false;
  try {
    for (const file of files) {
      uploadedFiles.push(await uploadArchiveFile(file, courseId, title));
    }

    const primaryUpload = uploadedFiles[0] || null;
    if (primaryUpload) {
      url = primaryUpload.publicUrl;
      archiveType = primaryUpload.archiveType;
    }

    if (!url) {
      showToast("외부 URL 또는 업로드 파일이 필요합니다.");
      return;
    }

    const primaryPayload = {
      course_id: courseId,
      type: archiveType,
      title,
      url,
      caption,
      is_public: isPublic,
      created_by: state.user.id,
    };

    if (existingArchive) {
      const oldStoragePath = primaryUpload ? archiveStoragePathFromUrl(existingArchive.url) : "";
      const { error } = await supabase.from("course_archives").update(primaryPayload).eq("id", existingArchive.id);
      if (error) throw error;
      primarySaved = true;
      if (primaryUpload && oldStoragePath && oldStoragePath !== primaryUpload.path) await removeUploadedArchiveFile(oldStoragePath);
    } else {
      const { error } = await supabase.from("course_archives").insert(primaryPayload);
      if (error) throw error;
      primarySaved = true;
    }

    const extraUploads = uploadedFiles.slice(1);
    if (extraUploads.length) {
      const rows = extraUploads.map((uploaded, index) => ({
        course_id: courseId,
        type: uploaded.archiveType,
        title: uploadedFiles.length > 1 ? `${title} ${index + 2}` : title,
        url: uploaded.publicUrl,
        caption,
        is_public: isPublic,
        created_by: state.user.id,
      }));
      const { error } = await supabase.from("course_archives").insert(rows);
      if (error) {
        await Promise.all(extraUploads.map((uploaded) => removeUploadedArchiveFile(uploaded.path)));
        throw error;
      }
    }
  } catch (error) {
    if (!primarySaved) await Promise.all(uploadedFiles.map((uploaded) => removeUploadedArchiveFile(uploaded.path)));
    throw error;
  }

  showToast(existingArchive ? "아카이브를 수정했습니다." : "아카이브를 등록했습니다.");
  await reload();
  state.tab = "archive";
  state.selectedArchiveId = existingArchive ? existingArchive.id : "";
  render();
}

async function deleteArchive(archiveId) {
  const archive = archiveById(archiveId);
  if (!archive) {
    showToast("삭제할 아카이브를 찾지 못했습니다.");
    return;
  }

  const storagePath = archiveStoragePathFromUrl(archive.url);
  if (storagePath) await removeUploadedArchiveFile(storagePath, { strict: true });
  const { error } = await supabase.from("course_archives").delete().eq("id", archive.id);
  if (error) throw error;

  showToast("아카이브를 삭제했습니다.");
  await reload();
  state.tab = "archive";
  state.selectedArchiveId = "";
  render();
}

async function saveAttendanceDocument(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const courseId = String(formData.get("course_id") || "");
  const course = courseById(courseId);
  const title = String(formData.get("title") || "").trim();
  const file = formData.get("attendance_document");

  if (!course) {
    showToast("교육 정보를 찾지 못했습니다.");
    return;
  }
  if (!title) {
    showToast("문서 제목을 입력해 주세요.");
    return;
  }
  if (!hasSelectedFile(file)) {
    showToast("업로드할 스캔 파일을 선택해 주세요.");
    return;
  }

  let uploadedPath = "";
  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "업로드 중...";
  }

  try {
    const uploaded = await uploadAttendanceDocument(file, course.id, title);
    uploadedPath = uploaded.path;
    const { error } = await supabase.from("course_attendance_documents").insert({
      course_id: course.id,
      title,
      storage_path: uploaded.path,
      original_file_name: uploaded.originalName || null,
      content_type: uploaded.contentType,
      file_size: uploaded.fileSize,
      uploaded_by: state.user.id,
    });
    if (error) throw error;

    showToast("참석자 명단 스캔본을 업로드했습니다.");
    await reload();
    state.tab = "applications";
    render();
  } catch (error) {
    await removeUploadedAttendanceDocument(uploadedPath);
    throw error;
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "스캔본 업로드";
    }
  }
}

async function openAttendanceDocument(documentId) {
  const document = state.attendanceDocuments.find((item) => item.id === documentId);
  if (!document) {
    showToast("문서 정보를 찾지 못했습니다.");
    return;
  }

  const { data, error } = await supabase.storage
    .from(ATTENDANCE_DOCUMENT_BUCKET)
    .createSignedUrl(document.storage_path, 600);
  if (error) throw error;

  const opened = window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  if (!opened) showToast("팝업 차단을 해제한 뒤 다시 시도해 주세요.");
}

async function updateReview(reviewId, action, nextTab = state.tab) {
  const payload = {};
  if (action === "hide") {
    payload.is_hidden = true;
    payload.verification_status = "none";
  }
  if (action === "show") {
    payload.is_hidden = false;
    payload.verification_status = "none";
  }
  if (!Object.keys(payload).length) {
    showToast("알 수 없는 후기 작업입니다.");
    return;
  }

  const { error } = await supabase.from("reviews").update(payload).eq("id", reviewId);
  if (error) throw error;
  showToast("후기 상태를 변경했습니다.");
  await reload();
  state.tab = nextTab;
  render();
}

async function deleteReview(reviewId) {
  await deleteRowsByColumn("review_draw_winners", "review_id", reviewId);
  const { error } = await supabase.from("reviews").delete().eq("id", reviewId);
  if (error) throw error;
  showToast("후기를 삭제했습니다.");
  await reload();
  state.tab = "reviews";
  render();
}

async function clearApplicationNoteAdmin(applicationId, nextTab = state.tab) {
  const { data, error } = await supabase.rpc("clear_course_application_note", {
    p_application_id: applicationId,
  });
  if (error) throw error;
  if (data !== true) throw new Error("삭제할 기대평/질문을 찾지 못했거나 관리 권한이 없습니다.");

  showToast("기대평/질문을 삭제했습니다.");
  await reload();
  state.tab = nextTab;
  render();
}

async function updateReportStatus(reportId, status) {
  const payload = {
    status,
    resolved_at: status === "open" ? null : new Date().toISOString(),
    resolved_by: status === "open" ? null : state.user.id,
  };
  const { error } = await supabase.from("content_reports").update(payload).eq("id", reportId);
  if (error) throw error;

  showToast("신고 상태를 변경했습니다.");
  await reload();
  state.tab = "reports";
  render();
}

async function saveAdminCourseNotificationPreferences(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const applicationId = String(form.elements.application_id?.value || "");
  const application = state.applications.find((item) => item.id === applicationId);
  if (!application) throw new Error("알림을 변경할 교육 신청을 찾지 못했습니다.");
  if (form.elements.participant_request_confirmed?.checked !== true) {
    throw new Error("신청자의 알림 설정 변경 요청을 확인해 주세요.");
  }

  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "저장 중...";
  }
  try {
    const { data, error } = await supabase.rpc("admin_set_course_notification_preferences", {
      p_application_id: applicationId,
      p_email_enabled: form.elements.email_enabled?.checked === true,
      p_sms_enabled: form.elements.sms_enabled?.checked === true,
      p_participant_request_confirmed: true,
      p_terms_version: COURSE_NOTIFICATION_TERMS_VERSION,
    });
    if (error) throw error;
    const result = data || {};
    Object.assign(application, {
      email_course_notice_enabled: result.email_enabled === true,
      sms_course_notice_enabled: result.sms_enabled === true,
      course_notice_preferences_updated_at: result.updated_at || new Date().toISOString(),
      course_notice_terms_version: COURSE_NOTIFICATION_TERMS_VERSION,
    });
    renderApplications();
    showToast("신청자 요청에 따른 교육별 알림 설정을 저장하고 감사 기록을 남겼습니다.");
  } finally {
    if (submitButton && document.body.contains(submitButton)) {
      submitButton.disabled = false;
      submitButton.textContent = "알림 설정 저장";
    }
  }
}

async function confirmApplicationAttendance(applicationId) {
  const application = state.applications.find((item) => item.id === applicationId);
  const course = courseById(application?.course_id);
  if (!hasCourseDateArrived(course)) {
    throw new Error("교육일이 도래한 뒤 참석 확인할 수 있습니다.");
  }

  const { data, error } = await supabase.rpc("confirm_course_application_attendance", {
    p_application_id: applicationId,
  });
  if (error) throw error;
  if (data !== true) throw new Error("참석 확인할 신청을 찾지 못했거나 아직 교육일이 도래하지 않았습니다.");

  showToast("참석 확인을 저장했습니다.");
  await reload();
  state.tab = "applications";
  render();
}

async function unconfirmApplicationAttendance(applicationId) {
  const { data, error } = await supabase.rpc("unconfirm_course_application_attendance", {
    p_application_id: applicationId,
  });
  if (error) throw error;
  if (data !== true) throw new Error("취소할 참석 확인을 찾지 못했습니다.");

  showToast("참석 확인을 취소했습니다.");
  await reload();
  state.tab = "applications";
  render();
}

async function searchWalkInCandidates(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;

  const formData = new FormData(form);
  const courseId = String(formData.get("course_id") || "");
  const query = String(formData.get("query") || "").trim();
  if ((isOwner() && query.length < 2) || (!isOwner() && (!query.includes("@") || query.length < 5))) {
    showToast(isOwner() ? "이름 또는 이메일을 2글자 이상 입력해 주세요." : "참여자의 전체 이메일 주소를 입력해 주세요.");
    return;
  }

  state.walkInSearch = {
    courseId,
    query,
    candidates: [],
    isLoading: true,
    error: "",
  };
  renderApplications();

  const { data, error } = await supabase.rpc("search_applicant_candidates_for_course", {
    p_course_id: courseId,
    p_query: query,
  });

  state.walkInSearch = {
    courseId,
    query,
    candidates: error ? [] : (data || []),
    isLoading: false,
    error: error?.message || "",
  };
  renderApplications();
}

async function addWalkInAttendee(courseId, userId) {
  const course = courseById(courseId);
  if (!hasCourseEnded(course)) {
    throw new Error("교육 종료 후 현장 참석자를 등록할 수 있습니다.");
  }

  const { data, error } = await supabase.rpc("add_walk_in_course_attendee", {
    p_course_id: courseId,
    p_user_id: userId,
  });
  if (error) throw error;
  if (!data) throw new Error("참석자 등록 결과를 확인하지 못했습니다.");

  showToast("현장 참석자를 등록하고 참석 확인을 저장했습니다.");
  await reload();
  state.tab = "applications";
  state.applicationFilters.courseId = courseId;
  state.walkInSearch = {
    courseId: "",
    query: "",
    candidates: [],
    isLoading: false,
    error: "",
  };
  render();
}

async function addGuestWalkInAttendee(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const courseId = String(formData.get("course_id") || "");
  const course = courseById(courseId);
  const applicantName = String(formData.get("applicant_name") || "").trim();
  const phone = formatMobilePhone(formData.get("phone"));
  const email = String(formData.get("email") || "").trim().toLowerCase();

  if (!hasCourseEnded(course)) throw new Error("교육 종료 후 현장 참석자를 등록할 수 있습니다.");
  if (!applicantName) throw new Error("참석자명을 입력해 주세요.");
  if (!isValidMobilePhone(phone)) throw new Error("010으로 시작하는 휴대전화번호 11자리를 입력해 주세요.");
  if (formData.get("privacy_confirmed") !== "on") throw new Error("참여자의 개인정보 수집·안내 활용 동의 확인이 필요합니다.");

  const button = form.querySelector("button[type='submit']");
  if (button) {
    button.disabled = true;
    button.textContent = "등록 중...";
  }
  try {
    const { data, error } = await supabase.rpc("add_guest_walk_in_course_attendee", {
      p_course_id: courseId,
      p_applicant_name: applicantName,
      p_phone: phone,
      p_email: email || null,
      p_terms_version: "admin-guest-walk-in-2026-07-24",
    });
    if (error) throw error;
    if (!data) throw new Error("참석자 등록 결과를 확인하지 못했습니다.");

    showToast("비회원 현장 참석자를 등록하고 참석 확인을 저장했습니다.");
    await reload();
    state.tab = "applications";
    state.applicationFilters.courseId = courseId;
    render();
  } finally {
    if (button && document.body.contains(button)) {
      button.disabled = false;
      button.textContent = "비회원 참석자로 등록";
    }
  }
}

async function runDraw(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const targetCourseId = formData.get("target_course_id") || null;
  const eligible = visibleReviews().filter((review) => !targetCourseId || review.course_id === targetCourseId);
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
  if (!isAdmin()) {
    state.organizations = [];
    state.instructors = [];
    state.venues = [];
    state.courses = [];
    state.sessions = [];
    state.archives = [];
    state.applications = [];
    state.attendanceDocuments = [];
    state.reviews = [];
    state.contentReports = [];
    state.draws = [];
    state.winners = [];
    state.smsDeliveries = [];
    state.demographicSummary = null;
    state.organizationAdmins = [];
    state.organizationAdminsError = "";
    render();
    return;
  }
  await syncFinishedCourseStatuses();
  await loadAdminData();
}

function bindEvents() {
  elements.adminLoginForm.addEventListener("submit", handleLogin);
  elements.adminPasswordResetButton.addEventListener("click", requestAdminPasswordReset);
  elements.adminPasswordUpdateForm.addEventListener("submit", handlePasswordUpdate);
  elements.adminLogoutButton.addEventListener("click", handleLogout);
  elements.refreshButton.addEventListener("click", async () => {
    await reload();
    showToast("새로고침했습니다.");
  });

  document.body.addEventListener("click", async (event) => {
    const tabButton = event.target.closest("[data-admin-tab]");
    const adminSelectButton = event.target.closest("[data-admin-select]");
    const adminClearSelectionButton = event.target.closest("[data-admin-clear-selection]");
    const openCoursePickerButton = event.target.closest("[data-open-course-picker]");
    const clearCoursePickerButton = event.target.closest("[data-clear-course-picker]");
    const coursePickerSelectButton = event.target.closest("[data-course-picker-select]");
    const openCourseFilterPickerButton = event.target.closest("[data-open-course-filter-picker]");
    const clearCourseFilterButton = event.target.closest("[data-clear-course-filter]");
    const courseFilterSelectButton = event.target.closest("[data-course-filter-select]");
    const openCourseTemplateButton = event.target.closest("[data-open-course-template]");
    const loadCourseTemplateButton = event.target.closest("[data-load-course-template]");
    const reviewButton = event.target.closest("[data-review-action]");
    const deleteReviewButton = event.target.closest("[data-delete-review-admin]");
    const clearApplicationNoteButton = event.target.closest("[data-clear-application-note-admin]");
    const clearApplicantSearchButton = event.target.closest("[data-clear-applicant-search]");
    const reportStatusButton = event.target.closest("[data-report-status]");
    const attendanceButton = event.target.closest("[data-confirm-attendance]");
    const unconfirmAttendanceButton = event.target.closest("[data-unconfirm-attendance]");
    const rosterButton = event.target.closest("[data-print-roster]");
    const addWalkInButton = event.target.closest("[data-add-walk-in-attendee]");
    const attendanceDocumentButton = event.target.closest("[data-open-attendance-document]");
    const editArchiveButton = event.target.closest("[data-edit-archive]");
    const deleteArchiveButton = event.target.closest("[data-delete-archive]");
    const deleteCourseButton = event.target.closest("[data-delete-course]");
    const courseManagementModeButton = event.target.closest("[data-course-management-mode]");
    const selectCourseSeriesButton = event.target.closest("[data-select-course-series]");
    const editSeriesCourseButton = event.target.closest("[data-edit-series-course]");
    const addCourseToSeriesButton = event.target.closest("[data-add-course-to-series]");
    const openCourseSeriesCreateButton = event.target.closest("[data-open-course-series-create]");
    const addCourseSeriesSelectionButton = event.target.closest("[data-add-course-series-selection]");
    const removeCourseSeriesSelectionButton = event.target.closest("[data-remove-course-series-selection]");
    const createCourseSeriesBatchButton = event.target.closest("[data-create-course-series-batch]");
    const dissolveCourseSeriesButton = event.target.closest("[data-dissolve-course-series]");
    const confirmDissolveCourseSeriesButton = event.target.closest("[data-confirm-dissolve-course-series]");
    const detachCourseSeriesButton = event.target.closest("[data-detach-course-series]");
    const confirmDetachCourseSeriesButton = event.target.closest("[data-confirm-detach-course-series]");
    const deleteEntityButton = event.target.closest("[data-delete-entity]");
    const removeOrganizationAdminButton = event.target.closest("[data-remove-organization-admin]");
    const downloadDashboardStatsButton = event.target.closest("[data-download-dashboard-stats]");
    const confirmChangeNotificationButton = event.target.closest("[data-confirm-change-notification]");
    const closeAdminNoticeButton = event.target.closest("[data-close-admin-notice]");
    if (clearApplicantSearchButton) {
      state.applicationFilters.applicantQuery = "";
      renderApplications();
      return;
    }
    if (confirmChangeNotificationButton) {
      const form = document.getElementById(confirmChangeNotificationButton.dataset.confirmChangeNotification);
      closeModal(elements.adminNoticeModal);
      if (form instanceof HTMLFormElement) {
        form.dataset.changeNotificationConfirmed = "true";
        form.requestSubmit();
      }
      return;
    }
    if (closeAdminNoticeButton || event.target === elements.adminNoticeModal) {
      closeModal(elements.adminNoticeModal);
      return;
    }
    if (downloadDashboardStatsButton) {
      downloadDashboardStats(downloadDashboardStatsButton.dataset.downloadDashboardStats);
      return;
    }
    if (createCourseSeriesBatchButton) {
      try {
        createCourseSeriesBatchButton.disabled = true;
        createCourseSeriesBatchButton.textContent = "연강 만드는 중...";
        await createCourseSeriesBatch();
      } catch (error) {
        showToast(`연강 만들기 실패: ${error.message}`);
        createCourseSeriesBatchButton.disabled = false;
        createCourseSeriesBatchButton.textContent = "선택한 교육으로 연강 만들기";
      }
      return;
    }
    if (removeCourseSeriesSelectionButton) {
      removeCourseSeriesCreateSelection(removeCourseSeriesSelectionButton.dataset.removeCourseSeriesSelection);
      return;
    }
    if (addCourseSeriesSelectionButton) {
      addCourseSeriesCreateSelection(addCourseSeriesSelectionButton.dataset.addCourseSeriesSelection);
      return;
    }
    if (openCourseSeriesCreateButton) {
      openCourseSeriesCreateModal();
      return;
    }
    if (confirmDissolveCourseSeriesButton) {
      try {
        confirmDissolveCourseSeriesButton.disabled = true;
        confirmDissolveCourseSeriesButton.textContent = "전체 해제 중...";
        await dissolveCourseSeries(confirmDissolveCourseSeriesButton.dataset.confirmDissolveCourseSeries);
      } catch (error) {
        showToast(`연강 전체 해제 실패: ${error.message}`);
        confirmDissolveCourseSeriesButton.disabled = false;
        confirmDissolveCourseSeriesButton.textContent = "연강 전체 해제";
      }
      return;
    }
    if (dissolveCourseSeriesButton) {
      openCourseSeriesDissolveNotice(dissolveCourseSeriesButton.dataset.dissolveCourseSeries);
      return;
    }
    if (addCourseToSeriesButton) {
      addCourseToSeries(addCourseToSeriesButton.dataset.addCourseToSeries);
      return;
    }
    if (editSeriesCourseButton) {
      editCourseFromSeries(editSeriesCourseButton.dataset.editSeriesCourse);
      return;
    }
    if (selectCourseSeriesButton) {
      selectCourseSeries(selectCourseSeriesButton.dataset.selectCourseSeries);
      return;
    }
    if (courseManagementModeButton) {
      state.courseManagement.mode = courseManagementModeButton.dataset.courseManagementMode === "series" ? "series" : "courses";
      renderCourses();
      return;
    }
    if (confirmDetachCourseSeriesButton) {
      try {
        confirmDetachCourseSeriesButton.disabled = true;
        confirmDetachCourseSeriesButton.textContent = "해제 중...";
        await detachCourseFromSeries(confirmDetachCourseSeriesButton.dataset.confirmDetachCourseSeries);
      } catch (error) {
        showToast(`연강 연결 해제 실패: ${error.message}`);
        confirmDetachCourseSeriesButton.disabled = false;
        confirmDetachCourseSeriesButton.textContent = "연결 해제";
      }
      return;
    }
    if (detachCourseSeriesButton) {
      openCourseSeriesDetachNotice(detachCourseSeriesButton.dataset.detachCourseSeries);
      return;
    }
    if (removeOrganizationAdminButton) {
      const defaultLabel = "연결 해제";
      if (removeOrganizationAdminButton.dataset.confirmRemove !== "true") {
        removeOrganizationAdminButton.dataset.confirmRemove = "true";
        removeOrganizationAdminButton.textContent = "한 번 더 누르면 해제";
        window.setTimeout(() => {
          if (removeOrganizationAdminButton.dataset.confirmRemove === "true") {
            removeOrganizationAdminButton.dataset.confirmRemove = "false";
            removeOrganizationAdminButton.textContent = defaultLabel;
          }
        }, 3000);
        return;
      }
      try {
        removeOrganizationAdminButton.disabled = true;
        removeOrganizationAdminButton.textContent = "해제 중...";
        await removeOrganizationAdmin(removeOrganizationAdminButton.dataset.removeOrganizationAdmin);
      } catch (error) {
        showToast(`관리자 연결 해제 실패: ${error.message}`);
        removeOrganizationAdminButton.disabled = false;
        removeOrganizationAdminButton.dataset.confirmRemove = "false";
        removeOrganizationAdminButton.textContent = defaultLabel;
      }
      return;
    }
    if (openCourseTemplateButton) {
      openCourseTemplateModal();
      return;
    }
    if (loadCourseTemplateButton) {
      loadCourseTemplate(loadCourseTemplateButton.dataset.loadCourseTemplate);
      return;
    }
    if (openCoursePickerButton) {
      openCoursePicker(openCoursePickerButton.dataset.openCoursePicker);
      return;
    }
    if (clearCoursePickerButton) {
      clearCoursePickerSelection(clearCoursePickerButton.dataset.clearCoursePicker);
      return;
    }
    if (coursePickerSelectButton) {
      setCoursePickerSelection(coursePickerSelectButton.dataset.coursePickerSelect, coursePickerSelectButton.dataset.entityId || "");
      return;
    }
    if (openCourseFilterPickerButton) {
      openCourseFilterPicker(openCourseFilterPickerButton.dataset.openCourseFilterPicker);
      return;
    }
    if (clearCourseFilterButton) {
      setCourseFilterSelection(clearCourseFilterButton.dataset.clearCourseFilter, "");
      return;
    }
    if (courseFilterSelectButton) {
      setCourseFilterSelection(courseFilterSelectButton.dataset.courseFilterSelect, courseFilterSelectButton.dataset.courseId || "");
      return;
    }
    if (adminSelectButton) {
      const kind = adminSelectButton.dataset.adminSelect;
      const entityId = adminSelectButton.dataset.entityId || "";
      if (kind === "organization") {
        state.adminSelections.organizationId = entityId;
        renderOrganizations();
      }
      if (kind === "instructor") {
        state.adminSelections.instructorId = entityId;
        renderInstructors();
      }
      if (kind === "venue") {
        state.adminSelections.venueId = entityId;
        renderVenues();
      }
      if (kind === "course") {
        clearCourseTemplateDraft();
        state.courseManagement.draftPreviousCourseId = "";
        state.adminSelections.courseId = entityId;
        renderCourses();
      }
      return;
    }
    if (adminClearSelectionButton) {
      const kind = adminClearSelectionButton.dataset.adminClearSelection;
      if (kind === "organization") {
        state.adminSelections.organizationId = "";
        state.adminSearch.organization = "";
        renderOrganizations();
      }
      if (kind === "instructor") {
        state.adminSelections.instructorId = "";
        state.adminSearch.instructor = "";
        renderInstructors();
      }
      if (kind === "venue") {
        state.adminSelections.venueId = "";
        state.adminSearch.venue = "";
        renderVenues();
      }
      if (kind === "course") {
        clearCourseTemplateDraft();
        state.courseManagement.draftPreviousCourseId = "";
        state.adminSelections.courseId = "";
        state.adminSearch.course = "";
        renderCourses();
      }
      return;
    }
    if (tabButton) {
      state.tab = tabButton.dataset.adminTab;
      render();
      return;
    }
    if (reviewButton) {
      try {
        await updateReview(reviewButton.dataset.reviewId, reviewButton.dataset.reviewAction);
      } catch (error) {
        showToast(`후기 변경 실패: ${error.message}`);
      }
      return;
    }
    if (deleteReviewButton) {
      const defaultDeleteLabel = deleteReviewButton.dataset.defaultLabel || deleteReviewButton.textContent;
      deleteReviewButton.dataset.defaultLabel = defaultDeleteLabel;
      if (deleteReviewButton.dataset.confirmDelete !== "true") {
        deleteReviewButton.dataset.confirmDelete = "true";
        deleteReviewButton.textContent = "한 번 더 누르면 삭제";
        window.setTimeout(() => {
          if (deleteReviewButton.dataset.confirmDelete === "true") {
            deleteReviewButton.dataset.confirmDelete = "false";
            deleteReviewButton.textContent = defaultDeleteLabel;
          }
        }, 3000);
        return;
      }
      try {
        deleteReviewButton.disabled = true;
        deleteReviewButton.textContent = "삭제 중...";
        await deleteReview(deleteReviewButton.dataset.deleteReviewAdmin);
      } catch (error) {
        showToast(`후기 삭제 실패: ${error.message}`);
        deleteReviewButton.disabled = false;
        deleteReviewButton.dataset.confirmDelete = "false";
        deleteReviewButton.textContent = defaultDeleteLabel;
      }
      return;
    }
    if (clearApplicationNoteButton) {
      const defaultDeleteLabel = clearApplicationNoteButton.dataset.defaultLabel || clearApplicationNoteButton.textContent;
      clearApplicationNoteButton.dataset.defaultLabel = defaultDeleteLabel;
      if (clearApplicationNoteButton.dataset.confirmDelete !== "true") {
        clearApplicationNoteButton.dataset.confirmDelete = "true";
        clearApplicationNoteButton.textContent = "한 번 더 누르면 삭제";
        window.setTimeout(() => {
          if (clearApplicationNoteButton.dataset.confirmDelete === "true") {
            clearApplicationNoteButton.dataset.confirmDelete = "false";
            clearApplicationNoteButton.textContent = defaultDeleteLabel;
          }
        }, 3000);
        return;
      }
      try {
        clearApplicationNoteButton.disabled = true;
        clearApplicationNoteButton.textContent = "삭제 중...";
        await clearApplicationNoteAdmin(clearApplicationNoteButton.dataset.clearApplicationNoteAdmin, state.tab);
      } catch (error) {
        showToast(`기대평/질문 삭제 실패: ${error.message}`);
        clearApplicationNoteButton.disabled = false;
        clearApplicationNoteButton.dataset.confirmDelete = "false";
        clearApplicationNoteButton.textContent = defaultDeleteLabel;
      }
      return;
    }
    if (reportStatusButton) {
      try {
        reportStatusButton.disabled = true;
        reportStatusButton.textContent = "저장 중...";
        await updateReportStatus(reportStatusButton.dataset.reportId, reportStatusButton.dataset.reportStatus);
      } catch (error) {
        showToast(`신고 상태 변경 실패: ${error.message}`);
        reportStatusButton.disabled = false;
        reportStatusButton.textContent = reportStatusLabel(reportStatusButton.dataset.reportStatus);
      }
      return;
    }
    if (attendanceButton) {
      try {
        attendanceButton.disabled = true;
        attendanceButton.textContent = "저장 중...";
        await confirmApplicationAttendance(attendanceButton.dataset.confirmAttendance);
      } catch (error) {
        showToast(`참석 확인 실패: ${error.message}`);
        attendanceButton.disabled = false;
        attendanceButton.textContent = "참석 확인";
      }
      return;
    }
    if (unconfirmAttendanceButton) {
      try {
        unconfirmAttendanceButton.disabled = true;
        unconfirmAttendanceButton.textContent = "취소 중...";
        await unconfirmApplicationAttendance(unconfirmAttendanceButton.dataset.unconfirmAttendance);
      } catch (error) {
        showToast(`참석 확인 취소 실패: ${error.message}`);
        unconfirmAttendanceButton.disabled = false;
        unconfirmAttendanceButton.textContent = "참석 확인 취소";
      }
      return;
    }
    if (rosterButton) {
      event.preventDefault();
      printApplicationRoster(rosterButton.dataset.printRoster);
      return;
    }
    if (addWalkInButton) {
      const defaultLabel = addWalkInButton.textContent;
      try {
        addWalkInButton.disabled = true;
        addWalkInButton.textContent = "등록 중...";
        await addWalkInAttendee(addWalkInButton.dataset.courseId, addWalkInButton.dataset.addWalkInAttendee);
        addWalkInButton.textContent = defaultLabel;
      } catch (error) {
        showToast(`현장 참석자 등록 실패: ${error.message}`);
        addWalkInButton.disabled = false;
        addWalkInButton.textContent = defaultLabel;
      }
      return;
    }
    if (attendanceDocumentButton) {
      try {
        await openAttendanceDocument(attendanceDocumentButton.dataset.openAttendanceDocument);
      } catch (error) {
        showToast(`문서 열기 실패: ${error.message}`);
      }
      return;
    }
    if (editArchiveButton) {
      state.selectedArchiveId = editArchiveButton.dataset.editArchive;
      state.tab = "archive";
      renderArchive();
      return;
    }
    if (deleteArchiveButton) {
      if (deleteArchiveButton.dataset.confirmDelete !== "true") {
        deleteArchiveButton.dataset.confirmDelete = "true";
        deleteArchiveButton.textContent = "한 번 더 누르면 삭제";
        window.setTimeout(() => {
          if (deleteArchiveButton.dataset.confirmDelete === "true") {
            deleteArchiveButton.dataset.confirmDelete = "false";
            deleteArchiveButton.textContent = "삭제";
          }
        }, 3000);
        return;
      }
      try {
        deleteArchiveButton.disabled = true;
        deleteArchiveButton.textContent = "삭제 중...";
        await deleteArchive(deleteArchiveButton.dataset.deleteArchive);
      } catch (error) {
        showToast(`아카이브 삭제 실패: ${error.message}`);
        deleteArchiveButton.disabled = false;
        deleteArchiveButton.textContent = "삭제";
      }
      return;
    }
    if (deleteCourseButton) {
      const course = courseById(deleteCourseButton.dataset.deleteCourse);
      const defaultDeleteLabel = deleteCourseButton.dataset.defaultLabel || deleteCourseButton.textContent;
      deleteCourseButton.dataset.defaultLabel = defaultDeleteLabel;
      if (course && !canDeleteCourse(course)) {
        courseDeleteBlockNotice(course);
        return;
      }

      if (deleteCourseButton.dataset.confirmDelete !== "true") {
        deleteCourseButton.dataset.confirmDelete = "true";
        deleteCourseButton.textContent = "한 번 더 누르면 삭제";
        window.setTimeout(() => {
          if (deleteCourseButton.dataset.confirmDelete === "true") {
            deleteCourseButton.dataset.confirmDelete = "false";
            deleteCourseButton.textContent = defaultDeleteLabel;
          }
        }, 3000);
        return;
      }
      try {
        deleteCourseButton.disabled = true;
        deleteCourseButton.textContent = "삭제 중...";
        const deleted = await deleteCourse(deleteCourseButton.dataset.deleteCourse);
        if (!deleted) {
          deleteCourseButton.disabled = false;
          deleteCourseButton.dataset.confirmDelete = "false";
          deleteCourseButton.textContent = defaultDeleteLabel;
        }
      } catch (error) {
        showToast(`교육 삭제 실패: ${error.message}`);
        deleteCourseButton.disabled = false;
        deleteCourseButton.textContent = defaultDeleteLabel;
      }
      return;
    }
    if (deleteEntityButton) {
      const defaultDeleteLabel = deleteEntityButton.dataset.defaultLabel || deleteEntityButton.textContent;
      deleteEntityButton.dataset.defaultLabel = defaultDeleteLabel;
      const config = managedEntityConfig(deleteEntityButton.dataset.deleteEntity);
      const item = config?.itemById(deleteEntityButton.dataset.entityId);
      const connectedCourses = connectedCoursesForEntity(deleteEntityButton.dataset.deleteEntity, deleteEntityButton.dataset.entityId);
      if (config && item && connectedCourses.length) {
        showConnectedEntityNotice(deleteEntityButton.dataset.deleteEntity, item, connectedCourses);
        return;
      }

      if (deleteEntityButton.dataset.confirmDelete !== "true") {
        deleteEntityButton.dataset.confirmDelete = "true";
        deleteEntityButton.textContent = "한 번 더 누르면 삭제";
        window.setTimeout(() => {
          if (deleteEntityButton.dataset.confirmDelete === "true") {
            deleteEntityButton.dataset.confirmDelete = "false";
            deleteEntityButton.textContent = defaultDeleteLabel;
          }
        }, 3000);
        return;
      }
      try {
        deleteEntityButton.disabled = true;
        deleteEntityButton.textContent = "삭제 중...";
        const deleted = await deleteManagedEntity(deleteEntityButton.dataset.deleteEntity, deleteEntityButton.dataset.entityId);
        if (!deleted) {
          deleteEntityButton.disabled = false;
          deleteEntityButton.dataset.confirmDelete = "false";
          deleteEntityButton.textContent = defaultDeleteLabel;
        }
      } catch (error) {
        showToast(`삭제 실패: ${error.message}`);
        deleteEntityButton.disabled = false;
        deleteEntityButton.textContent = defaultDeleteLabel;
      }
      return;
    }
    if (event.target.id === "newCourseButton") {
      clearCourseTemplateDraft();
      state.courseManagement.draftPreviousCourseId = "";
      state.adminSelections.courseId = "";
      state.adminSearch.course = "";
      renderCourses();
    }
    if (event.target.id === "newArchiveButton") {
      const picker = document.getElementById("archivePicker");
      if (picker) picker.value = "";
      state.selectedArchiveId = "";
      renderArchive();
    }
    if (event.target.id === "newOrganizationButton") {
      state.adminSelections.organizationId = "";
      state.adminSearch.organization = "";
      renderOrganizations();
    }
    if (event.target.id === "newInstructorButton") {
      state.adminSelections.instructorId = "";
      state.adminSearch.instructor = "";
      renderInstructors();
    }
    if (event.target.id === "newVenueButton") {
      state.adminSelections.venueId = "";
      state.adminSearch.venue = "";
      renderVenues();
    }
  });

  document.body.addEventListener("change", (event) => {
    if (event.target.id === "archivePicker") {
      state.selectedArchiveId = event.target.value;
      renderArchive();
    }
  });

  document.body.addEventListener("input", (event) => {
    const smsTestPhone = event.target.closest("[data-sms-test-form] input[name='recipient_phone']");
    if (smsTestPhone) {
      smsTestPhone.value = formatMobilePhone(smsTestPhone.value);
      return;
    }
    const guestWalkInPhone = event.target.closest("[data-guest-walk-in-form] input[name='phone']");
    if (guestWalkInPhone) {
      guestWalkInPhone.value = formatMobilePhone(guestWalkInPhone.value);
      return;
    }
    if (event.target.matches("[data-dashboard-stat-search]")) {
      const kind = event.target.dataset.dashboardStatSearch;
      state.dashboardStatsSearch[kind] = event.target.value;
      updateDashboardMetricResults(kind);
      return;
    }
    const adminSearchInput = event.target.closest("[data-admin-search]");
    if (adminSearchInput) {
      const kind = adminSearchInput.dataset.adminSearch;
      state.adminSearch[kind] = adminSearchInput.value;
      updateAdminSearchResults(kind);
      return;
    }
    if (event.target.matches("[data-course-picker-search]")) {
      const kind = event.target.dataset.coursePickerSearch;
      state.coursePicker.kind = kind;
      state.coursePicker.query = event.target.value;
      updateCoursePickerModalResults(kind);
      return;
    }
    if (event.target.matches("[data-course-filter-search]")) {
      const target = event.target.dataset.courseFilterSearch;
      state.courseFilterPicker.target = target;
      state.courseFilterPicker.query = event.target.value;
      updateCourseFilterResults(target);
      return;
    }
    if (event.target.matches("[data-course-template-search]")) {
      state.courseTemplate.query = event.target.value;
      updateCourseTemplateResults();
      return;
    }
    if (event.target.matches("[data-course-series-search]")) {
      state.courseManagement.seriesQuery = event.target.value;
      updateCourseSeriesManagementResults();
      return;
    }
    if (event.target.matches("[data-course-series-create-search]")) {
      state.courseManagement.createQuery = event.target.value;
      const resultsContainer = document.querySelector("[data-course-series-create-results]");
      if (resultsContainer) resultsContainer.innerHTML = courseSeriesCreateResultsHtml();
      return;
    }
    if (event.target.matches("#courseForm input[name='starts_at']")) {
      const endInput = document.querySelector("#courseForm input[name='ends_at']");
      if (endInput) endInput.min = event.target.value || currentMinuteLocalDateTimeValue();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.adminNoticeModal.classList.contains("open")) {
      closeModal(elements.adminNoticeModal);
    }
  });

  document.body.addEventListener("submit", async (event) => {
    try {
      if (event.target.id === "organizationForm") return await saveOrganization(event);
      if (event.target.id === "instructorForm") return await saveInstructor(event);
      if (event.target.id === "venueForm") return await saveVenue(event);
      if (event.target.id === "courseForm") return await saveCourse(event);
      if (event.target.id === "archiveForm") return await saveArchive(event);
      if (event.target.id === "organizationAdminForm") return await inviteOrganizationAdmin(event);
      if (event.target.matches("[data-application-name-search-form]")) return applyApplicationNameSearch(event);
      if (event.target.matches("[data-admin-course-notification-form]")) return await saveAdminCourseNotificationPreferences(event);
      if (event.target.matches("[data-attendance-document-form]")) return await saveAttendanceDocument(event);
      if (event.target.matches("[data-walk-in-search-form]")) return await searchWalkInCandidates(event);
      if (event.target.matches("[data-guest-walk-in-form]")) return await addGuestWalkInAttendee(event);
      if (event.target.matches("[data-sms-test-form]")) return await handleSmsTestSubmit(event);
      if (event.target.id === "drawForm") return await runDraw(event);
    } catch (error) {
      showToast(`작업 실패: ${error.message}`);
    }
  });

  supabase.auth.onAuthStateChange((event) => {
    console.info("[모두의 인문학] 인증 상태 변경", event);
    if (event === "PASSWORD_RECOVERY") {
      state.isPasswordRecovery = true;
      updateAdminLoginFormVisibility();
      showToast("새 비밀번호를 입력해 주세요.");
    }
    if (state.isLoggingIn) return;
    window.setTimeout(() => {
      reload().catch((error) => {
        console.error("[모두의 인문학] 인증 상태 갱신 실패", error);
        showToast(`로그인 상태 갱신 실패: ${error.message}`);
      });
    }, 0);
  });
}

async function initialize() {
  state.isPasswordRecovery = isPasswordSetupUrl();
  bindEvents();
  await reload();
}

initialize().catch((error) => {
  elements.adminContent.innerHTML = `<div class="empty">관리자 페이지를 불러오지 못했습니다: ${escapeHtml(error.message)}</div>`;
});
