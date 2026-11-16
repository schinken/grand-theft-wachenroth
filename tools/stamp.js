// Gives the bundle a new file name for every build that changes it,
// game.<hash>.js, and copies index.html into _site loading that file. A
// browser never keeps the old game after a deploy, and the same game keeps the
// same name and stays cached.
import {createHash} from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

const game = readFileSync('_site/game.js');
const hash = createHash('sha256').update(game).digest('hex').slice(0, 10);
const name = `game.${hash}.js`;
for (const old of readdirSync('_site')) {
  if (/^game\.[0-9a-f]{10}\.js$/.test(old)) {
    rmSync(`_site/${old}`); // from an earlier build here
  }
}
renameSync('_site/game.js', `_site/${name}`);
const page = readFileSync('index.html', 'utf8');
const stamped = page.replace('src="src/main.js"', `src="${name}"`);
if (stamped === page) {
  throw new Error('index.html does not load src/main.js any more');
}
writeFileSync('_site/index.html', stamped);
console.log(`_site/index.html loads ${name}`);
