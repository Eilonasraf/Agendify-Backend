// c_p_check.js
//
// Usage:   node c_p_check.js <tweet_id>
// Example: node c_p_check.js 1928793459994902815
//
// This script verifies whether your “Basic” bot is permitted to reply to a given Tweet.
// It checks three things in order:
//   1) Tweet’s reply_settings must be “everyone”
//   2) Author’s account must NOT be protected
//   3) (If possible) Author must NOT have blocked your bot
//
// Because Basic-tier apps do NOT have full v1.1 “friendships/show” access, we catch any
// “453” or “Unsupported Authentication” and assume “not blocked” if we cannot verify.
//
// Required ENV vars (in .env):
//   • API_KEY
//   • API_KEY_SECRET
//   • ACCESS_TOKEN
//   • ACCESS_TOKEN_SECRET
//   • BEARER_TOKEN

import axios from "axios";
import OAuth from "oauth-1.0a";
import crypto from "crypto";
import "dotenv/config";

// ────────────────────────────────────────────────────────────────────────────────
// 1) Load and verify required environment variables
const {
  API_KEY,
  API_KEY_SECRET,
  ACCESS_TOKEN,
  ACCESS_TOKEN_SECRET,
  BEARER_TOKEN
} = process.env;

if (
  !API_KEY ||
  !API_KEY_SECRET ||
  !ACCESS_TOKEN ||
  !ACCESS_TOKEN_SECRET ||
  !BEARER_TOKEN
) {
  console.error(`
❌ Missing one or more required environment variables.
Please ensure your .env contains:
  • API_KEY
  • API_KEY_SECRET
  • ACCESS_TOKEN
  • ACCESS_TOKEN_SECRET
  • BEARER_TOKEN
`);
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────────────────
// 2) Fetch the Tweet (v2) to get author_id + reply_settings
async function fetchTweetV2(tweetId) {
  try {
    const resp = await axios.get("https://api.twitter.com/2/tweets", {
      params: {
        ids: tweetId,
        "tweet.fields": "author_id,reply_settings"
      },
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`
      }
    });
    if (!resp.data || !Array.isArray(resp.data.data) || resp.data.data.length === 0) {
      console.error(`⚠️ Tweet ${tweetId} not found or not accessible via v2.`);
      process.exit(1);
    }
    return resp.data.data[0];
  } catch (err) {
    console.error("❌ Error fetching Tweet via v2:", err.response?.data || err.message);
    process.exit(1);
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// 3) Fetch the Author (v2) to get username + protected flag
async function fetchUserV2(userId) {
  try {
    const resp = await axios.get(`https://api.twitter.com/2/users/${userId}`, {
      params: { "user.fields": "username,protected" },
      headers: { Authorization: `Bearer ${BEARER_TOKEN}` }
    });
    return resp.data.data;
  } catch (err) {
    console.error("❌ Error fetching Author via v2:", err.response?.data || err.message);
    process.exit(1);
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// 4) Use OAuth1.0a to call v1.1 verify_credentials (to learn the bot’s own user-ID)
const oauthV1 = OAuth({
  consumer: { key: API_KEY, secret: API_KEY_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  }
});

async function fetchBotProfileV1() {
  try {
    const url = "https://api.twitter.com/1.1/account/verify_credentials.json";
    const request_data = { url, method: "GET" };
    const authHeader = oauthV1.toHeader(
      oauthV1.authorize(request_data, {
        key: ACCESS_TOKEN,
        secret: ACCESS_TOKEN_SECRET
      })
    );
    const resp = await axios.get(url, { headers: authHeader });
    return resp.data;
  } catch (err) {
    console.error(
      "❌ Unable to fetch Basic-bot profile (verify_credentials):",
      err.response?.data || err.message
    );
    process.exit(1);
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// 5) Attempt v1.1 friendships/show to see if author has blocked the bot.
//    If we see a “code=453” inside errors[0], or an “Unsupported Authentication”
//    message, we treat that as “cannot verify block-status under Basic-tier”,
//    so we assume “not blocked.”
async function authorBlockedBot(botUserId, authorId) {
  try {
    const url = "https://api.twitter.com/1.1/friendships/show.json";
    const params = new URLSearchParams({
      source_id: botUserId,
      target_id: authorId
    }).toString();
    const request_data = {
      url: `${url}?${params}`,
      method: "GET"
    };

    const authHeader = oauthV1.toHeader(
      oauthV1.authorize(request_data, {
        key: ACCESS_TOKEN,
        secret: ACCESS_TOKEN_SECRET
      })
    );

    const resp = await axios.get(url, {
      params: { source_id: botUserId, target_id: authorId },
      headers: authHeader
    });

    const rel = resp.data.relationship;
    return !!(rel.source && rel.source.blocked_by);
  } catch (err) {
    const e = err.response?.data;
    // Some Basic-tier apps return code=453 with nested errors array
    if (
      e &&
      Array.isArray(e.errors) &&
      e.errors[0].code === 453
    ) {
      console.warn(
        "⚠️ Cannot verify block-status under Basic-tier (453). Assuming author has NOT blocked the bot."
      );
      return false;
    }
    // Or they might return an “Unsupported Authentication” name
    if (
      e &&
      typeof e.title === "string" &&
      e.title.toLowerCase().includes("unsupported authentication")
    ) {
      console.warn(
        "⚠️ Cannot verify block-status under Basic-tier (“Unsupported Authentication”). Assuming author has NOT blocked the bot."
      );
      return false;
    }
    // Otherwise, it's some other unexpected error
    console.error("❌ Unexpected error calling v1.1 friendships/show:", e || err.message);
    process.exit(1);
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// 6) Main
(async () => {
  const tweetId = process.argv[2];
  if (!tweetId) {
    console.error("❌ Usage: node c_p_check.js <tweet_id>");
    process.exit(1);
  }

  console.log(`\n→ Checking Tweet ID: ${tweetId}\n`);

  // Fetch tweet
  const tweetData = await fetchTweetV2(tweetId);
  console.log(`→ Tweet’s reply_settings: ${tweetData.reply_settings}`);
  console.log(`→ Author user-ID: ${tweetData.author_id}\n`);

  // Fetch author
  const userData = await fetchUserV2(tweetData.author_id);
  console.log(`→ Author username: @${userData.username}`);
  console.log(`→ Author protected?: ${userData.protected}\n`);

  // Fetch bot profile (v1.1)
  const botProfile = await fetchBotProfileV1();
  const botUserId  = botProfile.id_str;
  console.log(`→ Basic-bot’s user-ID: ${botUserId}\n`);

  // Check if author has blocked bot
  console.log("→ Checking if author has blocked the bot…");
  const isBlocked = await authorBlockedBot(botUserId, tweetData.author_id);
  console.log(`→ Author has blocked Basic-bot? ${isBlocked}\n`);

  // Final verdict
  console.log("—— Final Verdict ——");
  if (userData.protected) {
    console.log("   • Author’s account is PROTECTED. You cannot reply.");
  } else if (tweetData.reply_settings !== "everyone") {
    console.log(
      `   • Tweet’s reply_settings = "${tweetData.reply_settings}". You cannot reply.`
    );
  } else if (isBlocked) {
    console.log("   • Author has BLOCKED the bot. You cannot reply.");
  } else {
    console.log("✅ All checks passed: The bot should be permitted to reply.");
  }
  process.exit(0);
})();
