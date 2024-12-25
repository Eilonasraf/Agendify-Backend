const mongoose = require('mongoose');

//(Schema) הגדרת הסכמה לפוסטים
const PostSchema = new mongoose.Schema({
  title: { type: String, required: true }, // כותרת הפוסט
  content: { type: String, required: true }, // תוכן הפוסט
  sender: { type: String, required: true }, // השולח של הפוסט
  createdAt: { type: Date, default: Date.now }, // תאריך יצירה
});

module.exports = mongoose.model('Post', PostSchema); // ייצוא המודל
