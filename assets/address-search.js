function normalizedResidencePart(value, maxLength = 60) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function residenceSelectionFromPostcode(data) {
  const sido = normalizedResidencePart(data?.sido);
  const sigungu = normalizedResidencePart(data?.sigungu);
  const district = normalizedResidencePart([sido, sigungu].filter(Boolean).join(" "));
  const ruralNeighborhood = normalizedResidencePart(data?.bname1);
  const legalNeighborhood = normalizedResidencePart(data?.bname2 || data?.bname);
  const neighborhood = ruralNeighborhood || legalNeighborhood;
  const selectedAddress = normalizedResidencePart(
    data?.userSelectedType === "J" ? data?.jibunAddress : data?.roadAddress,
    200,
  ) || normalizedResidencePart(data?.address, 200);

  if (!district || !neighborhood || (!ruralNeighborhood && /리$/.test(neighborhood))) return null;
  return {
    district,
    neighborhood,
    storedLabel: `${district} ${neighborhood}`,
    discardedAddress: selectedAddress,
  };
}

function showError(message) {
  const container = document.getElementById("postcode");
  container.innerHTML = "";
  const paragraph = document.createElement("p");
  paragraph.className = "status";
  paragraph.textContent = message;
  container.append(paragraph);
}

const Postcode = globalThis.kakao?.Postcode || globalThis.daum?.Postcode;
if (!window.opener || window.opener.closed) {
  showError("주소검색을 요청한 창을 확인하지 못했습니다. 이 창을 닫고 다시 시도해 주세요.");
} else if (typeof Postcode !== "function") {
  showError("주소검색을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
} else {
  new Postcode({
    oncomplete(data) {
      const selection = residenceSelectionFromPostcode(data);
      if (!selection) {
        showError("선택한 주소에서 읍·면·동을 확인하지 못했습니다. 다른 검색 결과를 선택해 주세요.");
        return;
      }
      window.opener.postMessage(
        { type: "humanities:residence-selected", selection },
        window.location.origin,
      );
      window.close();
    },
    onresize(size) {
      document.getElementById("postcode").style.height = `${Math.max(400, Number(size?.height || 0))}px`;
    },
    width: "100%",
    height: "100%",
  }).embed(document.getElementById("postcode"));
}
