// Copies index.html into _site and makes it load game.js with a hash of the
// bundle in the address, so a browser never keeps the old game after a deploy.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';

const game = readFileSync('_site/game.js');
const hash = createHash('sha256').update(game).digest('hex').slice(0, 10);
const page = readFileSync('index.html', 'utf8');
const stamped = page.replace('src="game.js"', `src="game.js?v=${hash}"`);
if (stamped === page) {
  throw new Error('index.html does not load game.js any more');
}
writeFileSync('_site/index.html', stamped);
console.log(`_site/index.html loads game.js?v=${hash}`);
