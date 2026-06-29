import {
  ARCHIVE_BUCKET,
  ATTENDANCE_DOCUMENT_BUCKET,
  SITE_MEDIA_BUCKET,
  escapeHtml,
  formatDateTime,
  getDisplayName,
  normalizeSafeUrl,
  randomPick,
  requireSafeUrl,
  shortDate,
  statusLabels,
  supabase,
  URL_RULES,
  verificationLabels,
} from "./supabaseClient.js";

const state = {
  tab: "dashboard",
  user: null,
  adminProfile: null,
  adminProfileError: null,
  isLoggingIn: false,
  applicationFilters: {
    courseId: "",
  },
  organizations: [],
  instructors: [],
  venues: [],
  courses: [],
  sessions: [],
  archives: [],
  applications: [],
  attendanceDocuments: [],
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
const rosterNameSorter = new Intl.Collator("ko-KR", {
  numeric: true,
  sensitivity: "base",
});

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 3000);
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
  elements.adminLogoutButton.classList.toggle("hidden", !isSignedIn);
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

function hasCourseDateArrived(course) {
  const courseDate = seoulDateKey(course?.starts_at);
  if (!courseDate) return false;
  return courseDate <= seoulDateKey(new Date());
}

function attendanceDocumentsForCourse(courseId) {
  return state.attendanceDocuments.filter((document) => document.course_id === courseId);
}

function applicationCountBadges(applications) {
  return `<span class="badge green">신청 ${applications.length}</span>`;
}

function isActiveApplication(application) {
  return application.status !== "cancelled";
}

function activeApplications() {
  return state.applications.filter(isActiveApplication);
}

function filteredApplications() {
  return activeApplications().filter((application) => {
    if (state.applicationFilters.courseId && application.course_id !== state.applicationFilters.courseId) return false;
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

function renderApplicationRow(application) {
  const attendanceConfirmed = Boolean(application.attendance_confirmed_at);
  const course = courseById(application.course_id);
  const canConfirmAttendance = hasCourseDateArrived(course);
  return `
    <div class="table-row">
      <div class="row-top">
        <strong>${escapeHtml(application.applicant_name || "신청자")}</strong>
        <span class="badge ${attendanceConfirmed ? "green" : "gray"}">${attendanceConfirmed ? "참석 확인" : "신청"}</span>
      </div>
      <div class="muted">신청일 ${escapeHtml(shortDate(application.created_at))}</div>
      <p class="muted">이메일: ${escapeHtml(application.email || "없음")} · 전화: ${escapeHtml(application.phone || "없음")}</p>
      ${application.note ? `<p>${escapeHtml(application.note)}</p>` : ""}
      <p class="muted">개인정보·문자 안내 동의 완료</p>
      <div class="actions">
        ${attendanceConfirmed
          ? `<span class="badge green">참석 확인 ${escapeHtml(shortDate(application.attendance_confirmed_at))}</span>
             <button class="btn small secondary" type="button" data-unconfirm-attendance="${escapeHtml(application.id)}">참석 확인 취소</button>`
          : `<button class="btn small" type="button" data-confirm-attendance="${escapeHtml(application.id)}" ${canConfirmAttendance ? "" : "disabled"}>${canConfirmAttendance ? "참석 확인" : "교육일 전"}</button>`}
      </div>
    </div>
  `;
}

function phoneLastFour(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.slice(-4);
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
  if (!applications.length) {
    showToast("출력할 신청자가 없습니다.");
    return;
  }

  const title = courseName(courseId);
  const densePrintClass = applications.length >= 40 ? "dense" : "";
  const rows = applications.map((application, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(title)}</td>
      <td>${escapeHtml(application.applicant_name || "")}</td>
      <td>${escapeHtml(phoneLastFour(application.phone))}</td>
      <td class="signature"></td>
    </tr>
  `).join("");
  const printWindow = window.open("", "_blank", "width=980,height=720");
  if (!printWindow) {
    showToast("팝업 차단을 해제한 뒤 다시 시도해 주세요.");
    return;
  }

  printWindow.document.write(`<!doctype html>
    <html lang="ko">
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(title)} 신청자 명단</title>
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
      <h1>${escapeHtml(title)} 신청자 명단</h1>
      <p>${escapeHtml(course?.starts_at ? shortDate(course.starts_at) : "일정 미정")} · 총 ${applications.length}명</p>
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

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
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

async function removeUploadedArchiveFile(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(ARCHIVE_BUCKET).remove([path]);
  if (error) console.warn("[모두의 인문학] 아카이브 업로드 롤백 파일 삭제 실패", error);
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

async function removeUploadedAttendanceDocument(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(ATTENDANCE_DOCUMENT_BUCKET).remove([path]);
  if (error) console.warn("[모두의 인문학] 참석자 명단 스캔본 업로드 롤백 파일 삭제 실패", error);
}

function statusBadge(status) {
  const className = status === "open" ? "green" : status === "finished" ? "gray" : status === "cancelled" ? "red" : "";
  return `<span class="badge ${className}">${escapeHtml(statusLabels[status] || status)}</span>`;
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

  if (state.user) {
    const { data: profile, error } = await supabase
      .from("admin_profiles")
      .select("*")
      .eq("user_id", state.user.id)
      .maybeSingle();
    if (error) {
      state.adminProfileError = error;
      console.error("[모두의 인문학] 관리자 권한 조회 실패", error);
    } else {
      state.adminProfile = profile;
    }
  }

  console.info("[모두의 인문학] 관리자 세션 상태", {
    signedIn: Boolean(state.user),
    userId: state.user?.id || null,
    isAdmin: Boolean(state.adminProfile),
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

  const role = state.adminProfile ? `${state.adminProfile.role} 권한` : "관리자 권한 없음";
  elements.adminStatus.innerHTML = `
    <p><strong>${escapeHtml(state.user.email || getDisplayName(state.user))}</strong></p>
    <p class="muted">${escapeHtml(role)}</p>
    <p class="muted">사용자 UUID</p>
    <div class="code">${escapeHtml(state.user.id)}</div>
  `;

  if (state.adminProfileError) {
    elements.permissionNotice.classList.remove("hidden");
    elements.permissionNotice.innerHTML = `
      <h3>관리자 권한을 확인하지 못했습니다</h3>
      <p>로그인은 되었지만 권한 정보를 불러오지 못했습니다. 페이지를 새로고침하거나 잠시 후 다시 시도해 주세요.</p>
      <p class="muted">${escapeHtml(state.adminProfileError.message)}</p>
    `;
  } else if (!state.adminProfile) {
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
    supabase.from("course_applications").select("*").order("created_at", { ascending: false }),
    supabase.from("course_attendance_documents").select("*").order("created_at", { ascending: false }),
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
    state.applications,
    state.attendanceDocuments,
    state.reviews,
    state.draws,
    state.winners,
  ] = requests.map((result) => result.data || []);

  render();
}

function renderDashboard() {
  const verified = state.reviews.filter((review) => review.verification_status === "verified").length;
  const pending = state.reviews.filter((review) => review.verification_status === "pending").length;
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
      <div class="section"><h3>후기 검수</h3><p>참여 확인 ${verified}개 · 확인 대기 ${pending}개</p></div>
      <div class="section"><h3>관리자 전용 추첨</h3><p>추첨 기록 ${state.draws.length}건 · 당첨 이력 ${state.winners.length}건</p></div>
    </div>
  `;
}

function renderOrganizationForm(organization = {}) {
  const logoUrl = normalizeSafeUrl(organization.logo_url, URL_RULES.image);
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
      ${logoUrl ? `<div class="media-preview"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(organization.name || "단체")} 로고"><a href="${escapeHtml(logoUrl)}" target="_blank" rel="noreferrer">현재 로고 보기</a></div>` : ""}
      <label style="margin-top: 10px;">로고 이미지 업로드<input name="logo_file" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
      <p class="media-upload-note">JPG, PNG, WEBP, GIF 형식 · 5MB 이하. 파일을 선택하면 저장할 때 Supabase Storage에 업로드됩니다.</p>
      <label style="margin-top: 10px;">로고 이미지 URL<input name="logo_url" value="${escapeHtml(organization.logo_url || "")}" placeholder="https://"></label>
      <label style="margin-top: 10px;">연락처<input name="contact_email" value="${escapeHtml(organization.contact_email || "")}" placeholder="이메일, 전화번호, 담당자 연락처 등"></label>
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
        const logoUrl = normalizeSafeUrl(organization.logo_url, URL_RULES.image);
        return `<div class="table-row">${logoUrl ? `<img class="admin-thumb" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(organization.name)} 로고">` : ""}<div class="row-top"><strong>${escapeHtml(organization.name)}</strong><span class="badge ${organization.is_active !== false ? "green" : "gray"}">${organization.is_active !== false ? "공개" : "숨김"}</span></div><span class="muted">교육 ${courseCount}개 · ${escapeHtml(organization.slug)}</span><p>${escapeHtml(organization.description || "소개 없음")}</p></div>`;
      }).join("") || `<div class="empty">등록된 단체가 없습니다.</div>`}
    </div>
  `;
}

function renderInstructorForm(instructor = {}) {
  const photoUrl = normalizeSafeUrl(instructor.photo_url, URL_RULES.image);
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
      <label style="margin-top: 10px;"><span><input name="is_active" type="checkbox" ${instructor.is_active !== false ? "checked" : ""} style="width:auto;min-height:auto;"> 공개 페이지에서 사용</span></label>
      <div class="actions" style="margin-top: 14px;">
        <button class="btn" type="submit">${instructor.id ? "강사 수정" : "강사 추가"}</button>
        <button class="btn secondary" type="button" id="newInstructorButton">새 강사 입력</button>
      </div>
    </form>
  `;
}

function renderInstructors() {
  const selectedId = document.getElementById("instructorPicker")?.value || "";
  const selectedInstructor = state.instructors.find((instructor) => instructor.id === selectedId) || {};
  elements.adminContent.innerHTML = `
    <h2>강사 관리</h2>
    <p class="muted">교육 상세 화면에서 강사 프로필로 표시됩니다.</p>
    <label>수정할 강사 선택<select id="instructorPicker"><option value="">새 강사</option>${state.instructors.map((instructor) => `<option value="${instructor.id}" ${instructor.id === selectedId ? "selected" : ""}>${escapeHtml(instructor.name)}</option>`).join("")}</select></label>
    <div style="margin-top: 14px;">${renderInstructorForm(selectedInstructor)}</div>
    <h3>강사 목록</h3>
    <div class="table-list">
      ${state.instructors.map((instructor) => {
        const photoUrl = normalizeSafeUrl(instructor.photo_url, URL_RULES.image);
        return `<div class="table-row">${photoUrl ? `<img class="admin-thumb round" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(instructor.name)} 사진">` : ""}<div class="row-top"><strong>${escapeHtml(instructor.name)}</strong><span class="badge ${instructor.is_active !== false ? "green" : "gray"}">${instructor.is_active !== false ? "사용" : "숨김"}</span></div><span class="muted">${escapeHtml(instructor.title || "직함 없음")}</span><p>${escapeHtml(instructor.bio || "프로필 소개 없음")}</p></div>`;
      }).join("") || `<div class="empty">등록된 강사가 없습니다.</div>`}
    </div>
  `;
}

function renderVenueForm(venue = {}) {
  return `
    <form id="venueForm" class="section">
      <input type="hidden" name="venue_id" value="${escapeHtml(venue.id || "")}">
      <div class="admin-grid">
        <label>장소명<input name="name" value="${escapeHtml(venue.name || "")}" required></label>
        <label>세부 장소<input name="detail" value="${escapeHtml(venue.detail || "")}" placeholder="예: 2층 세미나실"></label>
      </div>
      <label style="margin-top: 10px;">주소<input name="address" value="${escapeHtml(venue.address || "")}" placeholder="지도 검색에 사용할 주소"></label>
      <div class="admin-grid" style="margin-top: 10px;">
        <label>카카오맵 URL<input name="kakao_map_url" value="${escapeHtml(venue.kakao_map_url || "")}" placeholder="https://map.kakao.com/..."></label>
        <label>네이버플레이스 URL<input name="naver_place_url" value="${escapeHtml(venue.naver_place_url || "")}" placeholder="https://map.naver.com/... 또는 place.naver.com/..."></label>
      </div>
      <label style="margin-top: 10px;"><span><input name="is_online" type="checkbox" ${venue.is_online ? "checked" : ""} style="width:auto;min-height:auto;"> 온라인 장소</span></label>
      <div class="actions" style="margin-top: 14px;">
        <button class="btn" type="submit">${venue.id ? "장소 수정" : "장소 추가"}</button>
        <button class="btn secondary" type="button" id="newVenueButton">새 장소 입력</button>
      </div>
    </form>
  `;
}

function renderVenues() {
  const selectedId = document.getElementById("venuePicker")?.value || "";
  const selectedVenue = state.venues.find((venue) => venue.id === selectedId) || {};
  elements.adminContent.innerHTML = `
    <h2>장소 관리</h2>
    <p class="muted">교육 상세 화면에서 주소, 카카오맵, 네이버플레이스 링크로 표시됩니다. 정확한 장소 페이지가 있으면 URL을 붙여 넣으세요.</p>
    <label>수정할 장소 선택<select id="venuePicker"><option value="">새 장소</option>${state.venues.map((venue) => `<option value="${venue.id}" ${venue.id === selectedId ? "selected" : ""}>${escapeHtml(venue.name)}</option>`).join("")}</select></label>
    <div style="margin-top: 14px;">${renderVenueForm(selectedVenue)}</div>
    <h3>장소 목록</h3>
    <div class="table-list">
      ${state.venues.map((venue) => {
        const kakaoUrl = normalizeSafeUrl(venue.kakao_map_url, URL_RULES.kakaoMap);
        const naverUrl = normalizeSafeUrl(venue.naver_place_url, URL_RULES.naverPlace);
        return `<div class="table-row"><div class="row-top"><strong>${escapeHtml(venue.name)}</strong><span class="badge ${venue.is_online ? "green" : "gray"}">${venue.is_online ? "온라인" : "오프라인"}</span></div><span class="muted">${escapeHtml(venue.address || "주소 없음")} ${venue.detail ? `· ${escapeHtml(venue.detail)}` : ""}</span><div class="actions">${kakaoUrl ? `<a class="btn small secondary" href="${escapeHtml(kakaoUrl)}" target="_blank" rel="noreferrer">카카오맵</a>` : ""}${naverUrl ? `<a class="btn small secondary" href="${escapeHtml(naverUrl)}" target="_blank" rel="noreferrer">네이버플레이스</a>` : ""}</div></div>`;
      }).join("") || `<div class="empty">등록된 장소가 없습니다.</div>`}
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
      <div class="admin-grid" style="margin-top: 10px;">
        <label>교육 자료 제목<input name="course_file_title" placeholder="예: 강의계획서, 읽기 자료"></label>
        <label>교육 자료 PDF 업로드<input name="course_file" type="file" accept="application/pdf,.pdf"></label>
      </div>
      <p class="media-upload-note">PDF 15MB 이하. 저장하면 해당 교육의 공개 자료로 함께 등록됩니다.</p>
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
    <p class="muted">후기 작성은 신청 관리에서 참석 확인이 완료된 참여자에게만 열립니다.</p>
    <div class="table-list">
      ${state.reviews.map((review) => `
        <div class="table-row">
          <div class="row-top">
            <strong>${escapeHtml(review.author_name || "참여자")}</strong>
            <span class="badge ${review.verification_status === "verified" ? "green" : review.verification_status === "rejected" ? "red" : "gray"}">${escapeHtml(verificationLabels[review.verification_status] || review.verification_status)}</span>
          </div>
          <div class="muted">${escapeHtml(courseName(review.course_id))} · ${escapeHtml(shortDate(review.created_at))}</div>
          <p>${escapeHtml(review.body)}</p>
          <p class="muted">공개 상태: ${review.is_hidden ? "숨김" : "공개"}</p>
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

function renderApplications() {
  const applications = filteredApplications();
  const groups = applicationGroups(applications);
  elements.adminContent.innerHTML = `
    <h2>교육 신청 관리</h2>
    <p class="muted">신청자 이름, 이메일, 전화번호는 교육 접수와 안내 목적으로만 사용하세요. 전화번호는 별도 인증 없이 신청자가 입력한 값입니다.</p>
    <div class="section" style="margin: 12px 0 14px;">
      <div class="admin-grid">
        <label>교육별 보기
          <select id="applicationCourseFilter">
            <option value="">전체 교육</option>
            ${optionList(state.courses, state.applicationFilters.courseId)}
          </select>
        </label>
      </div>
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
                <br><span class="muted">${escapeHtml(group.course?.starts_at ? shortDate(group.course.starts_at) : "일정 미정")} · ${escapeHtml(group.course?.status ? (statusLabels[group.course.status] || group.course.status) : "교육 정보 확인 필요")}</span>
              </span>
              <span class="actions">
                ${applicationCountBadges(group.applications)}
                <button class="btn small secondary" type="button" data-print-roster="${escapeHtml(group.courseId)}">신청자 명단 출력</button>
              </span>
            </div>
          </summary>
          <div class="table-list" style="margin-top: 12px;">
            ${group.applications.map(renderApplicationRow).join("")}
          </div>
          ${renderAttendanceDocumentSection(group.courseId)}
        </details>
      `).join("") || `<div class="empty">${state.applications.length ? "선택한 조건에 맞는 신청이 없습니다." : "아직 교육 신청이 없습니다."}</div>`}
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
  else if (state.tab === "instructors") renderInstructors();
  else if (state.tab === "venues") renderVenues();
  else if (state.tab === "courses") renderCourses();
  else if (state.tab === "applications") renderApplications();
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
  const organizationId = formData.get("organization_id");
  const sortOrder = Number(formData.get("sort_order") || 0);
  const logoFile = formData.get("logo_file");
  const payload = {
    name: String(formData.get("name") || "").trim(),
    slug: String(formData.get("slug") || "").trim(),
    description: String(formData.get("description") || "").trim() || null,
    website_url: requireSafeUrl(formData.get("website_url"), "홈페이지 URL", URL_RULES.external),
    contact_email: String(formData.get("contact_email") || "").trim() || null,
    logo_url: requireSafeUrl(formData.get("logo_url"), "로고 이미지 URL", URL_RULES.image),
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    is_active: formData.get("is_active") === "on",
  };

  if (!payload.name || !payload.slug) {
    showToast("단체명과 주소 이름을 입력해 주세요.");
    return;
  }

  let uploadedLogoPath = "";
  if (hasSelectedFile(logoFile)) {
    showToast("로고 이미지를 업로드하는 중입니다.");
    const uploaded = await uploadSiteImage(logoFile, "organization-logos", payload.slug || payload.name);
    payload.logo_url = uploaded.publicUrl;
    uploadedLogoPath = uploaded.path;
  }

  const request = organizationId
    ? supabase.from("organizations").update(payload).eq("id", organizationId)
    : supabase.from("organizations").insert(payload);

  const { error } = await request;
  if (error) {
    await removeUploadedSiteImage(uploadedLogoPath);
    throw error;
  }

  showToast("단체 정보를 저장했습니다.");
  await reload();
  state.tab = "organizations";
  render();
}

async function saveInstructor(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const instructorId = formData.get("instructor_id");
  const photoFile = formData.get("photo_file");
  const payload = {
    name: String(formData.get("name") || "").trim(),
    title: String(formData.get("title") || "").trim() || null,
    bio: String(formData.get("bio") || "").trim() || null,
    photo_url: requireSafeUrl(formData.get("photo_url"), "프로필 사진 URL", URL_RULES.image),
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

  const { error } = await request;
  if (error) {
    await removeUploadedSiteImage(uploadedPhotoPath);
    throw error;
  }

  showToast("강사 정보를 저장했습니다.");
  await reload();
  state.tab = "instructors";
  render();
}

async function saveVenue(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const venueId = formData.get("venue_id");
  const payload = {
    name: String(formData.get("name") || "").trim(),
    address: String(formData.get("address") || "").trim() || null,
    detail: String(formData.get("detail") || "").trim() || null,
    kakao_map_url: requireSafeUrl(formData.get("kakao_map_url"), "카카오맵 URL", URL_RULES.kakaoMap),
    naver_place_url: requireSafeUrl(formData.get("naver_place_url"), "네이버플레이스 URL", URL_RULES.naverPlace),
    is_online: formData.get("is_online") === "on",
  };

  if (!payload.name) {
    showToast("장소명을 입력해 주세요.");
    return;
  }

  const request = venueId
    ? supabase.from("venues").update(payload).eq("id", venueId)
    : supabase.from("venues").insert(payload);

  const { error } = await request;
  if (error) throw error;

  showToast("장소 정보를 저장했습니다.");
  await reload();
  state.tab = "venues";
  render();
}

async function saveCourse(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
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
    application_url: requireSafeUrl(formData.get("application_url"), "신청 링크", URL_RULES.external),
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

  showToast(hasSelectedFile(formData.get("course_file")) ? "교육과 자료를 저장했습니다." : "교육을 저장했습니다.");
  await reload();
  state.tab = "courses";
  render();
}

async function saveArchive(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
  const formData = new FormData(form);
  const courseId = formData.get("course_id");
  let url = requireSafeUrl(formData.get("url"), "외부 URL", URL_RULES.archive);
  const file = formData.get("file");
  let archiveType = String(formData.get("type"));

  let uploadedFilePath = "";
  if (hasSelectedFile(file)) {
    const uploaded = await uploadArchiveFile(file, courseId, formData.get("title"));
    uploadedFilePath = uploaded.path;
    url = uploaded.publicUrl;
    archiveType = uploaded.archiveType;
  }

  if (!url) {
    showToast("외부 URL 또는 업로드 파일이 필요합니다.");
    return;
  }

  const { error } = await supabase.from("course_archives").insert({
    course_id: courseId,
    type: archiveType,
    title: String(formData.get("title")).trim(),
    url,
    caption: String(formData.get("caption") || "").trim(),
    is_public: formData.get("is_public") === "on",
    created_by: state.user.id,
  });
  if (error) {
    await removeUploadedArchiveFile(uploadedFilePath);
    throw error;
  }

  showToast("아카이브를 등록했습니다.");
  await reload();
  state.tab = "archive";
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

async function runDraw(event) {
  event.preventDefault();
  const form = getSubmitForm(event);
  if (!form) return;
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
    const attendanceButton = event.target.closest("[data-confirm-attendance]");
    const unconfirmAttendanceButton = event.target.closest("[data-unconfirm-attendance]");
    const rosterButton = event.target.closest("[data-print-roster]");
    const attendanceDocumentButton = event.target.closest("[data-open-attendance-document]");
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
    if (attendanceDocumentButton) {
      try {
        await openAttendanceDocument(attendanceDocumentButton.dataset.openAttendanceDocument);
      } catch (error) {
        showToast(`문서 열기 실패: ${error.message}`);
      }
      return;
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
    if (event.target.id === "newInstructorButton") {
      const picker = document.getElementById("instructorPicker");
      if (picker) picker.value = "";
      renderInstructors();
    }
    if (event.target.id === "newVenueButton") {
      const picker = document.getElementById("venuePicker");
      if (picker) picker.value = "";
      renderVenues();
    }
  });

  document.body.addEventListener("change", (event) => {
    if (event.target.id === "organizationPicker") renderOrganizations();
    if (event.target.id === "instructorPicker") renderInstructors();
    if (event.target.id === "venuePicker") renderVenues();
    if (event.target.id === "coursePicker") renderCourses();
    if (event.target.id === "applicationCourseFilter") {
      state.applicationFilters.courseId = event.target.value;
      renderApplications();
    }
  });

  document.body.addEventListener("submit", async (event) => {
    try {
      if (event.target.id === "organizationForm") return await saveOrganization(event);
      if (event.target.id === "instructorForm") return await saveInstructor(event);
      if (event.target.id === "venueForm") return await saveVenue(event);
      if (event.target.id === "courseForm") return await saveCourse(event);
      if (event.target.id === "archiveForm") return await saveArchive(event);
      if (event.target.matches("[data-attendance-document-form]")) return await saveAttendanceDocument(event);
      if (event.target.id === "drawForm") return await runDraw(event);
    } catch (error) {
      showToast(`작업 실패: ${error.message}`);
    }
  });

  supabase.auth.onAuthStateChange((event) => {
    console.info("[모두의 인문학] 인증 상태 변경", event);
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
  bindEvents();
  await reload();
}

initialize().catch((error) => {
  elements.adminContent.innerHTML = `<div class="empty">관리자 페이지를 불러오지 못했습니다: ${escapeHtml(error.message)}</div>`;
});
