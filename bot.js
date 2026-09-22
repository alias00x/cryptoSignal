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
    return { trades: {} };
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
    if (!closes || closes.length <= period) return null;
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
        console.log("Telegram alert dispatched.");
    } catch (err) {
        console.error("Telegram Error:", err.response ? err.response.data : err.message);
    }
}

// Strict check: Must have valid 1H AND 5M RSI data
async function processSymbol(symbol) {
    const [closes1h, closes5m] = await Promise.all([
        getCandles(symbol, '1h'),
        getCandles(symbol, '5m')
    ]);

    // Reject if either 1h or 5m data is incomplete
    if (!closes1h || !closes5m || closes1h.length < 20 || closes5m.length < 20) {
        return null;
    }

    const currRsi1h = calculateRSI(closes1h);
    const prevRsi1h = calculateRSI(closes1h.slice(0, -1));

    const currRsi5m = calculateRSI(closes5m);
    const prevRsi5m = calculateRSI(closes5m.slice(0, -1));

    if (currRsi1h === null || prevRsi1h === null || currRsi5m === null || prevRsi5m === null) {
        return null;
    }

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

// Guaranteed 10-Minute Result Evaluation (Using 1H & 5M Confluence)
async function sendTenMinuteResultReport(validCoins, state, avgRsi1h, avgRsi5m) {
    const tradeKeys = Object.keys(state.trades || {});
    const formattedDate = new Date().toISOString().replace('T', '  T: ');

    if (tradeKeys.length === 0) {
        const idleMessage = `📊 <b>Result (10M Check)</b>\n` +
            `• No active positions currently open.\n` +
            `• Market AVG: 1H [<code>${avgRsi1h}</code>] | 5M [<code>${avgRsi5m}</code>]\n` +
            `• Status: Scanning for confirmed zone transitions...\n\n` +
            `UTC: ${formattedDate}`;
        await sendTelegramMessage(idleMessage);
        return;
    }

    let reportLines = [];
    let updatedTrades = { ...state.trades };

    for (const key of tradeKeys) {
        const trade = state.trades[key];
        const coinData = validCoins.find(c => c.symbol === trade.symbol);
        if (!coinData) continue;

        const { currentPrice, currRsi1h, currRsi5m } = coinData;

        let pnlPercent = trade.type === 'BUY'
            ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
            : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

        const pnlFormatted = pnlPercent >= 0 ? `+${pnlPercent.toFixed(2)}%` : `${pnlPercent.toFixed(2)}%`;
        const icon = trade.type === 'BUY' ? '🟢 BUY' : '🔴 SELL';

        // Decision logic based on BOTH 1H and 5M RSI
        let advice = "HOLD ⏳";
        let isClosed = false;

        if (trade.type === 'BUY') {
            if (currRsi5m >= 70 || currRsi1h >= 70) {
                advice = "Close / TP 🟢 (Overbought Red Exhaustion)";
                isClosed = true;
            } else if (pnlPercent <= -2.5 || currRsi5m <= 30) {
                advice = "Close / SL 🔴 (Micro Support Broken)";
                isClosed = true;
            } else {
                advice = "HOLD ⏳ (Trend Healthy)";
            }
        } else { // SELL
            if (currRsi5m <= 30 || currRsi1h <= 30) {
                advice = "Close / TP 🟢 (Oversold Green Target)";
                isClosed = true;
            } else if (pnlPercent <= -2.5 || currRsi5m >= 70) {
                advice = "Close / SL 🔴 (Resistance Broken)";
                isClosed = true;
            } else {
                advice = "HOLD ⏳ (Downtrend Intact)";
            }
        }

        reportLines.push(
            `${icon} -> #${trade.symbol.replace('USDT', '')} @ $${trade.entryPrice} ➔ $${currentPrice} (${pnlFormatted})\n` +
            `• Decision: <b>${advice}</b> (1H: <code>${currRsi1h}</code> | 5M: <code>${currRsi5m}</code>)`
        );

        if (isClosed) {
            delete updatedTrades[key];
        }
    }

    const finalReport = `📊 <b>Result (10M Check)</b>\n\n` + reportLines.join('\n\n') + `\n\nUTC: ${formattedDate}`;
    await sendTelegramMessage(finalReport);
    state.trades = updatedTrades;
    saveState(state);
}

async function executeScan() {
    console.log("Starting 10-Minute Cycle Scanner...");

    try {
        const results = await Promise.all(SYMBOLS.map(sym => processSymbol(sym)));
        const validCoins = results.filter(r => r !== null);

        if (validCoins.length === 0) {
            console.error("Zero assets fetched.");
            process.exit(1);
        }

        const avgRsi1h = parseFloat((validCoins.reduce((acc, c) => acc + c.currRsi1h, 0) / validCoins.length).toFixed(2));
        const avgRsi5m = parseFloat((validCoins.reduce((acc, c) => acc + c.currRsi5m, 0) / validCoins.length).toFixed(2));

        let state = loadState();

        // 1. ALWAYS Send Result Report on Every 10-Minute Execution
        await sendTenMinuteResultReport(validCoins, state, avgRsi1h, avgRsi5m);

        // 2. Scan and Dispatch New Signals
        const signalsToSend = [];

        for (const coin of validCoins) {
            const { symbol, currentPrice, currRsi1h, prevRsi1h, currRsi5m } = coin;

            const prevZone1h = getZoneInfo(prevRsi1h);
            const currZone1h = getZoneInfo(currRsi1h);

            // Shift detection with 5M confirmation
            if (prevZone1h.name !== currZone1h.name) {
                const isBullish = currZone1h.level > prevZone1h.level;
                const isBuyAllowed = isBullish && avgRsi1h >= 45 && currRsi5m <= 65;
                const isSellAllowed = !isBullish && avgRsi1h <= 65 && currRsi5m >= 35;

                if (isBuyAllowed || isSellAllowed) {
                    const signalType = isBullish ? "BUY" : "SELL";
                    const signalIcon = isBullish ? "🟢 BUY" : "🔴 SELL";

                    const cardMessage = `${signalIcon} -> #${symbol.replace('USDT', '')} @ $${currentPrice}\n` +
                        `• Shift: [${prevZone1h.name}] ➔ [${currZone1h.name}] (1H RSI: ${currRsi1h} | 5M: ${currRsi5m})`;

                    signalsToSend.push({
                        symbol,
                        signalType,
                        currentPrice,
                        cardMessage
                    });
                }
            }
        }

        // 3. Dispatch New Signals if Found
        if (signalsToSend.length > 0) {
            const formattedDate = new Date().toISOString().replace('T', '  T: ');
            const headerMessage = `🩵 <b>New Signal</b>\n` +
                `Market AVG RSI: <code>${avgRsi1h}</code>\n` +
                `UTC: ${formattedDate}`;

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

        console.log("10-Minute execution completed successfully.");
        process.exit(0);

    } catch (error) {
        console.error("Execution Failure:", error.message);
        process.exit(1);
    }
}

executeScan();
