// Flo's jobs. Place keys come from the POIS table in tools/osm2map.py.
//
// Step kinds:
// goto reach a place (foot: true = walk in) steal take the car that waits at a
// place
// bring park the mission car at a place collect pick up n things scattered near
// a place
// hold stay at a place for some seconds chase ram the getaway car until it
// gives up
// take get into the car you just stopped lose shake off the police
// Options: time (seconds, runs on until the next `time`), fragile (crashes
// break the load), tip (seconds left pay extra),
// wanted (police heat), drop (the mission car is no longer needed), say (Flo on
// the pager), drunk (seconds of being drunk), fix (done only once the police
// have let go), load (what the trailer carries from now on), thieves (cars that
// ram you), logs (rams by the thieves the wood on the cart takes), doris (Mama
// Doris guards her hens), loose (things to collect lie anywhere, not on the
// road), kerb (they stand at the kerb in front of houses), db (the noise the
// rockers make: 10 dB less for each one met), got (what you call out once the
// step is done).
// A mission with sober: true ends the drunkenness; one with drunk: n leaves you
// drunk for n seconds.

export const PLACES = {
  hq: 'Flos Hauptquartier',
  murk: 'Bekleidungshaus Murk',
  fuel: 'Tankautomat Murk',
  carwash: 'Waschstraße Murk',
  bakery: 'Wachenröther Bäck',
  shop: 'Edeka Claudia',
  clubhouse: 'Sportheim SV Wachenroth',
  pitch: 'Sportplatz SV Wachenroth',
  works: 'Röckelein Baustoffwerk',
  depot: 'Röckelein Werkshof',
  townhall: 'Rathaus',
  church: 'St. Gertrud',
  school: 'Grundschule',
  hall: 'Ebrachtalhalle',
  firestation: 'Feuerwehr Wachenroth',
  kindergarten: 'Kita Villa Kunterbunt',
  bank: 'Raiffeisenbank',
  cemetery: 'Friedhof',
  sewage: 'Kläranlage',
  dump: 'Bauschuttdeponie',
  station: 'Alter Bahnhof',
  beach: 'Beachvolleyballplatz',
  lavite: 'Pizzeria La Vite',
  adler: 'Schwarzer Adler',
  inn: 'Gasthaus Grüner Baum',
  maras: "Mara's Marktschänke",
  butcher: 'Metzgerei Braun',
  pond: 'Karpfenweiher',
  farmyard: 'Bauernhof',
  playground: 'Spielplatz',
  club: 'Schwallclub',
  roadworks: 'Baustelle Schulstraße',
  drinks: 'Getränke Braun',
  garage: 'Mechanic Monkeys',
  forest: 'Wald am Johann-Philipp-Ring',
  schul22: 'Michi, Schulstraße 22',
  muehle: 'Kleinwachenrother Mühle',
  koppel: 'Koppel of Rock',
  warehouse: 'Lagerhaus Grönert',
  fairground: 'Kerwa-Festplatz',
  sammelstelle: 'Christbaum-Sammelstelle',
  streuobst: 'Streuobstwiese',
  toxicity: 'Toxicity',
  linsner: 'Gasthof Linsner',
};

// Painted on the roofs of the landmarks.
export const SIGNS = {
  murk: 'MURK',
  works: 'RÖCKELEIN',
  hall: 'EBRACHTALHALLE',
  firestation: 'FEUERWEHR',
  townhall: 'RATHAUS',
  clubhouse: 'SV WACHENROTH',
  shop: 'EDEKA CLAUDIA',
  bakery: 'BÄCK',
  hq: 'FLO',
  school: 'SCHULE',
  warehouse: 'LAGERHAUS',
  garage: 'MECHANIC MONKEYS',
};

export const RANKS = [
  [10000, 'Pate von Wachenroth'],
  [7500, 'Rechte Hand vom Flo'],
  [5000, 'Schwallkönig'],
  [2500, 'Kerwasbursch'],
  [-1e9, 'Dorfdepp'],
];

export const TALK = {
  hello: [
    'Servus! Hier ist der Flo.',
    'Du willst in Wachenroth was werden? Dann arbeitest du ab heute für mich.',
    'Mein Hauptquartier: Johann-Philipp-Ring 9. Merk dir das.',
  ],
  back: ["Da bist du ja wieder. Weiter geht's!"],
  scold: [
    'Allmächd! Das war nix. Gleich nochmal.',
    'So ein Gschmarri. Meine Oma fährt besser, und die hat keinen Führerschein.',
    'Fei net dein Ernst. Nochmal von vorn!',
    'Des war a weng wenig. Ich meld mich gleich wieder.',
  ],
  busted: [
    'Die Polizei aus Höchstadt hat angerufen. Ich kenn dich nicht, hab ich gesagt.',
    'Erwischt! Nächstes Mal fährst du durch die Waschstraße beim Murk, dann erkennt dich keiner.',
  ],
  wasted: [
    'Lebst du noch? Gut. Die Rechnung vom Krankenhaus zahlst du selber.',
    'Allmächd, wie schaust du denn aus! Aufstehen, weitermachen.',
  ],
  free: [
    'Keine Aufträge mehr. Wachenroth gehört dir.',
    'Fahr rum, heb das Geld auf, das rumliegt, und lass dir beim Bernhard die Karre aufmotzen.',
  ],
};

export const MISSIONS = [
  {
    id: 'cans',
    title: 'Dosen zum Saufen',
    reward: 300,
    intro: [
      'Ich hab Durst. Großen Durst.',
      'Hol mir Dosen zum Saufen: Jacky Cola! Die Claudia im Edeka in der Reumannswinder Straße hat welche. Nimm das Auto, das ist ein guter Kilometer.',
    ],
    steps: [
      {
        do: 'goto',
        to: 'shop',
        foot: true,
        obj: 'Fahr zum Edeka Claudia und geh zu Fuß rein',
      },
      {
        do: 'collect',
        n: 5,
        near: 'shop',
        r: 300,
        item: 'can',
        obj: 'Sammle 5 Dosen Jacky Cola ein',
        say: 'Die Claudia sagt: Der Lieferant hat die Palette auf der Straße verloren. Sammel die Dosen ein!',
      },
      {
        do: 'goto',
        to: 'hq',
        time: 90,
        obj: 'Bring die Dosen zum Flo, Johann-Philipp-Ring 9',
        say: 'Sauber! Jetzt her damit, bevor sie warm werden. Johann-Philipp-Ring 9!',
      },
    ],
    outro: [
      'Zisch! Ahh. Des is fei a Dosen zum Saufen.',
      'Du bist brauchbar. Ich meld mich.',
    ],
  },

  {
    id: 'snack',
    title: 'Brotzeit für den SV',
    reward: 400,
    intro: [
      'Der SV Wachenroth spielt, und im Sportheim ist die Brotzeit aus. Eine Katastrophe!',
      'Hol Essen bei der Claudia im Edeka.',
    ],
    steps: [
      {
        do: 'goto',
        to: 'shop',
        foot: true,
        obj: 'Fahr zum Edeka Claudia und hol das Essen (zu Fuß rein)',
      },
      {
        do: 'goto',
        to: 'butcher',
        foot: true,
        obj: 'Fahr zur Metzgerei in der Kellerstraße (zu Fuß rein)',
        say: 'Und Leberkäs vom Metzger in der Kellerstraße. Ohne Leberkäs kein Sieg.',
      },
      {
        do: 'goto',
        to: 'clubhouse',
        time: 80,
        obj: 'Bring die Brotzeit zum Sportheim vom SV',
        say: 'Gleich ist Halbzeit! Ab zum Sportplatz, aber flott!',
      },
    ],
    outro: ['Die Mannschaft ist satt und gewinnt 3:1. Mit rot-weißem Gruß!'],
  },

  {
    id: 'pizza',
    title: 'Pizza-Express',
    reward: 500,
    intro: [
      'Der Fahrer von der Pizzeria La Vite ist krank, und die Bestellungen stapeln sich.',
      'Ich hab gesagt, du springst ein. Der Pizza-Flitzer steht vor der Tür, Reumannswinder Straße 5!',
    ],
    steps: [
      {
        do: 'steal',
        veh: 'pizza',
        at: 'lavite',
        obj: 'Steig in den Pizza-Flitzer bei La Vite',
      },
      {
        do: 'bring',
        to: 'clubhouse',
        time: 85,
        tip: true,
        obj: 'Sechs Familienpizzen zum Sportheim vom SV',
        say: 'Vier Bestellungen. Je schneller du lieferst, desto mehr Trinkgeld! Erst zum Sportheim.',
      },
      {
        do: 'bring',
        to: 'firestation',
        time: 120,
        tip: true,
        obj: 'Pizza Diavolo zur Feuerwehr, Am Graben 7',
        say: 'Die Feuerwehr hat Diavolo bestellt. Extra scharf, die können ja löschen.',
      },
      {
        do: 'bring',
        to: 'sewage',
        time: 75,
        tip: true,
        obj: 'Pizza Salami zur Kläranlage',
        say: 'Jetzt raus zur Kläranlage. Der Klärwärter hat sich seine Salami verdient.',
      },
      {
        do: 'bring',
        to: 'hq',
        time: 100,
        tip: true,
        obj: 'Die letzte Pizza zum Flo, Johann-Philipp-Ring 9',
        say: 'Und die letzte ist für mich. Mit extra Käse. Vergiss das Tiramisu nicht!',
      },
    ],
    outro: [
      'Alle satt, keiner hat gemeckert. La Vite will dich fest anstellen.',
      'Das Tiramisu behalte ich als Vermittlungsgebühr.',
    ],
  },

  {
    id: 'concrete',
    title: 'Stillstand ist Rückstand',
    reward: 600,
    intro: [
      'Die Schulstraße wird neu gemacht, aber der Beton fehlt.',
      'Beim Röckelein steht ein voller Betonmischer rum. Den leihst du dir aus. Dauerhaft.',
    ],
    steps: [
      {
        do: 'steal',
        veh: 'mixer',
        at: 'depot',
        obj: 'Klau den Betonmischer beim Röckelein',
      },
      {
        do: 'bring',
        to: 'roadworks',
        time: 110,
        wanted: 1,
        obj: 'Fahr den Beton zur Baustelle Schulstraße',
        say: 'Der Beton wird hart! Fahr zur Baustelle in der Schulstraße, schnell!',
      },
    ],
    outro: [
      'Stillstand ist Rückstand! Die Bauarbeiter sagen danke.',
      'Den Mischer lässt du da stehen. Der gehört jetzt der Gmaa.',
    ],
  },

  {
    id: 'wheat',
    title: 'Weizen für den Bäck',
    reward: 600,
    intro: [
      'Der Wachenröther Bäck hat kein Mehl mehr. Ohne Weizen keine Semmeln!',
      'Am Lagerhaus Am Graben steht ein Bulldog mit einem Hänger voll Weizen.',
    ],
    steps: [
      {
        do: 'steal',
        veh: 'tractor',
        trailer: 'grain',
        at: 'warehouse',
        obj: 'Klau den Bulldog mit dem Weizen am Lagerhaus',
      },
      {
        do: 'bring',
        to: 'bakery',
        time: 100,
        obj: 'Bring den Weizen zum Wachenröther Bäck, Hauptstraße 1',
        say: 'Der Bäck macht um zehn zu! Gib Gas, soweit das mit einem Bulldog geht.',
      },
      {
        do: 'goto',
        to: 'hall',
        time: 70,
        drop: true,
        obj: 'Bring die Krapfen zur Ebrachtalhalle',
        say: 'Zum Dank gibt es Krapfen. Bring sie zum Kinderfasching in die Ebrachtalhalle!',
      },
    ],
    outro: ['Back to the roots! Die Kinder sind voller Puderzucker.'],
  },

  {
    id: 'beer',
    title: 'Bier für den Schwallclub',
    reward: 700,
    intro: [
      'Notfall beim Schwallclub: Das Bier ist aus!',
      'Beim Getränkehandel in Kleinwachenroth steht ein voller Bierlaster. Du weißt, was zu tun ist.',
    ],
    steps: [
      {
        do: 'steal',
        veh: 'truck',
        at: 'drinks',
        obj: 'Klau den Bierlaster in Kleinwachenroth',
      },
      {
        do: 'bring',
        to: 'club',
        time: 130,
        fragile: true,
        obj: 'Bring das Bier heil zum Schwallclub, Hauptstraße 2',
        say: 'Vorsichtig! Jeder Rempler kostet Seidla. Ab zum Schwallclub, gegenüber vom Bäck.',
      },
    ],
    outro: [
      'Die Schwaller lassen dich hochleben. Prost!',
      'Geselligkeit und Tradition, und du mittendrin.',
    ],
  },

  {
    id: 'suit',
    title: 'Feiner Zwirn',
    reward: 800,
    intro: [
      'Bald ist Kerwa, und ich hab nix zum Anziehen.',
      'Beim Bekleidungshaus Murk hängen die besten Anzüge weit und breit. Hol mir einen. Zahlen tun wir später. Vielleicht.',
    ],
    steps: [
      {
        do: 'goto',
        to: 'murk',
        foot: true,
        obj: 'Fahr zum Bekleidungshaus Murk und geh zu Fuß rein',
      },
      {
        do: 'lose',
        to: 'carwash',
        wanted: 2.3,
        obj: 'Häng die Polizei ab (Tipp: Waschstraße beim Murk)',
        say: 'Der Alarm! Die Polizei aus Höchstadt ist unterwegs. Fahr durch die Waschstraße beim Murk, dann erkennt dich keiner!',
      },
      {
        do: 'goto',
        to: 'hq',
        obj: 'Bring den Anzug zum Flo',
        say: 'Sauber abgehängt. Jetzt bring mir den Anzug.',
      },
    ],
    outro: ['Passt wie angegossen. Mode, Marken, Menschen!'],
  },

  {
    id: 'fire',
    title: 'Johannifeuer',
    reward: 800,
    props: [{k: 'fire', at: 'pitch', until: 3}],
    intro: [
      'Allmächd! Das Johannifeuer am Sportplatz ist außer Kontrolle.',
      'Die Feuerwehr sitzt noch beim Frühschoppen. Nimm ihr Löschfahrzeug, Am Graben 7!',
    ],
    steps: [
      {
        do: 'steal',
        veh: 'fire',
        at: 'firestation',
        obj: 'Klau das Löschfahrzeug bei der Feuerwehr',
      },
      {
        do: 'bring',
        to: 'pitch',
        time: 100,
        obj: 'Fahr zum Sportplatz vom SV',
        say: 'Tatütata! Mit der Hupe geht das Blaulicht an. Ab zum Sportplatz!',
      },
      {
        do: 'hold',
        to: 'pitch',
        secs: 6,
        r: 12,
        veh: true,
        fx: 'water',
        time: 0,
        obj: 'Wasser marsch! Bleib beim Feuer stehen',
      },
    ],
    outro: ['Feuer aus, Rasen gerettet. Der Platzwart weint vor Glück.'],
  },

  {
    id: 'carp',
    title: 'Aischgründer Gold',
    reward: 700,
    intro: [
      'Im Grünen Baum sind die Karpfen aus. Ein Skandal im Aischgrund!',
      'Im Weiher hinter Kleinwachenroth schwimmen die dicksten. Hol welche raus. Und fahr mir net in den Weiher!',
    ],
    steps: [
      {
        do: 'collect',
        n: 4,
        near: 'pond',
        r: 230,
        item: 'fish',
        obj: 'Fang 4 Karpfen am Weiher hinter Kleinwachenroth',
      },
      {
        do: 'goto',
        to: 'inn',
        time: 110,
        obj: 'Bring die Karpfen zum Gasthaus Grüner Baum',
        say: 'Frisch müssen sie sein! Ab zum Grünen Baum in die Hauptstraße.',
      },
    ],
    outro: ['Pfefferkarpfen für alle! Du kriegst die Karpfenchips aufs Haus.'],
  },

  {
    id: 'k1',
    title: 'K1',
    reward: 900,
    drunk: 90,
    props: [{k: 'person', at: 'club', col: '#1f4fa8'}],
    intro: [
      'Unser Finne, der Pasi, macht heut seinen berühmten K1. Was da drin ist, ist streng geheim.',
      'Er braucht Zutaten: "etwas Alkohol" von der Claudia, Lakupiippu vom Grönert und was von der Metzgerei Braun. Frag net, hol einfach.',
    ],
    steps: [
      {
        do: 'goto',
        to: 'shop',
        foot: true,
        got: 'Alkoholia! Kiitos!',
        obj: 'Hol "etwas Alkohol" bei der Claudia im Edeka (zu Fuß rein)',
      },
      {
        do: 'goto',
        to: 'warehouse',
        foot: true,
        got: 'Lakupiippu! Hyvä hyvä!',
        obj: 'Hol Lakupiippu beim Grönert (zu Fuß rein)',
        say: 'Kiitos! Die Claudia hat net gefragt, wofür. Hyvä! Jetzt Lakupiippu beim Grönert.',
      },
      {
        do: 'goto',
        to: 'butcher',
        foot: true,
        got: 'Salaisuus! Perkele!',
        obj: 'Hol die geheime Zutat bei der Metzgerei Braun (zu Fuß rein)',
        say: 'Lakupiippu! Mahtavaa! Fehlt nur noch was von der Metzgerei Braun. Was genau, sagt der Pasi net. Salaisuus, Geheimnis.',
      },
      {
        do: 'goto',
        to: 'club',
        time: 120,
        obj: 'Bring alles zum Pasi in den Schwallclub',
        say: 'Perkele, des riecht scho jetzt gefährlich! Ab zum Schwallclub, der Pasi wartet. Nopeasti, schnell!',
      },
    ],
    outro: [
      'Kippis! Der Pasi mischt den K1 und schenkt dir gleich einen ein. Auf ex, perkele!',
      'Was drin war, bleibt geheim. Und warum sich die Hauptstraße dreht, auch.',
    ],
  },

  {
    id: 'maypole',
    title: 'Der Baam',
    reward: 1000,
    intro: [
      'Sauerei! Ein paar Burschen aus Höchstadt haben unseren Maibaum geklaut.',
      'Die fahren mit dem Baam durchs Dorf. Ramm den Bulldog, bis sie aufgeben!',
    ],
    steps: [
      {
        do: 'chase',
        veh: 'tractor',
        trailer: 'log',
        at: 'townhall',
        hits: 4,
        obj: 'Ramm den Bulldog mit dem Maibaum',
      },
      {
        do: 'take',
        obj: 'Steig in den Bulldog mit dem Maibaum',
        say: 'Sie rennen! Jetzt schnapp dir den Bulldog.',
      },
      {
        do: 'bring',
        to: 'townhall',
        time: 150,
        obj: 'Bring den Maibaum zum Dorfplatz am Rathaus',
        say: 'Um 19 Uhr wird aufgestellt. Bring den Baam zum Rathaus!',
      },
    ],
    outro: ['Der Baam steht! Die Baamwacht hält heut der Schwallclub.'],
  },

  {
    id: 'barrels',
    title: 'Kerwa ausgraben',
    reward: 900,
    props: [{k: 'tent', at: 'fairground'}],
    intro: [
      'Die Kerwa wird ausgegraben! Drei Fässer sind im Dorf versteckt.',
      'Zwei mit Wasser, eins mit Bier. Find alle drei, bevor es die Kerwasburschen tun.',
    ],
    steps: [
      {
        do: 'collect',
        n: 3,
        near: 'church',
        r: 420,
        item: 'barrel',
        time: 160,
        obj: 'Finde die 3 Kerwa-Fässer',
      },
      {
        do: 'goto',
        to: 'fairground',
        time: 0,
        obj: 'Bring die Fässer zum Festzelt an der Kirchstraße',
        say: 'Du hast sie! Bring die Fässer zum Festzelt hinter dem Pfarrhaus.',
      },
    ],
    outro: ['Ozapft is! Die Kerwa kann anfangen.'],
  },

  {
    id: 'koppel',
    title: 'Koppel of Rock',
    reward: 1200,
    props: [
      {k: 'stage', at: 'koppel'},
      {k: 'person', at: 'inn', until: 2, col: '#22252b'},
      {k: 'person', at: 'inn', until: 2, col: '#3a3a3f', dx: 1.5},
      {k: 'person', at: 'inn', until: 2, col: '#22252b', dx: -1.5},
      {k: 'person', at: 'muehle', until: 3, col: '#22252b'},
      {k: 'person', at: 'muehle', until: 3, col: '#7a1f1f', dx: 1.5},
      {k: 'person', at: 'muehle', until: 3, col: '#3a3a3f', dx: -1.5},
    ],
    intro: [
      'Am Wochenende ist Koppel of Rock: Stoner, Thrash und Hardcore auf der Koppel hinter Kleinwachenroth!',
      'Der Shuttle-Fahrer liegt flach, und die Bands hocken noch in ihren Hotels. Der Bandbus steht am Hotel Relax, beim Linsner.',
    ],
    steps: [
      {
        do: 'steal',
        veh: 'van',
        at: 'linsner',
        obj: 'Steig in den Bandbus am Hotel Relax',
      },
      {
        do: 'bring',
        to: 'inn',
        time: 45,
        obj: 'Hol die Thrash-Band am Grünen Baum ab',
        say: 'Die Stoner-Band pennt schon hinten drin. Weiter zum Grünen Baum, die Thrasher warten!',
      },
      {
        do: 'bring',
        to: 'muehle',
        time: 60,
        obj: 'Hol die Hardcore-Band an der Kleinwachenrother Mühle ab',
        say: 'Zwei von drei. Die Hardcore-Band wohnt in der Kleinwachenrother Mühle. Gib Gas!',
      },
      {
        do: 'bring',
        to: 'koppel',
        time: 150,
        fragile: true,
        obj: 'Bring Bands und Verstärker heil zur Koppel of Rock',
        say: 'Alle drin, die Verstärker auch? Dann ab auf die Koppel, gleich ist Soundcheck. Und fahr anständig!',
      },
    ],
    outro: [
      'Die erste Band steht auf der Bühne, und du hast Backstage.',
      'Bier vier Euro, die Mucke gibts dazu. Geiles Wochenende!',
    ],
  },

  {
    id: 'wochenende',
    title: 'Endlich Wochenende',
    reward: 600,
    sober: true,
    intro: [
      'Endlich Wochenende! Wie jeden Freitag ist Fässlafreitag in der Metzgerei.',
      'Geh hin und trink gemütlich ein paar Seidla. Aber nur ein paar!',
    ],
    steps: [
      {
        do: 'goto',
        to: 'butcher',
        foot: true,
        obj: 'Geh zum Fässlafreitag in die Metzgerei, Kellerstraße 1',
      },
      {
        do: 'hold',
        to: 'butcher',
        r: 6,
        secs: 8,
        obj: 'Trink gemütlich ein paar Seidla',
      },
      {
        do: 'goto',
        to: 'garage',
        drunk: 180,
        wanted: 4,
        fix: true,
        obj: 'Fahr zum Bernhard, Mechanic Monkeys, und lass das Auto richten',
        say: 'Ups, das war eins zu viel. Und die Grünen haben dich gesehen! Schnapp dir ein Auto und ab zum Bernhard in die Werkstatt.',
      },
      {
        do: 'goto',
        to: 'hq',
        foot: true,
        obj: 'Heim ins Hauptquartier und den Rausch ausschlafen',
        say: 'Der Bernhard regelt das. Jetzt komm heim und schlaf deinen Rausch aus.',
      },
    ],
    outro: ['Gut geschlafen? Montag ist auch noch ein Tag.'],
  },

  {
    id: 'huehner',
    title: 'Hühnerjagd',
    reward: 500,
    intro: [
      'Notruf aus der Schulstraße 22: Beim Michi sind die Hühner ausgebüxt!',
      'Fang sie ein, bevor sie unters Auto kommen. Und pass auf Mama Doris auf, die hält dich für einen Hühnerdieb.',
    ],
    steps: [
      {do: 'goto', to: 'schul22', obj: 'Fahr zum Michi in die Schulstraße 22'},
      {
        do: 'collect',
        n: 6,
        near: 'schul22',
        r: 40,
        item: 'hen',
        loose: true,
        foot: true,
        doris: true,
        time: 180,
        obj: 'Fang die 6 Hühner ein, zu Fuß. Vorsicht, Mama Doris!',
        say: 'Da laufen sie! Steig aus und fang sie ein. Und lass dich nicht von Mama Doris erwischen.',
      },
    ],
    outro: [
      'Alle wieder im Stall. Der Michi gibt einen aus, und Mama Doris legt den Besen weg.',
    ],
  },

  {
    id: 'winter',
    title: 'Der Winter kommt',
    reward: 900,
    intro: [
      'Der Winter kommt, und im Hauptquartier ist kein Holz mehr.',
      'Hol deine Motorsäge und ab in den Wald!',
    ],
    steps: [
      {
        do: 'goto',
        to: 'hq',
        foot: true,
        obj: 'Hol deine Motorsäge aus Flos Hauptquartier',
      },
      {
        do: 'collect',
        n: 10,
        near: 'forest',
        r: 130,
        item: 'tree',
        foot: true,
        obj: 'Säg 10 Bäume im Wald um',
        say: 'Ab in den Wald hinterm Johann-Philipp-Ring. Zehn Bäume, dann reicht es für den Winter.',
      },
      {
        do: 'steal',
        veh: 'tractor',
        at: 'farmyard',
        trailer: 'cart',
        obj: 'Hol dir den Bulldog mit Anhänger am Bauernhof',
        say: 'Das Holz muss heim. Am Bauernhof an der alten Bahn steht ein Bulldog mit Anhänger.',
      },
      {
        do: 'hold',
        to: 'forest',
        r: 14,
        secs: 6,
        veh: 'tractor',
        obj: 'Fahr in den Wald und lad das Holz auf',
      },
      {
        do: 'bring',
        to: 'hq',
        load: 'wood',
        logs: 10,
        thieves: 2,
        obj: 'Bring das Holz zu Flo. Lass dich nicht von den Holzdieben rammen!',
        say: 'Holzdiebe! Jeder Rempler, und Holz fällt vom Hänger. Zehnmal, und er ist leer. Fahr heim, so schnell der Bulldog kann!',
      },
    ],
    outro: ['Der Ofen bullert. Soll der Winter ruhig kommen.'],
  },

  {
    id: 'christbaum',
    title: 'O Tannenbaum',
    reward: 800,
    intro: [
      'Nach Dreikönig sammelt der Schwallclub wie jedes Jahr die Christbäume ein. Die Leute stellen sie vor die Haustür, und für jeden Baum gibt es eine Spende für den Kindergarten.',
      'Heuer fehlt ihnen ein Fahrer. Der Bulldog mit Anhänger steht am Schwallclub, Hauptstraße 2.',
    ],
    steps: [
      {
        do: 'steal',
        veh: 'tractor',
        trailer: 'cart',
        at: 'club',
        obj: 'Hol den Bulldog mit Anhänger am Schwallclub',
      },
      {
        do: 'collect',
        n: 8,
        near: 'club',
        r: 230,
        item: 'xmas',
        kerb: true,
        veh: true,
        obj: 'Sammle 8 Christbäume vor den Haustüren ein, mit dem Bulldog',
        say: 'An jedem Baum hängt ein Kuvert mit 20 € Spende. Fahr die Straßen ab und lad alles auf den Hänger!',
      },
      {
        do: 'bring',
        to: 'sammelstelle',
        load: 'xmas',
        obj: 'Bring die Christbäume zur Sammelstelle am Containerplatz',
        say: 'Der Hänger ist voll. Ab zur Sammelstelle am Containerplatz, Am Graben!',
      },
      {
        do: 'goto',
        to: 'kindergarten',
        foot: true,
        drop: true,
        time: 100,
        obj: 'Bring die 160 € Spenden zur Kita Villa Kunterbunt (zu Fuß rein)',
        say: '160 € sind zusammengekommen! Die Kita Villa Kunterbunt macht gleich zu. Bring das Geld hin, und nix abzweigen!',
      },
    ],
    outro: [
      'Die Kinder malen dem Schwallclub ein Dankeschön-Bild.',
      'Und für dich gibts beim Schwallclub ein Seidla aufs Haus.',
    ],
  },

  {
    id: 'duenger',
    title: 'Dünger für die Obstwiese',
    reward: 700,
    props: [{k: 'person', at: 'streuobst', col: '#3c7a30'}],
    intro: [
      'Notruf vom Obst- und Gartenbauverein: Die Apfelbäume auf der Streuobstwiese oberhalb vom Sportplatz brauchen dringend Dünger.',
      'Beim Lagerhaus Grönert Am Graben steht ein Bulldog mit einem Hänger voll Düngersäcke.',
    ],
    steps: [
      {
        do: 'steal',
        veh: 'tractor',
        trailer: 'fert',
        at: 'warehouse',
        obj: 'Hol den Bulldog mit dem Dünger am Lagerhaus Grönert',
      },
      {
        do: 'bring',
        to: 'streuobst',
        time: 210,
        fragile: true,
        obj: 'Bring den Dünger zur Streuobstwiese oberhalb vom Sportplatz',
        say: 'Die Säcke sind net festgezurrt. Jeder Rempler kostet Dünger! Ab zur Streuobstwiese, oberhalb vom Sportplatz.',
      },
      {
        do: 'hold',
        to: 'streuobst',
        r: 25,
        secs: 8,
        veh: true,
        fx: 'spread',
        time: 0,
        fragile: false,
        obj: 'Fahr über die Wiese und streu den Dünger aus',
      },
    ],
    outro: [
      'Die Bäume danken es dir. Im Herbst gibts Most für den ganzen Verein.',
      'Der Obst- und Gartenbauverein macht dich zum Ehrenmitglied.',
    ],
  },

  {
    id: 'toxicity',
    title: 'Zimmerlautstärke',
    reward: 800,
    intro: [
      'Im Toxicity halten sich die Rocker mal wieder net an die Abendruhe. Die ganze Hauptstraße kann net schlafen.',
      'Der Bernhard hat einen Zerstampfer in der Werkstatt. Damit erinnerst du die Jungs an die erlaubte Dezibel-Obergrenze.',
    ],
    steps: [
      {
        do: 'goto',
        to: 'garage',
        foot: true,
        obj: 'Hol den Zerstampfer beim Bernhard, Mechanic Monkeys (zu Fuß rein)',
      },
      {
        do: 'goto',
        to: 'toxicity',
        obj: 'Fahr zum Toxicity in der Hauptstraße',
        say: 'Der Bernhard leiht dir seinen Zerstampfer. Ab zum Toxicity, die hört man bis Kleinwachenroth!',
      },
      {
        do: 'collect',
        n: 5,
        near: 'toxicity',
        r: 24,
        item: 'rocker',
        loose: true,
        foot: true,
        db: 120,
        time: 120,
        obj: 'Bring die Rocker mit dem Zerstampfer auf 70 dB, zu Fuß',
        say: 'Raus aus dem Auto, Zerstampfer in die Hand! Fünf Rocker, ein Bonk pro Kopf, dann ist Zimmerlautstärke.',
      },
    ],
    outro: [
      '70 dB. Die Hauptstraße schläft, und die Rocker spielen ab jetzt unplugged.',
      'Den Zerstampfer bringst du dem Bernhard morgen zurück.',
    ],
  },

  {
    id: 'finale',
    title: 'Kerwa-Samstag',
    reward: 1500,
    props: [
      {k: 'person', at: 'hq', until: 1, col: '#e0b21c'},
      {k: 'person', at: 'hall', until: 2, col: '#2f5fa8'},
      {k: 'person', at: 'hall', until: 2, col: '#b3372f', dx: 1.5},
      {k: 'tent', at: 'fairground'},
    ],
    intro: [
      'Heut ist Kerwa-Samstag, und ich komm net weg: Die Polizei steht vor meiner Tür.',
      'Hol mich am Hauptquartier ab. Und dann die Musik!',
    ],
    steps: [
      {do: 'goto', to: 'hq', obj: 'Hol den Flo am Hauptquartier ab'},
      {
        do: 'goto',
        to: 'hall',
        wanted: 2.5,
        obj: 'Hol die Blaskapelle an der Ebrachtalhalle ab',
        say: 'Los! Zur Ebrachtalhalle, die Blaskapelle wartet. Und häng die Polizei ab!',
      },
      {
        do: 'goto',
        to: 'fairground',
        time: 120,
        obj: 'Bring alle zum Festzelt an der Kirchstraße',
        say: 'Alle drin? Dann auf zum Festzelt!',
      },
    ],
    outro: [
      'Wir sind da! Die Musik spielt, das Bier läuft.',
      'Wachenroth gehört jetzt uns. Also mir. Aber du darfst mitfeiern.',
    ],
  },
];
