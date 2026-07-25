import { supabase } from "./supabaseClient.js";

const GUEST_ACCESS_TOKEN_SESSION_KEY = "humanities-guest-access-tokens";
const SHORT_CODE_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_TOKEN_PATTERN = /^[0-9a-f-]{36}\.[0-9a-f]{64}$/i;

const statusElement = document.getElementById("linkStatus");
const fallbackElement = document.getElementById("linkFallback");
const retryButton = document.getElementById("retryLinkButton");
const shortCode = window.location.hash.replace(/^#/, "").trim();
window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

function showInvalidLink() {
  document.title = "안내 링크 확인 필요 | 모두의 인문학";
  statusElement.textContent = "유효하지 않거나 더 이상 사용할 수 없는 안내 링크입니다.";
  retryButton.hidden = true;
  fallbackElement.hidden = false;
}

function rememberGuestAccess(courseId, accessToken) {
  if (!UUID_PATTERN.test(courseId) || !GUEST_TOKEN_PATTERN.test(accessToken) || accessToken.length !== 101) {
    return false;
  }

  try {
    const current = JSON.parse(window.sessionStorage.getItem(GUEST_ACCESS_TOKEN_SESSION_KEY) || "{}");
    const tokens = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    tokens[courseId] = accessToken;
    window.sessionStorage.setItem(GUEST_ACCESS_TOKEN_SESSION_KEY, JSON.stringify(tokens));
    return true;
  } catch (error) {
    console.warn("[모두의 인문학] 비회원 안내 링크 임시 저장 실패", error);
    return false;
  }
}

async function resolveShortLink() {
  if (!SHORT_CODE_PATTERN.test(shortCode)) {
    showInvalidLink();
    return;
  }

  retryButton.disabled = true;
  retryButton.hidden = true;
  fallbackElement.hidden = true;
  statusElement.textContent = "안내 링크를 확인하고 있습니다. 잠시만 기다려 주세요.";
  try {
    const { data, error } = await supabase.rpc("resolve_application_short_link", { p_code: shortCode });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    const courseId = String(result?.course_id || "");
    const accessToken = String(result?.access_token || "");
    if (!UUID_PATTERN.test(courseId)) {
      showInvalidLink();
      return;
    }

    const target = new URL("./index.html", window.location.href);
    target.searchParams.set("course", courseId);
    if (accessToken && !rememberGuestAccess(courseId, accessToken)) {
      target.hash = `guest=${encodeURIComponent(accessToken)}`;
    }
    window.location.replace(target.href);
  } catch (error) {
    console.error("[모두의 인문학] 안내 링크 확인 실패", error);
    statusElement.textContent = "안내 링크를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    retryButton.disabled = false;
    retryButton.hidden = false;
    fallbackElement.hidden = false;
  }
}

retryButton.addEventListener("click", resolveShortLink);
resolveShortLink();
