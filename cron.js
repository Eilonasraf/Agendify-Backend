// Here’s a reminder of the “cron” piece we sketched out,
//  which you’ll run on the server to fill in that empty metricsHistory array:
// cron.js

/*
const axios = require("axios");
const Promotion = require("./models/Promotion");

// 1) Your update function—batch-fetches metrics for all replyTweetIds
async function updateAllReplyMetrics() {
  // Pull all replyTweetIds from the DB
  const promos = await Promotion.find(
    { "tweets.replyTweetId": { $exists: true } },
    { "tweets.replyTweetId": 1 }
  );

  // N reply IDs in total

  const ids = [...new Set(
    promos.flatMap(p => p.tweets.map(t => t.replyTweetId))
  )];  // length N

  // Process in batches of 100
  for (let i = 0; i < ids.length; i += 100) {
  
    // Slice the array into batches of 100
    // and join them into a comma-separated string

    const batch = ids.slice(i, i + 100).join(",");

    // Call Twitter API once for up to 100 IDs - one HTTP request
    // and get the public_metrics for each

    const resp = await axios.get("https://api.twitter.com/2/tweets", {
      params: {
        ids: batch,
        "tweet.fields": "public_metrics"
      },
      headers: { Authorization: `Bearer ${process.env.BEARER_TOKEN}` }
    });

    // For each returned tweet, append a new metrics record
    // Inner loop—**no more Twitter calls** here, just DB updates

    for (const tw of resp.data.data) {
      await Promotion.updateOne(
        { "tweets.replyTweetId": tw.id },
        {
          $push: {
            "tweets.$.metricsHistory": {
              fetchedAt: new Date(),
              ...tw.public_metrics
            }
          }
        }
      );
    }
  }
}

module.exports = { updateAllReplyMetrics };
*/