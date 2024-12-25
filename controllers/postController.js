const Post = require('../models/Post');

// יצירת פוסט חדש
const createPost = async (req, res) => {
  const { title, content, sender } = req.body;
  try {
    const post = new Post({ title, content, sender });
    await post.save();
    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// שליפת כל הפוסטים
const getPosts = async (req, res) => {
  const { keyword } = req.query;
  try {
    let query = {};
    if (keyword) {
      query = { $or: [
        { title: { $regex: keyword, $options: 'i' } },
        { content: { $regex: keyword, $options: 'i' } }
      ]};
    }
    const posts = await Post.find(query);
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// שליפת פוסט לפי ID
const getPostById = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// שליפת פוסטים לפי Sender
const getPostsBySender = async (req, res) => {
  const { sender } = req.query;
  try {
    const posts = await Post.find({ sender });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// עדכון פוסט
const updatePost = async (req, res) => {
  const { title, content } = req.body;
  try {
    const post = await Post.findByIdAndUpdate(req.params.id, { title, content }, { new: true });
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getPostWithreplies = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    
    const repliess = await replies.find({ postId: post._id });
    
    res.json({ post, repliess });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  createPost,
  getPosts,
  getPostById,
  getPostsBySender,
  updatePost,
  getPostWithreplies, // Add this line
};