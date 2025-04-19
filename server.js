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

    // Import additional modules for OAuth 2.0 PKCE
    const querystring = require("querystring");

    /**
     * Generate a random code verifier.
     */
    function generateCodeVerifier() {
      const codeVerifier = crypto.randomBytes(32).toString("hex");
      console.log("Generated code verifier:", codeVerifier);
      return codeVerifier;
    }

    /**
     * Generate a code challenge from the verifier using SHA256 and Base64URL encoding.
     */
    function generateCodeChallenge(verifier) {
      return crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    }

    /**
     * OAuth2 Login Route
     * Redirects the user to Twitter’s OAuth 2.0 authorization endpoint.
     */
    app.get("/auth/twitter", (req, res) => {
      // Generate a random state and code verifier.
      const state = crypto.randomBytes(8).toString("hex");
      const codeVerifier = generateCodeVerifier();
      // Store the verifier and state in the session
      req.session.codeVerifier = codeVerifier;
      req.session.state = state;
      const codeChallenge = generateCodeChallenge(codeVerifier);

      // Build the authorization URL with necessary query parameters.
      const params = {
        response_type: "code",
        client_id: process.env.CLIENT_ID, // your Twitter OAuth2 Client ID
        redirect_uri: "http://localhost:3000/api/auth/twitter/callback2",
        scope: "tweet.read tweet.write users.read",
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      };

      const authUrl = `https://twitter.com/i/oauth2/authorize?${querystring.stringify(
        params
      )}`;
      console.log("Redirecting user to:", authUrl);
      res.redirect(authUrl);
    });

    /**
     * OAuth2 Callback Route
     * Handles the redirect from Twitter after user authorization.
     * Exchanges the authorization code for an access token.
     */
    app.get("/api/auth/twitter/callback2", async (req, res) => {
      const { code, state } = req.query;
      console.log("Received callback with code:", code, "and state:", state);
      console.log("Session state:", req.session.state);
      console.log("Session codeVerifier:", req.session.codeVerifier);

      if (
        !code ||
        !state ||
        req.session.state !== state ||
        !req.session.codeVerifier
      ) {
        return res
          .status(400)
          .send("Missing or invalid code, state, or code verifier.");
      }

      const codeVerifier = req.session.codeVerifier;
      // Clear these values from the session after use.
      req.session.codeVerifier = null;
      req.session.state = null;

      const tokenParams = {
        code: code,
        grant_type: "authorization_code",
        client_id: process.env.CLIENT_ID,
        redirect_uri: "http://localhost:3000/api/auth/twitter/callback2",
        code_verifier: codeVerifier,
      };

      try {
        const tokenResponse = await axios.post(
          "https://api.twitter.com/2/oauth2/token",
          querystring.stringify(tokenParams),
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${Buffer.from(
                `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
              ).toString("base64")}`,
            },
          }
        );
        const userAccessToken = tokenResponse.data.access_token;
        console.log("Obtained user access token:", userAccessToken);
        // Store the token automatically for later use:
        tokenStore.setUserAccessToken(userAccessToken);
        res.send(
          `<h1>Authentication Successful!</h1>
         <p>Your access token has been stored automatically.</p>`
        );
      } catch (error) {
        console.error(
          "Error exchanging code for token:",
          error.response?.data || error.message
        );
        res.status(500).send("Error during token exchange.");
      }
    });

    return app;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    throw error;
  }
};

module.exports = initApp;