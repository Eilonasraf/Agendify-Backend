// controllers/twitterController.js
const axios = require("axios");
const Tweet = require("../models/Tweet");
const tokenStore = require("./tokenStore");
const { generateGeminiDescription } = require("../services/aiService");
const OAuth = require("oauth-1.0a");
const crypto = require("crypto");

/** Helper to log rate limits */
function logRateLimits(headers) {
  console.log("📊 Twitter Rate Limit Info:");
  console.log("x-rate-limit-limit:", headers["x-rate-limit-limit"]);
  console.log("x-rate-limit-remaining:", headers["x-rate-limit-remaining"]);
  console.log(
    "x-rate-limit-reset:",
    new Date(parseInt(headers["x-rate-limit-reset"], 10) * 1000).toLocaleString()
  );
}

/**
 * Generates an optimized Twitter search query via Gemini AI.
 */
async function generateSearchQuery(topic, subtopics = [], stance = "in_favor") {
  const prompt = `
Generate an optimized Twitter API v2 search query string.
If the user is "in_favor" of the topic, prioritize tweets that oppose their stance.
If the user is "opposed" to the topic, prioritize tweets that support their stance.
Combine the two term groups with OR, include necessary operators (OR, quotes),
filters (lang:en), and hashtags. No wildcards (*). Example:
((pro-meat OR #meatlover) OR (vegan OR #vegan)) lang:en
Topic: ${topic}
Subtopics: ${subtopics.join(", ") || "none"}
User stance: ${stance}
Return only the query string.
  `.trim();

  const query = await generateGeminiDescription(prompt);
  console.log("→ Generated Twitter query:", query);
  return query.trim();
}

/**
 * Fetches tweets using the provided bearer token.
 */
const fetchTweets = async (count = 10, options = {}, bearerToken) => {
  const { topic, subtopics = [], stance } = options;
  const queryString =
    (await generateSearchQuery(topic, subtopics, stance)) +
    " -is:retweet -is:reply";

  console.log("→ fetchTweets opts:", options);

  try {
    const response = await axios.get(
      "https://api.twitter.com/2/tweets/search/recent",
      {
        params: {
          query: queryString,
          "tweet.fields":
            "author_id,created_at,conversation_id,public_metrics,text",
          max_results: count,
        },
        headers: { Authorization: `Bearer ${bearerToken}` },
      }
    );

    const rawTweets = response.data.data || [];
    const sortedTweets = rawTweets
      .sort((a, b) => {
        const aScore = a.public_metrics.retweet_count + a.public_metrics.like_count;
        const bScore = b.public_metrics.retweet_count + b.public_metrics.like_count;
        return bScore - aScore;
      })
      .slice(0, count);

    logRateLimits(response.headers);

    return {
      tweets: sortedTweets.map((t) => ({
        id: t.id,
        text: t.text,
        author_id: t.author_id,
        created_at: t.created_at,
        conversation_id: t.conversation_id,
      })),
      rateLimit: {
        limit:     response.headers["x-rate-limit-limit"],
        remaining: response.headers["x-rate-limit-remaining"],
        reset:     response.headers["x-rate-limit-reset"],
      }
    };
  } catch (error) {
    console.error("❌ Error fetching tweets:", error.response?.data || error.message);
    throw error;
  }
};

/**
 * Classifies the sentiment for all tweets relative to the user's stance.
 */
const classifyTweetsInJSON = async (tweetsJSON, options = {}) => {
  const { topic, subtopics = [], stance } = options;
  if (!tweetsJSON || !Array.isArray(tweetsJSON.tweets)) {
    throw new Error("Invalid JSON: 'tweets' array is missing.");
  }

  const prompt = `
You are an AI that classifies tweets according to the user's stance.
Topic: ${topic}
Subtopics: ${subtopics.join(", ") || "none"}.
User stance: ${stance} ("in_favor" or "opposed").
Classify each tweet as:
  "1" = agrees with the user's stance,
  "-1" = disagrees with the user's stance,
  "0" = neutral/unrelated.
Here are the tweets:
${JSON.stringify(tweetsJSON.tweets)}
Output only valid JSON mapping each id to its classification.
  `.trim();

  const responseText = await generateGeminiDescription(prompt);
  // strip any markdown fences and trailing commentary, keep only the {...}
  const raw = responseText.replace(/^```json\s*/, "").replace(/```$/, "").trim();
  const match = raw.match(/^{[\s\S]*}$/m);
  if (!match) throw new Error("AI returned non-JSON classification");
  const classificationMap = JSON.parse(match[0]);

  tweetsJSON.tweets.forEach((t) => {
    const v = classificationMap[t.id];
    t.classification = v === undefined ? 0 : parseInt(v, 10);
  });

  return tweetsJSON;
};

/**
 * Generates persuasive response comments for tweets that disagree.
 */
const generateResponseCommentsForNegativeTweetsBatch = async (
  tweetsJSON,
  options = {}
) => {
  const { topic, subtopics = [], stance } = options;
  const negative = tweetsJSON.tweets.filter((t) => t.classification === -1);
  if (negative.length === 0) {
    tweetsJSON.tweets.forEach((t) => (t.responseComment = null));
    return tweetsJSON;
  }

  // New prompt: concise (≤1.5 sentences), human tone, no markdown
  const prompt = `
You are an AI that writes concise, persuasive responses supporting the user's stance.
Topic: ${topic}
User stance: ${stance}
Subtopics: ${subtopics.join(", ") || "none"}.
For each tweet below, write at most one and a half sentences in a natural, human-like tone without any markdown or asterisks.
Here are the tweets that disagree:
${JSON.stringify(negative.map((t) => ({ id: t.id, text: t.text })))}
Output only valid JSON mapping each id to its suggested reply.
  `.trim();

  const responseText = await generateGeminiDescription(prompt);
  // Strip any code fences and pull out the JSON object
  const raw = responseText.replace(/^```json\s*/, "").replace(/```$/, "").trim();
  const match = raw.match(/^{[\s\S]*}$/m);
  if (!match) throw new Error("AI returned non-JSON replies");
  const commentsMap = JSON.parse(match[0]);

  // Assign and sanitize: remove any stray asterisks
  tweetsJSON.tweets.forEach((t) => {
    if (t.classification === -1) {
      const reply = commentsMap[t.id] || null;
      t.responseComment = reply
        ? reply.replace(/\*+/g, "").trim()
        : null;
    } else {
      t.responseComment = null;
    }
  });

  return tweetsJSON;
};

/**
 * Posts a reply using explicit OAuth1.0a credentials.
 */
async function postReplyToTweet(tweetId, replyText, creds) {
  const { consumer, access } = creds;
  const oauth = OAuth({
    consumer: { key: consumer.key, secret: consumer.secret },
    signature_method: "HMAC-SHA1",
    hash_function(base, key) {
      return crypto.createHmac("sha1", key).update(base).digest("base64");
    },
  });

  const url = "https://api.twitter.com/2/tweets";
  const body = { text: replyText, reply: { in_reply_to_tweet_id: tweetId } };
  const request_data = { url, method: "POST" };
  const oauth_headers = oauth.toHeader(oauth.authorize(request_data, access));

  const resp = await axios.post(url, body, {
    headers: {
      ...oauth_headers,
      "Content-Type": "application/json",
    },
  });

  console.log("→ Tweet created:", resp.data.data.id);
  return resp.data.data;
}

/**
 * Iterates through a JSON batch and saves each reply to MongoDB.
 */
const postRepliesFromJSON = async (tweetsJSON, twitterUserId) => {
  for (const t of tweetsJSON.tweets) {
    if (!t.responseComment) continue;
    try {
      const replyData = await postReplyToTweet(t.id, t.responseComment);
      console.log("→ Reply posted:", replyData.id);
      await Tweet.create({
        id:                    replyData.id,
        text:                  replyData.text,
        author_id:             replyData.author_id || null,
        created_at:            replyData.created_at ? new Date(replyData.created_at) : new Date(),
        responseComment:       t.responseComment,
        originalTweetId:       t.id,
        originalTweetText:     t.text,
        originalTweetAuthorId: t.author_id,
        originalTweetCreatedAt:t.created_at ? new Date(t.created_at) : new Date(),
        createdBy:             twitterUserId,
      });
    } catch (err) {
      console.error(`❌ Failed to save reply for ${t.id}:`, err.message);
    }
  }
};

/**
 * Generates trending debate topics (AI-powered).
 */
const generateTrendingTopics = async () => {
  const prompt = `
Give me a JSON object of the 5 most specific single-topic debates trending on Twitter right now.
Format:
{ "Topic1": ["Sub1","Sub2"], "Topic2": ["SubA","SubB"] }
Return only valid JSON.
  `.trim();

  const resp = await generateGeminiDescription(prompt);
  const jsonText = resp.replace(/^```json\s*/, "").replace(/```$/, "").trim();
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    console.error("🛑 JSON parse error in generateTrendingTopics:", jsonText);
    throw new Error("AI returned invalid JSON for topics");
  }
  return raw;
};

module.exports = {
  fetchTweets,
  generateSearchQuery,
  classifyTweetsInJSON,
  generateResponseCommentsForNegativeTweetsBatch,
  postReplyToTweet,
  postRepliesFromJSON,
  generateTrendingTopics,
};
