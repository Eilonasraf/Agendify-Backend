// routes/twitter.js
const express = require("express");
const router  = express.Router();
const twitter = require("../controllers/twitterController");
const promote = require("../controllers/promoteController");
const authController = require("../controllers/authController");

router.get("/login", authController.login);

// legacy / search
router.get("/search/tweets", twitter.fetchTweets);

// Promote (append new replies) into an existing cluster
router.post("/promote", promote.promote);

// POST replies into an existing cluster
router.post("/postToX", promote.postToXHandler);


module.exports = router;
