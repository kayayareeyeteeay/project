const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sql = require('mssql');
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || "fundelio_secret";

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        trustServerCertificate: false
    }
};

// Nodemailer transporter
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'Pages')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/img', express.static(path.join(__dirname, 'img')));

// Middleware: authenticate JWT and attach user info
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// 🔐 Regisztráció e-mail küldéssel + kezdő egyenleg beállítása
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        // E-mail ellenőrzés
        const check = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT FelhasználóID FROM Felhasználó WHERE Email = @email');
        if (check.recordset.length > 0) {
            return res.status(400).json({ message: 'Ez az e-mail már foglalt.' });
        }
        // Jelszó hashelése
        const hashedPassword = await bcrypt.hash(password, 10);
        // Felhasználó beszúrás
        const insertUser = await pool.request()
            .input('name', sql.NVarChar, name)
            .input('email', sql.NVarChar, email)
            .input('password', sql.NVarChar, hashedPassword)
            .query(
                `INSERT INTO Felhasználó (Név, Email, Jelszó)
                 OUTPUT INSERTED.FelhasználóID
                 VALUES (@name, @email, @password)`
            );
        const userId = insertUser.recordset[0].FelhasználóID;
        // Kezdő egyenleg 10000 USD, üres kripto- és részvényállomány
        await pool.request()
            .input('id', sql.Int, userId)
            .input('balance', sql.Float, 10000)
            .input('currency', sql.NVarChar, 'USD')
            .input('crypto', sql.NVarChar, JSON.stringify({}))
            .input('stocks', sql.NVarChar, JSON.stringify({}))
            .query(
                `INSERT INTO FelhasználóEgyenleg
                 (FelhasználóID, Egyenleg, Deviza, CryptoMennyiség, RészvényMennyiség)
                 VALUES(@id, @balance, @currency, @crypto, @stocks)`
            );
        // Üdvözlő e-mail
        await transporter.sendMail({
            from: `Fundelio <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Sikeres regisztráció - Fundelio",
            html: `<h2>Kedves ${name}!</h2><p>Köszönjük, hogy regisztráltál a Fundeliora.</p><p>Most már be tudsz jelentkezni.</p>`
        });
        res.status(201).json({ message: 'Sikeres regisztráció!' });
    } catch (err) {
        console.error('Regisztrációs hiba:', err);
        res.status(500).json({ message: 'Szerverhiba regisztráció közben.' });
    }
});

// 🔐 Bejelentkezés (JWT-be email is kerül)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT FelhasználóID, Név, Email, Jelszó FROM Felhasználó WHERE Email = @email');
        if (result.recordset.length === 0) {
            return res.status(401).json({ message: 'Hibás e-mail vagy jelszó.' });
        }
        const user = result.recordset[0];
        const valid = await bcrypt.compare(password, user.Jelszó);
        if (!valid) {
            return res.status(401).json({ message: 'Hibás e-mail vagy jelszó.' });
        }
        // Token generálása
        const token = jwt.sign(
            { id: user.FelhasználóID, email: user.Email },
            SECRET_KEY,
            { expiresIn: '2h' }
        );
        res.json({ token, name: user.Név, email: user.Email });
    } catch (err) {
        console.error('Bejelentkezési hiba:', err);
        res.status(500).json({ message: 'Szerverhiba bejelentkezés közben.' });
    }
});

// 🔁 Elfelejtett jelszó – email küldés
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT FelhasználóID, Név FROM Felhasználó WHERE Email = @email');
        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'Nem található ilyen e-mail.' });
        }
        const user = result.recordset[0];
        const resetToken = jwt.sign({ id: user.FelhasználóID }, SECRET_KEY, { expiresIn: '15m' });
        const resetLink = `https://fundelio.hu/reset-password.html?token=${resetToken}`;
        await transporter.sendMail({
            from: `Fundelio <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Jelszó visszaállítás - Fundelio",
            html: `<h2>Szia ${user.Név}!</h2><p>Kattints a linkre, hogy új jelszót állíts be:</p><a href="${resetLink}">${resetLink}</a>`
        });
        res.json({ message: 'E-mail elküldve.' });
    } catch (err) {
        console.error("Forgot password error:", err);
        res.status(500).json({ message: 'Hiba történt.' });
    }
});

// 🔁 Jelszó újraállítás tokennel
app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const hashed = await bcrypt.hash(newPassword, 10);
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('id', sql.Int, decoded.id)
            .input('pwd', sql.NVarChar, hashed)
            .query('UPDATE Felhasználó SET Jelszó = @pwd WHERE FelhasználóID = @id');
        res.json({ message: 'Jelszó frissítve!' });
    } catch (err) {
        console.error("Reset error:", err);
        res.status(400).json({ message: 'Érvénytelen vagy lejárt token.' });
    }
});

// 🔄 Egyenleg lekérés (userdata)
app.get('/api/userdata', authenticateToken, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('id', sql.Int, req.user.id)
            .query(
                `SELECT Egyenleg, Deviza, CryptoMennyiség, RészvényMennyiség
                 FROM FelhasználóEgyenleg
                 WHERE FelhasználóID = @id`
            );
        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'Nincs egyenleg adat.' });
        }
        const row = result.recordset[0];
        res.json({
            balance:        row.Egyenleg,
            currency:       row.Deviza,
            cryptoQuantity: JSON.parse(row.CryptoMennyiség || '{}'),
            stockQuantity : JSON.parse(row.RészvényMennyiség || '{}')
        });
    } catch (err) {
        console.error('Lekeresési hiba:', err);
        res.status(500).json({ message: 'Szerverhiba.' });
    }
});

// 🌟 Új: Tranzakciók kezelése, egyenleg- és kriptofrissítés
app.post('/api/transactions', authenticateToken, async (req, res) => {
    const { type, amount, currency, crypto, price } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        // 1) Tranzakció beszúrása
        const insert = await pool.request()
            .input('uid',        sql.Int,         req.user.id)
            .input('szimbolum',   sql.NVarChar,    crypto || null)
            .input('mennyiseg',   sql.Decimal(18,8), amount)
            .input('ar',          sql.Decimal(18,8), price || null)
            .input('tipus',       sql.NVarChar,    type)
            .query(
                `INSERT INTO dbo.Tranzakciók
                  (FelhasználóID, Szimbólum, Mennyiség, Ár, Típus)
                 VALUES
                  (@uid, @szimbolum, @mennyiseg, @ar, @tipus);
                 SELECT SCOPE_IDENTITY() AS TranzakcióID;`
            );
        const txId = insert.recordset[0].TranzakcióID;
        // 2) Aktuális egyenleg és kripto lekérése
        const balRes = await pool.request()
            .input('uid', sql.Int, req.user.id)
            .query(
                `SELECT Egyenleg, CryptoMennyiség
                 FROM dbo.FelhasználóEgyenleg
                 WHERE FelhasználóID = @uid`
            );
        if (!balRes.recordset.length) {
            throw new Error('Nincs egyenleg adat!');
        }
        let { Egyenleg, CryptoMennyiség } = balRes.recordset[0];
        let cryptoObj = JSON.parse(CryptoMennyiség || '{}');
        // 3) Egyenleg módosítása típus szerint
        switch (type) {
            case 'Vétel': {
                const cost = amount * price;
                if (Egyenleg < cost) return res.status(400).json({ message: 'Nincs elég USD kriptó vásárláshoz.' });
                Egyenleg -= cost;
                cryptoObj[crypto] = (cryptoObj[crypto] || 0) + amount;
                break;
            }
            case 'Eladás': {
                if ((cryptoObj[crypto] || 0) < amount) return res.status(400).json({ message: 'Nincs elég kriptód eladásra.' });
                const proceeds = amount * price;
                Egyenleg += proceeds;
                cryptoObj[crypto] -= amount;
                break;
            }
            default:
                return res.status(400).json({ message: 'Ismeretlen tranzakciótípus.' });
        }

        // 4) Egyenleg frissítése adatbázisban
        await pool.request()
            .input('uid',     sql.Int,      req.user.id)
            .input('balance', sql.Float,    Egyenleg)
            .input('crypto',  sql.NVarChar, JSON.stringify(cryptoObj))
            .query(
                `UPDATE dbo.FelhasználóEgyenleg
                 SET Egyenleg = @balance,
                     CryptoMennyiség = @crypto
                 WHERE FelhasználóID = @uid`
            );
        // 5) E-mail értesítés
        const html = `
            <h2>Szia!</h2>
            <p>Új tranzakció történt a fiókodban (#${txId}):</p>
            <ul>
                <li><strong>Típus:</strong> ${type}</li>
                <li><strong>Összeg:</strong> ${amount} ${currency || 'USD'}</li>
                ${crypto ? `<li><strong>Kripto:</strong> ${crypto}</li>` : ''}
                ${price  ? `<li><strong>Ár:</strong> ${price}</li>` : ''}
                <li><strong>Új egyenleg:</strong> ${Egyenleg.toFixed(2)} USD</li>
            </ul>
        `;
        await transporter.sendMail({
            from:    `Fundelio <${process.env.EMAIL_USER}>`,
            to:      req.user.email,
            subject: `Tranzakció a fiókodban (#${txId})`,
            html
        });
        res.status(201).json({ success: true, transactionId: txId, balance: Egyenleg, crypto: cryptoObj });
    } catch (err) {
        console.error('Tranzakciós hiba:', err);
        res.status(500).json({ message: err.message || 'Hiba a tranzakció során.' });
    }
});

// GET tranzakciólista
app.get('/api/transactions', authenticateToken, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('uid', sql.Int, req.user.id)
            .query(
                `SELECT TranzakcióID,
                        Típus AS type,
                        Mennyiség AS amount,
                        Ár AS price,
                        Szimbólum AS crypto,
                        Dátum AS createdAt
                 FROM dbo.Tranzakciók
                 WHERE FelhasználóID = @uid
                 ORDER BY Dátum DESC`
            );
        res.json({ transactions: result.recordset });
    } catch (err) {
        console.error('Lekérdezési hiba:', err);
        res.status(500).json({ message: 'Hiba a tranzakciók lekérésekor.' });
    }
    console.log("Kapott tranzakció:", { type, amount, price, crypto, currency });
});

// 📈 Binance WebSocket kriptoárfolyamokhoz
const symbols = ['btcusdt', 'ethusdt', 'dogeusdt', 'xrpusdt', 'trumpusdt', 'solusdt'];
const streams = symbols.map(s => `${s}@trade`).join('/');
const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
let prices = {};
ws.on('message', data => {
    const trade = JSON.parse(data).data;
    prices[trade.s.toLowerCase()] = trade.p;
});
app.get('/api/live/:symbol', (req, res) => {
    const symbol = req.params.symbol.toLowerCase();
    if (prices[symbol]) return res.json({ symbol, price: prices[symbol] });
    res.status(500).json({ error: 'Nincs élő adat ehhez a kriptóhoz' });
});

// 📊 Részvényadatok
const TWELVE_DATA_API_KEY = process.env.TWELVE_API_KEY;
const stockSymbols = ['SPY', 'NVDA', 'MSFT'];
app.get('/api/stocks', async (req, res) => {
    try {
        const data = await Promise.all(stockSymbols.map(async symbol => {
            const resp = await axios.get(
                `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TWELVE_DATA_API_KEY}`
            );
            return { symbol, price: resp.data.price };
        }));
        res.json(data);
    } catch (err) {
        console.error('Részvényadat hiba:', err);
        res.status(500).json({ message: 'Hiba a részvényadatok lekérésekor.' });
    }
});

// 🌐 Alapértelmezett oldal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Pages', 'auth', 'bejelentkezés.html'));
});

// 🚀 Szerver indítása
app.listen(PORT, () => console.log(`✅ Szerver fut: http://localhost:${PORT}`));
