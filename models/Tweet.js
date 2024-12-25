const mongoose = require('mongoose');

const TweetSchema = new mongoose.Schema({
  id: { type: String, unique: true }, // Unique tweet ID
  text: String, // Tweet content
  author_id: String, // Author's ID
  created_at: Date, // Date of tweet creation
  conversation_id: String, // Conversation ID for threads
  replies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'replies' }], // References to replies
}, { timestamps: true });

module.exports = mongoose.model('Tweet', TweetSchema);
