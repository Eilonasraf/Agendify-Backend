// loads all defined job handlers

// 📁 agenda/loadJobs.js
const postReplyJob = require("./jobs/postReplyJob");

module.exports = (agenda) => {
  postReplyJob(agenda);
};