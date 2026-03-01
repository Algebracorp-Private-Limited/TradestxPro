const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("TradeStxPro Backend Running");
});

app.get("/api/market/nse", (req, res) => {
  res.json({
    index: "NSE",
    level: 22500,
    change: 120,
    percent: 0.53
  });
});

app.get("/api/market/bse", (req, res) => {
  res.json({
    index: "BSE",
    level: 73500,
    change: -210,
    percent: -0.28
  });
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});