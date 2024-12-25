const mongoose = require('mongoose');

const repliesSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  postId: { type: String, required: true }, // Tweet ID
  content: { type: String, required: true }, // Reply content
  author: { type: String, required: true }, // Author's name or ID
  createdAt: { type: Date, default: Date.now }, // Date of reply creation
  in_reply_to_user_id: { type: String }, // User ID the reply is directed to
});

module.exports = mongoose.model('replies', repliesSchema);
