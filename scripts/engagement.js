// scripts/engagement.js

/**
 * סקריפט שמתזמן עדכוני engagement חד־יומיים עבור כל ציוץ חדש שנוצר מאז חצות UTC,
 * ועכשיו כולל גם עדכון של שדה `views_count` (impression_count).
 *
 * prerequisites:
 *   - בקובץ `.env` בתיקיית השורש של הפרויקט:
 *       DATABASE_URL=<Your MongoDB URI>
 *       LOOKUP_BEARER_TOKEN=<Your Twitter App-Only Bearer Token>
 *   - התקנת המודולים:
 *       npm install mongoose axios dotenv
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import AgendaModel from '../models/Agenda.js';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  // 1) התחברות למונגו
  await mongoose.connect(process.env.DATABASE_URL);
  console.log('✅ Connected to MongoDB');

  // 2) חישוב “תחילת היום ב־UTC” (00:00:00 UTC)
  const now = new Date();
  const utcTodayStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0
  ));

  // 3) שלוף את כל ה־agendas וצבור מיפוי של <replyTweetId → { agenda, index }>
  //    רק עבור ציוצים (tweets) שנוצרו מאז חצות UTC ועדיין לא עודכנו היום
  const agendas = await AgendaModel.find({});
  const tweetMap = new Map(); // replyTweetId → { agenda, index }

  for (const agenda of agendas) {
    agenda.tweets.forEach((t, index) => {
      if (!t.replyTweetId || !t.createdAt) return;

      let tweetCreatedAt;
      try {
        tweetCreatedAt = new Date(t.createdAt).getTime();
      } catch (e) {
        console.error(`Invalid date for tweet ${t._id}:`, e.message);
        return;
      }

      // LastFetched הוא זמן העדכון האחרון בשדה engagement.fetchedAt, אם קיים
      const lastFetched = t.engagement?.fetchedAt
        ? new Date(t.engagement.fetchedAt).getTime()
        : 0;

      // רק אם ציוץ נוצר ≥ חצות היום (UTC) ועדיין לא עודכן היום (lastFetched < חצות)
      if (
        tweetCreatedAt >= utcTodayStart.getTime() &&
        lastFetched < utcTodayStart.getTime()
      ) {
        tweetMap.set(t.replyTweetId, { agenda, index });
      }
    });
  }

  // 4) המרת המזהים ל־Array ועד הדפסת כמות הציוצים החדשים שדורשים עדכון
  const allIds = Array.from(tweetMap.keys());
  console.log(`🧠 Found ${allIds.length} tweets (created today) needing updates.`);

  if (!allIds.length) {
    console.log('No tweets require updating.');
    await mongoose.disconnect();
    return;
  }

  // 5) פרוק ל-batches של עד 100 IDs (עד 15 בקשות, לפי מגבלות Basic)
  const BATCH_SIZE   = 100;
  const MAX_REQUESTS = 15; 
  const batches      = [];

  for (let i = 0; i < allIds.length && batches.length < MAX_REQUESTS; i += BATCH_SIZE) {
    batches.push(allIds.slice(i, i + BATCH_SIZE));
  }

  // 6) עבור כל באצ׳, קרא ל-Twitter וכתוב את ה-bulkWrite
  const bearer = process.env.LOOKUP_BEARER_TOKEN;
  if (!bearer) throw new Error('Missing LOOKUP_BEARER_TOKEN in .env');

  let processed = 0;
  for (let idx = 0; idx < batches.length; idx++) {
    const batch = batches[idx];
    console.log(`\n🔄 Processing batch ${idx + 1}/${batches.length} (${batch.length} tweets)`);

    try {
      // 6a) קריאה ל-Twitter API לקבלת public_metrics (כולל impression_count)
      const resp = await axios.get('https://api.twitter.com/2/tweets', {
        params: {
          ids: batch.join(','),
          'tweet.fields': 'public_metrics'
        },
        headers: { Authorization: `Bearer ${bearer}` }
      });

      const tweets = resp.data.data || [];
      console.log(`📊 Fetched metrics for ${tweets.length}/${batch.length} tweets`);

      // 6b) בניית פעולות bulkWrite לעדכון כל שדות ה-engagement (לייקים, ריטוויטים, תגובות + Views)
      const bulkOps = [];
      tweets.forEach(tweet => {
        // מצא את המיקום ב־tweetMap
        const entry = tweetMap.get(tweet.id);
        if (!entry) return;

        const { agenda, index } = entry;
        const pm = tweet.public_metrics || {};
        const impressions = pm.impression_count ?? 0;

        bulkOps.push({
          updateOne: {
            filter: { _id: agenda._id, 'tweets._id': agenda.tweets[index]._id },
            update: {
              $set: {
                'tweets.$.engagement.like_count':   pm.like_count ?? 0,
                'tweets.$.engagement.retweet_count': pm.retweet_count ?? 0,
                'tweets.$.engagement.reply_count':   pm.reply_count ?? 0,
                'tweets.$.engagement.views_count':   impressions,
                'tweets.$.engagement.fetchedAt':     new Date().toISOString()
              }
            }
          }
        });
      });

      if (bulkOps.length > 0) {
        const res = await AgendaModel.bulkWrite(bulkOps);
        processed += res.modifiedCount;
        console.log(`💾 Updated engagement for ${res.modifiedCount} tweets in this batch`);
      } else {
        console.log('ℹ️ No new engagement to update in this batch');
      }

      // 6c) הדפסת נתוני rate-limit
      console.log('⏳ Rate limit:', {
        remaining: resp.headers['x-rate-limit-remaining'],
        reset:     new Date(parseInt(resp.headers['x-rate-limit-reset'], 10) * 1000).toISOString()
      });

    } catch (err) {
      if (err.response?.status === 429) {
        // 6d) Rate-limited: נחכה וננסה שוב את אותו באצ׳
        const resetTime = parseInt(err.response.headers['x-rate-limit-reset'], 10) * 1000;
        const delay     = Math.max(resetTime - Date.now(), 0) + 1000;
        console.warn(`⏳ Rate limited. Waiting ${Math.ceil(delay / 1000)}s before retry...`);
        await wait(delay);
        idx--; // נדחוף חזרה את האינדקס כדי לנסות שוב
      } else {
        console.error('❌ API Error:', err.response?.data || err.message);
      }
    }
  }

  // 7) ניתוק וסיכום
  console.log(`\n🎉 Engagement update complete. Tweets updated: ${processed}`);
  console.log(`💡 Checked a total of ${allIds.length} unique tweets for today.`);
  await mongoose.disconnect();
  console.log('✅ Disconnected from MongoDB');
  process.exit(0);
}

// קריאה ל-main() ולכידת חריגות שלא טופלו
main().catch(err => {
  console.error('🚨 Fatal error in engagement.js:', err);
  process.exit(1);
});