const express = require('express');
const router = express.Router();
const twitterController = require('../controllers/twitterController');
const authController = require('../controllers/authController');

router.get('/login', authController.login);
router.get('/search', twitterController.fetchTweets);
router.get('/search', twitterController.fetchReplies);
//router.get('/saved-tweets', twitterController.getSavedTweets);

module.exports = router;