document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    lucide.createIcons();
  }

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

  loadMealData();
});

function loadMealData() {
  const breakfastList = document.getElementById("breakfast-list");
  const lunchList = document.getElementById("lunch-list");
  const dinnerList = document.getElementById("dinner-list");

  const breakfastMenu = ["쌀밥", "콩나물국", "스크램블에그", "배추김치", "우유"];
  const lunchMenu = ["현미밥", "쇠고기미역국", "제육볶음", "계란말이", "포기김치"];
  const dinnerMenu = ["치킨마요덮밥", "팽이버섯장국", "떡볶이", "단무지", "유기농음료"];

  if (breakfastList) breakfastList.innerHTML = breakfastMenu.map(item => `<li>• ${item}</li>`).join("");
  if (lunchList) lunchList.innerHTML = lunchMenu.map(item => `<li>• ${item}</li>`).join("");
  if (dinnerList) dinnerList.innerHTML = dinnerMenu.map(item => `<li>• ${item}</li>`).join("");
}
