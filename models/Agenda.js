// models/Agenda.js
const mongoose = require("mongoose");

const AgendaSchema = new mongoose.Schema({
  title:       String,
  prompt:      String,
  createdBy:   String,
  
  tweets: [{
    replyTweetId:    String,
    originalTweetId: String,
    originalTweetText: String,
    responseComment: String,
    createdAt:       Date,

    engagement: {
    like_count: Number,
    retweet_count: Number,
    reply_count: Number,
    views_count: Number,
    fetchedAt: Date,
    }

  }],
  createdAt:   Date,
  updatedAt:   Date,
});


module.exports = mongoose.model("Agenda", AgendaSchema);
