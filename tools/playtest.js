// Play-test bot: plays Flo's missions through the same thumb stick a phone
// uses, and reaches the game through window.GTW.
//
// Run it with Playwright against a local server (python3 -m http.server 8765):
// the function below takes a Playwright `page` and returns a log of every
// mission. Options come from globalThis.PLAYTEST = {from, to, secs, shots,
// trace, seed, base}: first and last mission number, seconds of game time, a
// screenshot prefix, and whether to log the position every 20 seconds.
//
// seed: a number makes the run repeatable: the same random numbers every
// time, and no frames or sound ticks of the page's own in between. Every 20
// seconds it then takes a fingerprint of the game state, the picture and the
// HUD; `print` in the result sums them up.
// base: the address of another copy of the game, say the commit before
// (git archive). Both are played with the seed, and the result says whether
// their fingerprints are the same: after a refactoring they have to be.
async page => {
  const opt = Object.assign(
    {from: 0, to: 99, secs: 2400, shots: '', trace: false, seed: 0, base: ''},
    {url: 'http://127.0.0.1:8765/index.html'},
    globalThis.PLAYTEST
  );
  if (opt.base && !opt.seed) {
    opt.seed = 1;
  }

  // Makes a page repeatable. Its own loop stops: window.oneFrame runs one
  // frame by hand, and Math.random gives the same numbers every time.
  const fixed = seed => {
    window.requestAnimationFrame = tick => {
      window.oneFrame = tick;
    };
    window.setInterval = () => 0;
    performance.now = () => 0;
    window.clock = 1e9;
    // Every canvas is drawn by the CPU: a graphics card rounds differently
    // from one run to the next.
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind) {
      return getContext.call(this, kind, {willReadFrequently: true});
    };
    // Mulberry32, as in the game
    Math.random = () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Plays one copy of the game.
  const play = async url => {
    if (opt.seed) {
      // The page gets the fixed clock and random numbers before the game.
      const first = `<head><script>(${fixed})(${opt.seed})</script>`;
      await page.route(url, async route => {
        const res = await route.fetch();
        const body = (await res.text()).replace('<head>', first);
        await route.fulfill({response: res, body});
      });
    }
    await page.goto(url);
    if (opt.seed) {
      await page.unroute(url);
      await page.waitForTimeout(300); // the yard and field masks have loaded
    }
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
        if (state.shop) {
          // In a shop: the first offer is what a job needs (the repair)
          game.buy(0);
          game.closeShop();
        }
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
        // Things at a kerb lie behind the houses as the crow flies: keep to the
        // roads until close.
        const along = to => {
          if (dist(player, to) < (step.kerb ? 12 : 45)) {
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
          const sneak = job.guards && job.guards.length > 0;
          if ((step.foot && far < (sneak ? 130 : 60)) || (wanted && far < 60)) {
            // Walk there, or to the car we should take. Up against a wall, a
            // person steps sideways for a moment.
            if ((bot.sidestep = (bot.sidestep || 0) - dt) > 0) {
              const a = Math.atan2(target.y - player.y, target.x - player.x);
              const s = bot.side < 0 ? -1 : 1;
              pad.x = Math.cos(a + s * 1.6);
              pad.y = Math.sin(a + s * 1.6);
              return;
            }
            if ((bot.footT = (bot.footT || 0) + dt) > 1.5) {
              const moved = Math.hypot(player.x - bot.fx, player.y - bot.fy);
              if (moved < 1 && far > 3) {
                bot.sidestep = 1.2;
                bot.side = -bot.side || 1;
              }
              bot.footT = 0;
              bot.fx = player.x;
              bot.fy = player.y;
            }
            if (sneak) {
              // Wait while a lamp would fall on the next steps, back off if it
              // comes this way, and run when a dog does.
              const a = Math.atan2(target.y - player.y, target.x - player.x);
              const next = {
                x: player.x + Math.cos(a) * 3,
                y: player.y + Math.sin(a) * 3,
              };
              const lit = p => job.guards.some(g => game.inSight(g, p, 3));
              if (lit(next) || lit(player)) {
                const back = lit(player) ? -1 : 0;
                pad.x = Math.cos(a) * back;
                pad.y = Math.sin(a) * back;
                return;
              }
              pad.brake = job.dogs.some(d => d.chase > 0);
            }
            head(far > 45 ? along(target) : target);
            if (wanted && far < 4.5) {
              game.toggleCar();
            }
            return;
          }
          const usable = state.cars.filter(o => {
            return !o.dead && !o.burn && !(o.ai && o.ai.cop) && !o.tr;
          });
          // The job's own vehicle if it has one: only that one counts.
          const own =
            job.veh && !job.veh.dead && !job.veh.burn ? job.veh : null;
          const ride = own || nearestOf(usable, player);
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
        const hide = job.guards && job.guards.length > 0;
        const walk = step.foot && far < (hide ? 120 : 9);
        if (walk || (wanted && car !== wanted && far < 11)) {
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
          logs: job ? job.logs : 0,
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
        if (now.logs < was.logs && now.step === was.step) {
          say(`  rammed at ${where}: wood left ${now.logs}`);
        }
        if (now.missions > was.missions) {
          say(`DONE ${was.job}`);
        } else if (was.job && !now.job) {
          const why = flash.lastElementChild.textContent || 'see above';
          say(`FAIL ${was.job}: ${why} at step ${was.step}`);
        }
        bot.seen = now;
      };

      // A fingerprint of a value and all it holds, numbers to the last bit.
      // Canvases, paths and other browser objects are left out.
      const hash = root => {
        let h = 2166136261;
        const seen = new Set();
        const num = new Float64Array(1);
        const bits = new Uint32Array(num.buffer);
        const mix = v => {
          h = Math.imul(h ^ v, 16777619);
        };
        const walk = v => {
          if (typeof v === 'number') {
            num[0] = v;
            mix(bits[0]);
            mix(bits[1]);
            return;
          }
          if (typeof v === 'string') {
            for (let i = 0; i < v.length; i++) {
              mix(v.charCodeAt(i));
            }
            return;
          }
          if (typeof v !== 'object' || !v || seen.has(v)) {
            mix(v === true ? 1 : v === false ? 2 : 3);
            return;
          }
          seen.add(v);
          if (Array.isArray(v) || ArrayBuffer.isView(v)) {
            for (let i = 0; i < v.length; i++) {
              walk(v[i]);
            }
            return;
          }
          if (Object.getPrototypeOf(v) !== Object.prototype) {
            return;
          }
          for (const k of Object.keys(v).sort()) {
            walk(k);
            walk(v[k]);
          }
        };
        walk(root);
        return (h >>> 0).toString(16).padStart(8, '0');
      };
      const pixels = id => {
        const c = document.getElementById(id);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        return hash(new Uint32Array(d.data.buffer));
      };
      // The scenery as it was built, before anything moves.
      bot.world = () => {
        const {BUILD, TREES, NODES, SPOT, PROPS, AREAS, CROSSINGS} = game;
        const built = [BUILD, TREES, NODES, SPOT, PROPS, AREAS, CROSSINGS];
        return `world ${hash([built, game.TRAIN, game.TYPES])}`;
      };
      // Two frames of the real main loop, then the state, the picture, the HUD.
      bot.print = () => {
        for (let i = 0; i < 2; i++) {
          window.oneFrame((window.clock += 1000 / 60));
        }
        const state = game.state;
        const down = game.PROPS.filter(p => p.down).length;
        const cut = game.TREES.filter(t => t.cut).length;
        const hud = document.getElementById('hud').innerHTML;
        const what = [hash([state, down, cut]), pixels('game'), hash(hud)];
        return `${state.t.toFixed(2)} ${bot.last} ${what.join(' ')}`;
      };
      // The fold-out map, drawn by the main loop like everything else.
      bot.map = () => {
        game.showMap(true);
        window.oneFrame((window.clock += 1000 / 60));
        const print = `map ${pixels('map')}`;
        game.showMap(false);
        return print;
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
            const left =
              job && job.timed ? ` (${job.left.toFixed(0)}s left)` : '';
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

    const prints = [];
    if (opt.seed) {
      prints.push(await page.evaluate(() => window.BOT.world()));
    }
    let state;
    let shots = 0;
    for (let t = 0; t < opt.secs; t += 20) {
      state = await page.evaluate(() => window.BOT.run(20));
      if (opt.seed) {
        prints.push(await page.evaluate(() => window.BOT.print()));
      }
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
        await page.screenshot({
          path: `.playwright-mcp/${opt.shots}-${name}.png`,
        });
      }
      if (state.mode !== 'play' || state.jobN > opt.to) {
        break;
      }
    }
    if (opt.seed) {
      prints.push(await page.evaluate(() => window.BOT.map()));
    }
    return {state, log: await page.evaluate(() => window.BOT.log), prints};
  };

  // All fingerprints in one.
  const sum = prints => {
    let h = 0;
    for (const ch of prints.join()) {
      h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
    }
    return `${prints.length} prints, ${(h >>> 0).toString(16)}`;
  };
  if (!opt.base) {
    const {state, log, prints} = await play(opt.url);
    return opt.seed ? {state, log, print: sum(prints)} : {state, log};
  }
  const was = await play(opt.base);
  const now = await play(opt.url);
  const at = now.prints.findIndex((p, i) => p !== was.prints[i]);
  if (at < 0 && now.prints.length === was.prints.length) {
    return {same: true, print: sum(now.prints), state: now.state};
  }
  // Each line: game time, job and step, then state, picture and HUD.
  return {
    same: false,
    at,
    was: was.prints.slice(Math.max(0, at - 1), at + 2),
    now: now.prints.slice(Math.max(0, at - 1), at + 2),
    log: now.log.slice(-12),
  };
}
