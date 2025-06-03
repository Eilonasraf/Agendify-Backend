// controllers/promoteController.js

const botManager = require("../services/botManager");
const Agenda     = require("../models/Agenda");
const agendaInstance = require("../agenda/agendaInstance");

function unwrap(r) {
  if (!r) return "";
  if (typeof r === "string") return r;
  return (
    r.comment ??
    r.reply   ??
    Object.values(r).find((v) => typeof v === "string") ??
    ""
  );
}

exports.promote = async (req, res) => {
  try {
    console.log("\n🌟 --- Promote Workflow Start ---");

    const count = Math.min(Math.max(parseInt(req.query.count, 10) || 10, 10), 100);
    const { prompt, stance, createdBy, agendaId } = req.body;
    console.log("📝 Inputs:", { prompt, stance, createdBy, agendaId });

    const { tweets, rateLimit } = await botManager.fetchTweets(
      count,
      { topic: prompt, stance }
    );
    console.log(`✅ Fetched ${tweets.length} tweets`);

    const classified = await botManager.classifyTweetsInJSON(
      { tweets },
      { topic: prompt, stance }
    );
    console.log("🎯 Classified tweets");

    const withComments = await botManager.generateResponseCommentsForNegativeTweetsBatch(
      classified,
      { topic: prompt, stance }
    );
    console.log("💬 Generated reply suggestions");

    let agenda;
    if (agendaId) {
      agenda = await Agenda.findById(agendaId);
      if (!agenda) return res.status(404).json({ error: "Agenda not found" });
      agenda.updatedAt = new Date();
      await agenda.save();
    } else {
      agenda = await Agenda.findOneAndUpdate(
        { createdBy, prompt },
        {
          $setOnInsert: { createdAt: new Date() },
          updatedAt: new Date(),
          prompt
        },
        { upsert: true, new: true }
      );
      try {
        agenda.title = await botManager.generateTrendingTopics();
      } catch {
        agenda.title = prompt.slice(0, 40) + (prompt.length > 40 ? "…" : "");
      }
      await agenda.save();
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
      return res.status(429).json({ error: "Twitter rate limit exceeded. Try again shortly." });
    }
    return res.status(500).json({ error: err.message });
  }
};

exports.postToXHandler = async (req, res) => {
  try {
    const { agendaId, tweets, twitterUserId } = req.body;
    if (!agendaId || !Array.isArray(tweets) || !twitterUserId) {
      return res.status(400).json({ error: "Must include agendaId, tweets array and twitterUserId" });
    }

    for (let i = 0; i < tweets.length; i++) {
      const t = tweets[i];
      if (!t.responseComment) continue;

      const delayMs = i * 3000; // 30 seconds apart
      const when = new Date(Date.now() + delayMs);

      await agendaInstance.schedule(when, "post-reply-to-tweet", {
        tweet: t,
        agendaId,
      });
      console.log(`⏰ Scheduled reply to ${t.id} at ${when.toLocaleTimeString()}`);
    }

    const agenda = await Agenda.findById(agendaId);
    if (!agenda) return res.status(404).json({ error: "Agenda not found" });
    agenda.updatedAt = new Date();
    await agenda.save();

    return res.json({
      message: `Scheduled ${tweets.length} replies (1 per minute).`,
      agendaId,
    });

  } catch (err) {
    console.error("❌ postToXHandler error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
