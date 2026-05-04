// merge_agendas.js

import 'dotenv/config';
import mongoose from 'mongoose';
import Agenda from './models/Agenda.js';

async function merge() {
  await mongoose.connect(process.env.DATABASE_URL);
  console.log('✅ Connected to MongoDB');

  const fromId = '683188852cb4f6daa9e93b2f';  // Israel Gaza War
  const toId   = '6831d369198953a3d3c85c26';  // Israel Gaza

  // 1) Load source tweets
  const src = await Agenda.findById(fromId, 'tweets');
  if (!src) throw new Error(`Source agenda ${fromId} not found`);

  // 2) Append them into the target agenda
  await Agenda.findByIdAndUpdate(toId, {
    $push: { tweets: { $each: src.tweets } },
    $set:  { updatedAt: new Date() }
  });

  console.log(`✅ Merged ${src.tweets.length} tweets into agenda ${toId}`);
  await mongoose.disconnect();
}

merge().catch(err => {
  console.error('❌ Error merging agendas:', err);
  process.exit(1);
});
