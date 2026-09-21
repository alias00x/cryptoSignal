const axios = require('axios');
const fs = require('fs');

const TELEGRAM_BOT_TOKEN = "8952382896:AAGeV0YYvFF4exWp3hax0JnqSxtECRP-IsI";
const TARGET_CHAT_ID = "-1004340657482";
const TRADES_FILE = './active_trades.json';

const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 
    'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'LINKUSDT',
    'SUIUSDT', 'TONUSDT', 'NEARUSDT', 'APTUSDT', 'DOTUSDT', 
    'ICPUSDT', 'LTCUSDT', 'BCHUSDT', 'POLUSDT', 'ARBUSDT', 
    'OPUSDT', 'SEIUSDT', 'TIAUSDT', 'FETUSDT', 'TAOUSDT', 
    'RENDERUSDT', 'INJUSDT', 'UNIUSDT', 'AAVEUSDT', 'CAKEUSDT', 
    'PEPEUSDT', 'SHIBUSDT', 'WIFUSDT', 'PAXGUSDT'
];

function loadTrades() {
    try {
        if (fs.existsSync(TRADES_FILE)) {
            return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
        }
    } catch (e) {
        console.error("Error loading trades:", e.message);
    }
    return {};
}

function saveTrades(trades) {
    try {
        fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving trades:", e.message);
    }
}

function getZoneInfo(rsi) {
    if (rsi >= 70) return { name: "Red", level: 5 };
    if (rsi >= 60) return { name: "Pink", level: 4 };
    if (rsi >= 40) return { name: "Grey", level: 3 };
    if (rsi >= 30) return { name: "Light Green", level: 2 };
    return { name: "Deep Green", level: 1 };
}

function calculateRSI(closes, period = 14) {
    if (closes.length <= period) return null;
    let gains = 0, losses = 0;

    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return parseFloat((100 - (100 / (1 + rs))).toFixed(2));
}

async function getCandles(symbol, interval, limit = 50) {
    try {
        const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const res = await axios.get(url, { 
            timeout: 6000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (Array.isArray(res.data)) {
            return res.data.map(k => parseFloat(k[4]));
        }
        return null;
    } catch (e) {
        return null;
    }
}

async function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: TARGET_CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
        console.log("Telegram message sent.");
    } catch (err) {
        console.error("Telegram Error:", err.response ? err.response.data : err.message);
    }
}

async function processSymbol(symbol) {
    const [closes1h, closes5m] = await Promise.all([
        getCandles(symbol, '1h'),
        getCandles(symbol, '5m')
    ]);

    if (!closes1h || !closes5m || closes1h.length < 20 || closes5m.length < 20) {
        return null;
    }

    const currRsi1h = calculateRSI(closes1h);
    const prevRsi1h = calculateRSI(closes1h.slice(0, -1));

    const currRsi5m = calculateRSI(closes5m);
    const prevRsi5m = calculateRSI(closes5m.slice(0, -1));

    const currentPrice = closes5m[closes5m.length - 1];

    return {
        symbol,
        currentPrice,
        currRsi1h,
        prevRsi1h,
        currRsi5m,
        prevRsi5m
    };
}

// Compact Hourly Positions Review (Max 2 lines per coin)
async function reviewActivePositions(validCoins, activeTrades) {
    const tradeKeys = Object.keys(activeTrades);
    if (tradeKeys.length === 0) return;

    let reviewReport = `📊 <b>HOURLY POSITIONS REVIEW & PnL REPORT</b>\n\n`;
    let updatedTrades = { ...activeTrades };

    for (const key of tradeKeys) {
        const trade = activeTrades[key];
        const coinData = validCoins.find(c => c.symbol === trade.symbol);
        if (!coinData) continue;

        const currentPrice = coinData.currentPrice;
        const currentZone = getZoneInfo(coinData.currRsi1h);

        let pnlPercent = trade.type === 'BUY'
            ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
            : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

        const pnlFormatted = pnlPercent >= 0 ? `+${pnlPercent.toFixed(2)}%` : `${pnlPercent.toFixed(2)}%`;
        const pnlIcon = pnlPercent >= 0 ? '🟢' : '🔴';

        let action = "HOLD ⏳";
        let shouldClose = false;

        if (trade.type === 'BUY') {
            if (currentZone.level >= 5) {
                action = "Close / TP 🟢 (Overbought Red)";
                shouldClose = true;
            } else if (pnlPercent <= -3.0 || currentZone.level <= 2) {
                action = "Close / SL 🔴 (Support Lost)";
                shouldClose = true;
            } else {
                action = "HOLD ⏳ (Pink Momentum)";
            }
        } else { // SELL
            if (currentZone.level <= 1) {
                action = "Close / TP 🟢 (Oversold Green)";
                shouldClose = true;
            } else if (pnlPercent <= -3.0 || currentZone.level >= 4) {
                action = "Close / SL 🔴 (Resistance Broken)";
                shouldClose = true;
            } else {
                action = "HOLD ⏳ (Downward Riding)";
            }
        }

        // Exact 2-Line Compact Format
        reviewReport += `🪙 <b>#${trade.symbol.replace('USDT', '')}</b> [${trade.type}]\n` +
            `• Entry: <code>$${trade.entryPrice}</code> ➔ Current: <code>$${currentPrice}</code> (<b>${pnlFormatted}</b> ${pnlIcon})\n` +
            `• Decision: <b>${action}</b> (1H RSI: <code>${coinData.currRsi1h}</code>)\n\n`;

        if (shouldClose) {
            delete updatedTrades[key];
        }
    }

    await sendTelegramMessage(reviewReport);
    saveTrades(updatedTrades);
}

async function executeScan() {
    console.log("Executing Scan and Compact Review Workflow...");

    try {
        const results = await Promise.all(SYMBOLS.map(sym => processSymbol(sym)));
        const validCoins = results.filter(r => r !== null);

        if (validCoins.length === 0) {
            console.error("Zero assets fetched.");
            process.exit(1);
        }

        const avgRsi1h = parseFloat((validCoins.reduce((acc, c) => acc + c.currRsi1h, 0) / validCoins.length).toFixed(2));
        const avgRsi5m = parseFloat((validCoins.reduce((acc, c) => acc + c.currRsi5m, 0) / validCoins.length).toFixed(2));

        let activeTrades = loadTrades();

        // Hourly Review at top of the hour
        const currentMinute = new Date().getUTCMinutes();
        if (currentMinute < 10) {
            await reviewActivePositions(validCoins, activeTrades);
            activeTrades = loadTrades();
        }

        // New Signal Processing
        for (const coin of validCoins) {
            const { symbol, currentPrice, currRsi1h, prevRsi1h, currRsi5m, prevRsi5m } = coin;

            const prevZone1h = getZoneInfo(prevRsi1h);
            const currZone1h = getZoneInfo(currRsi1h);
            const prevZone5m = getZoneInfo(prevRsi5m);
            const currZone5m = getZoneInfo(currRsi5m);

            // 1-Hour Shift
            if (prevZone1h.name !== currZone1h.name) {
                const isBullish = currZone1h.level > prevZone1h.level;
                const isBuyAllowed = isBullish && avgRsi1h >= 45;
                const isSellAllowed = !isBullish && avgRsi1h <= 65;

                if (isBuyAllowed || isSellAllowed) {
                    const signalType = isBullish ? "BUY" : "SELL";
                    const signalTag = isBullish ? "🟢 BUY / LONG" : "🔴 SELL / SHORT";

                    const message1h = `🚨 <b>${signalTag} (1-HOUR SHIFT)</b>\n\n` +
                        `• Asset: <b>#${symbol.replace('USDT', '')}</b> @ <code>$${currentPrice}</code>\n` +
                        `• Shift: [${prevZone1h.name}] ➔ [${currZone1h.name}] (1H RSI: <code>${currRsi1h}</code>)\n` +
                        `• Market AVG RSI: <code>${avgRsi1h}</code>\n` +
                        `UTC: ${new Date().toISOString()}`;

                    await sendTelegramMessage(message1h);

                    activeTrades[symbol] = {
                        symbol,
                        type: signalType,
                        entryPrice: currentPrice,
                        timestamp: Date.now()
                    };
                    saveTrades(activeTrades);
                }
            }

            // 5-Minute Shift
            if (prevZone5m.name !== currZone5m.name) {
                const isBullish5m = currZone5m.level > prevZone5m.level;
                const signalTag5m = isBullish5m ? "🟢 BUY (5M)" : "🔴 SELL (5M)";

                const message5m = `🔔 <b>${signalTag5m}</b>\n\n` +
                    `• Asset: <b>#${symbol.replace('USDT', '')}</b> @ <code>$${currentPrice}</code>\n` +
                    `• Shift: [${prevZone5m.name}] ➔ [${currZone5m.name}] (5M RSI: <code>${currRsi5m}</code>)\n` +
                    `UTC: ${new Date().toISOString()}`;

                await sendTelegramMessage(message5m);
            }
        }

        console.log("Scan finished cleanly.");
        process.exit(0);

    } catch (error) {
        console.error("Fatal Error:", error.message);
        process.exit(1);
    }
}

executeScan();
