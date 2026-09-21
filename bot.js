const axios = require('axios');

const TELEGRAM_BOT_TOKEN = "8952382896:AAGeV0YYvFF4exWp3hax0JnqSxtECRP-IsI";
const TARGET_CHAT_ID = "-1004340657482";

// Spot symbols accessible globally via Binance Public Data API
const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 
    'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'LINKUSDT',
    'SUIUSDT', 'TONUSDT', 'NEARUSDT', 'APTUSDT', 'DOTUSDT', 
    'ICPUSDT', 'LTCUSDT', 'BCHUSDT', 'POLUSDT', 'ARBUSDT', 
    'OPUSDT', 'SEIUSDT', 'TIAUSDT', 'FETUSDT', 'TAOUSDT', 
    'RENDERUSDT', 'INJUSDT', 'UNIUSDT', 'AAVEUSDT', 'CAKEUSDT', 
    'PEPEUSDT', 'SHIBUSDT', 'WIFUSDT', 'PAXGUSDT'
];

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

// Global open endpoint: Completely unblocked for GitHub Actions US runners
async function getCandles(symbol, interval, limit = 50) {
    try {
        const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const res = await axios.get(url, { 
            timeout: 6000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (Array.isArray(res.data)) {
            return res.data.map(k => parseFloat(k[4])); // Closing price
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
        console.log("Telegram alert sent.");
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

async function executeScan() {
    console.log("Starting GitHub Actions Scan Execution...");

    try {
        const results = await Promise.all(SYMBOLS.map(sym => processSymbol(sym)));
        const validCoins = results.filter(r => r !== null);

        console.log(`Successfully fetched: ${validCoins.length} / ${SYMBOLS.length} assets.`);

        if (validCoins.length === 0) {
            console.error("Endpoint issue. Zero coins retrieved.");
            process.exit(1);
        }

        const avgRsi1h = parseFloat((validCoins.reduce((acc, c) => acc + c.currRsi1h, 0) / validCoins.length).toFixed(2));
        const avgRsi5m = parseFloat((validCoins.reduce((acc, c) => acc + c.currRsi5m, 0) / validCoins.length).toFixed(2));

        console.log(`Market Stats -> 1H AVG RSI: ${avgRsi1h} | 5M AVG RSI: ${avgRsi5m}`);

        for (const coin of validCoins) {
            const { symbol, currentPrice, currRsi1h, prevRsi1h, currRsi5m, prevRsi5m } = coin;

            const prevZone1h = getZoneInfo(prevRsi1h);
            const currZone1h = getZoneInfo(currRsi1h);
            const prevZone5m = getZoneInfo(prevRsi5m);
            const currZone5m = getZoneInfo(currRsi5m);

            // 1. 1-Hour Shift Alert
            if (prevZone1h.name !== currZone1h.name) {
                const isBullish = currZone1h.level > prevZone1h.level;
                const isBuyAllowed = isBullish && avgRsi1h >= 45;
                const isSellAllowed = !isBullish && avgRsi1h <= 65;

                if (isBuyAllowed || isSellAllowed) {
                    const signalTag = isBullish ? "🟢 BUY / LONG SIGNAL" : "🔴 SELL / SHORT SIGNAL";
                    const message1h = `🚨 <b>${signalTag} (1-HOUR SHIFT)</b>\n\n` +
                        `Asset: <b>#${symbol.replace('USDT', '')}</b>\n` +
                        `Price: <b>$${currentPrice}</b>\n\n` +
                        `🌐 <b>Market AVG RSI (1H):</b> <code>${avgRsi1h}</code>\n` +
                        `Action: <b>${isBullish ? 'BULLISH EXPANSION' : 'BEARISH CONTRACTION'}</b>\n` +
                        `• Previous 1H: <code>${prevRsi1h}</code> [${prevZone1h.name}]\n` +
                        `• Current 1H:  <code>${currRsi1h}</code> [${currZone1h.name}]\n\n` +
                        `5M Micro RSI: <code>${currRsi5m}</code> [${currZone5m.name}]\n` +
                        `UTC: ${new Date().toISOString()}`;

                    await sendTelegramMessage(message1h);
                }
            }

            // 2. 5-Minute Shift Alert
            if (prevZone5m.name !== currZone5m.name) {
                const isBullish5m = currZone5m.level > prevZone5m.level;
                const signalTag5m = isBullish5m ? "🟢 BUY / SCALP LONG (5M SHIFT)" : "🔴 SELL / SCALP SHORT (5M SHIFT)";

                const message5m = `🔔 <b>${signalTag5m}</b>\n\n` +
                    `Asset: <b>#${symbol.replace('USDT', '')}</b>\n` +
                    `Price: <b>$${currentPrice}</b>\n\n` +
                    `🌐 <b>Market AVG RSI (5M):</b> <code>${avgRsi5m}</code>\n` +
                    `Movement: <b>${isBullish5m ? 'UPWARD REBOUND' : 'DOWNWARD REJECTION'}</b>\n` +
                    `• From: <code>${prevRsi5m}</code> [${prevZone5m.name}]\n` +
                    `• To:   <code>${currRsi5m}</code> [${currZone5m.name}]\n\n` +
                    `1H Macro Context: <code>${currRsi1h}</code> [${currZone1h.name}]\n` +
                    `UTC: ${new Date().toISOString()}`;

                await sendTelegramMessage(message5m);
            }
        }

        // Hourly Watchlist Check
        const currentMinute = new Date().getUTCMinutes();
        if (currentMinute < 10) {
            let bullishPotentials = [];
            let bearishPotentials = [];

            for (const item of validCoins) {
                if (item.currRsi1h >= 52 && item.currRsi1h < 60) {
                    bullishPotentials.push(`• <b>#${item.symbol.replace('USDT', '')}</b> ($${item.currentPrice}) - 1H: <code>${item.currRsi1h}</code>`);
                }
                if (item.currRsi1h >= 69 || (item.currRsi1h >= 35 && item.currRsi1h <= 43)) {
                    bearishPotentials.push(`• <b>#${item.symbol.replace('USDT', '')}</b> ($${item.currentPrice}) - 1H: <code>${item.currRsi1h}</code>`);
                }
            }

            let report = `📡 <b>HOURLY MARKET RADAR (POTENTIAL WATCHLIST)</b>\n\n`;
            report += `🌐 <b>Overall Market AVG RSI (1H):</b> <code>${avgRsi1h}</code> [${getZoneInfo(avgRsi1h).name}]\n\n`;
            report += `🟢 <b>BULLISH WATCHLIST:</b>\n` + (bullishPotentials.length > 0 ? bullishPotentials.slice(0, 6).join('\n') : "• None.") + `\n\n`;
            report += `🔴 <b>BEARISH WATCHLIST:</b>\n` + (bearishPotentials.length > 0 ? bearishPotentials.slice(0, 6).join('\n') : "• None.") + `\n\n`;
            report += `⚠️ <b>CRITICAL NOTICE:</b>\n<i>DO NOT ENTER YET! WAIT FOR THE TRIGGER SIGNAL!</i>\n\n`;
            report += `UTC Time: ${new Date().toISOString()}`;

            await sendTelegramMessage(report);
        }

        console.log("Scan finished cleanly.");
        process.exit(0);

    } catch (error) {
        console.error("Fatal Error:", error.message);
        process.exit(1);
    }
}

executeScan();
