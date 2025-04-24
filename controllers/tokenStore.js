// controllers/tokenStore.js
const fs = require("fs");
const path = require("path");

const tokenPath = path.join(__dirname, "user_token.txt");
let userAccessToken = null;

// Load token from disk on startup
(function loadTokenFromFile() {
  if (fs.existsSync(tokenPath)) {
    try {
      userAccessToken = fs.readFileSync(tokenPath, "utf-8").trim();
      console.log("→ [tokenStore] Loaded access token");
    } catch (err) {
      console.error("→ [tokenStore] Failed to load access token:", err);
    }
  }
})();

// Save token to disk
function saveTokenToFile(token) {
  try {
    fs.writeFileSync(tokenPath, token, "utf-8");
    console.log("→ [tokenStore] Saved access token");
  } catch (err) {
    console.error("→ [tokenStore] Failed to save access token:", err);
  }
}

module.exports = {
  getUserAccessToken: () => {
    console.log("→ [tokenStore] getUserAccessToken() →", userAccessToken);
    return userAccessToken;
  },
  setUserAccessToken: (token) => {
    userAccessToken = token;
    saveTokenToFile(token);
    console.log("✅ [tokenStore] Stored user access token");
  },
};
