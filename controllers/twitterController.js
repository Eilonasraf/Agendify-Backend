const axios = require("axios");
const Tweet = require("../models/Tweet");
const tokenStore = require("./tokenStore");
const { generateGeminiDescription } = require("../services/aiService");
const OAuth = require("oauth-1.0a");
const crypto = require("crypto");

// Setup for OAuth 1.0a
const oauth = OAuth({
  consumer: {
    key: process.env.CONSUMER_KEY,
    secret: process.env.CONSUMER_SECRET,
  },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  },
});

// --- Helper to log rate limits
function logRateLimits(headers) {
  console.log("📊 Twitter Rate Limit Info:");
  console.log("x-rate-limit-limit:", headers["x-rate-limit-limit"]);
  console.log("x-rate-limit-remaining:", headers["x-rate-limit-remaining"]);
  console.log(
    "x-rate-limit-reset:",
    new Date(
      parseInt(headers["x-rate-limit-reset"], 10) * 1000
    ).toLocaleString()
  );
  console.log(
    "x-user-limit-24hour-remaining:",
    headers["x-user-limit-24hour-remaining"]
  );
}

/**
 * Fetches up to `count` tweets matching an AI‑generated query that opposes or supports the user's stance.
 */
const fetchTweets = async (count = 10, options = {}) => {
  console.log("→ fetchTweets received options:", options);
  console.log("→ Bearer token in use:", process.env.BEARER_TOKEN);

  const { topic, subtopics = [], stance } = options;
  const queryString =
    (await generateSearchQuery(topic, subtopics, stance)) +
    " -is:retweet -is:reply";

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
        headers: { Authorization: `Bearer ${process.env.BEARER_TOKEN}` },
      }
    );

    // 2) pick high-traffic tweets by sorting on engagement
    const rawTweets = response.data.data || [];
    const sortedTweets = rawTweets
      .sort((a, b) => {
        const aScore =
          a.public_metrics.retweet_count + a.public_metrics.like_count;
        const bScore =
          b.public_metrics.retweet_count + b.public_metrics.like_count;
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
    };
  } catch (error) {
    console.error(
      "❌ Error fetching tweets:",
      error.response?.data || error.message
    );
    throw error;
  }
};

/**
 * Generates an optimized Twitter search query via Gemini AI.
 */
async function generateSearchQuery(topic, subtopics = [], stance = "in_favor") {
  const prompt = `
Generate an optimized Twitter API v2 search query string.
If the user is \"in_favor\" of the topic, prioritize tweets that oppose their stance.
If the user is \"opposed\" to the topic, prioritize tweets that support their stance.
Ensure you combine the two term groups with \`OR\`, for example: ((opposeTerms) OR (topicTerms)).
Topic: ${topic}
Subtopics: ${subtopics.join(", ") || "none"}
User stance: ${stance}
Include necessary operators (OR, quotes), filters (lang:en), and relevant hashtags.
Ensure no wildcard characters (e.g., '*') and that all terms/operators are valid for the v2 recent search endpoint.
Example query: ((pro-meat OR #meatlover OR #carnivore OR #keto) OR (vegan OR #vegan OR #veganism OR #plantbased)) lang:en
Return only the query string.
  `.trim();

  const query = await generateGeminiDescription(prompt);
  console.log("→ Generated Twitter query:", query);
  return query;
}

/**
 * Classifies the sentiment for all tweets relative to the user's stance.
 */
const classifyTweetsInJSON = async (tweetsJSON, options = {}) => {
  const { topic, subtopics = [], stance } = options;
  if (!tweetsJSON || !Array.isArray(tweetsJSON.tweets)) {
    throw new Error("Invalid JSON: 'tweets' array is missing.");
  }

  const prompt = `
You are an AI that classifies tweets according to the user's stance on a topic.
Topic: ${topic}
Subtopics: ${subtopics.join(", ") || "none"}.
User stance: ${stance} ("in_favor" or "opposed").
Classify each tweet as:
  "1" = agrees with the user's stance,
  "-1" = disagrees with the user's stance,
  "0" = neutral or unrelated.
Here are the tweets:
${JSON.stringify(tweetsJSON.tweets)}
Output a JSON mapping each id to its classification.
  `.trim();

  const responseText = await generateGeminiDescription(prompt);
  const jsonStr = responseText
    .trim()
    .replace(/^```json/, "")
    .replace(/```$/, "")
    .trim();

  const classificationResult = JSON.parse(jsonStr);
  tweetsJSON.tweets.forEach((tweet) => {
    const val = classificationResult[tweet.id];
    tweet.classification = val === undefined ? 0 : parseInt(val, 10);
  });

  return tweetsJSON;
};

/**
 * Generates persuasive response comments for tweets that disagree with the user's stance.
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

  const prompt = `
You are an AI that writes persuasive responses supporting the user's stance.
Topic: ${topic}
User stance: ${stance}
Subtopics: ${subtopics.join(", ") || "none"}.
Write each reply in a bold, human‑like tone—no robotic phrasing and no political correctness.
Use engaging, provocative language to influence viewers toward the user's position.
Here are the tweets that disagree with the stance:
${JSON.stringify(negative.map((t) => ({ id: t.id, text: t.text })))}
Output a JSON mapping each id to its suggested response comment.
  `.trim();

  const responseText = await generateGeminiDescription(prompt);
  const jsonStr = responseText
    .trim()
    .replace(/^```json/, "")
    .replace(/```$/, "")
    .trim();

  const commentsResult = JSON.parse(jsonStr);
  tweetsJSON.tweets.forEach((tweet) => {
    tweet.responseComment =
      tweet.classification === -1 ? commentsResult[tweet.id] || null : null;
  });

  return tweetsJSON;
};

/**
 * Posts a reply to a specific tweet using Twitter API v2, with detailed debug logging.
 */

async function postReplyToTweet(tweetId, replyText) {
  const accessToken = {
    key: process.env.ACCESS_TOKEN,
    secret: process.env.ACCESS_TOKEN_SECRET,
  };
  if (!accessToken.key || !accessToken.secret) {
    throw new Error("Missing user token");
  }

  console.log("accessToken:", accessToken);
  const url = "https://api.twitter.com/2/tweets";
  const body = {
    text: replyText,
    reply: { in_reply_to_tweet_id: tweetId },
  };

  // ⚠️ DO NOT include `data` here — sign only the URL & method
  const request_data = {
    url,
    method: "POST",
  };

  // build your OAuth1.0a header
  const oauth_headers = oauth.toHeader(
    oauth.authorize(request_data, accessToken)
  );

  // now send JSON body separately, requesting author_id and created_at in the response
  const resp = await axios.post(url, body, {
    headers: {
      ...oauth_headers,
      "Content-Type": "application/json",
    },
  });

  console.log("→ Tweet created with ID:", resp.data.data.id);
  return resp.data.data;
}

/**
 * Iterates through tweets JSON and posts replies for those with responseComment.
 */
const postRepliesFromJSON = async (tweetsJSON, twitterUserId) => {
  for (const t of tweetsJSON.tweets) {
    if (t.responseComment) {
      try {
        // 1) send the reply and get the reply data directly
        const replyData = await postReplyToTweet(t.id, t.responseComment);
        console.log("→ Reply posted, received replyData:", replyData);
        const saved = await Tweet.create({
          id: replyData.id,
          text: replyData.text,
          author_id: replyData.author_id || null,
          created_at: replyData.created_at
            ? new Date(replyData.created_at)
            : new Date(),
          responseComment: t.responseComment,
          originalTweetId: t.id,
          originalTweetText: t.text,
          originalTweetAuthorId: t.author_id,
          originalTweetCreatedAt: t.created_at
            ? new Date(t.created_at)
            : new Date(),
          createdBy: twitterUserId,
        });
        console.log(`✔ Saved reply ${saved.id} to MongoDB`);
      } catch (err) {
        console.error(`❌ Failed reply for ${t.id}:`, err.message);
      }
    }
  }
};

/**
 * Generates trending debate topics (AI-powered). Not used in debug flow.
 */
const generateTrendingTopics = async () => {
  const prompt = `
Give me a JSON object of the 5 most specific, single‐topic debates trending on Twitter right now—no nested categories or “vs” pairs.  
For each key, provide an array of 3–4 concise subtopics or controversies.  
Example format:
{
  "Trump": ["Impeachment Inquiry", "Election Integrity", "Trade Policy"],
  "Gaza Conflict": ["Humanitarian Crisis", "Ceasefire Talks", "International Aid"]
}
Return only valid JSON.
  `.trim();

  const resp = await generateGeminiDescription(prompt);
  const jsonText = resp
    .replace(/^```json\s*/, "")
    .replace(/```$/, "")
    .trim();
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    console.error("🛑 JSON parse error in generateTrendingTopics:", jsonText);
    throw new Error("AI returned invalid JSON for topics");
  }

  const flatMap = {};
  Object.values(raw).forEach((arr) => {
    if (Array.isArray(arr)) {
      arr.forEach((item) => {
        if (item.topic && Array.isArray(item.subtopics)) {
          flatMap[item.topic] = item.subtopics;
        }
      });
    }
  });

  console.log("→ Flattened topics JSON:", flatMap);
  return flatMap;
};

module.exports = {
  fetchTweets,
  classifyTweetsInJSON,
  generateResponseCommentsForNegativeTweetsBatch,
  postRepliesFromJSON,
  generateSearchQuery,
  generateTrendingTopics,
  postReplyToTweet,
};
