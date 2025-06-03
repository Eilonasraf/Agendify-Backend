// controllers/dashboardController.js
const Agenda = require("../models/Agenda");

// GET /api/agendas?userId=…
exports.listAgendas = async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const agendas = await Agenda.find({ createdBy: userId })
    .sort({ createdAt: -1 })
    .select("title prompt createdAt tweets");

  return res.json(
    agendas.map((a) => ({
      agendaId:    a._id,
      title:       a.title,
      prompt:      a.prompt,
      createdAt:   a.createdAt,
      tweetsCount: a.tweets.length,
    }))
  );
};

// GET /api/agendas/:agendaId
exports.getAgendaDetail = async (req, res) => {
  const { agendaId } = req.params;
  const agenda = await Agenda.findById(agendaId).lean();
  if (!agenda) return res.status(404).json({ error: "not found" });
  return res.json(agenda);
};

// POST /api/agendas
exports.createAgenda = async (req, res) => {
  const { userId, topic } = req.body;
  if (!userId || !topic) {
    return res.status(400).json({ error: "userId and topic required" });
  }
  try {
    const agenda = await Agenda.create({
      title:     topic,
      prompt:    topic,       // ← seed the prompt right away
      createdBy: userId,
      tweets:    [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return res.status(201).json({
      agendaId: agenda._id,
      title:     agenda.title,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "agenda creation failed" });
  }
};

/**
 * DELETE /api/agendas/:agendaId
 * Deletes one agenda by ID
 */
exports.deleteAgenda = async (req, res) => {
    try {
      const { agendaId } = req.params;
      const deleted = await Agenda.findByIdAndDelete(agendaId);
      if (!deleted) {
        return res.status(404).json({ error: "agenda not found" });
      }
      return res.json({ message: "agenda deleted." });
    } catch (err) {
      console.error("❌ delete agenda error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  };