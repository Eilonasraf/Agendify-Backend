const twitter = require("./twitterController");
const Agenda = require("../models/Agenda");

function unwrap(r) {
  if (!r) return "";
  if (typeof r === "string") return r;
  return (
    r.comment ??
    r.reply ??
    Object.values(r).find((v) => typeof v === "string") ??
    ""
  );
}

/**
 * POST /api/twitter/promote
 *  - Fetches tweets, classifies and generates response suggestions.
 *  - Stores only Agenda metadata and returns suggested tweets to front-end.
 */
exports.promote = async (req, res) => {
  try {
    console.log("\n🌟 --- Promote Workflow Start ---");

    // 1) clamp & parse tweet count
    const count = Math.min(
      Math.max(parseInt(req.query.count, 10) || 10, 10),
      100
    );
    console.log("🪙 Step 1) Tweet count:", count);

    // 2) pull inputs
    const { prompt, stance, createdBy, agendaId } = req.body;
    console.log("📝 Step 2) Inputs:", { prompt, stance, createdBy, agendaId });

    // 3) fetch tweets & rate-limit
    const { tweets, rateLimit } = await twitter.fetchTweets(count, {
      topic: prompt,
      stance,
    });
    console.log(`✅ Step 3) Fetched ${tweets.length} tweets`);

    // 4) classify
    const classified = await twitter.classifyTweetsInJSON(
      { tweets },
      { topic: prompt, stance }
    );
    console.log("🎯 Step 4) Classified tweets");

    // 5) comment
    const withComments =
      await twitter.generateResponseCommentsForNegativeTweetsBatch(classified, {
        topic: prompt,
        stance,
      });
    console.log("💬 Step 5) Generated reply suggestions");

    // 6) upsert Agenda metadata only
    let agenda;
    if (agendaId) {
      agenda = await Agenda.findById(agendaId);
      if (!agenda) return res.status(404).json({ error: "Agenda not found" });
      agenda.updatedAt = new Date();
      await agenda.save();
      console.log("✔ Updated existing Agenda metadata");
    } else {
      agenda = await Agenda.findOneAndUpdate(
        { createdBy, prompt },
        {
          $setOnInsert: { createdAt: new Date() },
          updatedAt: new Date(),
          prompt,
        },
        { upsert: true, new: true }
      );
      try {
        const { generateGeminiDescription } = require("../services/aiService");
        agenda.title = await generateGeminiDescription(
          `Summarize into a 5-word title:\n"\${prompt}"`
        );
      } catch {
        agenda.title = prompt.slice(0, 40) + (prompt.length > 40 ? "…" : "");
      }
      await agenda.save();
      console.log("✔ Created new Agenda metadata:", agenda._id);
    }

    return res.json({
      message: `Fetched ${withComments.tweets.length} reply suggestions`,
      agendaId: agenda._id,
      title: agenda.title,
      tweets: withComments.tweets.map((t) => ({
        id: t.id,
        conversation_id: t.conversation_id,
        text: t.text,
        responseComment: unwrap(t.responseComment),
        created_at: t.created_at,
      })),
      rateLimit,
    });
  } catch (err) {
    console.error("🚨 Promote error:", err);
    if (err.response?.status === 429) {
      return res
        .status(429)
        .json({ error: "Twitter rate limit exceeded. Try again shortly." });
    }
    return res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/twitter/postToX
 *  - Takes agendaId, suggestions[], twitterUserId
 *  - Posts each reply to Twitter, then appends only those that succeeded to Agenda
 */
exports.postToXHandler = async (req, res) => {
  try {
    const { agendaId, tweets, twitterUserId } = req.body;
    if (!agendaId || !Array.isArray(tweets) || !twitterUserId) {
      return res.status(400).json({
        error: "Must include agendaId, tweets array and twitterUserId",
      });
    }

    const postedReplies = [];
    for (const t of tweets) {
      if (!t.responseComment) continue;
      try {
        const replyData = await twitter.postReplyToTweet(
          t.id || t.replyTweetId,
          t.responseComment
        );
        const createdAt = replyData.created_at
          ? new Date(replyData.created_at)
          : new Date();
        postedReplies.push({
          replyTweetId: replyData.id,
          originalTweetId: t.conversation_id || t.originalTweetId,
          originalTweetText: t.text || t.originalTweetText,
          responseComment: t.responseComment,
          createdAt,
        });
      } catch (err) {
        console.error(
          `❌ Failed to post reply for ${t.id}:`,
          err.message || err
        );
      }
    }

    // Manually append via spread operator instead of Mongo update operators
    const agenda = await Agenda.findById(agendaId);
    if (!agenda) return res.status(404).json({ error: "Agenda not found" });
    agenda.tweets = [...agenda.tweets, ...postedReplies];
    agenda.updatedAt = new Date();
    await agenda.save();

    return res.json({
      message: `Posted and saved ${postedReplies.length} replies.`,
      posted: postedReplies,
    });
  } catch (err) {
    console.error("❌ postToXHandler error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
