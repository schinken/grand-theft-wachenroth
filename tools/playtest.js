// Play-test bot: plays Flo's missions through the same thumb stick a phone uses.
// Run it with Playwright against a local server, e.g. `python3 -m http.server 8765`:
//   the function below takes a Playwright `page` and returns a log of every mission.
// Options come from globalThis.PLAYTEST = {from, to, shots} (mission numbers, screenshot prefix).
async (page) => {
  const opt = Object.assign({from: 0, to: 99, shots: '', url: 'http://127.0.0.1:8765/index.html'}, globalThis.PLAYTEST);
  await page.goto(opt.url);
  await page.click('#start');
  await page.evaluate(from => {
    AUDIO.mute(true);
    GTW.job(from);
    const B = window.BOT = {log: [], stuck: 0, rev: 0, last: null, tries: 0, helps: 0, walk: 0, side: 0};
    const say = s => B.log.push(`${S.t.toFixed(0).padStart(4)}s  ${s}`);
    B.tick = dt => {
      const P = S.P, j = S.job, c = P.car;
      pad.x = pad.y = 0; pad.brake = false;
      if (S.mode !== 'play' || S.wasted || !j) return;
      const st = j.step;
      let to = j.to;
      if (st.do === 'collect') to = S.items.filter(v => v.job).sort((a, b) => dist(a, P) - dist(b, P))[0];
      if (!to) return;
      const d = dist(P, to), want = st.do === 'steal' || st.do === 'take' ? j.veh : null;
      const head = (o, k = 1) => { const a = Math.atan2(o.y - P.y, o.x - P.x); pad.x = Math.cos(a) * k; pad.y = Math.sin(a) * k; };
      const far = o => dist(P, o) < 45 ? o : waypoint(field(o), P, c ? 38 : 22) || o;
      const fire = S.cars.find(o => o.burn > 0 && dist(o, P) < 14);
      if (c && c.burn) return toggleCar(); // out of a burning car
      if (!c && fire) return head({x: 2 * P.x - fire.x, y: 2 * P.y - fire.y}); // and away from it
      if (!c) {
        B.walk = (B.walk || 0) + dt; // on foot for ages: the nearest car is out of reach, try another
        if ((st.foot && d < 60) || (want && d < 60)) { // walk there, or to the car we should take
          head(d > 45 ? far(to) : to);
          if (want && d < 4.5) toggleCar();
          return;
        }
        const ride = S.cars.filter(o => !o.dead && !o.burn && !(o.ai && o.ai.cop) && !o.tr).sort((a, b) => dist(a, P) - dist(b, P))[0];
        if (!ride) return;
        head(ride);
        if (B.walk > 25) { B.walk = 0; B.helps++; say('  help: put next to a car'); P.x = ride.x + Math.sin(ride.a) * 2.5; P.y = ride.y - Math.cos(ride.a) * 2.5; } // a person would walk around the house
        if (dist(ride, P) < 4.5) toggleCar();
        return;
      }
      const sp = Math.hypot(c.vx, c.vy);
      B.walk = 0;
      if ((st.foot && d < 9) || (want && c !== want && d < 11)) { // get out and walk the rest
        pad.brake = sp > 1;
        if (sp < 4) toggleCar();
        return;
      }
      if (B.rev > 0) { B.rev -= dt; pad.brake = true; pad.x = Math.cos(c.a + B.side); pad.y = Math.sin(c.a + B.side); return; } // stuck: back out, turning
      const wp = st.do === 'collect' || st.do === 'chase' ? far(to) : (S.gps && S.gps.wp) || to;
      const stop = st.do !== 'chase' && st.do !== 'collect' && st.do !== 'lose';
      const turn = Math.abs(wrap(Math.atan2(wp.y - P.y, wp.x - P.x) - c.a)), limit = turn > .5 ? 9 : d < 30 && stop ? 9 : 21; // drive like a person, not a rocket
      head(wp, sp > limit ? .16 : 1);
      if (stop && d < 6 && sp > 5) { pad.x = pad.y = 0; pad.brake = true; }
      if (st.do === 'hold' && d < (st.r || 10) - 3) { pad.x = pad.y = 0; pad.brake = sp > 1; return; }
      if ((B.stuck += dt) > 2.5) { // no headway in a while: wedged somewhere
        const wedged = Math.hypot(P.x - B.px, P.y - B.py) < 4 && !(stop && d < 8);
        B.tries = wedged ? B.tries + 1 : 0;
        if (wedged) { B.rev = 1.6; B.side = Math.random() < .5 ? -.6 : .6; }
        if (B.tries > 2) { // still wedged after backing out twice: lift the car back onto the road
          const [l, x, y] = nearLink(P), n = NODES[l[1]];
          Object.assign(c, {x, y, a: Math.atan2(n.y - y, n.x - x), vx: 0, vy: 0, spin: 0});
          B.tries = 0; B.rev = 0; B.helps++; say('  help: car lifted back onto the road');
        }
        B.stuck = 0; B.px = P.x; B.py = P.y;
      }
    };
    B.run = secs => { // simulate without drawing, as fast as the CPU allows
      for (let i = 0; i < secs * 60 && S.mode === 'play'; i++) {
        const j = S.job, key = j ? `${j.m.id}/${j.i} ${j.step.do}` : S.jobN >= MISSIONS.length ? 'all done' : 'idle';
        if (key !== B.last) { say(key + (j && j.timed ? ` (${j.left.toFixed(0)}s left)` : '')); B.last = key; }
        B.tick(1 / 60);
        update(1 / 60);
        if (i % 15 === 0) guide(1);
      }
      return {t: S.t, jobN: S.jobN, money: S.money, stats: S.stats, mode: S.mode, helps: B.helps};
    };
    for (const name of ['waste', 'sink', 'explode', 'busted']) { // and what went wrong on the way
      const orig = window[name];
      window[name] = a => { if (name === 'waste' || name === 'busted' || a === S.P.car) say(`  ${name} ${typeof a === 'string' ? a : ''} at ${S.P.x | 0},${S.P.y | 0}`); return orig(a); };
    }
    for (const name of ['endJob', 'failJob']) { // note how every mission ends
      const orig = window[name];
      window[name] = why => { say(name === 'endJob' ? `DONE ${S.job.m.id}` : `FAIL ${S.job.m.id}: ${why} at step ${S.job.i} (${S.job.step.do})`); return orig(why); };
    }
  }, opt.from);
  let state, n = 0;
  for (let t = 0; t < (opt.secs || 2400); t += 20) {
    state = await page.evaluate(() => BOT.run(20));
    if (opt.trace) await page.evaluate(() => BOT.log.push(`      at ${S.P.x | 0},${S.P.y | 0} ${S.P.car ? S.P.car.kind : 'on foot'} heat ${S.wanted.toFixed(1)}`));
    if (opt.shots && n++ % 4 === 0) { await page.waitForTimeout(120); await page.screenshot({path: `.playwright-mcp/${opt.shots}-${String(n).padStart(3, '0')}.png`}); }
    if (state.mode !== 'play' || state.jobN > opt.to) break;
  }
  return {state, log: await page.evaluate(() => BOT.log)};
}
