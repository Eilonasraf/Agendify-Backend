const userModel = require("../models/userModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const client = new OAuth2Client();

const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const profilePicture = req.file ? `/uploads/${req.file.filename}` : "/uploads/default-avatar.png";

    if (!username || !email || !password) {
      res.status(400).json({ message: "Username, email, and password are required" });
      return;
    }

    if (!/^(?=.*[a-zA-Z])(?=.*\d).+$/.test(username)) {
      res.status(400).json({ message: "Username must contain both letters and numbers" });
      return;
    }

    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      res.status(400).json({ message: "Email already in use" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await userModel.create({
      username,
      email,
      password: hashedPassword,
      profilePicture,
      refreshTokens: [],
    });

    res.status(201).json({ message: "User registered successfully", user: newUser });
  } catch (error) {
    console.error("❌ Error registering user:", error);
    res.status(500).json({ message: "Error registering user" });
  }
};

const generateTokens = (_id) => {
  const random = Math.floor(Math.random() * 1000000);

  if (!process.env.TOKEN_SECRET) return null;

  const accessToken = jwt.sign(
    { _id, random },
    process.env.TOKEN_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION }
  );

  const refreshToken = jwt.sign(
    { _id, random },
    process.env.TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION }
  );

  return { accessToken, refreshToken };
};

const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ message: "Username and password are required" });
    return;
  }

  try {
    const user = await userModel.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(400).json({ message: "Wrong username or password" });
      return;
    }

    const tokens = generateTokens(user._id);
    if (!tokens) {
      res.status(500).json({ message: "Error generating tokens" });
      return;
    }

    const { accessToken, refreshToken } = tokens;
    user.refreshTokens = user.refreshTokens || [];
    user.refreshTokens.push(refreshToken);
    await user.save();

    const apiBaseUrl = process.env.DOMAIN_BASE?.trim().replace(/\/$/, "");
    let profilePictureUrl = "/default-avatar.png";

    if (user.profilePicture) {
      profilePictureUrl = user.profilePicture.startsWith("/uploads/")
        ? `${apiBaseUrl}${user.profilePicture}`
        : user.profilePicture;
    }

    res.status(200).json({
      username: user.username,
      email: user.email,
      _id: user._id,
      profilePicture: profilePictureUrl,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("❌ Error logging in:", error);
    res.status(500).json({ message: "Error logging in" });
  }
};

const refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken || !process.env.TOKEN_SECRET) {
    res.status(400).send("Invalid refresh token or secret not set");
    return;
  }

  jwt.verify(refreshToken, process.env.TOKEN_SECRET, async (err, payload) => {
    if (err) {
      res.status(403).send("Invalid token");
      return;
    }

    const userId = payload._id;
    try {
      const user = await userModel.findById(userId);
      if (!user || !user.refreshTokens.includes(refreshToken)) {
        res.status(400).send("Invalid refresh token");
        user.refreshTokens = [];
        await user.save();
        return;
      }

      const newTokens = generateTokens(user._id);
      if (!newTokens) {
        user.refreshTokens = [];
        await user.save();
        res.status(500).send("Error generating tokens");
        return;
      }

      user.refreshTokens = user.refreshTokens.filter(t => t !== refreshToken);
      user.refreshTokens.push(newTokens.refreshToken);
      await user.save();

      res.status(200).send(newTokens);
    } catch (error) {
      console.error(error);
      res.status(500).send("Error refreshing token");
    }
  });
};

const logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).send("Refresh token required");
    return;
  }

  jwt.verify(refreshToken, process.env.TOKEN_SECRET, async (err, payload) => {
    if (err) {
      res.status(403).send("Invalid token");
      return;
    }

    const userId = payload._id;
    try {
      const user = await userModel.findById(userId);
      if (!user || !user.refreshTokens.includes(refreshToken)) {
        res.status(400).send("Invalid refresh token");
        user.refreshTokens = [];
        await user.save();
        return;
      }

      user.refreshTokens = user.refreshTokens.filter(t => t !== refreshToken);
      await user.save();
      res.status(200).send("Logged out");
    } catch (error) {
      console.error(error);
      res.status(500).send("Error logging out");
    }
  });
};

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token || !process.env.TOKEN_SECRET) {
    res.status(401).json({ message: "Access denied or token secret missing" });
    return;
  }

  jwt.verify(token, process.env.TOKEN_SECRET, (err, payload) => {
    if (err) {
      res.status(403).json({ message: "Invalid token" });
      return;
    }
    req.user = { id: payload._id };
    next();
  });
};

const googleSignin = async (req, res) => {
  try {
    const ticket = await client.verifyIdToken({
      idToken: req.body.credential,
      audience: process.env.WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      res.status(400).json({ message: "Invalid Google token or missing email" });
      return;
    }

    let user = await userModel.findOne({ email: payload.email });
    if (!user) {
      const safeName = (payload.name || "User").replace(/\s+/g, "");
      const randomDigits = Math.floor(Math.random() * 1000);
      const username = safeName + randomDigits;

      user = await userModel.create({
        username,
        email: payload.email,
        password: "",
        profilePicture: payload.picture,
      });
    }

    const tokens = generateTokens(user._id);
    if (!tokens) {
      res.status(500).json({ message: "Token generation failed" });
      return;
    }

    res.status(200).json({
      email: user.email,
      _id: user._id,
      username: user.username,
      profilePicture: user.profilePicture,
      ...tokens,
    });
  } catch (err) {
    console.error("Google Signin Error:", err);
    res.status(400).json({
      message: err instanceof Error ? err.message : "Unknown error occurred",
    });
  }
};

module.exports = {
  register,
  login,
  refresh,
  logout,
  googleSignin,
  authMiddleware,
};