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
- There's no ref in casual games, so **lifts, double contacts on sets and overlap aren't called**. Only clear-cut calls happen: in/out, four hits, one player obviously touching the ball twice in a row (two clearly separate touches), net and centre-line touches, antennas, and balls crossing outside or under the net.
- **Paste a roster**: in *Edit teams & stats…*, click **📋 Paste roster** for a team and paste 6 rows copied from a spreadsheet. Each row is number, name, height, then JMP REA AGI HIT PAS SET BLK SRV AWR. Rows fill positions P1–P6 in order. This works in the competitive version too, with heights in cm and ratings from 1 to 99.
- **"Setter out!"**: when the setter takes the first ball, the team has to call for a backup setter, and awareness decides how that goes. Aware teams call it quickly and send their best remaining setter, and an aware setter digs the ball high to the middle to give the backup time. Less aware teams call it late or send whoever is closest, and sometimes nobody calls it at all, so everyone hesitates.
- **⚖️ Balance rotations** (in the editor) tries every possible order and picks the one whose weakest rotation is strongest. Every front row gets a setter option and hitters or blockers, and every back row gets passers. Random casual teams are balanced this way too.
- Casual mode keeps its own teams and settings, which default to best of 3 on a 2.35 m (co-ed) net.

## Tournament

Open `tournament.html` (live: https://eang0521.github.io/volleyball-sim/tournament.html) to run a whole tournament from an open-gym player list. It plays like casual mode, but a referee enforces every rule.

1. **Players**: paste an **open-gym-teams** backup (JSON) or one player per line (`name, stars, position, gender`), then uncheck anyone who isn't playing. Stars and positions can be edited here too.
   - Ratings are 1–10, the same as open-gym-teams. A player's rating is the base for every skill. Older backups on 1–5 stars convert as 2 × stars − 1.
   - Position (All-around, Hitter, Middle, Libero or Setter) shifts points between skills. The shifts sum to zero, so every player with the same rating has the same total.
   - Everyone is 5′8″ with the same skin tone.
2. **Teams**: teams are split with the same engine as **vball-teams**.
   - It balances average rating first, then spreads setters and hitters, genders, and strong and newer players, and it honors together/apart rules from the backup.
   - Pick the number of teams. Every team has at least 6 players.
   - Each lineup is ordered so every rotation is playable. Teams with 7 or more players sub in at the serve: each rotation, the next bench player comes in at zone 1 to serve and the player rotating out of zone 2 sits.
   - You can move players between teams.
3. **Format**:
   - **Single elimination**, with an optional third-place match. Choose a **stepladder** bracket style to give top seeds extra byes: set the byes each round (e.g. `4, 2` for 8 teams gives 5v8 and 6v7, then 3v6/7 and 4v5/8, then 1v4/5/8 and 2v3/6/7), or leave it blank for an automatic ladder. A preview shows every round. This works after pool play too.
   - **Double elimination**, with an optional grand-final reset.
   - **Round robin**.
   - **Pool play → playoffs**: number of pools, games per team or a full round robin, an option to play each opponent twice, the top N per pool or overall advance, and a single- or double-elimination playoff.
   - Seeding is by team strength or random.
   - Pool games, playoff matches and finals each get their own match length: best of 1, 3 or 5, or a fixed number of sets with ties allowed, plus points per set, deciding-set points, win by 2 and a point cap.
   - Rules: net height, ball-handling strictness, front-row setter, switching sides.
4. **Tournament**:
   - Standings, a bracket that updates as results come in, and stat leaders.
   - **Watch** any match in 3D, or **Sim** it.
   - **Sim whole tournament** runs matches in parallel background workers; a 10-team pool-and-playoff tournament takes about 10 seconds.
   - Progress is saved in the browser.

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
- **Rules** (`js/game.js`): rally scoring. A team rotates clockwise when it wins back the serve. The rules cover the 3-touch limit, double contacts (a block touch doesn't count as a touch), in/out calls with the ball touching the line counting as in, balls crossing outside or over the antennas, antenna hits, under-net crossings, net touches and centre-line faults. They also cover:
  - **Overlap**, judged by feet positions at the serve contact, with the server exempt. Less aware players stand sloppier, and casual teams occasionally mix up their spots.
  - **Illegal back-row attacks**: a back-row player takes off on or inside the 3 m line and sends a ball entirely above the net. It's called when the ball crosses the net or touches the block.
  - **Lifts and double contacts** on overhead contacts. Worse setters and harder balls get called more often, and only lifts are called on the first team contact. The Settings tab has a referee-strictness setting (Off, Lenient, Normal, Strict).
  - **Body contacts**: players' bodies are solid. A ball that hits someone deflects and counts as a touch, which can cause four hits, a double contact, or a serve hitting a teammate.
- **AI**: each team predicts the ball's path and picks who plays it, based on reaction time, movement speed, perception error (awareness) and role preference. The right-front player usually sets and the left-front player usually hits, but anyone can play any role. Hitters time their approach and jump, and back-row players can attack from behind the 3 m line (pipe and D sets). Blockers read the set and time their jump off the hitter's. Attackers pick shots around the block and the defenders (spikes, rolls and tips), and diggers dive when they must.
- **Ratings** (1–99): jumping, reactions, agility, hitting, passing, setting, blocking, serving and awareness, plus height (which sets standing reach).

## Tuning tools

`node tools/tourney-test.js [backup.json]` checks the tournament logic (stats, team split, every bracket format). `node tools/headless.js [matches] [level|casual]` runs whole matches without rendering. It prints outcome rates (kills, aces, errors, blocks, digs) so you can check realism after changing the model. `node tools/diag.js` prints the contact sequence of each rally.
