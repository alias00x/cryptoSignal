const axios = require('axios');
axios.post("https://api.telegram.org/bot8952382896:AAGeV0YYvFF4exWp3hax0JnqSxtECRP-IsI/sendMessage", {
    chat_id: "-1003912506906",
    text: "✅ connected!"
}).then(() => console.log("message sent!"))
  .catch(err => console.error("connection error:", err.response ? err.response.data : err.message));
