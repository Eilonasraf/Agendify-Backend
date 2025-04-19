// controllers/promoteController.js
const twitter = require("./twitterController");

const promote = async (req, res) => {
  try {
    // 1) count comes in as a query‑param (clamped between 10 and 100)
    const count = Math.min(Math.max(parseInt(req.query.count, 10) || 10, 10), 100);

    // 2) pull the form inputs
    const { topic, subtopics = [], freeText = "" } = req.body;

    // 3) stitch them together into Twitter search syntax
    const parts = [topic, ...subtopics, freeText, "lang:en", "-is:retweet"]
      .filter(Boolean)
      .join(" ");

    // fallback if they didn’t select anything
    const defaultQuery = '("Israel Gaza" OR #Israel OR #Gaza OR #IsraelUnderAttack) lang:en -is:retweet';
    const queryString = parts.length > 0 ? parts : defaultQuery;

    // 4) pass both into fetchTweets
    const tweetsJSON = await twitter.fetchTweets(count, queryString);
    const classified = await twitter.classifyTweetsInJSON(tweetsJSON);
    const withComments = await twitter.generateResponseCommentsForNegativeTweetsBatch(classified);

    // 5) post replies
    const replyCount = withComments.tweets.filter(t => t.responseComment).length;
    await twitter.postRepliesFromJSON(withComments);

    // 6) send back result
    return res.json({
      message: `Posted ${replyCount} replies.`,
      tweets: withComments.tweets
    });
  } catch (err) {
    console.error("🚨 Promote error:", err);

    // Handle Twitter 429 rate‑limit
    if (err.response?.status === 429) {
      return res
        .status(429)
        .json({ error: "Twitter rate limit exceeded. Please wait a minute and try again." });
    }

    // Fallback for all other errors
    return res.status(500).json({ error: err.message });
  }
};

module.exports = { promote };
