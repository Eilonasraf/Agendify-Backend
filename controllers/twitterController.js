const axios = require("axios");
const OAuth = require("oauth-1.0a");
const crypto = require("crypto");
const Tweet = require("../models/Tweet"); // Tweet schema
const Reply = require("../models/replies"); // Reply schema
const { generateGeminiDescription } = require("../services/aiService"); // Gemini AI service

const tokenStore = require("./tokenStore");

// For read-only endpoints, encode CLIENT_ID and CLIENT_SECRET
const credentials = Buffer.from(
  `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
).toString("base64");

/**
 * Obtains an application-only access token using the OAuth 2.0 Client Credentials flow.
 * Note: This token has read-only access.
 */
const getAccessToken = async () => {
  try {
    const response = await axios.post(
      "https://api.twitter.com/oauth2/token",
      "grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error(
      "Error fetching access token:",
      error.response?.data || error.message
    );
    throw error;
  }
};

// Function to fetch and save tweets (read-only, uses app-only token)
/**
 * Fetch and save tweets (can be called as a route or internally).
 */
const fetchTweets = async (req, res) => {
  try {
    // 1) get an app‑only bearer token
    const token = process.env.BEARER_TOKEN;

    // 2) hit Twitter's recent search endpoint
    const response = await axios.get(
      "https://api.twitter.com/2/tweets/search/recent",
      {
        params: {
          // hard‑coded query
          query:
            '("Israel Gaza" OR #Israel OR #Gaza OR #IsraelUnderAttack OR #GazaWar) lang:en -is:retweet',
          "tweet.fields":
            "author_id,created_at,conversation_id,public_metrics,text",
          max_results: 10,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    // 3) upsert into Mongo
    const tweets = response.data.data || [];
    const savedTweets = await Promise.all(
      tweets.map((t) =>
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

    // 4a) if in Express: send JSON
    if (res && typeof res.json === "function") {
      return res.json({ tweets: savedTweets });
    }

    // 4b) if called internally: return data
    return { tweets: savedTweets };
  } catch (error) {
    console.error(
      "Error fetching tweets:",
      error.response?.data || error.message
    );

    // if in Express: return 500
    if (res && typeof res.status === "function") {
      return res.status(500).json({
        error: "Error fetching tweets",
        details: error.response?.data || error.message,
      });
    }

    // else (internal call) just return an empty list so test() can continue
    return { tweets: [] };
  }
};

const fetchReplies = async (req, res) => {
  try {
    const { conversation_id } = req.query;
    if (!conversation_id) {
      return res.status(400).json({ error: "conversation_id is required" });
    }
    const token = await getAccessToken();
    const repliesResponse = await axios.get(
      "https://api.twitter.com/2/tweets/search/recent",
      {
        params: {
          query: `conversation_id:${conversation_id} -is:retweet`,
          "tweet.fields": "author_id,created_at,in_reply_to_user_id",
          max_results: 5,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    const replies = repliesResponse.data.data || [];
    const savedReplies = [];
    for (let reply of replies) {
      const savedReply = await Reply.findOneAndUpdate(
        { id: reply.id },
        {
          id: reply.id,
          postId: conversation_id,
          content: reply.text,
          author: reply.author_id,
          createdAt: new Date(reply.created_at),
          in_reply_to_user_id: reply.in_reply_to_user_id,
        },
        { upsert: true, new: true }
      );
      savedReplies.push(savedReply);
    }
    res.json({ replies: savedReplies });
  } catch (error) {
    console.error(
      "Error fetching replies:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Error fetching replies for the given conversation_id",
      details: error.response?.data || error.message,
    });
  }
};

/**
 * Classifies the sentiment for all tweets in the provided JSON.
 */
const classifyTweetsInJSON = async (tweetsJSON) => {
  if (!tweetsJSON || !Array.isArray(tweetsJSON.tweets)) {
    throw new Error("Invalid JSON: 'tweets' array is missing.");
  }
  const tweetsArrayString = JSON.stringify(tweetsJSON.tweets);
  const prompt = `You are an AI that classifies sentiment of tweets toward Israel.
You will be provided with a JSON array of tweet objects. Each object contains an "id" and a "text" property.
For each tweet, determine its sentiment as follows:
- Output "1" if the tweet is in favor of Israel.
- Output "-1" if the tweet is against Israel.
- Output "0" if the tweet is neutral or ambiguous.
Please output a valid JSON object that maps each tweet's id to its classification.
Now, classify the sentiment of the following JSON:
${tweetsArrayString}

Output JSON:`;
  try {
    const responseText = await generateGeminiDescription(prompt);
    let cleanedResponse = responseText.trim();
    if (cleanedResponse.startsWith("```json")) {
      cleanedResponse = cleanedResponse.slice(7).trim();
    }
    if (cleanedResponse.endsWith("```")) {
      cleanedResponse = cleanedResponse.slice(0, -3).trim();
    }
    let classificationResult = JSON.parse(cleanedResponse);
    for (const tweet of tweetsJSON.tweets) {
      tweet.classification =
        classificationResult[tweet.id] !== undefined
          ? classificationResult[tweet.id]
          : null;
    }
    return tweetsJSON;
  } catch (error) {
    console.error("Error classifying tweets:", error);
    throw error;
  }
};

/**
 * Generates response comments in favor of Israel for tweets with classification -1.
 */
const generateResponseCommentsForNegativeTweetsBatch = async (tweetsJSON) => {
  if (!tweetsJSON || !Array.isArray(tweetsJSON.tweets)) {
    throw new Error("Invalid JSON: 'tweets' array is missing.");
  }
  const negativeTweets = tweetsJSON.tweets.filter(
    (tweet) => tweet.classification === -1
  );
  if (negativeTweets.length === 0) {
    tweetsJSON.tweets = tweetsJSON.tweets.map((tweet) => ({
      ...tweet,
      responseComment: null,
    }));
    return tweetsJSON;
  }
  const negativeTweetsArrayString = JSON.stringify(
    negativeTweets.map((tweet) => ({ id: tweet.id, text: tweet.text }))
  );
  const prompt = `You are an AI tasked with generating response comments in favor of Israel for tweets.
You will be provided with a JSON array of tweet objects, where each object contains an "id" and a "text" property.
For each tweet, craft a natural, engaging, and slightly spiced-up response comment that passionately supports Israel.
Please output a valid JSON object that maps each tweet's id to its generated comment.
Now, generate the response comments for the following JSON:
${negativeTweetsArrayString}
Output JSON:`;
  try {
    const responseText = await generateGeminiDescription(prompt);
    let cleanedResponse = responseText.trim();
    if (cleanedResponse.startsWith("```json")) {
      cleanedResponse = cleanedResponse.slice(7).trim();
    }
    if (cleanedResponse.endsWith("```")) {
      cleanedResponse = cleanedResponse.slice(0, -3).trim();
    }
    let commentsResult = JSON.parse(cleanedResponse);
    tweetsJSON.tweets = tweetsJSON.tweets.map((tweet) => {
      tweet.responseComment =
        tweet.classification === -1 && commentsResult[tweet.id] !== undefined
          ? commentsResult[tweet.id]
          : null;
      return tweet;
    });
    return tweetsJSON;
  } catch (error) {
    console.error("Error generating response comments:", error);
    throw error;
  }
};

/**
 * Posts a reply to a specific tweet using Twitter API v2.
 * This function uses axios to send a POST request with a JSON body.
 * It requires a valid OAuth 2.0 user access token (with write permissions)
 * stored in tokenStore.
 */
const postReplyToTweet = async (tweetId, replyText) => {
  // Retrieve the token from the token store.
  const token = tokenStore.getUserAccessToken();
  if (!token) {
    throw new Error("Missing USER_ACCESS_TOKEN for posting tweets.");
  }
  try {
    const response = await axios.post(
      "https://api.twitter.com/2/tweets",
      {
        text: replyText,
        reply: {
          in_reply_to_tweet_id: tweetId,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`Reply posted for tweet ${tweetId}:`, response.data);
    return response.data;
  } catch (error) {
    console.error(
      `Error posting reply for tweet ${tweetId}:`,
      error.response?.data || error.message
    );
    throw error;
  }
};

/**
 * Iterates through the provided tweets JSON and posts replies for tweets that have a generated response comment.
 */
const postRepliesFromJSON = async (tweetsJSON) => {
  if (!tweetsJSON || !Array.isArray(tweetsJSON.tweets)) {
    throw new Error("Invalid JSON: 'tweets' array is missing.");
  }
  for (const tweet of tweetsJSON.tweets) {
    if (tweet.responseComment && tweet.id) {
      try {
        await postReplyToTweet(tweet.id, tweet.responseComment);
      } catch (error) {
        console.error(`Failed to post reply for tweet ${tweet.id}:`, error);
      }
    }
  }
};

// ----- TEST BLOCK -----
// This test block runs when the server starts.
// It uses a static JSON sample to classify tweets, generate response comments, and then post replies.
const test = async () => {
  const testJSON = {
    tweets: [
      {
        _id: "67ead42e6d4dc8701a3d21d8",
        id: "1906763826214609141",
        __v: 0,
        author_id: "4194937875",
        conversation_id: "1906763826214609141",
        createdAt: "2025-03-31T17:43:10.546Z",
        created_at: "2025-03-31T17:41:36.000Z",
        replies: [],
        text: "Israel killed 15 Palestinian paramedics and rescue workers one by one, says UN | Israel-Gaza war | The Guardian https://t.co/o9ZX27Wq6n",
        updatedAt: "2025-03-31T17:43:10.546Z",
      },
      // Additional tweets can be added here...
    ],
  };

  try {
    console.log("Fetching tweets for testing...");
    const tweets = await fetchTweets();
    // press any key
    console.log("Press any key to continue...");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    });
    console.log("Fetched tweets for testing:", tweets);
    console.log("Classifying tweets...");
    const classifiedJSON = await classifyTweetsInJSON(tweets);
    console.log("Classified tweets:", classifiedJSON);
    // press any key
    console.log("Press any key to continue...");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    });
    console.log("Generating response comments...");
    const finalJSON = await generateResponseCommentsForNegativeTweetsBatch(
      classifiedJSON
    );
    console.log("Generated response comments:", finalJSON);
    // press any key
    console.log("Press any key to continue...");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    });
    console.log("Posting replies...");
    await postRepliesFromJSON(finalJSON);
    console.log("Test classification and response comment result:");
    console.log(JSON.stringify(finalJSON, null, 2));
    console.log(
      "Test classification and response comment generation successful."
    );
  } catch (error) {
    console.error(
      "Error during test classification and comment generation:",
      error
    );
  }
};

module.exports = {
  fetchTweets,
  fetchReplies,
  classifyTweetsInJSON,
  generateResponseCommentsForNegativeTweetsBatch,
  postRepliesFromJSON,
  postReplyToTweet,
  test,
};
