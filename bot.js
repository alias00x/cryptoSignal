const axios = require('axios');
const fs = require('fs');

const TELEGRAM_BOT_TOKEN = "8952382896:AAGeV0YYvFF4exWp3hax0JnqSxtECRP-IsI";
const TELEGRAM_CHAT_LOG = "-1004340657482";   // Admin Log Channel
const TELEGRAM_CHAT_VIPI = "-1003909320436";  // VIP Users Channel
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
    return { trades: {}, closedToday: [], lastDailyReportDate: "" };
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

async function sendTelegramMessage(chatId, text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML'
        });
        console.log(`Alert sent to: ${chatId}`);
    } catch (err) {
        console.error(`Telegram Error (${chatId}):`, err.response ? err.response.data : err.message);
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

async function sendTenMinuteReport(validCoins, state, avgRsi1h, avgRsi5m) {
    const tradeKeys = Object.keys(state.trades || {});
    const formattedDate = new Date().toISOString().replace('T', '  T: ');

    if (tradeKeys.length === 0) {
        const idleMessage = `📊 <b>TRADE STATUS UPDATE (10M Check)</b>\n\n` +
            `• No active positions currently open.\n` +
            `• Market Climate: 1H RSI [<code>${avgRsi1h}</code>] | 5M RSI [<code>${avgRsi5m}</code>]\n` +
            `• Status: Scanning for high-probability setups...\n\n` +
            `UTC: ${formattedDate}`;

        await sendTelegramMessage(TELEGRAM_CHAT_LOG, idleMessage);
        return;
    }

    let vipCards = [];
    let logCards = [];
    let updatedTrades = { ...state.trades };
    if (!state.closedToday) state.closedToday = [];

    for (const key of tradeKeys) {
        const trade = state.trades[key];
        const coinData = validCoins.find(c => c.symbol === trade.symbol);
        if (!coinData) continue;

        const { currentPrice, currRsi1h, currRsi5m } = coinData;

        let pnlPercent = trade.type === 'BUY'
            ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
            : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

        const pnlFormatted = pnlPercent >= 0 ? `+${pnlPercent.toFixed(2)}%` : `${pnlPercent.toFixed(2)}%`;
        const pnlIcon = pnlPercent >= 0 ? '🟢' : '🔴';

        let actionBanner = "👉 ACTION ➔ ⏳ [ HOLD POSITION ] ⏳";
        let isClosed = false;
        let closeReason = "";

        if (trade.type === 'BUY') {
            if (currRsi5m >= 70 || currRsi1h >= 70) {
                actionBanner = "👉 ACTION ➔ 💰 [ CLOSE & TAKE PROFIT ] 🎯";
                isClosed = true;
                closeReason = "Take Profit";
            } else if (pnlPercent <= -2.5 || currRsi5m <= 30) {
                actionBanner = "👉 ACTION ➔ 🛑 [ CLOSE & STOP LOSS ] 🛑";
                isClosed = true;
                closeReason = "Stop Loss";
            }
        } else { // SELL
            if (currRsi5m <= 30 || currRsi1h <= 30) {
                actionBanner = "👉 ACTION ➔ 💰 [ CLOSE & TAKE PROFIT ] 🎯";
                isClosed = true;
                closeReason = "Take Profit";
            } else if (pnlPercent <= -2.5 || currRsi5m >= 70) {
                actionBanner = "👉 ACTION ➔ 🛑 [ CLOSE & STOP LOSS ] 🛑";
                isClosed = true;
                closeReason = "Stop Loss";
            }
        }

        const vipCard = `🪙 <b>#${trade.symbol.replace('USDT', '')}</b> [${trade.type}]\n` +
            `• Price: <code>$${trade.entryPrice}</code> ➔ <code>$${currentPrice}</code> (<b>${pnlFormatted}</b> ${pnlIcon})\n` +
            `${actionBanner}`;
        vipCards.push(vipCard);

        const logCard = `🪙 <b>#${trade.symbol.replace('USDT', '')}</b> [${trade.type}]\n` +
            `• PnL: ${pnlFormatted} | Entry: $${trade.entryPrice} | Now: $${currentPrice}\n` +
            `• Telemetry: 1H RSI [${currRsi1h}] | 5M RSI [${currRsi5m}]\n` +
            `${actionBanner}`;
        logCards.push(logCard);

        if (isClosed) {
            state.closedToday.push({
                symbol: trade.symbol,
                type: trade.type,
                pnlPercent: parseFloat(pnlPercent.toFixed(2)),
                reason: closeReason
            });
            delete updatedTrades[key];
        }
    }

    const vipReport = `📊 <b>TRADE STATUS UPDATE (10M Check)</b>\n\n` + 
        vipCards.join('\n─────────────────────\n') + 
        `\n\nUTC: ${formattedDate}`;

    const logReport = `📊 <b>ADMIN TELEMETRY UPDATE (10M Check)</b>\n\n` + 
        logCards.join('\n─────────────────────\n') + 
        `\n\nUTC: ${formattedDate}`;

    await sendTelegramMessage(TELEGRAM_CHAT_VIPI, vipReport);
    await sendTelegramMessage(TELEGRAM_CHAT_LOG, logReport);

    state.trades = updatedTrades;
    saveState(state);
}

async function checkDailyPerformanceReport(state) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentHour = now.getUTCHours();

    if (currentHour === 0 && state.lastDailyReportDate !== today) {
        const closed = state.closedToday || [];
        if (closed.length === 0) return;

        const wins = closed.filter(t => t.pnlPercent > 0);
        const losses = closed.filter(t => t.pnlPercent <= 0);
        const winRate = ((wins.length / closed.length) * 100).toFixed(1);

        const grossProfit = wins.reduce((acc, t) => acc + t.pnlPercent, 0);
        const grossLoss = losses.reduce((acc, t) => acc + t.pnlPercent, 0);
        const netPnL = (grossProfit + grossLoss).toFixed(2);

        let breakdownLines = closed.map(t => {
            const icon = t.pnlPercent > 0 ? "✅" : "❌";
            const targetIcon = t.pnlPercent > 0 ? "🎯" : "🛑";
            return `${icon} #${t.symbol.replace('USDT', '')} [${t.type}] ➔ ${t.pnlPercent > 0 ? '+' : ''}${t.pnlPercent}% ${targetIcon} (${t.reason})`;
        });

        const dailyMessage = `🏆 <b>DAILY AUDIT & PERFORMANCE REPORT</b>\n` +
            `📅 Date: ${today} | UTC Close\n\n` +
            `📈 <b>CORE PERFORMANCE:</b>\n` +
            `• Total Trades: <b>${closed.length}</b>\n` +
            `• Win / Loss: <b>${wins.length}W - ${losses.length}L</b>\n` +
            `• Win Rate: <b>${winRate}% 🎯</b>\n` +
            `• Gross Profit: <b>+${grossProfit.toFixed(2)}%</b>\n` +
            `• Gross Loss: <b>${grossLoss.toFixed(2)}%</b>\n` +
            `🔥 <b>TOTAL NET PnL: ${netPnL >= 0 ? '+' : ''}${netPnL}% 🚀</b>\n` +
            `─────────────────────\n` +
            `📋 <b>CLOSED TRADES:</b>\n` +
            breakdownLines.join('\n') +
            `\n\n💡 <i>Strict risk discipline guarantees long-term edge!</i>`;

        await sendTelegramMessage(TELEGRAM_CHAT_VIPI, dailyMessage);
        await sendTelegramMessage(TELEGRAM_CHAT_LOG, dailyMessage);

        state.lastDailyReportDate = today;
        state.closedToday = [];
        saveState(state);
    }
}

async function executeScan() {
    console.log(`Starting GitHub Actions Scan Execution...`);

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

        await sendTenMinuteReport(validCoins, state, avgRsi1h, avgRsi5m);
        await checkDailyPerformanceReport(state);

        for (const coin of validCoins) {
            const { symbol, currentPrice, currRsi1h, prevRsi1h, currRsi5m } = coin;

            if (state.trades[symbol]) {
                continue; 
            }

            const prevZone1h = getZoneInfo(prevRsi1h);
            const currZone1h = getZoneInfo(currRsi1h);

            if (prevZone1h.name !== currZone1h.name) {
                const isBullish = currZone1h.level > prevZone1h.level;
                const isBuyAllowed = isBullish && avgRsi1h >= 45 && currRsi5m <= 65;
                const isSellAllowed = !isBullish && avgRsi1h <= 65 && currRsi5m >= 35;

                if (isBuyAllowed || isSellAllowed) {
                    const signalType = isBullish ? "BUY" : "SELL";
                    const formattedDate = new Date().toISOString().replace('T', '  T: ');

                    const tpPrice = isBullish 
                        ? (currentPrice * 1.035).toFixed(4) 
                        : (currentPrice * 0.965).toFixed(4);
                    const slPrice = isBullish 
                        ? (currentPrice * 0.975).toFixed(4) 
                        : (currentPrice * 1.025).toFixed(4);

                    const vipMessage = `${isBullish ? '🟢 BUY SIGNAL (LONG)' : '🔴 SELL SIGNAL (SHORT)'}\n\n` +
                        `🪙 Coin: <b>#${symbol.replace('USDT', '')}</b>\n` +
                        `💵 Entry Price: <code>$${currentPrice}</code>\n\n` +
                        `🎯 Target (TP): <code>$${tpPrice}</code> (+3.5%)\n` +
                        `🛑 Stop Loss (SL): <code>$${slPrice}</code> (-2.5%)\n` +
                        `⚡️ Leverage: 3x - 5x\n\n` +
                        `UTC: ${formattedDate}`;

                    const logMessage = `🚨 <b>ADMIN SIGNAL LOG [${signalType}]</b>\n\n` +
                        `• Asset: #${symbol.replace('USDT', '')} @ $${currentPrice}\n` +
                        `• Shift: [${prevZone1h.name}] ➔ [${currZone1h.name}] (1H RSI: ${currRsi1h})\n` +
                        `• Micro 5M RSI: ${currRsi5m}\n` +
                        `• Market AVG RSI: ${avgRsi1h}\n` +
                        `UTC: ${formattedDate}`;

                    await sendTelegramMessage(TELEGRAM_CHAT_VIPI, vipMessage);
                    await sendTelegramMessage(TELEGRAM_CHAT_LOG, logMessage);

                    state.trades[symbol] = {
                        symbol: symbol,
                        type: signalType,
                        entryPrice: currentPrice,
                        timestamp: Date.now()
                    };
                    saveState(state);
                }
            }
        }

        console.log("GitHub Action iteration completed successfully.");
        process.exit(0);

    } catch (error) {
        console.error("Execution Failure:", error.message);
        process.exit(1);
    }
}

executeScan();
