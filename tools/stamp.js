// Copies index.html into _site and makes it load game.js?version= with a hash
// of the bundle, so every deploy that changes the game gets a fresh file and no
// browser keeps the old one. The same game keeps the same address and stays
// cached.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';

const game = readFileSync('_site/game.js');
const hash = createHash('sha256').update(game).digest('hex').slice(0, 10);
const page = readFileSync('index.html', 'utf8');
const stamped = page.replace('src="game.js"', `src="game.js?version=${hash}"`);
if (stamped === page) {
  throw new Error('index.html does not load game.js any more');
}
writeFileSync('_site/index.html', stamped);
console.log(`_site/index.html loads game.js?version=${hash}`);
