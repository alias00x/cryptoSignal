const axios = require('axios');

const TELEGRAM_BOT_TOKEN = "8952382896:AAGeV0YYvFF4exWp3hax0JnqSxtECRP-IsI";
const TARGET_CHAT_ID = "-1003912506906";

const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 
    'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'LINKUSDT',
    'SUIUSDT', 'TONUSDT', 'NEARUSDT', 'APTUSDT', 'DOTUSDT', 
    'ICPUSDT', 'LTCUSDT', 'BCHUSDT', 'POLUSDT', 'ARBUSDT', 
    'OPUSDT', 'SEIUSDT', 'TIAUSDT', 'KASUSDT', 'FETUSDT', 
    'TAOUSDT', 'RENDERUSDT', 'INJUSDT', 'UNIUSDT', 'AAVEUSDT', 
    'CAKEUSDT', '1000PEPEUSDT', '1000SHIBUSDT', 'WIFUSDT', 'PAXGUSDT'
];

let lastHourlyReportTime = 0;

function getZoneInfo(rsi) {
    if (rsi >= 70) return { name: "OVERBOUGHT (Red)", level: 5 };
    if (rsi >= 60) return { name: "STRONG (Pink)", level: 4 };
    if (rsi >= 40) return { name: "NEUTRAL (Grey)", level: 3 };
    if (rsi >= 30) return { name: "WEAK (Light Green)", level: 2 };
    return { name: "OVERSOLD (Deep Green)", level: 1 };
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
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const res = await axios.get(url, { timeout: 8000 });
        return res.data.map(k => parseFloat(k[4]));
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
        console.log("Telegram alert dispatched successfully.");
    } catch (err) {
        console.error("Telegram API Error:", err.message);
    }
}

// Generates hourly watchlist of potential setups
async function checkHourlyPotentialWatchlist(marketData) {
    const now = Date.now();
    // Run every 60 minutes
    if (now - lastHourlyReportTime < 60 * 60 * 1000) return;

    let bullishPotentials = [];
    let bearishPotentials = [];

    for (const item of marketData) {
        const { symbol, rsi1h, price } = item;
        // Bullish Watchlist: Moving towards Pink (52-60)
        if (rsi1h >= 52 && rsi1h < 60) {
            bullishPotentials.push(`• <b>#${symbol.replace('USDT', '')}</b> ($${price}) - 1H RSI: <code>${rsi1h}</code>`);
        }
        // Bearish Watchlist: Overbought (>70) or Breaking Down (35-43)
        if (rsi1h >= 69 || (rsi1h >= 35 && rsi1h <= 43)) {
            bearishPotentials.push(`• <b>#${symbol.replace('USDT', '')}</b> ($${price}) - 1H RSI: <code>${rsi1h}</code>`);
        }
    }

    let report = `📡 <b>HOURLY MARKET WATCHLIST (POTENTIAL SETUPS)</b>\n\n`;

    report += `🟢 <b>BULLISH WATCHLIST (Approaching Breakout):</b>\n`;
    report += bullishPotentials.length > 0 ? bullishPotentials.slice(0, 6).join('\n') : "• No immediate setups.";

    report += `\n\n🔴 <b>BEARISH WATCHLIST (Overbought Exhaustion / Breakdown):</b>\n`;
    report += bearishPotentials.length > 0 ? bearishPotentials.slice(0, 6).join('\n') : "• No immediate setups.";

    report += `\n\n⚠️ <b>CRITICAL NOTICE:</b>\n`;
    report += `<i>DO NOT ENTER YET! These assets have high potential but require confirmation. WAIT FOR THE TRIGGER SIGNAL!</i>\n\n`;
    report += `UTC Time: ${new Date().toISOString()}`;

    await sendTelegramMessage(report);
    lastHourlyReportTime = now;
}

async function scanMarket() {
    console.log("Scanning market for BUY/SELL signals and Hourly Watchlist...");
    const marketData = [];

    for (const symbol of SYMBOLS) {
        try {
            // 1H Data
            const closes1h = await getCandles(symbol, '1h');
            if (!closes1h || closes1h.length < 20) continue;

            const currRsi1h = calculateRSI(closes1h);
            const prevRsi1h = calculateRSI(closes1h.slice(0, -1));
            const prevZone1h = getZoneInfo(prevRsi1h);
            const currZone1h = getZoneInfo(currRsi1h);

            // 5M Data
            const closes5m = await getCandles(symbol, '5m');
            if (!closes5m || closes5m.length < 20) continue;

            const currRsi5m = calculateRSI(closes5m);
            const prevRsi5m = calculateRSI(closes5m.slice(0, -1));
            const prevZone5m = getZoneInfo(prevRsi5m);
            const currZone5m = getZoneInfo(currRsi5m);
            const currentPrice = closes5m[closes5m.length - 1];

            marketData.push({ symbol, rsi1h: currRsi1h, price: currentPrice });

            // 1. SIGNAL: 1-HOUR TIMEFRAME SHIFTS (BUY OR SELL)
            if (prevZone1h.name !== currZone1h.name) {
                const isBullish = currZone1h.level > prevZone1h.level;
                const signalTag = isBullish ? "🟢 BUY / LONG SIGNAL" : "🔴 SELL / SHORT SIGNAL";

                const message1h = `🚨 <b>${signalTag} (1-HOUR TIMEFRAME SHIFT)</b>\n\n` +
                    `Asset: <b>#${symbol.replace('USDT', '')}</b>\n` +
                    `Price: <b>$${currentPrice}</b>\n\n` +
                    `Action: <b>${isBullish ? 'BULLISH EXPANSION' : 'BEARISH CONTRACTION'}</b>\n` +
                    `• Previous 1H: <code>${prevRsi1h}</code> [${prevZone1h.name}]\n` +
                    `• Current 1H:  <code>${currRsi1h}</code> [${currZone1h.name}]\n\n` +
                    `5M Micro RSI: <code>${currRsi5m}</code> [${currZone5m.name}]\n` +
                    `UTC: ${new Date().toISOString()}`;

                await sendTelegramMessage(message1h);
            }

            // 2. SIGNAL: 5-MINUTE REJECTION / BREAKOUT
            if (prevZone5m.name !== currZone5m.name) {
                const isBullish5m = currZone5m.level > prevZone5m.level;
                const signalTag5m = isBullish5m ? "🟢 BUY / SCALP LONG (5M SHIFT)" : "🔴 SELL / SCALP SHORT (5M SHIFT)";

                const message5m = `🔔 <b>${signalTag5m}</b>\n\n` +
                    `Asset: <b>#${symbol.replace('USDT', '')}</b>\n` +
                    `Price: <b>$${currentPrice}</b>\n\n` +
                    `Movement: <b>${isBullish5m ? 'UPWARD REBOUND' : 'DOWNWARD REJECTION'}</b>\n` +
                    `• From: <code>${prevRsi5m}</code> [${prevZone5m.name}]\n` +
                    `• To:   <code>${currRsi5m}</code> [${currZone5m.name}]\n\n` +
                    `1H Trend Context: <code>${currRsi1h}</code> [${currZone1h.name}]\n` +
                    `UTC: ${new Date().toISOString()}`;

                await sendTelegramMessage(message5m);
            }

        } catch (error) {
            console.error(`Error processing ${symbol}:`, error.message);
        }
    }

    // Process hourly potential watchlist
    await checkHourlyPotentialWatchlist(marketData);
    console.log("Scan iteration completed.");
}

// Continuous execution every 60 seconds
scanMarket();
setInterval(scanMarket, 60 * 1000);
