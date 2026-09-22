const axios = require('axios');
const fs = require('fs');

const TELEGRAM_BOT_TOKEN = "8952382896:AAGeV0YYvFF4exWp3hax0JnqSxtECRP-IsI";
const TARGET_CHAT_ID = "-1004340657482";
const STATE_FILE = './active_trades.json';

const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 
    'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'LINKUSDT',
    'SUIUSDT', 'TONUSDT', 'NEARUSDT', 'APTUSDT', 'DOTUSDT', 
    'ICPUSDT', 'LTCUSDT', 'BCHUSDT', 'POLUSDT', 'ARBUSDT', 
    'OPUSDT', 'SEIUSDT', 'TIAUSDT', 'FETUSDT', 'TAOUSDT', 
    'RENDERUSDT', 'INJUSDT', 'UNIUSDT', 'AAVEUSDT', 'CAKEUSDT', 
    'PEPEUSDT', 'SHIBUSDT', 'WIFUSDT', 'PAXGUSDT'
];

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error("Error loading state:", e.message);
    }
    return { lastReportHour: -1, trades: {} };
}

function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving state:", e.message);
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
        console.log("Telegram message delivered.");
    } catch (err) {
        console.error("Telegram API Error:", err.response ? err.response.data : err.message);
    }
}

async function processSymbol(symbol) {
    const closes1h = await getCandles(symbol, '1h');
    const closes5m = await getCandles(symbol, '5m');

    if (!closes1h || !closes5m || closes1h.length < 20 || closes5m.length < 20) {
        return null;
    }

    const currRsi1h = calculateRSI(closes1h);
    const prevRsi1h = calculateRSI(closes1h.slice(0, -1));
    const currentPrice = closes5m[closes5m.length - 1];

    return {
        symbol,
        currentPrice,
        currRsi1h,
        prevRsi1h
    };
}

async function reportActiveResults(validCoins, state) {
    const tradeKeys = Object.keys(state.trades || {});
    const formattedDate = new Date().toISOString().replace('T', '  T: ');

    if (tradeKeys.length === 0) {
        const emptyMessage = `<b>Result</b>\n• No active positions currently open.\n\nUTC: ${formattedDate}`;
        await sendTelegramMessage(emptyMessage);
        return;
    }

    let resultLines = [];
    let updatedTrades = { ...state.trades };

    for (const key of tradeKeys) {
        const trade = state.trades[key];
        const coinData = validCoins.find(c => c.symbol === trade.symbol);
        if (!coinData) continue;

        const currentPrice = coinData.currentPrice;
        const currentZone = getZoneInfo(coinData.currRsi1h);

        let pnlPercent = trade.type === 'BUY'
            ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
            : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

        const pnlFormatted = pnlPercent >= 0 ? `+${pnlPercent.toFixed(2)}%` : `${pnlPercent.toFixed(2)}%`;
        const icon = trade.type === 'BUY' ? '🟢 BUY' : '🔴 SELL';

        resultLines.push(`${icon} -> #${trade.symbol.replace('USDT', '')} @ $${trade.entryPrice} -> $${currentPrice} (${pnlFormatted})`);

        const isLongTarget = trade.type === 'BUY' && (currentZone.level >= 5 || pnlPercent <= -3.5);
        const isShortTarget = trade.type === 'SELL' && (currentZone.level <= 1 || pnlPercent <= -3.5);

        if (isLongTarget || isShortTarget) {
            delete updatedTrades[key];
        }
    }

    const message = `<b>Result</b>\n` + resultLines.join('\n') + `\n\nUTC: ${formattedDate}`;
    await sendTelegramMessage(message);
    state.trades = updatedTrades;
}

async function executeScan() {
    console.log("Executing Scanner Workflow...");

    try {
        const results = await Promise.all(SYMBOLS.map(sym => processSymbol(sym)));
        const validCoins = results.filter(r => r !== null);

        if (validCoins.length === 0) {
            console.error("Zero assets fetched.");
            process.exit(1);
        }

        const avgRsi1h = parseFloat((validCoins.reduce((acc, c) => acc + c.currRsi1h, 0) / validCoins.length).toFixed(2));
        let state = loadState();

        // 1. Hourly Result Check
        const currentHour = new Date().getUTCHours();
        if (state.lastReportHour !== currentHour) {
            await reportActiveResults(validCoins, state);
            state.lastReportHour = currentHour;
            saveState(state);
        }

        // 2. Collect New Signals
        const signalsToSend = [];

        for (const coin of validCoins) {
            const { symbol, currentPrice, currRsi1h, prevRsi1h } = coin;

            const prevZone1h = getZoneInfo(prevRsi1h);
            const currZone1h = getZoneInfo(currRsi1h);

            if (prevZone1h.name !== currZone1h.name) {
                const isBullish = currZone1h.level > prevZone1h.level;
                const isBuyAllowed = isBullish && avgRsi1h >= 45;
                const isSellAllowed = !isBullish && avgRsi1h <= 65;

                if (isBuyAllowed || isSellAllowed) {
                    const signalType = isBullish ? "BUY" : "SELL";
                    const signalIcon = isBullish ? "🟢 BUY" : "🔴 SELL";

                    const cardMessage = `${signalIcon} -> #${symbol.replace('USDT', '')} @ $${currentPrice}\n` +
                        `• Shift: [${prevZone1h.name}] ➔ [${currZone1h.name}] (1H RSI: ${currRsi1h})\n` +
                        `• Market AVG RSI: ${avgRsi1h}`;

                    signalsToSend.push({
                        symbol,
                        signalType,
                        currentPrice,
                        cardMessage
                    });
                }
            }
        }

        // 3. Dispatch Signals (Header Sent Only Once)
        if (signalsToSend.length > 0) {
            const formattedDate = new Date().toISOString().replace('T', '  T: ');
            const headerMessage = `🩵 <b>New Signal</b>\nUTC: ${formattedDate}`;

            await sendTelegramMessage(headerMessage);

            for (const sig of signalsToSend) {
                await sendTelegramMessage(sig.cardMessage);

                state.trades[sig.symbol] = {
                    symbol: sig.symbol,
                    type: sig.signalType,
                    entryPrice: sig.currentPrice,
                    timestamp: Date.now()
                };
            }
            saveState(state);
        }

        console.log("Scan finished successfully.");
        process.exit(0);

    } catch (error) {
        console.error("Fatal Error:", error.message);
        process.exit(1);
    }
}

executeScan();
