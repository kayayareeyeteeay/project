// 📁 server.js (Frissített: Azure SQL + pontos mezőnevekkel)

const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sql = require('mssql');
const axios = require('axios');
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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'Pages')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));

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

// 🔐 Regisztráció (frissítve pontos oszlopnevekkel)
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
            .query(`INSERT INTO Felhasználó (Név, Email, Jelszó, RegisztrációDátuma) OUTPUT INSERTED.FelhasználóID VALUES (@name, @email, @password, GETDATE())`);

        const userId = insertUser.recordset[0].FelhasználóID;

        await pool.request()
            .input('id', sql.Int, userId)
            .input('balance', sql.Float, 10000)
            .input('currency', sql.NVarChar, 'USD')
            .input('crypto', sql.NVarChar, JSON.stringify({ btcusdt: 0 }))
            .input('stocks', sql.NVarChar, JSON.stringify({}))
            .query(`INSERT INTO FelhasználóEgyenleg (FelhasználóID, Egyenleg, Deviza, CryptoMennyiség, RészvényMennyiség) VALUES (@id, @balance, @currency, @crypto, @stocks)`);

        res.status(201).json({ message: 'Sikeres regisztráció!' });
    } catch (err) {
        console.error('Regisztrációs hiba:', err);
        res.status(500).json({ message: 'Szerverhiba regisztráció közben.' });
    }
});

// 🔑 Bejelentkezés
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

// 🔐 Egyenleg lekérés és mentés
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Pages', 'auth', 'bejelentkezés.html'));
});

app.listen(PORT, () => {
    console.log(`✅ Szerver fut: http://localhost:${PORT}`);
});
