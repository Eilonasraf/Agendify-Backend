const axios = require("axios");
const Tweet = require("../models/Tweet"); // Tweet schema
const Reply = require("../models/replies"); // Reply schema
const { generateGeminiDescription } = require("../services/aiService"); // Gemini AI service

// Function to fetch and save tweets
const fetchTweets = async (req, res) => {
  const { query } = req.query;

  try {
    const response = await axios.get(
      "https://api.twitter.com/2/tweets/search/recent",
      {
        params: {
          query:
            '("Israel Gaza" OR #Israel OR #Gaza OR #IsraelUnderAttack OR #GazaWar) lang:en -is:retweet',
          "tweet.fields":
            "author_id,created_at,conversation_id,public_metrics,text",
          max_results: 10,
        },
        headers: {
          Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
        },
      }
    );

    console.log("Twitter API Response:", response.data); // Debugging log

    const tweets = response.data.data || [];
    const savedTweets = [];

    for (let tweet of tweets) {
      const savedTweet = await Tweet.findOneAndUpdate(
        { id: tweet.id },
        {
          id: tweet.id,
          text: tweet.text,
          author_id: tweet.author_id,
          created_at: new Date(tweet.created_at),
          conversation_id: tweet.conversation_id,
        },
        { upsert: true, new: true }
      );
      savedTweets.push(savedTweet);
    }

    res.json({ tweets: savedTweets });
  } catch (error) {
    console.error(
      "Error fetching tweets:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Error fetching tweets",
      details: error.response?.data || error.message,
    });
  }
};

const fetchReplies = async (req, res) => {
  try {
    // Extract conversation_id from the query params
    const { conversation_id } = req.query;

    if (!conversation_id) {
      return res.status(400).json({ error: "conversation_id is required" });
    }

    // Make a request to Twitter API for the specific conversation_id
    const repliesResponse = await axios.get(
      "https://api.twitter.com/2/tweets/search/recent",
      {
        params: {
          query: `conversation_id:${conversation_id} -is:retweet`,
          "tweet.fields": "author_id,created_at,in_reply_to_user_id",
          max_results: 5,
        },
        headers: {
          Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
        },
      }
    );

    // Parse the replies
    const replies = repliesResponse.data.data || [];

    // Save the replies in the database
    const savedReplies = [];
    for (let reply of replies) {
      const savedReply = await Reply.findOneAndUpdate(
        { id: reply.id },
        {
          id: reply.id,
          postId: conversation_id, // Associate with the provided conversation_id
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
 * Classifies a tweet’s sentiment toward Israel.
 * Returns 1 if the tweet is in favor of Israel,
 * -1 if it is against Israel, and 0 if neutral.
 * @param tweetText The tweet's content.
 * @returns A number: 1, -1, or 0.
 */
const classifyTweetSentiment = async (tweetText) => {
  // Construct a prompt that instructs Gemini to analyze and return only a number.
  const prompt = `Analyze the following tweet for its sentiment toward Israel.
If the tweet is in favor of Israel, respond with only "1".
If the tweet is against Israel, respond with only "-1".
If the tweet is neutral or ambiguous, respond with only "0".
Tweet: "${tweetText}"`;

  try {
    // Call your existing Gemini description generator.
    const responseText = await generateGeminiDescription(prompt);
    // Clean and parse the response.
    const trimmed = responseText.trim();
    const classification = parseInt(trimmed, 10);
    if ([1, -1, 0].includes(classification)) {
      return classification;
    }
    throw new Error(`Unexpected classification result: ${trimmed}`);
  } catch (error) {
    console.error("Error classifying tweet sentiment:", error);
    throw error;
  }
};

/**
 * Test function to classify tweet sentiment.
 * @param {string} tweetContent - The tweet text to classify.
 */
const testTweetClassification = async (tweetContent) => {
  try {
    const sentiment = await classifyTweetSentiment(tweetContent);
    console.log(`Tweet: "${tweetContent}"`);
    console.log(`Sentiment classification: ${sentiment}`);
  } catch (error) {
    console.error("Error during tweet classification:", error);
  }
};

// Example usage:
//const exampleTweet =
//  "The IDF Arabic-language spokesman has instructed the residents of nearly all of Rafah to evacuate immediately.\n\nThis is the most extensive evacuation order since hostilities resumed earlier this month.#Gaza #Palestine #Rafah #Israel #evacuation #war #conflict https://t.co/OXFxqbuNuk";
//testTweetClassification(exampleTweet);

module.exports = { fetchTweets, fetchReplies };