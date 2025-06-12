// agenda/jobs/postReplyJob.js

let attemptedCount = 0;
let successCount = 0;

const BotModule   = require("../../models/Bot");
const Bot         = BotModule.default || BotModule;
const twitterCtrl = require("../../controllers/twitterController");
const AgendaModel = require("../../models/Agenda");

module.exports = (agenda) => {
  agenda.define("post-reply-to-tweet", async (job) => {
    attemptedCount++;

    const { tweet, agendaId } = job.attrs.data;
    if (!tweet.responseComment) {
      console.log(`ℹ️ Skipping tweet ${tweet.id}: no responseComment`);
      console.log(`✅ Tried ${attemptedCount} replies and succeeded ${successCount}.`);
      return;
    }

    try {
      console.log(`🔄 Job for tweet ${tweet.id}: attempting reply with BASIC bot…`);

      // 1) Load exactly the Basic bot (plan: "basic")
      const basicBot = await Bot.findOne({ plan: "basic" });
      if (!basicBot) {
        throw new Error("Basic bot not found in DB (plan='basic')");
      }

      // 2) Build credentials for the Basic bot
      const creds = {
        consumer: {
          key:    basicBot.apiKey,
          secret: basicBot.apiSecret
        },
        access: {
          key:    basicBot.accessToken,
          secret: basicBot.accessTokenSecret
        }
      };

      // 3) Post the reply using the Basic bot
      console.log(`🔗 Using Basic bot ${basicBot.botId} to reply to tweet ${tweet.id}`);
      const replyData = await twitterCtrl.postReplyToTweet(
        tweet.id,
        tweet.responseComment,
        creds
      );

      // 4) Ensure replyData.created_at exists
      if (!replyData.created_at) {
        replyData.created_at = new Date().toISOString();
      }

      // 5) Update Basic bot’s usage stats
      await Bot.updateOne(
        { botId: basicBot.botId },
        {
          $inc:  { replyCount: 1 },
          $set:  { lastUsedAt: new Date() }
        }
      );

      console.log(`✅ [basic botId=${basicBot.botId}] replied with id ${replyData.id}`);

      // 6) Save this reply in the Agenda document
      const agendaDoc = await AgendaModel.findById(agendaId);
      if (!agendaDoc) throw new Error("Agenda not found");

      agendaDoc.tweets.push({
        replyTweetId:      replyData.id,
        originalTweetId:   tweet.conversation_id || tweet.id,
        originalTweetText: tweet.text,
        responseComment:   tweet.responseComment,
        createdAt:         new Date(replyData.created_at),
        repliedByBot:      basicBot.botId
      });
      agendaDoc.updatedAt = new Date();
      await agendaDoc.save();

      successCount++;
      console.log(`✅ Tried ${attemptedCount} replies and succeeded ${successCount}.`);

    } catch (err) {
      // === Full error logging ===
      const status = err.response?.status;
      const body   = err.response?.data || err.response?.body?.text();
      console.error(
        `❌ Failed to reply to ${tweet.id} using Basic bot (status=${status}):\n`,
        JSON.stringify(body, null, 2)
      );
      console.log(`✅ Tried ${attemptedCount} replies and succeeded ${successCount}.`);
    }
  });
};