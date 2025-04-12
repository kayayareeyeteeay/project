// Regisztráció 
document.getElementById('registerForm')?.addEventListener('submit', function(event) {
    event.preventDefault();
    let email = document.getElementById('registerEmail').value;
    let password = document.getElementById('registerPassword').value;
    let name = document.getElementById('registerName').value;

    let users = JSON.parse(localStorage.getItem("users")) || [];
    
    // Ellenőrizzük, hogy létezik-e már az email
    if (users.find(user => user.email === email)) {
        alert("Ez az email már regisztrálva van!");
        return;
    }

    users.push({ email, password, name });
    localStorage.setItem("users", JSON.stringify(users));
    alert("Sikeres regisztráció!");
    window.location.href = "bejelentkezés.html";
});

// Bejelentkezés
document.getElementById('loginForm')?.addEventListener('submit', function(event) {
    event.preventDefault();
    let email = document.getElementById('email').value;
    let password = document.getElementById('password').value;

    let users = JSON.parse(localStorage.getItem("users")) || [];

    let user = users.find(user => user.email === email && user.password === password);

    if (user) {
        localStorage.setItem("loggedIn", JSON.stringify(user)); // 🔹 Itt elmentjük a teljes felhasználót
        alert("Sikeres bejelentkezés!");
        window.location.href = "főoldal.html";
    } else {
        alert("Hibás email vagy jelszó!");
    }
});

// Kijelentkezés
document.getElementById("logoutBtn")?.addEventListener("click", function() {
    localStorage.removeItem("loggedIn");
    window.location.href = "bejelentkezés.html";
});

// Profil oldal betöltése
document.addEventListener("DOMContentLoaded", function () {
    let user = JSON.parse(localStorage.getItem("loggedIn")); // 🔹 Betöltjük a bejelentkezett felhasználót
    if (user) {
        document.getElementById("userEmail").innerText = user.email; // 🔹 Kiírjuk az email címet
        document.getElementById("userName").innerText = user.name; // 🔹 Kiírjuk az nevet
    } else {
        document.getElementById("userEmail").innerText = "Nem vagy bejelentkezve!";
    }
});
