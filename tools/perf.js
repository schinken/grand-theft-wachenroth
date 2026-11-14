// Performance probe: start-up time, frame times, the hottest functions and the
// load on the GPU thread, with the CPU slowed down to roughly a mid-range
// phone.
//
// Run it with Playwright against a local server, like tools/playtest.js. The
// function takes a Playwright `page` and returns the numbers. Options come
// from globalThis.PERF = {throttle, secs, width, height}.
async page => {
  const opt = Object.assign(
    {throttle: 4, secs: 6, width: 1280, height: 720},
    {url: 'http://127.0.0.1:8765/index.html'},
    globalThis.PERF
  );
  await page.setViewportSize({width: opt.width, height: opt.height});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: opt.throttle});
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', {interval: 500});

  await page.goto(`${opt.url}?perf=${Date.now()}`);
  const startupMs = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return Math.round(nav.domContentLoadedEventStart - nav.responseEnd);
  });

  // Frame times over some seconds, with the hottest functions, and how long
  // the browser's GPU thread works for every second of play: that thread
  // turns the canvas commands into pixels and is not slowed by the throttle.
  const browser = page.context().browser();
  const measure = async () => {
    await browser.startTracing(page, {categories: ['toplevel']});
    await cdp.send('Profiler.start');
    const frames = await page.evaluate(secs => {
      return new Promise(resolve => {
        const gaps = [];
        const begin = performance.now();
        let last = begin;
        const tick = now => {
          gaps.push(now - last);
          last = now;
          if (now - begin < secs * 1000) {
            requestAnimationFrame(tick);
          } else {
            gaps.sort((a, b) => a - b);
            resolve({
              fps: Math.round((gaps.length * 1000) / (now - begin)),
              medianMs: +gaps[gaps.length >> 1].toFixed(1),
              p95Ms: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
              maxMs: +gaps[gaps.length - 1].toFixed(1),
            });
          }
        };
        requestAnimationFrame(tick);
      });
    }, opt.secs);
    const {profile} = await cdp.send('Profiler.stop');
    const trace = JSON.parse((await browser.stopTracing()).toString());
    const threads = new Map();
    const work = new Map();
    for (const event of trace.traceEvents) {
      const key = `${event.pid}:${event.tid}`;
      if (event.ph === 'M' && event.name === 'thread_name') {
        threads.set(key, event.args.name);
      } else if (event.ph === 'X' && event.dur && /RunTask/.test(event.name)) {
        work.set(key, (work.get(key) || 0) + event.dur / 1000);
      }
    }
    let gpuMsPerSec = 0;
    for (const [key, ms] of work) {
      if (threads.get(key) === 'CrGpuMain') {
        gpuMsPerSec = Math.round(ms / opt.secs);
      }
    }
    const self = new Map();
    const byId = new Map(profile.nodes.map(node => [node.id, node]));
    const step = profile.timeDeltas;
    profile.samples.forEach((id, i) => {
      const frame = byId.get(id).callFrame;
      const name = frame.functionName || '(anonymous)';
      self.set(name, (self.get(name) || 0) + step[i] / 1000);
    });
    const total = (profile.endTime - profile.startTime) / 1000;
    const idle = self.get('(idle)') || 0;
    const hot = [...self]
      .filter(([name]) => name !== '(idle)' && name !== '(program)')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([name, ms]) => `${name} ${((ms / total) * 100).toFixed(1)}%`);
    const share = ms => `${((ms / total) * 100).toFixed(0)}%`;
    // `busy` is everything but idle; `native` is browser work outside scripts.
    const busy = share(total - idle);
    const native = share(self.get('(program)') || 0);
    return {...frames, busy, native, gpuMsPerSec, hot};
  };

  // 1. The title screen: the camera circles over the village, zoomed out.
  const menu = await measure();

  // 2. In the game: a car is pulled along the main road through the village.
  await page.click('#start');
  await page.evaluate(() => {
    const game = window.GTW;
    const state = game.state;
    state.nextJob = 1e9;
    game.audio.mute(true);
    game.tp('club');
    game.toggleCar();
    const car = state.player.car || game.makeCar(0, 0, 0, 'car');
    state.player.car = car;
    const from = game.SPOT.club;
    const to = game.SPOT.murk;
    const path = game.routeLine(game.field(to), from, to);
    const begin = performance.now();
    const pull = now => {
      let left = (((now - begin) / 1000) * 18) % game.pathLength(path);
      for (let i = 2; i < path.length; i += 2) {
        const dx = path[i] - path[i - 2];
        const dy = path[i + 1] - path[i - 1];
        const len = Math.hypot(dx, dy);
        if (left <= len && len > 0) {
          const k = left / len;
          Object.assign(car, {
            x: path[i - 2] + dx * k,
            y: path[i - 1] + dy * k,
            a: Math.atan2(dy, dx),
            vx: (dx / len) * 18,
            vy: (dy / len) * 18,
            hp: 100,
          });
          break;
        }
        left -= len;
      }
      requestAnimationFrame(pull);
    };
    requestAnimationFrame(pull);
  });
  const play = await measure();

  await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});
  await cdp.detach();
  return {throttle: opt.throttle, startupMs, menu, play};
}
