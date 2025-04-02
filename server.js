const express = require("express");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS Configuration
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: "GET, POST, PUT, DELETE, OPTIONS",
    allowedHeaders: "Content-Type, Authorization",
    credentials: true,
  })
);

// Ensure Preflight Requests Are Handled
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:5173");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  res.sendStatus(200);
});

// Import Routes
const postRouter = require("./routes/posts");
const repliesRouter = require("./routes/replies");
const authRouter = require("./routes/authRoute");
const twitterRouter = require('./routes/twitter');
const { router: uploadRouter } = require("./routes/uploadRoute");

// Initialize the Server
const initApp = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  try {
    await mongoose.connect(process.env.DATABASE_URL);
    console.log("✅ Connected to Database");

    app.use("/uploads", express.static(path.join(__dirname, "./uploads")));

    app.use("/api/posts", postRouter);
    app.use("/api/replies", repliesRouter);
    app.use("/api/auth", authRouter);
    app.use('/api/twitter', twitterRouter);
    app.use("/api/uploads", uploadRouter);

    return app;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    throw error;
  }
};

module.exports = initApp;