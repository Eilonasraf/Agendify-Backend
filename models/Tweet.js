const mongoose = require("mongoose");

const TweetSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true }, // Unique tweet (or reply) ID
    text: String, // Text of the tweet or reply
    author_id: String, // Author’s user ID
    created_at: Date, // When this tweet/reply was created
    conversation_id: String, // Thread/conversation ID
    responseComment: String, // The AI‑generated comment you posted
    originalTweetId: String, // ID of the tweet you replied to
    originalTweetText: String, // Text of the tweet you replied to
    originalTweetAuthorId: String, // Author ID of the original tweet
    originalTweetCreatedAt: Date, // Creation time of the original tweet
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Your web‑app user ID
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Tweet", TweetSchema);
