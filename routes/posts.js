const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');

// נתיבים לניהול פוסטים
router.post('/', postController.createPost);
router.get('/', postController.getPosts); // Supports filtering by query
router.get('/:id', postController.getPostById);
router.put('/:id', postController.updatePost);
router.get('/:id/with-replies', postController.getPostWithreplies); // Add this line

module.exports = router;