export const SUPABASE_URL = "https://wmynvcuedusjnufmhdqv.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rXN3xjZ2aJGeb00QMEs1KQ_bChOdSRI";
export const ARCHIVE_BUCKET = "archive-media";
export const SITE_MEDIA_BUCKET = "site-media";
export const ATTENDANCE_DOCUMENT_BUCKET = "attendance-documents";
export const APP_VERSION = "2026.07.24.0850";

export const URL_RULES = Object.freeze({
  external: Object.freeze({ protocols: ["https:"] }),
  image: Object.freeze({ protocols: ["https:"] }),
  archive: Object.freeze({ protocols: ["https:"] }),
  kakaoMap: Object.freeze({ protocols: ["https:"], hostSuffixes: ["kakao.com", "daum.net"] }),
  naverPlace: Object.freeze({ protocols: ["https:"], hostSuffixes: ["naver.com", "naver.me"] }),
});

if (!globalThis.__HUMANITIES_FOR_ALL_VERSION_LOGGED__) {
  globalThis.__HUMANITIES_FOR_ALL_VERSION_LOGGED__ = true;
  console.info(`[모두의 인문학] version ${APP_VERSION}`);
}

export const statusLabels = {
  scheduled: "예정",
  open: "모집 중",
  finished: "종료",
  cancelled: "취소",
};

export const verificationLabels = {
  none: "후기",
  pending: "후기",
  verified: "후기",
  rejected: "후기",
};

export function escapeHtml(value) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (character) => map[character]);
}

function hostMatches(hostname, suffixes = []) {
  const normalizedHost = String(hostname || "").toLowerCase();
  return suffixes.some((suffix) => normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`));
}

export function normalizeSafeUrl(value, rule = URL_RULES.external) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/[\u0000-\u001F\u007F\s]/.test(raw)) return "";

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw);
  const candidate = hasProtocol ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return "";
  }

  const allowedProtocols = rule.protocols || ["https:"];
  if (!allowedProtocols.includes(parsed.protocol)) return "";
  if (!parsed.hostname) return "";
  if (rule.hostSuffixes?.length && !hostMatches(parsed.hostname, rule.hostSuffixes)) return "";
  return parsed.href;
}

export function requireSafeUrl(value, label, rule = URL_RULES.external) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = normalizeSafeUrl(raw, rule);
  if (!normalized) throw new Error(`${label}은 허용된 https 주소만 입력해 주세요.`);
  return normalized;
}

export function formatDateTime(value) {
  if (!value) return "일정 미정";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "일정 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatDate(value) {
  if (!value) return "일정 미정";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "일정 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function seoulDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatTimeRange(startsAt, endsAt) {
  if (!startsAt) return "시간 미정";
  const startText = formatClock(startsAt);
  if (!startText) return "시간 미정";
  const endText = endsAt ? formatClock(endsAt) : "";
  if (!endText || seoulDateKey(startsAt) !== seoulDateKey(endsAt)) return startText;
  return `${startText}–${endText}`;
}

export function formatSchedule(startsAt, endsAt, { includeYear = false } = {}) {
  if (!startsAt) return "일정 미정";
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return "일정 미정";
  const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    ...(includeYear ? { year: "numeric" } : {}),
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const startDateText = dateFormatter.format(start);
  const startTimeText = formatClock(startsAt);
  const end = endsAt ? new Date(endsAt) : null;
  if (!end || Number.isNaN(end.getTime())) return `${startDateText} ${startTimeText}`;
  if (seoulDateKey(startsAt) === seoulDateKey(endsAt)) {
    return `${startDateText} ${formatTimeRange(startsAt, endsAt)}`;
  }
  return `${startDateText} ${startTimeText} – ${dateFormatter.format(end)} ${formatClock(endsAt)}`;
}

export function shortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function getCurrentUrlWithoutHash() {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

export function getDisplayName(user) {
  return user?.user_metadata?.name || user?.email?.split("@")[0] || "참여자";
}

export function getMaskedEmailName(value) {
  const raw = String(value || "").trim();
  const base = raw.replace(/님의 후기$/, "").trim();
  if (!base) return "참여***";
  if (base.includes("***")) return base;
  const localPart = base.includes("@") ? base.split("@")[0] : base;
  const visible = Array.from(localPart).slice(0, 3).join("") || "참여";
  return `${visible}***`;
}

export function getReviewAuthorName(user) {
  return getMaskedEmailName(user?.email || getDisplayName(user));
}

export function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key];
    if (!acc.has(value)) acc.set(value, []);
    acc.get(value).push(item);
    return acc;
  }, new Map());
}

export function byId(items) {
  return items.reduce((acc, item) => {
    acc.set(item.id, item);
    return acc;
  }, new Map());
}

export function randomPick(items, count) {
  const pool = items.slice();
  const picked = [];
  const cryptoApi = window.crypto;

  while (pool.length && picked.length < count) {
    let index = Math.floor(Math.random() * pool.length);
    if (cryptoApi?.getRandomValues) {
      const value = new Uint32Array(1);
      cryptoApi.getRandomValues(value);
      index = value[0] % pool.length;
    }
    picked.push(pool.splice(index, 1)[0]);
  }

  return picked;
}
