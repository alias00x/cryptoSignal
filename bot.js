const axios = require('axios');

const TELEGRAM_BOT_TOKEN = "8952382896:AAGeV0YYvFF4exWp3hax0JnqSxtECRP-IsI";
const TARGET_CHAT_ID = "-1003912506906";

const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 
    'AVAXUSDT', 'NEARUSDT', 'TRXUSDT', 'DOGEUSDT', 'LINKUSDT'
];

// Wilder's RSI calculation
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

// Fetch candlestick data from Binance Futures
async function getCandles(symbol, interval, limit = 50) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const res = await axios.get(url, { timeout: 8000 });
        return res.data.map(k => parseFloat(k[4])); // Closing prices
    } catch (e) {
        return null;
    }
}

// Send formatted alert to Telegram
async function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: TARGET_CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
        console.log("Alert delivered to Telegram.");
    } catch (err) {
        console.error("Telegram API Error:", err.message);
    }
}

// Main execution function
async function scanMarket() {
    console.log("Starting multi-timeframe scan...");

    for (const symbol of SYMBOLS) {
        try {
            // 4-Hour Trend Check
            const closes4h = await getCandles(symbol, '4h');
            if (!closes4h) continue;
            const rsi4h = calculateRSI(closes4h);

            // 5-Minute Entry Check
            const closes5m = await getCandles(symbol, '5m');
            if (!closes5m) continue;
            const rsi5m = calculateRSI(closes5m);
            const currentPrice = closes5m[closes5m.length - 1];

            console.log(`[${symbol}] 4H RSI: ${rsi4h} | 5M RSI: ${rsi5m}`);

            // Strategy: 4H Strong (55 - 68) + 5M Oversold Dip (<= 38)
            const isMacroStrong = (rsi4h >= 55 && rsi4h <= 68);
            const isMicroOversold = (rsi5m <= 38);

            if (isMacroStrong && isMicroOversold) {
                const message = `🚨 <b>RSI DIVERGENCE / PULLBACK SIGNAL</b>\n\n` +
                    `Asset: <b>#${symbol.replace('USDT', '')}</b>\n` +
                    `Price: <b>$${currentPrice}</b>\n\n` +
                    `📊 <b>4H RSI:</b> <code>${rsi4h}</code> (Macro Bullish Trend)\n` +
                    `📉 <b>5M RSI:</b> <code>${rsi5m}</code> (Intraday Oversold Dip)\n\n` +
                    `💡 <i>Setup: Macro uptrend remains intact while micro timeframe offers a pullback entry.</i>\n` +
                    `UTC Time: ${new Date().toISOString()}`;

                await sendTelegramMessage(message);
            }
        } catch (error) {
            console.error(`Error processing ${symbol}:`, error.message);
        }
    }
    console.log("Scan completed.");
}

scanMarket();
