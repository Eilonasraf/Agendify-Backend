// scripts/update_views_DB.js

/**
 * סקריפט לעדכון חד פעמי של שדה `views_count` (impression_count) לכל הציוצים
 * השמורים כרגע ב־MongoDB (לכל ה־agendas שלך).
 *
 * prerequisites:
 *   - בקובץ `.env` שבתיקיית השורש של הפרויקט חייב להיות:
 *       DATABASE_URL=<Your MongoDB connection string>
 *       LOOKUP_BEARER_TOKEN=<Your Twitter “App‐Only” Bearer Token with Basic access>
 *   - התקנת המודולים הבאים:
 *       npm install mongoose axios dotenv
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import AgendaModel from '../models/Agenda.js';

async function main() {
  // 1) התחברות ל‐MongoDB
  await mongoose.connect(process.env.DATABASE_URL);
  console.log('✅ Connected to MongoDB');

  // 2) שליפת כל ה־agendas + צבירת כל replyTweetId
  const agendas = await AgendaModel.find({});
  const tweetIdSet = new Set();

  for (const agenda of agendas) {
    for (const t of agenda.tweets) {
      if (t.replyTweetId) {
        tweetIdSet.add(t.replyTweetId);
      }
    }
  }

  const allIds = Array.from(tweetIdSet);
  console.log(`🧠 Found ${allIds.length} unique tweet IDs in the database.`);

  if (!allIds.length) {
    console.log('אין ציוצים לעדכן.');
    await mongoose.disconnect();
    return;
  }

  // 3) נתב המזהים לבאצ׳ים של עד 100, ועד 15 בקשות (לפי מגבלות Basic plan: 15 lookups per 15 min)
  const BATCH_SIZE   = 100;
  const MAX_REQUESTS = 15;
  const batches      = [];

  for (let i = 0; i < allIds.length && batches.length < MAX_REQUESTS; i += BATCH_SIZE) {
    batches.push(allIds.slice(i, i + BATCH_SIZE));
  }

  // 4) עבור כל באצ׳, שליפה מ־Twitter ו־bulk write של views_count
  const bearer = process.env.LOOKUP_BEARER_TOKEN;
  if (!bearer) {
    console.error('❌ Missing LOOKUP_BEARER_TOKEN in .env');
    await mongoose.disconnect();
    process.exit(1);
  }

  let totalUpdated = 0;
  for (let idx = 0; idx < batches.length; idx++) {
    const batch = batches[idx];
    console.log(`\n🔄 Processing batch ${idx + 1}/${batches.length} (${batch.length} IDs)`);

    try {
      // 4a) בקשה ל-Twitter API לביצוע bulk lookup של public_metrics
      const resp = await axios.get('https://api.twitter.com/2/tweets', {
        params: {
          ids: batch.join(','),
          'tweet.fields': 'public_metrics' // כולל כבר את השדה impression_count
        },
        headers: { Authorization: `Bearer ${bearer}` }
      });

      const tweets = resp.data.data || [];
      console.log(`📊 Twitter returned metrics for ${tweets.length}/${batch.length} tweets`);

      // 4b) בניית פעולות bulkWrite לעדכון כל views_count
      const bulkOps = [];
      for (const tweet of tweets) {
        const id          = tweet.id;
        const metrics     = tweet.public_metrics || {};
        const impressions = metrics.impression_count ?? 0;

        // עדכון המסמך שמתאים ל־replyTweetId = id, וכתיבת views_count
        bulkOps.push({
          updateOne: {
            filter: { 'tweets.replyTweetId': id },
            update: {
              $set: {
                'tweets.$.engagement.views_count': impressions
              }
            }
          }
        });
      }

      if (bulkOps.length > 0) {
        const res = await AgendaModel.bulkWrite(bulkOps);
        totalUpdated += res.modifiedCount;
        console.log(`💾 Updated views_count for ${res.modifiedCount} tweets in this batch`);
      } else {
        console.log('ℹ️ No matching tweets to update in this batch');
      }

      // 4c) הדפסת נתוני rate-limit כדי לעקוב אחרי השימוש
      console.log('⏳ Rate limit:', {
        remaining: resp.headers['x-rate-limit-remaining'],
        reset:     new Date(parseInt(resp.headers['x-rate-limit-reset'], 10) * 1000).toISOString()
      });

    } catch (err) {
      if (err.response?.status === 429) {
        // Rate‐limited: נחכה עד שמועד האיפוס, ואז נחזור לנסות את אותו באצ׳
        const resetTime = parseInt(err.response.headers['x-rate-limit-reset'], 10) * 1000;
        const delay     = Math.max(resetTime - Date.now(), 0) + 1000;
        console.warn(`⏳ Rate limited. Waiting ${Math.ceil(delay / 1000)}s before retry...`);
        await new Promise(res => setTimeout(res, delay));
        idx--; // נדחוף חזרה את האינדקס כדי לנסות את הבאצ׳ שוב
      } else {
        console.error('❌ Twitter API Error:', err.response?.data || err.message);
      }
    }
  }

  // 5) ניתוק + סיכום
  console.log(`\n🎉 Finished updating views_count. Total tweets updated: ${totalUpdated}`);
  await mongoose.disconnect();
  console.log('✅ Disconnected from MongoDB');
  process.exit(0);
}

main().catch(err => {
  console.error('🚨 Fatal error in update_views_DB.js:', err);
  process.exit(1);
});