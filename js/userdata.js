// ✅ userdata.js — Regisztráció, bejelentkezés, kijelentkezés, profil betöltés

console.log("✅ userdata.js betöltve");

// 🔐 Regisztráció kezelése
document.getElementById("registerForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("registerName").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const password = document.getElementById("registerPassword").value;

    console.log("➡️ Regisztráció elküldve:", { name, email });

    try {
        const response = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, password })
        });

        const result = await response.json();

        if (response.ok) {
            alert("Sikeres regisztráció!");
            window.location.href = "/auth/bejelentkezés.html"; // 🔄 Pages nélkül
        } else {
            document.getElementById("errorMsg").innerText = result.message;
            document.getElementById("errorMsg").style.display = "block";
        }
    } catch (err) {
        console.error("❌ Hiba a fetch-ben:", err);
        alert("Valami hiba történt regisztráció közben.");
    }
});

// 🔑 Bejelentkezés kezelése
const loginForm = document.getElementById("loginForm");
if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        try {
            const response = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });

            const result = await response.json();

            if (response.ok) {
                localStorage.setItem("token", result.token);
                localStorage.setItem("user", JSON.stringify({ name: result.name, email: result.email }));
                window.location.href = "/index.html";
            } else {
                const error = document.getElementById("errorMsg");
                if (error) {
                    error.innerText = result.message;
                    error.style.display = "block";
                } else {
                    alert(result.message);
                }
            }
        } catch (err) {
            console.error("❌ Bejelentkezési hiba:", err);
            alert("Hiba történt a bejelentkezés során.");
        }
    });
}

// 🚪 Kijelentkezés
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.location.href = "/auth/bejelentkezés.html";
    });
}

// 📋 Profil betöltése
document.addEventListener("DOMContentLoaded", async () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/auth/bejelentkezés.html';  // Ha nincs token, átirányít a bejelentkezés oldalra
        return;
    }

    try {
        // API hívás a backendhez, hogy lekérje a felhasználó adatait
        const response = await fetch('https://project-production-feb3.up.railway.app/api/userdata', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Nem sikerült lekérni az adatokat.');
        }

        const data = await response.json();
        // Az adatokat kiírjuk a megfelelő helyekre
        document.getElementById('userEmail').innerText = data.email || 'Nincs adat';
        document.getElementById('userName').innerText = data.name || 'Nincs adat';
        document.getElementById('userBalance').innerText = data.balance || '0 USD';

        // Részvények lista (ha van)
        const stocks = data.stockQuantity || {};
        const stocksList = document.getElementById('userStocks');
        stocksList.innerHTML = '';
        for (const stock in stocks) {
            const li = document.createElement('li');
            li.textContent = `${stock}: ${stocks[stock]}`;
            stocksList.appendChild(li);
        }

    } catch (err) {
        console.error('Hiba történt a profil betöltésekor:', err);
    }
});
