const axios = require('axios');
const Tweet = require('../models/Tweet'); // Tweet schema
const Reply = require('../models/replies'); // Reply schema

// Function to fetch and save tweets
const fetchTweets = async (req, res) => {
  const { query } = req.query;

  try {
    const response = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
      params: {
        query: query || 'israel',
        'tweet.fields': 'author_id,created_at,conversation_id',
        max_results: 10,
      },
      headers: {
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
      },
    });

    console.log('Twitter API Response:', response.data); // Debugging log

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
    console.error('Error fetching tweets:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Error fetching tweets',
      details: error.response?.data || error.message,
    });
  }
};

const fetchReplies = async (req, res) => {
  try {
    // Extract conversation_id from the query params
    const { conversation_id } = req.query;

    if (!conversation_id) {
      return res.status(400).json({ error: 'conversation_id is required' });
    }

    // Make a request to Twitter API for the specific conversation_id
    const repliesResponse = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
      params: {
        query: `conversation_id:${conversation_id} -is:retweet`,
        'tweet.fields': 'author_id,created_at,in_reply_to_user_id',
        max_results: 5,
      },
      headers: {
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
      },
    });

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
    console.error('Error fetching replies:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Error fetching replies for the given conversation_id',
      details: error.response?.data || error.message,
    });
  }
};

module.exports = { fetchTweets, fetchReplies };