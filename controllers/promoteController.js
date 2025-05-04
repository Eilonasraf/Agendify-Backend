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

    // 3) fetch tweets **and** rate-limit info
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
      await twitter.generateResponseCommentsForNegativeTweetsBatch(
        classified,
        { topic: prompt, stance }
      );
    console.log("💬 Step 5) Tweets with comments");

    // build the array to save
    const repliesArray = withComments.tweets.map((t) => ({
      replyTweetId: t.id,
      originalTweetId: t.conversation_id,
      originalTweetText: t.text,
      responseComment: unwrap(t.responseComment),
      createdAt: new Date(t.created_at),
    }));

    // 6a) if appending
    if (agendaId) {
      const cluster = await Agenda.findById(agendaId);
      if (!cluster) return res.status(404).json({ error: "Cluster not found" });
      cluster.tweets.push(...repliesArray);
      cluster.updatedAt = new Date();
      await cluster.save();

      // do not post yet—front end will call /postToX
      console.log("✔ Appended replies to existing cluster");
      return res.json({
        message: `Appended ${repliesArray.length} reply suggestions`,
        agendaId,
        title: cluster.title,
        tweets: withComments.tweets,
        rateLimit,
      });
    }

    // 6b) otherwise new cluster
    const agenda = await Agenda.findOneAndUpdate(
      { createdBy, prompt },
      {
        $setOnInsert: { createdAt: new Date() },
        $push: { tweets: { $each: repliesArray } },
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // generate a short title
    let agendaTitle;
    try {
      const { generateGeminiDescription } = require("../services/aiService");
      agendaTitle = await generateGeminiDescription(
        `Summarize into a 5-word title:\n"${prompt}"`
      );
    } catch {
      agendaTitle = prompt.slice(0, 40) + (prompt.length > 40 ? "…" : "");
    }
    agenda.title = agendaTitle;
    agenda.prompt = prompt;
    await agenda.save();

    console.log("✔ Created new Agenda:", agenda._id);
    return res.json({
      message: `Created cluster and generated ${withComments.tweets.length} replies.`,
      agendaId: agenda._id,
      title: agendaTitle,
      tweets: withComments.tweets,
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
 *   - Takes agendaId + tweets[], **actually posts** to X _and_ appends to MongoDB.
 */
exports.postToXHandler = async (req, res) => {
  try {
    const { agendaId, tweets, twitterUserId } = req.body;
    if (!agendaId || !Array.isArray(tweets) || !twitterUserId) {
      return res.status(400).json({
        error: "Must include agendaId, tweets array and twitterUserId",
      });
    }

    // save into Agenda
    await Agenda.findByIdAndUpdate(agendaId, {
      $push: {
        tweets: tweets.map(t => ({
          replyTweetId:  t.id,
          responseComment: t.responseComment,
          createdAt:     new Date(),
        }))
      },
      updatedAt: new Date(),
    });

    // post on X
    await twitter.postRepliesFromJSON({ tweets }, twitterUserId);

    return res.json({ message: `Posted and saved ${tweets.length} replies.` });
  } catch (err) {
    console.error("❌ postToX error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
