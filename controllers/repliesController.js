const Tweet = require('../models/Tweet');
const replies = require('../models/replies');

/**
 * Create a new reply
 * @route POST /api/replies
 */
const createreplies = async (req, res) => {
  const { postId, content, author } = req.body;
  try {
    const reply = new replies({ postId, content, author });
    await reply.save();
    res.status(201).json(reply);
  } catch (err) {
    console.error('Error creating reply:', err.message);
    res.status(500).json({ error: 'Error creating reply' });
  }
};

/**
 * Get replies (filtered by postId if provided)
 * @route GET /api/replies
 */
const getreplies = async (req, res) => {
  const { postId } = req.query;
  try {
    const query = postId ? { postId } : {};
    const repliess = await replies.find(query).limit(20); // Limit to 20 replies
    res.json(repliess);
  } catch (err) {
    console.error('Error fetching replies:', err.message);
    res.status(500).json({ error: 'Error fetching replies' });
  }
};

/**
 * Update a reply by ID
 * @route PUT /api/replies/:id
 */
const updatereplies = async (req, res) => {
  const { content } = req.body;
  try {
    const reply = await replies.findByIdAndUpdate(req.params.id, { content }, { new: true });
    if (!reply) {
      return res.status(404).json({ message: 'Reply not found' });
    }
    res.json(reply);
  } catch (err) {
    console.error('Error updating reply:', err.message);
    res.status(500).json({ error: 'Error updating reply' });
  }
};

/**
 * Delete a reply by ID
 * @route DELETE /api/replies/:id
 */
const deletereplies = async (req, res) => {
  try {
    const reply = await replies.findByIdAndDelete(req.params.id);
    if (!reply) {
      return res.status(404).json({ message: 'Reply not found' });
    }
    res.json({ message: 'Reply deleted successfully' });
  } catch (err) {
    console.error('Error deleting reply:', err.message);
    res.status(500).json({ error: 'Error deleting reply' });
  }
};

/**
 * Add a reply to a tweet
 * @route POST /api/replies/:tweetId/replies
 */
const addReply = async (req, res) => {
  const { tweetId } = req.params; // Tweet ID from URL params
  const { content } = req.body; // Reply content from the request body
  const loggedInUser = req.user; // User info from the authentication middleware

  if (!loggedInUser) {
    return res.status(401).json({ error: 'Unauthorized. Please log in to reply.' });
  }

  try {
    // Check if the tweet exists
    const tweet = await Tweet.findOne({ id: tweetId });
    if (!tweet) {
      return res.status(404).json({ error: 'Tweet not found' });
    }

    // Create the reply
    const newReply = await replies.create({
      postId: tweetId,
      content,
      author: loggedInUser.username, // Set the author's username from the logged-in user
      in_reply_to_user_id: tweet.author_id, // Link reply to the tweet's author
    });

    res.status(201).json({ message: 'Reply added successfully', reply: newReply });
  } catch (err) {
    console.error('Error adding reply:', err.message);
    res.status(500).json({ error: 'Error adding reply' });
  }
};

module.exports = {
  createreplies,
  getreplies,
  updatereplies,
  deletereplies,
  addReply,
};
