import axios from 'axios';

const TELEGRAM_BOT_TOKEN = "8952382896:AAGeV0YYvFF4exWp3hax0JnqSxtECRP-IsI";
const TELEGRAM_CHAT_LOG = "-1004340657482";

// Function to send Telegram message
async function sendTelegramAlert(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_LOG,
      text: message,
      parse_mode: 'HTML'
    });
    console.log("Alert message sent successfully.");
  } catch (error) {
    console.error("Error sending Telegram message:", error.message);
  }
}

async function analyzeMarket() {
  try {
    // 1. Fetch global market data from CoinGecko
    const globalRes = await axios.get('https://api.coingecko.com/api/v3/global');
    const btcDominance = globalRes.data.data.market_cap_percentage.btc;
    const totalMarketCap = globalRes.data.data.total_market_cap.usd;

    // 2. Fetch specific coin metrics (BTC, ETH, USDT)
    const coinsRes = await axios.get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,ethereum,bitcoin&price_change_percentage=24h');
    
    const btc = coinsRes.data.find(c => c.id === 'bitcoin');
    const eth = coinsRes.data.find(c => c.id === 'ethereum');
    const usdt = coinsRes.data.find(c => c.id === 'tether');

    // Calculate USDT Dominance and ETH/BTC ratio
    const usdtDominance = (usdt.market_cap / totalMarketCap) * 100;
    const ethBtcRatio = eth.current_price / btc.current_price;

    // 24h performance metrics
    const ethChange24h = eth.price_change_percentage_24h;
    const btcChange24h = btc.price_change_percentage_24h;
    
    // Relative strength indicators
    const isEthBtcBullish = ethChange24h > btcChange24h;
    const isUsdtDDecreasing = usdt.market_cap_change_percentage_24h < 0;

    let alertMessage = null;

    // Condition 1: Altseason Scenario
    if (isUsdtDDecreasing && isEthBtcBullish && btcDominance < 55) {
      alertMessage = `🚨 <b>Market Alert: Altseason Signals Detected!</b> 🚀\n\n` +
        `📉 <b>USDT Dominance:</b> Falling (Capital entering crypto)\n` +
        `📈 <b>ETH/BTC:</b> Outperforming BTC (Risk-on sentiment)\n` +
        `📊 <b>BTC Dominance:</b> ${btcDominance.toFixed(2)}%\n` +
        `📊 <b>ETH/BTC Ratio:</b> ${ethBtcRatio.toFixed(5)}\n\n` +
        `💡 <i>Outlook: High probability of an altcoin rally.</i>`;
    } 
    // Condition 2: Bitcoin Dominance Run
    else if (isUsdtDDecreasing && !isEthBtcBullish && btcChange24h > 3) {
      alertMessage = `⚡️ <b>Market Alert: Bitcoin Run in Progress!</b> 🟠\n\n` +
        `📉 <b>USDT Dominance:</b> Falling (Inflow of capital)\n` +
        `📊 <b>BTC Dominance:</b> ${btcDominance.toFixed(2)}%\n` +
        `📉 <b>ETH/BTC:</b> Underperforming\n\n` +
        `💡 <i>Outlook: Liquidity is flowing mainly into BTC. High volatility expected.</i>`;
    } 
    // Condition 3: Panic / Market Dump (Flight to USDT)
    else if (!isUsdtDDecreasing && usdt.market_cap_change_percentage_24h > 1.5) {
      alertMessage = `⚠️ <b>Market Alert: Risk-Off / Capital Flight!</b> 🔴\n\n` +
        `📈 <b>USDT Dominance:</b> Rising sharply (Dumping to cash)\n` +
        `📊 <b>USDT Dominance:</b> ${usdtDominance.toFixed(2)}%\n` +
        `📊 <b>BTC Dominance:</b> ${btcDominance.toFixed(2)}%\n\n` +
        `💡 <i>Outlook: Market-wide sell-off detected. Exercise caution on long positions.</i>`;
    }

    // Send alert only if a significant market event occurred
    if (alertMessage) {
      await sendTelegramAlert(alertMessage);
    } else {
      console.log("Market status is neutral. No critical conditions met; no alert sent.");
    }

  } catch (error) {
    console.error("Error analyzing market data:", error.message);
  }
}

analyzeMarket();
