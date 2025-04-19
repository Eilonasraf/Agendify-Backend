const fs = require("fs");
const path = require("path");
const tokenPath = path.join(__dirname, "user_token.txt");

let userAccessToken = null;

const loadTokenFromFile = () => {
  if (fs.existsSync(tokenPath)) {
    userAccessToken = fs.readFileSync(tokenPath, "utf-8").trim();
  }
};

const saveTokenToFile = (token) => {
  fs.writeFileSync(tokenPath, token, "utf-8");
};

loadTokenFromFile(); // Load token on startup

module.exports = {
  getUserAccessToken: () => userAccessToken,
  setUserAccessToken: (token) => {
    userAccessToken = token;
    saveTokenToFile(token);
    console.log("✅ Stored user access token:", token);
  },
};
