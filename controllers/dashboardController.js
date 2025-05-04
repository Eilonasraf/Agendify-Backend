// controllers/dashboardController.js
const Agenda = require("../models/Agenda");

// GET /api/clusters?userId=…
exports.listClusters = async (req, res) => {
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

// GET /api/clusters/:clusterId
exports.getClusterDetail = async (req, res) => {
  const { clusterId } = req.params;
  const cluster = await Agenda.findById(clusterId).lean();
  if (!cluster) return res.status(404).json({ error: "not found" });
  return res.json(cluster);
};

// POST /api/clusters
exports.createCluster = async (req, res) => {
  const { userId, topic } = req.body;
  if (!userId || !topic) {
    return res.status(400).json({ error: "userId and topic required" });
  }
  try {
    const cluster = await Agenda.create({
      title:     topic,
      prompt:    topic,       // ← seed the prompt right away
      createdBy: userId,
      tweets:    [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return res.status(201).json({
      clusterId: cluster._id,
      title:     cluster.title,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "cluster creation failed" });
  }
};

/**
 * DELETE /api/clusters/:clusterId
 * Deletes one cluster by ID
 */
exports.deleteCluster = async (req, res) => {
    try {
      const { clusterId } = req.params;
      const deleted = await Agenda.findByIdAndDelete(clusterId);
      if (!deleted) {
        return res.status(404).json({ error: "Cluster not found" });
      }
      return res.json({ message: "Cluster deleted." });
    } catch (err) {
      console.error("❌ deleteCluster error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  };