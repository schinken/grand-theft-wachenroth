'use strict';
// Flo Ganzmann's jobs. Place keys come from the POIS table in tools/osm2map.py.
//
// Step kinds:
//   goto    reach a place (foot: true = walk in)        steal   take the car that waits at a place
//   bring   park the mission car at a place             collect pick up n things scattered near a place
//   hold    stay at a place for some seconds            chase   ram the getaway car until it gives up
//   take    get into the car you just stopped           lose    shake off the police
// Options: time (seconds, runs on until the next `time`), fragile (crashes break the load),
// wanted (police heat), drop (the mission car is no longer needed), say (Flo on the pager).

const PLACES = {
  hq: 'Flos Hauptquartier', murk: 'Bekleidungshaus Murk', tanke: 'Tankautomat Murk', wasch: 'Waschstraße Murk',
  baeck: 'Wachenröther Bäck', markt: 'Mein Markt 24', sport: 'Sportheim SV Wachenroth', platz: 'Sportplatz SV Wachenroth',
  roeck: 'Röckelein Baustoffwerk', rathaus: 'Rathaus', kirche: 'St. Gertrud', schule: 'Grundschule', halle: 'Ebrachtalhalle',
  ffw: 'Feuerwehr Wachenroth', kiga: 'Kita Villa Kunterbunt', bank: 'Raiffeisenbank', friedhof: 'Friedhof',
  klaer: 'Kläranlage', deponie: 'Bauschuttdeponie', bahnhof: 'Alter Bahnhof', beach: 'Beachvolleyballplatz',
  lavite: 'Pizzeria La Vite', adler: 'Schwarzer Adler', baum: 'Gasthaus Grüner Baum', maras: 'Mara\'s Marktschänke',
  metzger: 'Metzgerei Braun', weiher: 'Karpfenweiher', hof: 'Bauernhof', spielplatz: 'Spielplatz',
  schwall: 'Schwallclub', baustelle: 'Baustelle Schulstraße', getraenke: 'Getränke Braun', lagerhaus: 'Lagerhaus',
  festplatz: 'Kerwa-Festplatz', linsner: 'Gasthof Linsner',
};

// Painted on the roofs of the landmarks.
const SIGNS = {murk: 'MURK', roeck: 'RÖCKELEIN', halle: 'EBRACHTALHALLE', ffw: 'FEUERWEHR', rathaus: 'RATHAUS',
  sport: 'SV WACHENROTH', markt: 'MEIN MARKT 24', baeck: 'BÄCK', hq: 'FLO', schule: 'SCHULE', lagerhaus: 'LAGERHAUS'};

const RANKS = [[10000, 'Pate von Wachenroth'], [7500, 'Rechte Hand vom Flo'], [5000, 'Schwallkönig'], [2500, 'Kerwasbursch'], [-1e9, 'Dorfdepp']];

const TALK = {
  hello: ['Servus! Hier ist der Flo Ganzmann.', 'Du willst in Wachenroth was werden? Dann arbeitest du ab heute für mich.',
    'Mein Hauptquartier: Johann-Philipp-Ring 9. Merk dir das.'],
  back: ['Da bist du ja wieder. Weiter geht\'s!'],
  scold: ['Allmächd! Das war nix. Gleich nochmal.', 'So ein Gschmarri. Meine Oma fährt besser, und die hat keinen Führerschein.',
    'Fei net dein Ernst. Nochmal von vorn!', 'Des war a weng wenig. Ich meld mich gleich wieder.'],
  busted: ['Die Polizei aus Höchstadt hat angerufen. Ich kenn dich nicht, hab ich gesagt.',
    'Erwischt! Nächstes Mal fährst du durch die Waschstraße beim Murk, dann erkennt dich keiner.'],
  wasted: ['Lebst du noch? Gut. Die Rechnung vom Krankenhaus zahlst du selber.', 'Allmächd, wie schaust du denn aus! Aufstehen, weitermachen.'],
};

const MISSIONS = [
  {id: 'dosen', title: 'Dosen zum Saufen', reward: 300,
    intro: ['Ich hab Durst. Großen Durst.', 'Hol mir Dosen zum Saufen: Jacky Cola! Der Mein Markt 24 in der Reumannswinder Straße hat welche.'],
    steps: [
      {do: 'goto', to: 'markt', foot: true, obj: 'Geh zu Fuß in den Mein Markt 24'},
      {do: 'collect', n: 5, near: 'markt', r: 300, item: 'dose', obj: 'Sammle 5 Dosen Jacky Cola ein',
        say: 'Die Claudia sagt: Der Lieferant hat die Palette auf der Straße verloren. Sammel die Dosen ein!'},
      {do: 'goto', to: 'hq', time: 90, obj: 'Bring die Dosen zum Flo, Johann-Philipp-Ring 9',
        say: 'Sauber! Jetzt her damit, bevor sie warm werden. Johann-Philipp-Ring 9!'},
    ],
    outro: ['Zisch! Ahh. Des is fei a Dosen zum Saufen.', 'Du bist brauchbar. Ich meld mich.']},

  {id: 'brotzeit', title: 'Brotzeit für den SV', reward: 400,
    intro: ['Der SV Wachenroth spielt, und im Sportheim ist die Brotzeit aus. Eine Katastrophe!', 'Hol Essen bei der Claudia im Mein Markt 24.'],
    steps: [
      {do: 'goto', to: 'markt', foot: true, obj: 'Hol das Essen im Mein Markt 24 (zu Fuß rein)'},
      {do: 'goto', to: 'metzger', foot: true, obj: 'Hol Leberkäs bei der Metzgerei in der Kellerstraße',
        say: 'Und Leberkäs vom Metzger in der Kellerstraße. Ohne Leberkäs kein Sieg.'},
      {do: 'goto', to: 'sport', time: 80, obj: 'Bring die Brotzeit zum Sportheim vom SV',
        say: 'Gleich ist Halbzeit! Ab zum Sportplatz, aber flott!'},
    ],
    outro: ['Die Mannschaft ist satt und gewinnt 3:1. Mit rot-weißem Gruß!']},

  {id: 'beton', title: 'Stillstand ist Rückstand', reward: 600,
    intro: ['Die Schulstraße wird neu gemacht, aber der Beton fehlt.', 'Beim Röckelein steht ein voller Betonmischer rum. Den leihst du dir aus. Dauerhaft.'],
    steps: [
      {do: 'steal', veh: 'mixer', at: 'roeck', obj: 'Klau den Betonmischer beim Röckelein'},
      {do: 'bring', to: 'baustelle', time: 110, wanted: 1, obj: 'Fahr den Beton zur Baustelle Schulstraße',
        say: 'Der Beton wird hart! Fahr zur Baustelle in der Schulstraße, schnell!'},
    ],
    outro: ['Stillstand ist Rückstand! Die Bauarbeiter sagen danke.', 'Den Mischer lässt du da stehen. Der gehört jetzt der Gmaa.']},

  {id: 'weizen', title: 'Weizen für den Bäck', reward: 600,
    intro: ['Der Wachenröther Bäck hat kein Mehl mehr. Ohne Weizen keine Semmeln!', 'Am Lagerhaus Am Graben steht ein Bulldog mit einem Hänger voll Weizen.'],
    steps: [
      {do: 'steal', veh: 'tractor', trailer: 'grain', at: 'lagerhaus', obj: 'Klau den Bulldog mit dem Weizen am Lagerhaus'},
      {do: 'bring', to: 'baeck', time: 100, obj: 'Bring den Weizen zum Wachenröther Bäck, Hauptstraße 1',
        say: 'Der Bäck macht um zehn zu! Gib Gas, soweit das mit einem Bulldog geht.'},
      {do: 'goto', to: 'halle', time: 70, drop: true, obj: 'Bring die Krapfen zur Ebrachtalhalle',
        say: 'Zum Dank gibt es Krapfen. Bring sie zum Kinderfasching in die Ebrachtalhalle!'},
    ],
    outro: ['Back to the roots! Die Kinder sind voller Puderzucker.']},

  {id: 'bier', title: 'Bier für den Schwallclub', reward: 700,
    intro: ['Notfall beim Schwallclub: Das Bier ist aus!', 'Beim Getränkehandel in Kleinwachenroth steht ein voller Bierlaster. Du weißt, was zu tun ist.'],
    steps: [
      {do: 'steal', veh: 'truck', at: 'getraenke', obj: 'Klau den Bierlaster in Kleinwachenroth'},
      {do: 'bring', to: 'schwall', time: 130, fragile: true, obj: 'Bring das Bier heil zum Schwallclub, Hauptstraße 2',
        say: 'Vorsichtig! Jeder Rempler kostet Seidla. Ab zum Schwallclub, gegenüber vom Bäck.'},
    ],
    outro: ['Die Schwaller lassen dich hochleben. Prost!', 'Geselligkeit und Tradition, und du mittendrin.']},

  {id: 'murk', title: 'Feiner Zwirn', reward: 800,
    intro: ['Bald ist Kerwa, und ich hab nix zum Anziehen.', 'Beim Bekleidungshaus Murk hängen die besten Anzüge weit und breit. Hol mir einen. Zahlen tun wir später. Vielleicht.'],
    steps: [
      {do: 'goto', to: 'murk', foot: true, obj: 'Geh zu Fuß ins Bekleidungshaus Murk'},
      {do: 'lose', to: 'wasch', wanted: 2.3, obj: 'Häng die Polizei ab (Tipp: Waschstraße beim Murk)',
        say: 'Der Alarm! Die Polizei aus Höchstadt ist unterwegs. Fahr durch die Waschstraße beim Murk, dann erkennt dich keiner!'},
      {do: 'goto', to: 'hq', obj: 'Bring den Anzug zum Flo', say: 'Sauber abgehängt. Jetzt bring mir den Anzug.'},
    ],
    outro: ['Passt wie angegossen. Mode, Marken, Menschen!']},

  {id: 'feuer', title: 'Johannifeuer', reward: 800,
    props: [{k: 'fire', at: 'platz', until: 3}],
    intro: ['Allmächd! Das Johannifeuer am Sportplatz ist außer Kontrolle.', 'Die Feuerwehr sitzt noch beim Frühschoppen. Nimm ihr Löschfahrzeug, Am Graben 7!'],
    steps: [
      {do: 'steal', veh: 'fire', at: 'ffw', obj: 'Klau das Löschfahrzeug bei der Feuerwehr'},
      {do: 'bring', to: 'platz', time: 100, obj: 'Fahr zum Sportplatz vom SV',
        say: 'Tatütata! Mit der Hupe geht das Blaulicht an. Ab zum Sportplatz!'},
      {do: 'hold', to: 'platz', secs: 6, r: 12, veh: true, fx: 'water', time: 0, obj: 'Wasser marsch! Bleib beim Feuer stehen'},
    ],
    outro: ['Feuer aus, Rasen gerettet. Der Platzwart weint vor Glück.']},

  {id: 'karpfen', title: 'Aischgründer Gold', reward: 700,
    intro: ['Im Grünen Baum sind die Karpfen aus. Ein Skandal im Aischgrund!', 'Im Weiher hinter Kleinwachenroth schwimmen die dicksten. Hol welche raus.'],
    steps: [
      {do: 'collect', n: 4, near: 'weiher', r: 230, item: 'fisch', obj: 'Fang 4 Karpfen am Weiher hinter Kleinwachenroth'},
      {do: 'goto', to: 'baum', time: 110, obj: 'Bring die Karpfen zum Gasthaus Grüner Baum',
        say: 'Frisch müssen sie sein! Ab zum Grünen Baum in die Hauptstraße.'},
    ],
    outro: ['Pfefferkarpfen für alle! Du kriegst die Karpfenchips aufs Haus.']},

  {id: 'maibaum', title: 'Der Baam', reward: 1000,
    intro: ['Sauerei! Ein paar Burschen aus Höchstadt haben unseren Maibaum geklaut.', 'Die fahren mit dem Baam durchs Dorf. Ramm den Bulldog, bis sie aufgeben!'],
    steps: [
      {do: 'chase', veh: 'tractor', trailer: 'log', at: 'rathaus', hits: 4, obj: 'Ramm den Bulldog mit dem Maibaum'},
      {do: 'take', obj: 'Steig in den Bulldog mit dem Maibaum', say: 'Sie rennen! Jetzt schnapp dir den Bulldog.'},
      {do: 'bring', to: 'rathaus', time: 150, obj: 'Bring den Maibaum zum Dorfplatz am Rathaus',
        say: 'Um 19 Uhr wird aufgestellt. Bring den Baam zum Rathaus!'},
    ],
    outro: ['Der Baam steht! Die Baamwacht hält heut der Schwallclub.']},

  {id: 'pizza', title: 'Pizza-Express', reward: 700,
    intro: ['Hunger! Und nicht nur ich.', 'Hol Pizza bei La Vite in der Reumannswinder Straße und fahr sie aus.'],
    steps: [
      {do: 'goto', to: 'lavite', foot: true, obj: 'Hol die Pizzen bei La Vite (zu Fuß rein)'},
      {do: 'goto', to: 'klaer', time: 80, obj: 'Pizza zur Kläranlage',
        say: 'Erste Pizza: Kläranlage. Der Klärwärter hat sich eine Salami verdient.'},
      {do: 'goto', to: 'deponie', time: 75, obj: 'Pizza zur Bauschuttdeponie', say: 'Nummer zwei: Bauschuttdeponie. Frag nicht.'},
      {do: 'goto', to: 'hq', time: 60, obj: 'Pizza zum Flo', say: 'Die letzte ist für mich. Mit extra Käse. Und vergiss das Tiramisu nicht!'},
    ],
    outro: ['Mmh. Noch warm. Du bist schneller als jeder Lieferdienst.']},

  {id: 'kerwa', title: 'Kerwa ausgraben', reward: 900,
    props: [{k: 'zelt', at: 'festplatz'}],
    intro: ['Die Kerwa wird ausgegraben! Drei Fässer sind im Dorf versteckt.', 'Zwei mit Wasser, eins mit Bier. Find alle drei, bevor es die Kerwasburschen tun.'],
    steps: [
      {do: 'collect', n: 3, near: 'kirche', r: 420, item: 'fass', time: 160, obj: 'Finde die 3 Kerwa-Fässer'},
      {do: 'goto', to: 'festplatz', obj: 'Bring die Fässer zum Festzelt an der Kirchstraße',
        say: 'Du hast sie! Bring die Fässer zum Festzelt hinter dem Pfarrhaus.'},
    ],
    outro: ['Ozapft is! Die Kerwa kann anfangen.']},

  {id: 'finale', title: 'Kerwa-Samstag', reward: 1500,
    props: [{k: 'wer', at: 'hq', until: 1, col: '#e0b21c'}, {k: 'wer', at: 'halle', until: 2, col: '#2f5fa8'},
      {k: 'wer', at: 'halle', until: 2, col: '#b3372f', dx: 1.5}, {k: 'zelt', at: 'festplatz'}],
    intro: ['Heut ist Kerwa-Samstag, und ich komm net weg: Die Polizei steht vor meiner Tür.', 'Hol mich am Hauptquartier ab. Und dann die Musik!'],
    steps: [
      {do: 'goto', to: 'hq', obj: 'Hol den Flo am Hauptquartier ab'},
      {do: 'goto', to: 'halle', wanted: 2.5, obj: 'Hol die Blaskapelle an der Ebrachtalhalle ab',
        say: 'Los! Zur Ebrachtalhalle, die Blaskapelle wartet. Und häng die Polizei ab!'},
      {do: 'goto', to: 'festplatz', time: 120, wanted: 1, obj: 'Bring alle zum Festzelt an der Kirchstraße',
        say: 'Alle drin? Dann auf zum Festzelt!'},
    ],
    outro: ['Wir sind da! Die Musik spielt, das Bier läuft.', 'Wachenroth gehört jetzt uns. Also mir. Aber du darfst mitfeiern.']},
];
