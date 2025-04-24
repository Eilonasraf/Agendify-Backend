const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require("express-session");
const tokenStore = require("./controllers/tokenStore");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config();

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// If behind a proxy, enable trust proxy
app.set("trust proxy", 1);

// Middleware
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

// Setup session middleware
app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "4971gK2em1SDQllBSio0RJ7Rpjes472QEyZS8wkakrhSMSCKJrMX5MGft9U6giFd",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false, // requires HTTPS
      sameSite: "lax", // allows cross-site cookies
    },
  })
);

app.use((req, res, next) => {
  console.log("🔑 Session now:", req.session);
  next();
});

// Import Routes
const postRouter = require("./routes/posts");
const repliesRouter = require("./routes/replies");
const authRouter = require("./routes/authRoute");
const twitterRouter = require("./routes/twitter");
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
    app.use("/api/twitter", twitterRouter);
    app.use("/api/uploads", uploadRouter);

    // OAuth2 PKCE helpers
    const querystring = require("querystring");
    function generateCodeVerifier() {
      return crypto.randomBytes(32).toString("hex");
    }
    function generateCodeChallenge(v) {
      return crypto
        .createHash("sha256")
        .update(v)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    }

    // 1) Kick off OAuth2 login
    app.get("/auth/twitter", (req, res) => {
      const state = crypto.randomBytes(8).toString("hex");
      const verifier = generateCodeVerifier();
      req.session.codeVerifier = verifier;
      req.session.state = state;
      const challenge = generateCodeChallenge(verifier);
      const params = {
        response_type: "code",
        client_id: process.env.CLIENT_ID,
        redirect_uri: "http://localhost:3000/api/auth/twitter/callback2",
        scope: "tweet.read tweet.write users.read",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      };
      const url =
        "https://twitter.com/i/oauth2/authorize?" +
        querystring.stringify(params);
      res.redirect(url);
    });

    // 2) OAuth2 callback — exchange code for tokens
    app.get("/api/auth/twitter/callback2", async (req, res) => {
      const { code, state } = req.query;
      if (!code || state !== req.session.state || !req.session.codeVerifier) {
        return res.status(400).send("Invalid OAuth callback.");
      }
      const verifier = req.session.codeVerifier;
      req.session.state = null;
      req.session.codeVerifier = null;

      try {
        const resp = await axios.post(
          "https://api.twitter.com/2/oauth2/token",
          querystring.stringify({
            grant_type: "authorization_code",
            code,
            client_id: process.env.CLIENT_ID,
            redirect_uri: "http://localhost:3000/api/auth/twitter/callback2",
            code_verifier: verifier,
          }),
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization:
                "Basic " +
                Buffer.from(
                  `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
                ).toString("base64"),
            },
          }
        );

        const { access_token, refresh_token } = resp.data;
        tokenStore.setUserTokens({
          accessToken: access_token,
          refreshToken: refresh_token,
        });

        res.send(
          `<h1>Twitter Connected!</h1><p>You can now close this window and start promoting.</p>`
        );
      } catch (e) {
        console.error("Error exchanging token:", e.response?.data || e);
        res.status(500).send("OAuth token exchange failed.");
      }
    });

    return app;
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    throw err;
  }
};

module.exports = initApp;
