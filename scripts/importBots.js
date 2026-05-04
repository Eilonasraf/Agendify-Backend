// scripts/importBots.js
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import csvParser from 'csv-parser';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    console.error('❌ DATABASE_URL is missing');
    process.exit(1);
  }
  const dbName = new URL(uri).pathname.slice(1).toLowerCase();
  const client = new MongoClient(uri);
  await client.connect();

  const botsCol  = client.db(dbName).collection('bots');
  const filePath = path.join(__dirname, '..', 'Bots_keys.csv');
  const rows     = [];

  fs.createReadStream(filePath)
    .pipe(csvParser({ mapHeaders: ({ header }) => header.trim() }))
    .on('data', row => {
      // parse your manual “monthly reset” (ISO date or blank)
      const monthlyReset = row['Next Fetch Reset']
        ? new Date(row['Next Fetch Reset'])
        : null;

      rows.push({
        botId:         row['botId'].trim(),
        apiKey:        row['API Key'].trim(),
        apiSecret:     row['API Key Secret'].trim(),
        bearerToken:   row['Bearer Token'].trim(),
        accessToken:   row['Access Token'].trim(),
        accessTokenSecret: row['Access Token Secret'].trim(),
        clientId:      row['Client ID'].trim(),
        clientSecret:  row['Client Secret'].trim(),
        monthlyReset,    // ← here
      });
    })
    .on('end', async () => {
      for (const b of rows) {
        await botsCol.updateOne(
          { botId: b.botId },
          {
            $set: b,           // writes creds + monthlyReset
            $setOnInsert: {
              role:           'all',
              lastUsedAt:     null,
              nextFetchReset: null,
              nextReplyReset: null,
            }
          },
          { upsert: true }
        );
      }
      console.log(`✅ Imported ${rows.length} bots, seeded monthlyReset.`);
      process.exit(0);
    })
    .on('error', err => {
      console.error(err);
      process.exit(1);
    });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
