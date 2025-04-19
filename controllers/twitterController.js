// controllers/twitterController.js
const axios = require("axios");
const crypto = require("crypto");
const Tweet = require("../models/Tweet");
const tokenStore = require("./tokenStore");
const { generateGeminiDescription } = require("../services/aiService");

// --- Helper to log rate limits
function logRateLimits(headers) {
  console.log("📊 Twitter Rate Limit Info:");
  console.log("x-rate-limit-limit:", headers["x-rate-limit-limit"]);
  console.log("x-rate-limit-remaining:", headers["x-rate-limit-remaining"]);
  console.log(
    "x-rate-limit-reset:",
    new Date(parseInt(headers["x-rate-limit-reset"], 10) * 1000).toLocaleString()
  );
  console.log("x-user-limit-24hour-remaining:", headers["x-user-limit-24hour-remaining"]);
}

/**
 * Fetches up to `count` tweets matching `queryString`.
 * Always returns `{ tweets: [...] }` or throws.
 */
const fetchTweets = async (count = 10, queryString) => {
  console.log("→ Bearer token in use:", process.env.BEARER_TOKEN);
  console.log("→ User access token in use:", tokenStore.getUserAccessToken());

  try {
    const response = await axios.get(
      "https://api.twitter.com/2/tweets/search/recent",
      {
        params: {
          query: queryString,
          "tweet.fields": "author_id,created_at,conversation_id,public_metrics,text",
          max_results: count,
        },
        headers: { Authorization: `Bearer ${process.env.BEARER_TOKEN}` },
      }
    );

    logRateLimits(response.headers);

    // Upsert into Mongo for caching
    const tweets = response.data.data || [];
    await Promise.all(
      tweets.map(t =>
        Tweet.findOneAndUpdate(
          { id: t.id },
          {
            id: t.id,
            text: t.text,
            author_id: t.author_id,
            created_at: new Date(t.created_at),
            conversation_id: t.conversation_id,
          },
          { upsert: true, new: true }
        )
      )
    );

    // Return a plain JS object
    return {
      tweets: tweets.map(t => ({
        id: t.id,
        text: t.text,
        author_id: t.author_id,
        created_at: t.created_at,
        conversation_id: t.conversation_id,
      }))
    };
  } catch (error) {
    console.error("❌ Error fetching tweets:", error.response?.data || error.message);
    throw error;
  }
};

/**
 * Classifies the sentiment for all tweets in the provided JSON.
 */
const classifyTweetsInJSON = async tweetsJSON => {
  if (!tweetsJSON || !Array.isArray(tweetsJSON.tweets)) {
    throw new Error("Invalid JSON: 'tweets' array is missing.");
  }

  const prompt = `
You are an AI that classifies sentiment of tweets toward Israel.
Given a JSON array of tweets [{id,text},...], output a JSON mapping each id to:
  "1" = pro‑Israel, "-1" = anti‑Israel, "0" = neutral.
Here are the tweets:
${JSON.stringify(tweetsJSON.tweets)}
Output JSON:
  `.trim();

  const responseText = await generateGeminiDescription(prompt);
  let jsonStr = responseText.trim()
    .replace(/^```json/, "")
    .replace(/```$/, "")
    .trim();

  const classificationResult = JSON.parse(jsonStr);
  tweetsJSON.tweets.forEach(tweet => {
    tweet.classification = parseInt(classificationResult[tweet.id], 10) || 0;
  });

  return tweetsJSON;
};

/**
 * Generates response comments for any tweets with classification === -1.
 */
const generateResponseCommentsForNegativeTweetsBatch = async tweetsJSON => {
  const negative = tweetsJSON.tweets.filter(t => t.classification === -1);
  if (negative.length === 0) {
    tweetsJSON.tweets.forEach(t => (t.responseComment = null));
    return tweetsJSON;
  }

  const prompt = `
You are an AI that writes pro‑Israel replies to anti‑Israel tweets.
Here are the tweets:
${JSON.stringify(negative.map(t => ({id: t.id, text: t.text})))}
Output a JSON mapping each id to a reply comment:
  `.trim();

  const responseText = await generateGeminiDescription(prompt);
  let jsonStr = responseText.trim()
    .replace(/^```json/, "")
    .replace(/```$/, "")
    .trim();

  const commentsResult = JSON.parse(jsonStr);
  tweetsJSON.tweets.forEach(tweet => {
    tweet.responseComment =
      tweet.classification === -1 ? commentsResult[tweet.id] || null : null;
  });

  return tweetsJSON;
};

/**
 * Posts a reply to a specific tweet using Twitter API v2.
 */
const postReplyToTweet = async (tweetId, replyText) => {
  const token = tokenStore.getUserAccessToken();
  if (!token) throw new Error("Missing USER_ACCESS_TOKEN");

  console.log(`🟡 Replying to ${tweetId}:`, replyText);
  const resp = await axios.post(
    "https://api.twitter.com/2/tweets",
    { text: replyText, reply: { in_reply_to_tweet_id: tweetId } },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  logRateLimits(resp.headers);
  return resp.data;
};

/**
 * Iterates through tweets JSON and posts replies for those with responseComment.
 */
const postRepliesFromJSON = async tweetsJSON => {
  for (const t of tweetsJSON.tweets) {
    if (t.responseComment) {
      try {
        await postReplyToTweet(t.id, t.responseComment);
      } catch (err) {
        console.error(`Failed reply for ${t.id}:`, err.message);
      }
    }
  }
};

module.exports = {
  fetchTweets,
  classifyTweetsInJSON,
  generateResponseCommentsForNegativeTweetsBatch,
  postRepliesFromJSON
};
