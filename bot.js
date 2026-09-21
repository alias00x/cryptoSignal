const axios = require('axios');

const TELEGRAM_BOT_TOKEN = "8952382896:AAGeV0YYvFF4exWp3hax0JnqSxtECRP-IsI";
const TARGET_CHAT_ID = "-1004340657482";

const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 
    'AVAXUSDT', 'NEARUSDT', 'TRXUSDT', 'DOGEUSDT', 'LINKUSDT'
];

// Map RSI values to specific colored zones
function getZoneInfo(rsi) {
    if (rsi >= 70) return { name: "OVERBOUGHT (Red)", level: 5 };
    if (rsi >= 60) return { name: "STRONG (Pink)", level: 4 };
    if (rsi >= 40) return { name: "NEUTRAL (Grey)", level: 3 };
    if (rsi >= 30) return { name: "WEAK (Light Green)", level: 2 };
    return { name: "OVERSOLD (Deep Green)", level: 1 };
}

// Calculate Wilder's RSI
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

// Fetch candles from Binance Futures API
async function getCandles(symbol, interval, limit = 50) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const res = await axios.get(url, { timeout: 8000 });
        return res.data.map(k => parseFloat(k[4]));
    } catch (e) {
        return null;
    }
}

// Send alert to Telegram
async function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: TARGET_CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
        console.log("Telegram alert sent successfully.");
    } catch (err) {
        console.error("Telegram API Error:", err.message);
    }
}

// Main scanning logic
async function scanMarket() {
    console.log("Scanning market transitions (1H Trend + 5M Zone Shifts)...");

    for (const symbol of SYMBOLS) {
        try {
            // 1. Fetch 1-Hour Trend Data
            const closes1h = await getCandles(symbol, '1h');
            if (!closes1h) continue;
            const rsi1h = calculateRSI(closes1h);
            const zone1h = getZoneInfo(rsi1h);

            // 2. Fetch 5-Minute Data (Current vs Previous Candle)
            const closes5m = await getCandles(symbol, '5m');
            if (!closes5m || closes5m.length < 20) continue;

            const currRsi5m = calculateRSI(closes5m);
            const prevRsi5m = calculateRSI(closes5m.slice(0, -1));
            const currentPrice = closes5m[closes5m.length - 1];

            const prevZone5m = getZoneInfo(prevRsi5m);
            const currZone5m = getZoneInfo(currRsi5m);

            console.log(`[${symbol}] 1H: ${rsi1h} | 5M Transition: ${prevZone5m.name} -> ${currZone5m.name}`);

            // Detect if the coin changed its color zone in 5M timeframe
            if (prevZone5m.name !== currZone5m.name) {
                const isShiftUp = currZone5m.level > prevZone5m.level;
                const shiftDirection = isShiftUp ? "🟢 UPWARD TRANSITION (BULLISH)" : "🔴 DOWNWARD TRANSITION (BEARISH)";

                const message = `🚨 <b>RSI COLOR ZONE TRANSITION</b>\n\n` +
                    `Asset: <b>#${symbol.replace('USDT', '')}</b>\n` +
                    `Price: <b>$${currentPrice}</b>\n\n` +
                    `⏱ <b>1-Hour Context:</b> <code>${rsi1h}</code> [${zone1h.name}]\n` +
                    `🔄 <b>5-Minute Shift:</b> ${shiftDirection}\n` +
                    `• From: <code>${prevRsi5m}</code> [${prevZone5m.name}]\n` +
                    `• To:   <code>${currRsi5m}</code> [${currZone5m.name}]\n\n` +
                    `UTC Timestamp: ${new Date().toISOString()}`;

                await sendTelegramMessage(message);
            }
        } catch (error) {
            console.error(`Error processing ${symbol}:`, error.message);
        }
    }
    console.log("Scan iteration completed.");
}

scanMarket();
