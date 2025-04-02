const path = require("path");

// Helper function for checking file types
const isValidImage = (filename) => {
  const allowedExtensions = [".png", ".jpg", ".jpeg"];
  const fileExtension = path.extname(filename).toLowerCase();
  return allowedExtensions.includes(fileExtension);
};

// Handles uploading a profile picture
const uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "No file uploaded or invalid file type" });
      return;
    }

    // Validate the uploaded file type
    if (!isValidImage(req.file.filename)) {
      console.error("❌ Invalid file type:", req.file.filename);
      res.status(400).json({ message: "Only .png, .jpg, and .jpeg formats are allowed!" });
      return;
    }

    // Construct the image URL
    const imageUrl = `/uploads/${req.file.filename}`;
    console.log("✅ Profile picture uploaded:", imageUrl);
    res.json({ url: imageUrl });

  } catch (error) {
    console.error("❌ Error handling profile picture upload:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = {
  uploadProfilePicture
};