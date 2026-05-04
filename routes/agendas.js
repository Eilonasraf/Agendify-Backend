// routes/agendas.js
const express = require("express");
const router  = express.Router();
const ac = require("../controllers/agendaController");
const pc = require("../controllers/promoteController");

// list all clusters for a user
router.get("/",   ac.listAgendas);

// fetch one cluster’s full detail
router.get("/:agendaId", ac.getAgendaDetail);

// create a brand-new cluster
router.post("/",  ac.createAgenda);

// delete a cluster
router.delete("/:agendaId", ac.deleteAgenda);

// promote tweets in a cluster
router.post("/:agendaId/promote", pc.promote);

module.exports = router;
