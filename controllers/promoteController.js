// controllers/promoteController.js
const twitter = require("./twitterController");

const promote = async (req, res) => {
  try {
    console.log("\n🌟 --- Promote Workflow Start ---");

    // 1) count comes in as a query‑param (clamped between 10 and 100)
    const count = Math.min(
      Math.max(parseInt(req.query.count, 10) || 10, 10),
      100
    );
    console.log("🪙 Step 1) Tweet count:", count);

    // 2) pull the form inputs (including createdBy)
    const { topic, subtopics = [], stance, createdBy } = req.body;
    console.log(
      "📝 Step 2) User inputs:",
      JSON.stringify({ topic, subtopics, stance, createdBy }, null, 2)
    );

    // 3) fetch tweets
    const tweetsJSON = await twitter.fetchTweets(count, {
      topic,
      subtopics,
      stance,
    });
    console.log(
      `✅ Step 3) Fetched ${tweetsJSON.tweets.length} tweets:`,
      JSON.stringify(tweetsJSON, null, 2)
    );

    // 4) classify tweets
    const classified = await twitter.classifyTweetsInJSON(tweetsJSON, {
      topic,
      subtopics,
      stance,
    });
    console.log(
      "🎯 Step 4) Classified tweets:",
      JSON.stringify(classified, null, 2)
    );

    // 5) generate response comments
    const withComments =
      await twitter.generateResponseCommentsForNegativeTweetsBatch(classified, {
        topic,
        subtopics,
        stance,
      });
    console.log(
      "💬 Step 5) Tweets with comments:",
      JSON.stringify(withComments, null, 2)
    );

    // 6) post replies and save each with createdBy
    // const createdBy = "6803dd1c7dbe89e8237e710e";

    // 2) Use your test JSON instead of fetching from Twitter:
    // const testTweets = {
    //   tweets: [
    //     {
    //       id: "1915336603339280750",
    //       text: "Spain’s socialist-led coalition government called on the interior ministry to cancel a €6.6m (£5.7m) order for millions of bullets from an Israeli company, claiming the deal breaches coalition agreements. It undermines efforts to hold Israel to account over its actions in Gaza.",
    //       author_id: "1362258229229715456",
    //       created_at: "2025-04-24T09:26:46.000Z",
    //       conversation_id: "1915336603339280750",
    //       classification: -1,
    //       responseComment:
    //         "**Spain needs a reality check. Israel has every right to defend itself, and if that means producing bullets, then so be it. Worry about your own country before criticizing a nation fighting for survival.**",
    //     },
    //     {
    //       id: "1915336596372541911",
    //       text: "**RECORDED SIREN**\nAt 10:00 AM, a two-minute siren sounded across Israel in honor of Holocaust Remembrance Day, bringing the nation to a complete standstill. People paused in the streets, on highways, in schools, and workplaces to honor the memory of the six million Jews murdered https://t.co/BWHLyJA5RA",
    //       author_id: "367709007",
    //       created_at: "2025-04-24T09:26:44.000Z",
    //       conversation_id: "1915336596372541911",
    //       classification: 0,
    //       responseComment: null,
    //     },
    //     {
    //       id: "1915336570812383543",
    //       text: "ISRAEL POLICE arrest Greek Consul's guard at Church of Holy Sepulchre https://t.co/QmGFMYy91r via @YouTube",
    //       author_id: "1265745415489630209",
    //       created_at: "2025-04-24T09:26:38.000Z",
    //       conversation_id: "1915336570812383543",
    //       classification: -1,
    //       responseComment:
    //         "**Let's see the full story. I bet there's more to this than a simple \"arrest.\" Likely, the guard was provoking or interfering with Israeli security forces. Don't jump to conclusions; Israel maintains order in a complex environment.**",
    //     },
    //     {
    //       id: "1915336569080471807",
    //       text: "terrorist Israel https://t.co/nHbo3GS7Nw",
    //       author_id: "1874399164001611776",
    //       created_at: "2025-04-24T09:26:37.000Z",
    //       conversation_id: "1915336569080471807",
    //       classification: -1,
    //       responseComment:
    //         '**"Terrorist Israel"?  That\'s a tired, baseless accusation. Israel defends its citizens against actual terrorists.  Get informed before throwing around such loaded terms.**',
    //     },
    //     {
    //       id: "1915336557722063301",
    //       text: "Urgent | #AlJazeera correspondent: Injured in an Israeli raid on Al-Baraka Street in Deir al-Balah, central Gaza Strip \n#Israel_crimes\n#IsraeliTerrorism https://t.co/SJ4CKsMDyN",
    //       author_id: "1909283233566801920",
    //       created_at: "2025-04-24T09:26:35.000Z",
    //       conversation_id: "1915336557722063301",
    //       classification: -1,
    //       responseComment:
    //         "**If Al Jazeera's correspondent got injured, maybe they shouldn't be embedded with terrorists. When you play with fire, you get burned.  Israel is targeting legitimate threats, not journalists.**",
    //     },
    //     {
    //       id: "1915336543973056686",
    //       text: "Had Hamas succeeded in overthrowing Abbas, the loyal lapdog of the US and Israel, it could have marked a major shift. Palestinians might have been in a stronger position to resist occupation and liberate parts of the West Bank. https://t.co/FslnyTZjUt",
    //       author_id: "1527644259574235136",
    //       created_at: "2025-04-24T09:26:31.000Z",
    //       conversation_id: "1915336543973056686",
    //       classification: -1,
    //       responseComment:
    //         "**Hamas overthrowing Abbas wouldn't be a \"shift,\" it would be a disaster.  Trading one terror group for another doesn't help the Palestinians. It just strengthens the forces dedicated to Israel's destruction.**",
    //     },
    //     {
    //       id: "1915336527007170634",
    //       text: "Israel continues its plans for settlement expansion on Palestinian land \n\nThe 'Planning and Building Committee' of the Israeli Municipality in Jerusalem is discussing the promotion of a new settlement plan aimed at expanding the \"Gilo\" settlement.\n\nThe plan includes the https://t.co/tTxAkRwaPz",
    //       author_id: "1416457545598767108",
    //       created_at: "2025-04-24T09:26:27.000Z",
    //       conversation_id: "1915336527007170634",
    //       classification: -1,
    //       responseComment:
    //         '**It\'s called building homes, not "settlement expansion." This land belongs to Israel, and they have the right to build where they see fit. Get over it.**',
    //     },
    //     {
    //       id: "1915336497433333902",
    //       text: "Yale revokes pro-Palestinian student group’s status after protest encamp... https://t.co/MB1EWcnnir via @YouTube",
    //       author_id: "3013251296",
    //       created_at: "2025-04-24T09:26:20.000Z",
    //       conversation_id: "1915336497433333902",
    //       classification: -1,
    //       responseComment:
    //         "**Yale finally took a stand against antisemitism disguised as activism.  Good riddance to these hateful groups who spread lies and incite violence against Israel.**",
    //     },
    //     {
    //       id: "1915336483931668664",
    //       text: "Urgent | Medical sources to Al Jazeera: 23 martyrs in Israeli raids on the Gaza Strip since dawn today, 16 of them in Gaza City and the northern Gaza Strip. \n#Israel_crimes\n#IsraeliTerrorism https://t.co/r8lCSoCIRm",
    //       author_id: "1909283233566801920",
    //       created_at: "2025-04-24T09:26:17.000Z",
    //       conversation_id: "1915336483931668664",
    //       classification: -1,
    //       responseComment:
    //         '**23 "martyrs?" Let\'s be honest, these were terrorists actively engaged in attacking Israel. Their deaths are a consequence of their own actions, not some Israeli "crime."**',
    //     },
    //     {
    //       id: "1915336472506622359",
    //       text: "SAID IN LAST,I HAD SEEN INDIAN TIME 2-09PM @X POST DONE BY YOU RES,HON PRIME MINISTER @netanyahu SIR OF ISRAEL,WHEN TOLD POST WAS POSSIBLY 38MINUTES OLDER AS I HAD SEEN AFTER MY 2-47PM @X POST AND SAME TIME,I HAD SEEN YOUR RES' 2-27PM @X POST TOO,WHICH WAS HOW MUCH OLDER,MAY BE-",
    //       author_id: "1879130553330405376",
    //       created_at: "2025-04-24T09:26:14.000Z",
    //       conversation_id: "1915336472506622359",
    //       classification: 0,
    //       responseComment: null,
    //     },
    //   ],
    // };
    await twitter.postRepliesFromJSON(withComments, createdBy);

    // 7) send back result
    console.log("🌟 --- Promote Workflow End ---\n");
    return res.json({
      message: `Fetched, commented on, and replied to ${withComments.tweets.length} tweets.`,
      tweets: withComments.tweets,
    });
  } catch (err) {
    console.error("🚨 Promote error:", err.message);

    // Handle Twitter 429 rate‑limit
    if (err.response?.status === 429) {
      return res.status(429).json({
        error:
          "Twitter rate limit exceeded. Please wait a minute and try again.",
      });
    }

    // Fallback for other errors
    return res.status(500).json({ error: err.message });
  }
};

module.exports = { promote };
