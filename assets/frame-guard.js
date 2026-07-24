if (window.top !== window.self) {
  const message = document.createElement("p");
  message.textContent = "관리자 페이지는 다른 사이트 안에서 열 수 없습니다.";
  document.body.replaceChildren(message);
  window.stop();
}
