const express = require('express');
const router = express.Router();
const repliesController = require('../controllers/repliesController');
const { authMiddleware } = require("../controllers/authController");

// Replies routes
router.post('/', repliesController.createreplies); // Create a new reply

router.get('/', repliesController.getreplies); // Get all replies or filter by post

router.put('/:id', repliesController.updatereplies); // Update a reply by ID

router.delete('/:id', repliesController.deletereplies); // Delete a reply by ID

router.post('/:tweetId/replies', authMiddleware, repliesController.addReply); // Add a reply to a tweet

module.exports = router;
