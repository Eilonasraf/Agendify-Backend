const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]; // Extract Bearer token

  console.log("Authorization Header:", req.headers.authorization); // Debugging header

  if (!token) {
    return res.status(401).json({ error: 'No token provided, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded Token:", decoded); // Debug token payload

    const user = await User.findById(decoded.user.id);
    console.log("User Found:", user); // Debug user existence

    if (!user) {
      return res.status(401).json({ error: 'User not found, authorization denied' });
    }

    req.user = { id: user.id, username: user.username };
    next();
  } catch (err) {
    console.error("Token Error:", err.message); // Debug token validation error
    res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = authMiddleware;