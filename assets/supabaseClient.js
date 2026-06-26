import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://wmynvcuedusjnufmhdqv.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rXN3xjZ2aJGeb00QMEs1KQ_bChOdSRI";
export const ARCHIVE_BUCKET = "archive-media";
export const APP_VERSION = "2026.06.26.1228";

if (!globalThis.__HUMANITIES_FOR_ALL_VERSION_LOGGED__) {
  globalThis.__HUMANITIES_FOR_ALL_VERSION_LOGGED__ = true;
  console.info(`[모두의 인문학] version ${APP_VERSION}`);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const statusLabels = {
  scheduled: "예정",
  open: "모집 중",
  finished: "종료",
  cancelled: "취소",
};

export const verificationLabels = {
  none: "일반 후기",
  pending: "참여 확인 대기",
  verified: "참여 확인",
  rejected: "확인 반려",
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

export function formatDateTime(value) {
  if (!value) return "일정 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDate(value) {
  if (!value) return "일정 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(value));
}

export function shortDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function getCurrentUrlWithoutHash() {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

export function getDisplayName(user) {
  return user?.user_metadata?.name || user?.email?.split("@")[0] || "참여자";
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
