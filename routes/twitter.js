// routes/twitter.js
const express = require("express");
const router = express.Router();
const twitter = require("../controllers/twitterController");
const authController = require("../controllers/authController");
const promoteController = require("../controllers/promoteController"); // <<< חדש

router.get("/login", authController.login);
router.post("/promote", promoteController.promote);
router.get("/search/tweets", twitter.fetchTweets);

router.get("/search/classify", async (req, res) => {
  try {
    const tweetsJSON = await twitter.fetchTweets();
    const classifiedJSON = await twitter.classifyTweetsInJSON(tweetsJSON);
    return res.json(classifiedJSON);
  } catch (err) {
    console.error("🔍 classify error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/search/generate", async (req, res) => {
  try {
    const tweetsJSON = await twitter.fetchTweets();
    const classified = await twitter.classifyTweetsInJSON(tweetsJSON);
    const withComments =
      await twitter.generateResponseCommentsForNegativeTweetsBatch(classified);
    return res.json(withComments);
  } catch (err) {
    console.error("✍️ generate error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/topics", async (req, res) => {
  try {
    const topics = await twitter.generateTrendingTopics();
    res.json(topics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────
// ▶ TESTS from Mongo only
// ──────────────────────────────────────────────────────
router.get("/test/classifyDB", async (req, res) => {
  try {
    const tweetsJSON = await twitter.getSavedTweets();
    const classified = await twitter.classifyTweetsInJSON(tweetsJSON);
    return res.json(classified);
  } catch (err) {
    console.error("classifyDB error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/test/generateDB", async (req, res) => {
  try {
    const tweetsJSON = await twitter.getSavedTweets();
    const classified = await twitter.classifyTweetsInJSON(tweetsJSON);
    const withComments =
      await twitter.generateResponseCommentsForNegativeTweetsBatch(classified);
    return res.json(withComments);
  } catch (err) {
    console.error("generateDB error:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/test/postDB", async (req, res) => {
  try {
    const tweetsJSON = await twitter.getSavedTweets();
    const classified = await twitter.classifyTweetsInJSON(tweetsJSON);
    const withComments =
      await twitter.generateResponseCommentsForNegativeTweetsBatch(classified);
    await twitter.postRepliesFromJSON(withComments);
    return res.json({
      message: `Posted ${
        withComments.tweets.filter((t) => t.responseComment).length
      } replies.`,
    });
  } catch (err) {
    console.error("postDB error:", err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
