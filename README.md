# Volleyball Sim

A 6-v-6 indoor volleyball simulation that plays itself. There are 12 players, and each has their own ratings. The ball follows simple physics, and a Three.js scene shows the match from a camera at the side of the court.

**▶ Play it live: https://eang0521.github.io/volleyball-sim/**

## Running it

Play the live version at the link above, or run it locally: double-click `index.html`. Three.js loads from a CDN, so you need an internet connection. You can also serve the folder, e.g. `python -m http.server`, and open http://localhost:8000.

## Casual version

Open `casual.html` (or add `?mode=casual` to the URL) for a version tuned for a group that plays for fun. Live: https://eang0521.github.io/volleyball-sim/casual.html

- Ratings are **0–10** and heights are in **inches**. A casual 10/10 plays roughly like a mid-level competitive player.
- Hits are weaker, jumps lower and awareness lower. Passes shank more often and fly farther, so players sometimes have to run a long way to chase a ball down and bump it back into play. Weak servers serve underhand.
- Positions are loose. Teams still rotate clockwise, but each rotation the team decides who sets, and players set to whoever they think should hit. A team's **awareness** decides how often it gets these right: an aware team puts its best setter in and feeds its best hitters, while an unaware one falls back on "whoever's in right front sets" or picks someone at random.
- **Setter always plays from the front row** (a casual setting, on by default): each rotation the setter is one of the three front-row players, usually middle front or right front. Awareness still decides whether it's the best setter up there.
- Casual mode keeps its own teams and settings, which default to best of 3 on a 2.35 m (co-ed) net.

## Controls

| Key | Action |
| --- | --- |
| Space | Pause / play |
| `.` | Step one frame (while paused) |
| 1–6 | Speed ¼× … 8× |
| C | Cycle camera (side broadcast, side follow, baseline, free orbit) |
| P | Toggle side panel |
| N | New match |

The side panel has four tabs:
- **Play-by-play**: a log of every point.
- **Box score**: kills, errors, hitting %, assists, aces, digs and blocks for each player.
- **Teams**: current rotations, random-team generation, and the full ratings editor.
- **Settings**: points per set, deciding-set points, match length, win-by-2, point cap, net height and side switching.

Teams and settings are saved in the browser's local storage.

## How it works

- **Physics** (`js/physics.js`): the ball has gravity, quadratic drag, Magnus lift from topspin, and random wobble on float serves. It collides with the net mesh, the top tape (let serves and trickle-overs) and the antennas. Every contact is aimed with a shooting solver that finds the launch velocity reaching a target in a given flight time. The stats then add execution error to that launch.
- **Rules** (`js/game.js`): rally scoring. A team rotates clockwise when it wins back the serve. The rules cover the 3-touch limit, double contacts (a block touch doesn't count as a touch), in/out calls with the ball touching the line counting as in, balls crossing outside or over the antennas, antenna hits, under-net crossings, net touches and centre-line faults.
- **AI**: each team predicts the ball's path and picks who plays it, based on reaction time, movement speed, perception error (awareness) and role preference. The right-front player usually sets and the left-front player usually hits, but anyone can play any role. Hitters time their approach and jump. Blockers read the set and time their jump off the hitter's. Attackers pick shots around the block and the defenders (spikes, rolls and tips), and diggers dive when they must.
- **Ratings** (1–99): jumping, reactions, agility, hitting, passing, setting, blocking, serving and awareness, plus height (which sets standing reach).

## Tuning tools

`node tools/headless.js [matches] [level|casual]` runs whole matches without rendering. It prints outcome rates (kills, aces, errors, blocks, digs) so you can check realism after changing the model. `node tools/diag.js` prints the contact sequence of each rally.
