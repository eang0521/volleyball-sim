// Background match simulator for the tournament page.
importScripts('util.js', 'physics.js', 'teams.js', 'game.js', 'highlights.js', 'tourney.js');
VB.MODE = 'casual';

onmessage = (e) => {
  const { job, teams, settings } = e.data;
  try {
    const result = VB.T.simMatch(teams, settings, { highlights: 10 });
    postMessage({ job, result });
  } catch (err) {
    postMessage({ job, error: String(err && err.stack || err) });
  }
};
