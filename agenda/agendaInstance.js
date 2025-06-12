// sets up and exports the Agenda instance

// agenda/agendaInstance.js
const Agenda = require("agenda");

const agenda = new Agenda({
  db: {
    address: process.env.DATABASE_URL,
    collection: "agendaJobs" // no conflict with models/Agenda.js
  },
  processEvery: "10 seconds",
  maxConcurrency: 5
});

module.exports = agenda;

