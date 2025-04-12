function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user; // FelhasználóID ezután: req.user.id
        next();
    });
}

const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const sql = require('mssql');
const exec = require('child_process').exec;
const axios = require('axios');

const app = express();
const PORT = 3000;
const SECRET_KEY = "fundelio_secret";

const dbConfig = {
    user: 'SA',                 // vagy a saját SQL Server felhasználód
    password: 'jelszavad',      // a saját jelszavad
    server: 'localhost',        // vagy IP-cím, ha máshol fut
    database: 'FundelioDB',
    options: {
      encrypt: true,
      trustServerCertificate: true
    }
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 🔐 API: Regisztráció
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

        await pool.request()
            .input('name', sql.NVarChar, name)
            .input('email', sql.NVarChar, email)
            .input('password', sql.NVarChar, hashedPassword)
            .query(`
                INSERT INTO Felhasználó (Név, Email, Jelszó)
                VALUES (@name, @email, @password)
            `);

        res.status(201).json({ message: 'Sikeres regisztráció!' });
    } catch (err) {
        console.error('Regisztrációs hiba:', err);
        res.status(500).json({ message: 'Szerverhiba regisztráció közben.' });
    }
});

// 🔐 API: Bejelentkezés
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

        res.json({
            token,
            name: user.Név,
            email: user.Email
        });
    } catch (err) {
        console.error('Bejelentkezési hiba:', err);
        res.status(500).json({ message: 'Szerverhiba bejelentkezés közben.' });
    }
});

// 🔄 Binance WebSocket stream (pl. BTC, ETH, stb.)
const symbols = ['btcusdt', 'ethusdt', 'dogeusdt', 'xrpusdt', 'trumpusdt', 'solusdt'];
const streams = symbols.map(symbol => `${symbol}@trade`).join('/');
const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

let prices = {};

ws.on('message', (data) => {
    const parsedData = JSON.parse(data);
    const trade = parsedData.data;
    prices[trade.s.toLowerCase()] = trade.p;
});

// API végpont élő kriptó árakhoz
app.get('/api/live/:symbol', (req, res) => {
    const symbol = req.params.symbol.toLowerCase();
    if (prices[symbol]) {
        res.json({ symbol, price: prices[symbol] });
    } else {
        res.status(500).json({ error: "Nincs élő adat ehhez a kriptóhoz" });
    }
});

// Twelve Data API konfiguráció részvényekhez
const TWELVE_DATA_API_KEY = 'b6e3585ebb094839929ee2d793b8e45d';
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

// Globális beállítások betöltése az adatbázisból
async function loadGlobalSettings() {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query("SELECT TOP 1 * FROM GlobalSettings");
        if (result.recordset.length > 0) {
            const row = result.recordset[0];
            globalCurrency = row.currency || 'USD';
            try {
                globalCryptoQuantity = JSON.parse(row.cryptoQuantity);
            } catch (e) {
                globalCryptoQuantity = { btcusdt: 0, ethusdt: 0, dogeusdt: 0, xrpusdt: 0, trumpusdt: 0, solusdt: 0 };
            }
            try {
                globalStockQuantity = JSON.parse(row.stockQuantity);
            } catch (e) {
                globalStockQuantity = { SPY: 0, NVDA: 0, MSFT: 0 };
            }
            console.log("Globális beállítások betöltve az adatbázisból:", { globalCurrency, globalCryptoQuantity, globalStockQuantity });
        } else {
            globalCurrency = 'USD';
            globalCryptoQuantity = { btcusdt: 0, ethusdt: 0, dogeusdt: 0, xrpusdt: 0, trumpusdt: 0, solusdt: 0 };
            globalStockQuantity = { SPY: 0, NVDA: 0, MSFT: 0 };
            console.log("Nincs bejegyzés a GlobalSettings táblában, alapértelmezett értékek betöltve.");
        }
    } catch (error) {
        console.error("Hiba a globális beállítások betöltésekor az adatbázisból:", error);
    }
}

// Indítás
loadGlobalSettings().then(() => {
    app.listen(PORT, () => {
        console.log(`✅ Szerver fut: http://localhost:${PORT}`);
    });
});
