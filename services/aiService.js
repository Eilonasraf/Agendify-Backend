const { GoogleGenerativeAI } = require("@google/generative-ai");

// Init Gemini with API Key from .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generates a description based on the provided prompt.
 * @param prompt User prompt (e.g., "Write a description about...").
 * @returns The AI-generated description.
 */
const generateGeminiDescription = async (prompt) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    return text;
  } catch (error) {
    console.error("Gemini AI generation error:", error);
    throw new Error("Failed to generate description");
  }
};

module.exports = { generateGeminiDescription };
