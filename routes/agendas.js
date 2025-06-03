// routes/dashboard.js
const express = require("express");
const router  = express.Router();
const ac = require("../controllers/agendaController");

// list all clusters for a user
router.get("/",   ac.listAgendas);

// fetch one cluster’s full detail
router.get("/:agendaId", ac.getAgendaDetail);

// create a brand-new cluster
router.post("/",  ac.createAgenda);

// delete a cluster
router.delete("/:agendaId", ac.deleteAgenda);

module.exports = router;
