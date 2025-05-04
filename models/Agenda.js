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
  }],
  createdAt:   Date,
  updatedAt:   Date,
});


module.exports = mongoose.model("Agenda", AgendaSchema);
