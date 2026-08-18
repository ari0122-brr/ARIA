document.addEventListener("DOMContentLoaded", () => {
  // Lucide 아이콘 로드 (노션 느낌의 선형 아이콘 적용)
  if (window.lucide) {
    lucide.createIcons();
  }

  // 탭 전환 로직
  const navItems = document.querySelectorAll(".nav-item");
  const tabContents = document.querySelectorAll(".tab-content");

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const targetTab = item.getAttribute("data-tab");

      navItems.forEach((nav) => nav.classList.remove("active"));
      tabContents.forEach((content) => content.classList.remove("active"));

      item.classList.add("active");
      document.getElementById(targetTab).classList.add("active");
    });
  });

  // 급식 데이터 불러오기
  loadMealData();
});

// 급식 데이터 표시 함수 (중식/석식 구분)
function loadMealData() {
  const lunchList = document.getElementById("lunch-list");
  const dinnerList = document.getElementById("dinner-list");

  // 예시 중식 데이터
  const lunchMenu = ["현미밥", "쇠고기미역국", "제육볶음", "계란말이", "포기김치"];
  
  // 예시 석식 데이터
  const dinnerMenu = ["치킨마요덮밥", "팽이버섯장국", "떡볶이", "단무지", "유기농음료"];

  if (lunchList) {
    lunchList.innerHTML = lunchMenu.map(item => `<li>• ${item}</li>`).join("");
  }

  if (dinnerList) {
    dinnerList.innerHTML = dinnerMenu.map(item => `<li>• ${item}</li>`).join("");
  }
}
