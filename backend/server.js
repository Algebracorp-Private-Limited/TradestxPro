const express = require("express");
const cors = require("cors");
const db = require("./database");
const { createSignupUser, verifySignupOtp } = require("./auth");

const app = express();

app.use(cors());
app.use(express.json());

app.post("/api/auth/signup", (req, res) => {
  try {
    const {
      name,
      email,
      gender,
      phone,
      city,
      state,
      country,
      password,
    } = req.body;

    const result = createSignupUser({
      name,
      email,
      gender,
      phone,
      city,
      state,
      country,
      password,
    });

    res.status(201).json({
      success: true,
      message: "Signup successful. OTP generated for verification.",
      userId: result.userId,
      plan: "Free",
      developmentOtp: result.otp,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/auth/verify-otp", (req, res) => {
  try {
    const { userId, otp } = req.body;

    const result = verifySignupOtp(userId, otp);

    res.json({
      success: true,
      message: "OTP verified successfully.",
      userId: result.userId,
      verified: true,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

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