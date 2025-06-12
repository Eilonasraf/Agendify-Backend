// scripts/total_tweets.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DATABASE_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const calculateTotalTweets = async () => {
  try {
    // Connect to database
    await connectDB();

    // Aggregate sum of fetchCount from all bots, then multiply by 10
    const result = await mongoose.connection.db.collection('bots').aggregate([
      {
        $group: {
          _id: null,
          totalFetchCount: { $sum: "$fetchCount" }
        }
      },
      {
        $project: {
          _id: 0,
          totalTweets: { $multiply: ["$totalFetchCount", 10] }
        }
      }
    ]).toArray();

    const totalTweets = result[0]?.totalTweets || 0;
    
    console.log('=================================');
    console.log('📊 TOTAL TWEETS CALCULATION');
    console.log('=================================');
    console.log(`Total Fetch Count: ${result[0]?.totalFetchCount || 0}`);
    console.log(`Total Tweets (x10): ${totalTweets}`);
    console.log('=================================');
    
    return totalTweets;
    
  } catch (error) {
    console.error('Error calculating total tweets:', error);
    return 0;
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

// Run the script
calculateTotalTweets()
  .then((totalTweets) => {
    console.log(`✅ Script completed. Total Tweets: ${totalTweets}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });