// services/botManager.js

const BotModule = require('../models/Bot');
const Bot       = BotModule.default || BotModule;
const twitter   = require('../controllers/twitterController');

class BotManager {
  constructor() {
    this.fetchIndex = 0;
    this.replyIndex = 0;
    this.lastUsedReplyBot = null;
  }

  async loadBots() {
    const all = await Bot.find();
    const now = new Date();

    const fetchBots = all.filter(
      b =>
        ['all','fetch'].includes(b.role) &&
        (!b.nextFetchReset || b.nextFetchReset <= now)
    );

    const replyBots = all.filter(
      b =>
        ['all','reply'].includes(b.role) &&
        (!b.nextReplyReset || b.nextReplyReset <= now)
    );

    if (!fetchBots.length) throw new Error('All bots are fetch-locked');
    if (!replyBots.length) throw new Error('All bots are reply-locked');

    return { fetchBots, replyBots };
  }

  pickFetchBot(fetchBots) {
    const bot = fetchBots[this.fetchIndex % fetchBots.length];
    this.fetchIndex++;
    return bot;
  }

  pickReplyBot(replyBots) {
    const bot = replyBots[this.replyIndex % replyBots.length];
    this.replyIndex++;
    return bot;
  }

  /** Fetch tweets, retrying and locking on caps, incrementing fetchCount */
  async fetchTweets(count, options) {
    let lastErr;
    const { fetchBots } = await this.loadBots();

    for (let i = 0; i < fetchBots.length; i++) {
      const bot = this.pickFetchBot(fetchBots);

      try {
        const result = await twitter.fetchTweets(count, options, bot.bearerToken);

        // increment fetchCount & update lastUsedAt
        await Bot.updateOne(
          { botId: bot.botId },
          {
            $inc:  { fetchCount: 1 },
            $set:  { lastUsedAt: new Date() }
          }
        );

        console.log(`🛠️ Bot "${bot.botId}" fetched tweets.`);
        return result;

      } catch (err) {
        lastErr = err;
        const data   = err.response?.data;
        const status = err.response?.status;
        const hdrs   = err.response?.headers || {};

        // monthly cap → lock until next period
        if (data?.title === 'UsageCapExceeded' && data.period === 'Monthly') {
          if (bot.monthlyReset) {
            await Bot.updateOne(
              { botId: bot.botId },
              { $set: { nextFetchReset: bot.monthlyReset } }
            );
          }
          continue;
        }

        // short-window cap → lock until header reset
        if (hdrs['x-rate-limit-reset']) {
          const resetTs = parseInt(hdrs['x-rate-limit-reset'], 10) * 1000;
          await Bot.updateOne(
            { botId: bot.botId },
            { $set: { nextFetchReset: new Date(resetTs) } }
          );
          continue;
        }

        // transient auth / service errors → try next bot
        if ([401,403,503].includes(status)) {
          continue;
        }

        // fatal
        break;
      }
    }

    throw lastErr || new Error('Failed to fetchTweets on all bots');
  }

  /** Post a reply, retrying and locking on caps, incrementing replyCount */
  async postReplyToTweet(tweetId, replyText) {
    let lastErr;
    const { replyBots } = await this.loadBots();

    for (let i = 0; i < replyBots.length; i++) {
      const bot = this.pickReplyBot(replyBots);
      this.lastUsedReplyBot = bot;

      const creds = {
        consumer: { key: bot.apiKey, secret: bot.apiSecret },
        access:   { key: bot.accessToken, secret: bot.accessTokenSecret },
      };

      try {
        const replyData = await twitter.postReplyToTweet(tweetId, replyText, creds);

        // ensure created_at
        if (!replyData.created_at) {
          replyData.created_at = new Date().toISOString();
        }

        // record usage on this bot
        await Bot.updateOne(
          { botId: bot.botId },
          {
            $inc: { replyCount: 1 },
            $set: { lastUsedAt: new Date() }
          }
        );

        return replyData;
      } catch (err) {
        lastErr = err;
        const status = err.response?.status;
        const data   = err.response?.data;
        const hdrs   = err.response?.headers || {};

        // Monthly or 24-hour cap exceeded?
        if (data?.title === 'UsageCapExceeded') {
          const period = data.period;
          let until;
          if (period === '24hour') {
            until = new Date(Date.now() + 24*3600*1000);
          } else if (period === 'Monthly' && bot.monthlyReset) {
            until = bot.monthlyReset;
          }
          if (until) {
            await Bot.updateOne(
              { botId: bot.botId },
              { $set: { nextReplyReset: until } }
            );
            console.warn(`⚠️ [${bot.botId}] UsageCapExceeded (${period}), locked until ${until}`);
            continue;
          }
        }

        // Rate-limit headers?
        if (hdrs['x-rate-limit-reset']) {
          const resetTs  = parseInt(hdrs['x-rate-limit-reset'], 10) * 1000;
          const resetDate = new Date(resetTs);
          await Bot.updateOne(
            { botId: bot.botId },
            { $set: { nextReplyReset: resetDate } }
          );
          console.warn(`⚠️ [${bot.botId}] rate limited, reset at ${resetDate}`);
          continue;
        }

        // Transient 401/403/429/503?
        if ([401,403,429,503].includes(status)) {
          console.warn(`⚠️ [${bot.botId}] status=${status}, trying next bot`);
          continue;
        }

        // Otherwise, fatal
        console.error(`❌ [${bot.botId}] fatal:`, data || err.message);
        break;
      }
    }

    throw lastErr || new Error('All bots failed to postReply');
  }
}

const manager = new BotManager();
module.exports = Object.assign(manager, {
  classifyTweetsInJSON:                        twitter.classifyTweetsInJSON,
  generateResponseCommentsForNegativeTweetsBatch:
                                                twitter.generateResponseCommentsForNegativeTweetsBatch,
  generateSearchQuery:                         twitter.generateSearchQuery,
  generateTrendingTopics:                      twitter.generateTrendingTopics,
});
