function setTheme(theme) {
  const themeLink = document.getElementById("theme-style");
  if (themeLink) {
    const newHref = theme === "light" ? "/css/style-light.css" : "/css/style-dark.css";
    themeLink.setAttribute("href", newHref);
    localStorage.setItem("theme", theme);
  }

  const toggleBtn = document.getElementById("theme-toggle");
  if (toggleBtn) {
    toggleBtn.innerText = theme === "dark" ? "🌙" : "☀️";
    toggleBtn.classList.toggle("btn-outline-light", theme === "dark");
    toggleBtn.classList.toggle("btn-outline-dark", theme === "light");

    toggleBtn.onclick = () => {
      const newTheme = localStorage.getItem("theme") === "dark" ? "light" : "dark";
      setTheme(newTheme);
    };
  }

  // 🌗 Navbar classok dinamikusan
  const navbar = document.getElementById("main-navbar");
  if (navbar) {
    navbar.classList.remove("navbar-dark", "bg-dark", "navbar-light", "bg-light");
    if (theme === "dark") {
      navbar.classList.add("navbar-dark", "bg-dark");
    } else {
      navbar.classList.add("navbar-light", "bg-light");
    }
  }
}

function waitForElement(selector, callback) {
  const el = document.querySelector(selector);
  if (el) return callback(el);

  const observer = new MutationObserver(() => {
    const el = document.querySelector(selector);
    if (el) {
      observer.disconnect();
      callback(el);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

document.addEventListener("DOMContentLoaded", () => {
  const currentTheme = localStorage.getItem("theme") || "dark";
  waitForElement("#theme-toggle", () => {
    setTheme(currentTheme);
  });
});
