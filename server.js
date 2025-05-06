// 📁 server.js – Fundelio (Teljes verzió emailes jelszó visszaállítással és regisztrációval)

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

// 🔐 Regisztráció e-mail küldéssel
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        const check = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT * FROM Felhasználó WHERE Email = @email');

        if (check.recordset.length > 0) {
            return res.status(400).json({ message: 'Ez az e-mail már foglalt.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const insertUser = await pool.request()
            .input('name', sql.NVarChar, name)
            .input('email', sql.NVarChar, email)
            .input('password', sql.NVarChar, hashedPassword)
            .query(`INSERT INTO Felhasználó (Név, Email, Jelszó) OUTPUT INSERTED.FelhasználóID VALUES (@name, @email, @password)`);

        const userId = insertUser.recordset[0].FelhasználóID;

        await pool.request()
            .input('id', sql.Int, userId)
            .input('balance', sql.Float, 10000)
            .input('currency', sql.NVarChar, 'USD')
            .input('crypto', sql.NVarChar, JSON.stringify({ btcusdt: 0 }))
            .input('stocks', sql.NVarChar, JSON.stringify({}))
            .query(`INSERT INTO FelhasználóEgyenleg (FelhasználóID, Egyenleg, Deviza, CryptoMennyiség, RészvényMennyiség) VALUES (@id, @balance, @currency, @crypto, @stocks)`);

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

// 🔐 Bejelentkezés
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT * FROM Felhasználó WHERE Email = @email');

        if (result.recordset.length === 0) {
            return res.status(401).json({ message: 'Hibás e-mail vagy jelszó.' });
        }

        const user = result.recordset[0];
        const valid = await bcrypt.compare(password, user.Jelszó);

        if (!valid) {
            return res.status(401).json({ message: 'Hibás e-mail vagy jelszó.' });
        }

        const token = jwt.sign({ id: user.FelhasználóID }, SECRET_KEY, { expiresIn: '2h' });

        res.json({ token, name: user.Név, email: user.Email });
    } catch (err) {
        console.error('Bejelentkezési hiba:', err);
        res.status(500).json({ message: 'Szerverhiba bejelentkezés közben.' });
    }
});

// 🔁 Elfelejtett jelszó - email küldés
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

// 🔄 Egyenleg lekérés és frissítés
app.get('/api/userdata', authenticateToken, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('id', sql.Int, req.user.id)
            .query('SELECT Egyenleg, Deviza, CryptoMennyiség, RészvényMennyiség FROM FelhasználóEgyenleg WHERE FelhasználóID = @id');

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'Nincs egyenleg adat.' });
        }

        const row = result.recordset[0];
        res.json({
            balance: row.Egyenleg,
            currency: row.Deviza,
            cryptoQuantity: JSON.parse(row.CryptoMennyiség || '{}'),
            stockQuantity: JSON.parse(row.RészvényMennyiség || '{}')
        });
    } catch (err) {
        console.error('Lekeresési hiba:', err);
        res.status(500).json({ message: 'Szerverhiba.' });
    }
});

app.post('/api/userdata', authenticateToken, async (req, res) => {
    const { balance, currency, cryptoQuantity, stockQuantity } = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('id', sql.Int, req.user.id)
            .input('balance', sql.Float, balance)
            .input('currency', sql.NVarChar, currency)
            .input('crypto', sql.NVarChar, JSON.stringify(cryptoQuantity))
            .input('stocks', sql.NVarChar, JSON.stringify(stockQuantity))
            .query(`UPDATE FelhasználóEgyenleg SET Egyenleg = @balance, Deviza = @currency, CryptoMennyiség = @crypto, RészvényMennyiség = @stocks WHERE FelhasználóID = @id`);

        res.json({ message: 'Adatok frissítve.' });
    } catch (err) {
        console.error('Mentési hiba:', err);
        res.status(500).json({ message: 'Hiba mentés közben.' });
    }
});

// 📈 Binance WebSocket kriptoárfolyamokhoz
const symbols = ['btcusdt', 'ethusdt', 'dogeusdt', 'xrpusdt', 'trumpusdt', 'solusdt'];
const streams = symbols.map(symbol => `${symbol}@trade`).join('/');
const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

let prices = {};
ws.on('message', (data) => {
    const parsedData = JSON.parse(data);
    const trade = parsedData.data;
    prices[trade.s.toLowerCase()] = trade.p;
});

app.get('/api/live/:symbol', (req, res) => {
    const symbol = req.params.symbol.toLowerCase();
    if (prices[symbol]) {
        res.json({ symbol, price: prices[symbol] });
    } else {
        res.status(500).json({ error: "Nincs élő adat ehhez a kriptóhoz" });
    }
});

// 📊 Részvényadatok
const TWELVE_DATA_API_KEY = process.env.TWELVE_API_KEY;
const stockSymbols = ['SPY', 'NVDA', 'MSFT'];

app.get('/api/stocks', async (req, res) => {
    try {
        const stockData = await Promise.all(stockSymbols.map(async (symbol) => {
            const response = await axios.get(`https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TWELVE_DATA_API_KEY}`);
            return { symbol, price: response.data.price };
        }));
        res.json(stockData);
    } catch (error) {
        res.status(500).json({ message: "Hiba a részvényadatok lekérésekor!", error });
    }
});

// 🌐 Alapértelmezett oldal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Pages', 'auth', 'bejelentkezés.html'));
});

// 🚀 Szerver indítása
app.listen(PORT, () => {
    console.log(`✅ Szerver fut: http://localhost:${PORT}`);
});
