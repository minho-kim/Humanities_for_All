import { supabase } from "./supabaseClient.js";

const GUEST_ACCESS_TOKEN_SESSION_KEY = "humanities-guest-access-tokens";
const SHORT_CODE_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const ORGANIZATION_SHORT_CODE_PATTERN = /^o-[A-Za-z0-9_-]{12}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,47}$/;
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

function organizationShortCodeBytes(bytes) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function organizationShortCode(organizationId) {
  const normalizedId = String(organizationId || "").trim().toLowerCase();
  if (!UUID_PATTERN.test(normalizedId) || !globalThis.crypto?.subtle) return "";
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`humanities:organization:v1:${normalizedId}`),
  );
  return `o-${organizationShortCodeBytes(new Uint8Array(digest).slice(0, 9))}`;
}

async function resolveOrganizationShortLink() {
  document.title = "단체 교육 페이지로 이동 | 모두의 인문학";
  statusElement.textContent = "단체 교육 주소를 확인하고 있습니다. 잠시만 기다려 주세요.";
  const { data, error } = await supabase
    .from("organizations")
    .select("id,slug,is_active")
    .eq("is_active", true);
  if (error) throw error;

  const organizations = Array.isArray(data) ? data : [];
  const candidates = await Promise.all(organizations.map(async (organization) => ({
    organization,
    code: await organizationShortCode(organization.id),
  })));
  const matches = candidates.filter(({ organization, code }) => (
    code === shortCode
    && ORGANIZATION_SLUG_PATTERN.test(String(organization?.slug || ""))
  ));
  if (matches.length !== 1) {
    showInvalidLink();
    return;
  }

  const target = new URL("./index.html", window.location.href);
  target.hash = `organization/${encodeURIComponent(matches[0].organization.slug)}`;
  window.location.replace(target.href);
}

async function resolveShortLink() {
  if (!SHORT_CODE_PATTERN.test(shortCode) && !ORGANIZATION_SHORT_CODE_PATTERN.test(shortCode)) {
    showInvalidLink();
    return;
  }

  retryButton.disabled = true;
  retryButton.hidden = true;
  fallbackElement.hidden = true;
  statusElement.textContent = "안내 링크를 확인하고 있습니다. 잠시만 기다려 주세요.";
  try {
    if (ORGANIZATION_SHORT_CODE_PATTERN.test(shortCode)) {
      await resolveOrganizationShortLink();
      return;
    }
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
