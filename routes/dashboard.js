// routes/dashboard.js
const express = require("express");
const router  = express.Router();
const dc      = require("../controllers/dashboardController");

// list all clusters for a user
router.get("/",   dc.listClusters);

// fetch one cluster’s full detail
router.get("/:clusterId", dc.getClusterDetail);

// create a brand-new cluster
router.post("/",  dc.createCluster);

// delete a cluster
router.delete("/:clusterId", dc.deleteCluster);

module.exports = router;
