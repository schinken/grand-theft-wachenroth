// Play-test bot: plays Flo's missions through the same thumb stick a phone
// uses, and reaches the game through window.GTW.
//
// Run it with Playwright against a local server (python3 -m http.server 8765):
// the function below takes a Playwright `page` and returns a log of every
// mission. Options come from globalThis.PLAYTEST = {from, to, secs, shots,
// trace}: first and last mission number, seconds of game time, a screenshot
// prefix, and whether to log the position every 20 seconds.
async page => {
  const opt = Object.assign(
    {from: 0, to: 99, secs: 2400, shots: '', trace: false},
    {url: 'http://127.0.0.1:8765/index.html'},
    globalThis.PLAYTEST
  );
  await page.goto(opt.url);
  await page.click('#start');
  await page.evaluate(from => {
    const game = window.GTW;
    const {pad, dist, field, waypoint, nearLink, NODES, wrap, surfAt} = game;
    const bot = {
      log: [],
      stuck: 0,
      rev: 0,
      side: 0,
      tries: 0,
      helps: 0,
      walk: 0,
      last: null,
      since: 0,
      seen: null,
      px: 0,
      py: 0,
    };
    window.BOT = bot;
    game.audio.mute(true);
    game.job(from);

    const say = text => {
      bot.log.push(`${game.state.t.toFixed(0).padStart(4)}s  ${text}`);
    };
    const nearestOf = (list, from) => {
      return list.sort((a, b) => dist(a, from) - dist(b, from))[0];
    };
    const jobItems = () => game.state.items.filter(item => item.job);

    // One decision of the bot: where to push the stick, when to get out.
    bot.tick = dt => {
      const state = game.state;
      const player = state.player;
      const job = state.job;
      const car = player.car;
      pad.x = 0;
      pad.y = 0;
      pad.brake = false;
      if (state.mode !== 'play' || state.wasted || !job) {
        return;
      }
      const step = job.step;
      const collecting = step.do === 'collect';
      const target = collecting ? nearestOf(jobItems(), player) : job.to;
      if (!target) {
        return;
      }
      const far = dist(player, target);
      const taking = step.do === 'steal' || step.do === 'take';
      const wanted = taking ? job.veh : null;
      const head = (to, push = 1) => {
        const angle = Math.atan2(to.y - player.y, to.x - player.x);
        pad.x = Math.cos(angle) * push;
        pad.y = Math.sin(angle) * push;
      };
      // The next point down the road towards a place.
      const along = to => {
        if (dist(player, to) < 45) {
          return to;
        }
        return waypoint(field(to), player, car ? 38 : 22) || to;
      };

      const fire = state.cars.find(o => o.burn > 0 && dist(o, player) < 14);
      if (car && car.burn) {
        game.toggleCar(); // out of a burning car
        return;
      }
      if (!car && fire) {
        head({x: 2 * player.x - fire.x, y: 2 * player.y - fire.y});
        return;
      }
      if (!car) {
        bot.walk += dt;
        if ((step.foot && far < 60) || (wanted && far < 60)) {
          // Walk there, or to the car we should take.
          head(far > 45 ? along(target) : target);
          if (wanted && far < 4.5) {
            game.toggleCar();
          }
          return;
        }
        const usable = state.cars.filter(o => {
          return !o.dead && !o.burn && !(o.ai && o.ai.cop) && !o.tr;
        });
        const ride = nearestOf(usable, player);
        if (!ride) {
          return;
        }
        head(ride);
        if (bot.walk > 25) {
          // On foot for ages: a person would walk around the house.
          bot.walk = 0;
          bot.helps++;
          say('  help: put next to a car');
          player.x = ride.x + Math.sin(ride.a) * 2.5;
          player.y = ride.y - Math.cos(ride.a) * 2.5;
        }
        if (dist(ride, player) < 4.5) {
          game.toggleCar();
        }
        return;
      }

      const speed = Math.hypot(car.vx, car.vy);
      bot.walk = 0;
      if ((step.foot && far < 9) || (wanted && car !== wanted && far < 11)) {
        // Get out and walk the rest.
        pad.brake = speed > 1;
        if (speed < 4) {
          game.toggleCar();
        }
        return;
      }
      if (bot.rev > 0) {
        // Stuck: back out, turning.
        bot.rev -= dt;
        pad.brake = true;
        pad.x = Math.cos(car.a + bot.side);
        pad.y = Math.sin(car.a + bot.side);
        return;
      }
      const chasing = step.do === 'chase';
      const guided = (state.gps && state.gps.wp) || target;
      const waypt = collecting || chasing ? along(target) : guided;
      const stops = !chasing && !collecting && step.do !== 'lose';
      const bearing = Math.atan2(waypt.y - player.y, waypt.x - player.x);
      const turn = Math.abs(wrap(bearing - car.a));
      // Drive like a person, not a rocket.
      let limit = 21;
      if (turn > 0.5 || (stops && far < 30)) {
        limit = 9;
      } else if (collecting && far < 18) {
        limit = 7;
      }
      head(waypt, speed > limit ? 0.16 : 1);
      // A light stick still accelerates, so brake when well over the limit.
      pad.brake = speed > limit + 3;
      if (collecting && far < 10 && turn > 1 && speed > 2) {
        // Circling the thing: back up and try again.
        bot.rev = 0.9;
        bot.side = 0;
      }
      if (stops && far < 6 && speed > 5) {
        pad.x = 0;
        pad.y = 0;
        pad.brake = true;
      }
      if (step.do === 'hold' && far < (step.r || 10) - 3) {
        pad.x = 0;
        pad.y = 0;
        pad.brake = speed > 1;
        return;
      }
      bot.stuck += dt;
      if (bot.stuck > 2.5) {
        // No headway in a while: wedged somewhere.
        const moved = Math.hypot(player.x - bot.px, player.y - bot.py);
        const wedged = moved < 4 && !(stops && far < 8);
        bot.tries = wedged ? bot.tries + 1 : 0;
        if (wedged) {
          bot.rev = 1.6;
          bot.side = Math.random() < 0.5 ? -0.6 : 0.6;
        }
        if (bot.tries > 2) {
          // Still wedged after backing out twice: lift the car back onto the
          // road, facing the way the arrow points.
          const [link, x, y] = nearLink(player);
          const ahead = state.gps && waypoint(state.gps.f, {x, y}, 15);
          const to = ahead || NODES[link[1]];
          const a = Math.atan2(to.y - y, to.x - x);
          Object.assign(car, {x, y, a, vx: 0, vy: 0, spin: 0});
          if (car.tr) {
            car.tr.a = a;
          }
          bot.tries = 0;
          bot.rev = 0;
          bot.helps++;
          say('  help: car lifted back onto the road');
        }
        bot.stuck = 0;
        bot.px = player.x;
        bot.py = player.y;
      }
    };

    // Notes how missions end and what goes wrong, from the score sheet.
    bot.watch = () => {
      const state = game.state;
      const stats = state.stats;
      const job = state.job;
      const now = {
        job: job ? job.m.id : null,
        step: job ? `${job.i} (${job.step.do})` : '',
        missions: stats.missions,
        wasted: stats.wasted,
        busted: stats.busted,
      };
      const was = bot.seen || now;
      const where = `${state.player.x | 0},${state.player.y | 0}`;
      const flash = document.getElementById('flash');
      if (now.wasted > was.wasted) {
        say(`  wasted at ${where}: ${flash.firstElementChild.textContent}`);
      }
      if (now.busted > was.busted) {
        say(`  busted at ${where}`);
      }
      if (now.missions > was.missions) {
        say(`DONE ${was.job}`);
      } else if (was.job && !now.job) {
        const why = flash.lastElementChild.textContent || 'see above';
        say(`FAIL ${was.job}: ${why} at step ${was.step}`);
      }
      bot.seen = now;
    };

    // Simulates without drawing, as fast as the CPU allows.
    bot.run = secs => {
      for (let i = 0; i < secs * 60 && game.state.mode === 'play'; i++) {
        const state = game.state;
        const job = state.job;
        let key = 'idle';
        if (job) {
          key = `${job.m.id}/${job.i} ${job.step.do}`;
        } else if (state.jobN >= game.MISSIONS.length) {
          key = 'all done';
        }
        if (key !== bot.last) {
          const left = job && job.timed ? ` (${job.left.toFixed(0)}s left)` : '';
          say(key + left);
          bot.last = key;
          bot.since = state.t;
        }
        if (job && state.t - bot.since > 300) {
          // Nothing happened for five minutes: say where we are, then cheat.
          const player = state.player;
          const target = job.to || nearestOf(jobItems(), player);
          const ride = player.car ? player.car.kind : 'on foot';
          const goal = target ? `${target.x | 0},${target.y | 0}` : 'none';
          say(
            `  STALL in ${ride} at ${player.x | 0},${player.y | 0}, ` +
              `target ${goal}, ground ${surfAt(player.x, player.y)}`
          );
          if (target) {
            const body = player.car || player;
            Object.assign(body, {x: target.x, y: target.y, vx: 0, vy: 0});
          }
          bot.since = state.t;
          bot.helps++;
        }
        bot.tick(1 / 60);
        game.update(1 / 60);
        bot.watch();
        if (i % 15 === 0) {
          game.guide(1);
        }
      }
      const state = game.state;
      return {
        t: state.t,
        jobN: state.jobN,
        money: state.money,
        stats: state.stats,
        mode: state.mode,
        helps: bot.helps,
      };
    };
  }, opt.from);

  let state;
  let shots = 0;
  for (let t = 0; t < opt.secs; t += 20) {
    state = await page.evaluate(() => window.BOT.run(20));
    if (opt.trace) {
      await page.evaluate(() => {
        const game = window.GTW;
        const player = game.state.player;
        const ride = player.car ? player.car.kind : 'on foot';
        const heat = game.state.wanted.toFixed(1);
        window.BOT.log.push(
          `      at ${player.x | 0},${player.y | 0} ${ride} heat ${heat}`
        );
      });
    }
    if (opt.shots && shots++ % 4 === 0) {
      await page.waitForTimeout(120);
      const name = String(shots).padStart(3, '0');
      await page.screenshot({path: `.playwright-mcp/${opt.shots}-${name}.png`});
    }
    if (state.mode !== 'play' || state.jobN > opt.to) {
      break;
    }
  }
  return {state, log: await page.evaluate(() => window.BOT.log)};
}
