#!/usr/bin/env python3
"""Bake OpenStreetMap data for Wachenroth into map.js.

Usage: python3 tools/osm2map.py [cached-overpass.json] > map.js
"""
import json
import math
import sys
import urllib.parse
import urllib.request

S, W, N, E = 49.7440, 10.6950, 49.7590, 10.7300
MARGIN = 80  # metres of road kept outside the playable world
QUERY = f"""[out:json][timeout:90][bbox:{S - .002},{W - .003},{N + .002},{E + .003}];
(way[highway];way[waterway];way[building];relation[building];way[landuse];relation[landuse];
 way[natural];relation[natural];way[amenity];way[leisure];relation[leisure];way[railway];way[barrier];
 way[man_made];node[natural=tree];);
out geom;"""

ROAD_W = {'secondary': 8, 'tertiary': 7, 'unclassified': 6.5, 'residential': 6, 'living_street': 5, 'service': 4,
          'track': 3, 'path': 1.5, 'footway': 1.5, 'steps': 1.5, 'cycleway': 2}
CAR = {'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'}
WATER_W = {'river': 7, 'stream': 2.4, 'ditch': 1.2, 'drain': 1.2}
AREA = {'forest': 'forest', 'wood': 'forest', 'scrub': 'scrub', 'wetland': 'scrub', 'farmland': 'farm',
        'meadow': 'meadow', 'grass': 'meadow', 'grassland': 'meadow', 'residential': 'resi', 'industrial': 'ind',
        'commercial': 'com', 'construction': 'constr', 'water': 'water', 'basin': 'water', 'parking': 'park',
        'playground': 'play', 'farmyard': 'yard', 'cemetery': 'cem', 'grave_yard': 'cem', 'landfill': 'dump',
        'orchard': 'orchard', 'plant_nursery': 'orchard', 'pitch': 'pitch', 'school': 'school',
        'kindergarten': 'school', 'wastewater_plant': 'ind'}

# Places the missions use, as lat/lon read off OpenStreetMap (name tags, house numbers).
POIS = {
    'hq': (49.75477, 10.71925),        # Johann-Philipp-Ring 9
    'murk': (49.75185, 10.72136),      # Bekleidungshaus Murk, Anton-Murk-Straße 2
    'fuel': (49.75100, 10.72129),     # Murk Tankstelle
    'carwash': (49.75116, 10.72180),     # Murk Waschanlage
    'bakery': (49.75119, 10.71248),     # Wachenröther Bäck, Hauptstraße 1
    'shop': (49.75259, 10.70924),     # Mein Markt 24, Reumannswinder Straße 23; "Edeka Claudia" in the game
    'clubhouse': (49.75512, 10.70155),     # Sportheim SV Wachenroth
    'pitch': (49.75470, 10.70241),     # SV Wachenroth A-Platz
    'works': (49.74861, 10.71426),     # Röckelein works
    'depot': (49.74853, 10.71605),   # the works yard, where the mixers wait
    'townhall': (49.75013, 10.71593),   # Hauptstraße 23
    'church': (49.75010, 10.71493),    # St. Gertrud
    'school': (49.75162, 10.71486),
    'hall': (49.75174, 10.71530),     # Ebrachtalhalle
    'firestation': (49.75114, 10.71782),       # Feuerwehr, Am Graben 7
    'kindergarten': (49.75214, 10.71469),      # Villa Kunterbunt
    'bank': (49.75120, 10.71534),
    'cemetery': (49.75093, 10.72012),
    'sewage': (49.75061, 10.72681),     # Kläranlage
    'dump': (49.75682, 10.72239),   # Bauschuttdeponie
    'station': (49.74919, 10.71809),   # old halt of the Steigerwaldbahn
    'beach': (49.74815, 10.71911),     # beach volleyball court
    'lavite': (49.75183, 10.71148),
    'adler': (49.75025, 10.71620),     # Schwarzer Adler, Hauptstraße 25
    'inn': (49.74986, 10.71655),      # Grüner Baum, Hauptstraße 30
    'maras': (49.74994, 10.71768),     # Maras Marktschänke, Hauptstraße 38
    'butcher': (49.75211, 10.71376),   # Kellerstraße 1
    'pond': (49.74498, 10.71090),    # carp pond
    'farmyard': (49.74890, 10.71823),       # farmyard by the old railway
    'playground': (49.75227, 10.71083),
    'club': (49.75088, 10.71262),   # Schwallclub clubhouse, Hauptstraße 2, opposite the bakery
    'roadworks': (49.75245, 10.71595),  # Schulstraße is being rebuilt
    'drinks': (49.74719, 10.72087),  # Getränke Braun, Kleinwachenroth 25
    'warehouse': (49.75125, 10.71829),  # Lagerhaus, Am Graben 9
    'fairground': (49.74950, 10.71430),  # Kerwa tent in the Frühmessgarten off Kirchstraße
    'linsner': (49.75086, 10.71445),   # Gasthof Linsner, Hauptstraße 7
}

KX = 111320 * math.cos(math.radians((S + N) / 2))
KY = 111200
WW, WH = round((E - W) * KX), round((N - S) * KY)


def xy(p):
    return (round((p['lon'] - W) * KX, 1), round((N - p['lat']) * KY, 1))


def inside(p, m=0.0):
    return -m <= p[0] <= WW + m and -m <= p[1] <= WH + m


def shoelace(pts):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1])) / 2


def ring(geom):
    """Closed OSM way -> clockwise (y down) point list without the duplicate end."""
    pts = [xy(p) for p in geom]
    if pts[0] == pts[-1]:
        pts.pop()
    pts = [p for i, p in enumerate(pts) if p != pts[i - 1]]
    return pts[::-1] if shoelace(pts) < 0 else pts


def flat(pts):
    return [c for p in pts for c in p]


def pip(p, poly):
    c = False
    for a, b in zip(poly, poly[1:] + poly[:1]):
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
    return c


def clip(pts, m=150):
    """Sutherland-Hodgman: cut a polygon down to the world rectangle plus a margin."""
    for ax, lim, sign in ((0, -m, 1), (0, WW + m, -1), (1, -m, 1), (1, WH + m, -1)):
        out = []
        for a, b in zip(pts, pts[1:] + pts[:1]):
            ia, ib = (a[ax] - lim) * sign >= 0, (b[ax] - lim) * sign >= 0
            if ia != ib:
                f = (lim - a[ax]) / (b[ax] - a[ax])
                out.append((round(a[0] + (b[0] - a[0]) * f, 1), round(a[1] + (b[1] - a[1]) * f, 1)))
            if ib:
                out.append(b)
        pts = out
    return pts


def outers(rel):
    """Stitch a multipolygon's outer member ways into closed rings."""
    parts = [m['geometry'] for m in rel['members'] if m['type'] == 'way' and m['role'] == 'outer' and m.get('geometry')]
    rings = []
    while parts:
        cur = parts.pop()
        while cur[0] != cur[-1]:
            nxt = next((p for p in parts if cur[-1] in (p[0], p[-1])), None)
            if not nxt:
                break
            parts.remove(nxt)
            cur = cur + (nxt[1:] if nxt[0] == cur[-1] else nxt[-2::-1])
        if len(cur) > 3:
            rings.append(cur)
    return rings


src = sys.argv[1] if len(sys.argv) > 1 else None
if src:
    els = json.load(open(src))['elements']
else:
    req = urllib.request.Request('https://overpass-api.de/api/interpreter',
                                 urllib.parse.urlencode({'data': QUERY}).encode(), {'User-Agent': 'osm2map/1.0'})
    els = json.load(urllib.request.urlopen(req, timeout=120))['elements']

roads, areas, buildings, trees, hedges, fences = [], [], [], [], [], []
node_ix, nodes, edges = {}, [], []
zones = {'ind': [], 'com': [], 'yard': []}

for e in els:
    t = e.get('tags', {})
    if e['type'] == 'node':
        if t.get('natural') == 'tree' and inside(xy(e), 20):
            trees.append(xy(e))
        continue
    rings = outers(e) if e['type'] == 'relation' else [e.get('geometry') or []]
    hw, ww = t.get('highway'), t.get('waterway')
    if hw in ROAD_W or ww in WATER_W or t.get('railway') == 'rail':
        if ww and t.get('tunnel'):
            continue  # piped under the road
        kind = hw if hw in ROAD_W else ww or 'rail'
        pts = [xy(p) for p in e['geometry']]
        run = []
        for p, nid in list(zip(pts, e['nodes'])) + [(None, None)]:
            if p and inside(p, MARGIN):
                run.append((p, nid))
                continue
            if len(run) > 1:
                road = {'t': kind, 'w': ROAD_W.get(kind) or WATER_W.get(kind, 1.6), 'p': flat(r[0] for r in run)}
                if hw and (t.get('name') or t.get('ref')):
                    road['n'] = t.get('name') or t['ref']
                if hw and t.get('tunnel'):
                    road['u'] = 1
                if hw:
                    ids = []
                    for q, nid2 in run:
                        if nid2 not in node_ix:
                            node_ix[nid2] = len(nodes)
                            nodes.append(q)
                        ids.append(node_ix[nid2])
                    one = t.get('oneway') == 'yes' or t.get('junction') == 'roundabout'
                    # flag bits: 1 = road for cars, 2 = through traffic (set below), 4 = one-way, 8 = track
                    flag = (1 if kind in CAR else 8 if kind == 'track' else 0) | (4 if one else 0)
                    edges += [[a, b, len(roads), flag] for a, b in zip(ids, ids[1:])]
                roads.append(road)
            run = []
    elif 'building' in t or t.get('man_made') in ('silo', 'storage_tank'):
        for g in rings:
            pts = ring(g) if len(g) > 2 else []
            if len(pts) < 3 or not any(inside(p, 20) for p in pts):
                continue
            a = shoelace(pts)
            b = t.get('building', 'silo')
            k = 's' if 'man_made' in t else 'c' if b in ('church', 'chapel') else 'o' if b == 'roof' \
                else 'g' if b in ('garage', 'garages', 'carport', 'shed', 'transformer_tower') else 'h'
            h = float(t['height']) if 'height' in t else int(t['building:levels']) * 3 if 'building:levels' in t \
                else 14 if k == 's' else 4.5 if k == 'o' else 3 if k == 'g' \
                else 11 if a > 2000 else 9 if a > 600 else 7 if a > 110 else 5.5 if a > 45 else 3
            buildings.append({'p': flat(pts), 'h': h, 'a': round(a), 'k': k})
    elif t.get('barrier') == 'hedge' or t.get('natural') == 'hedge':
        pts = [xy(p) for p in e['geometry'] if inside(xy(p), 20)]
        if len(pts) > 1:
            hedges.append(flat(pts))
    elif t.get('barrier') in ('fence', 'wall', 'guard_rail'):
        pts = [xy(p) for p in e['geometry'] if inside(xy(p), 20)]
        if len(pts) > 1:
            fences.append(flat(pts))
    else:
        k = AREA.get(t.get('landuse') or t.get('natural') or t.get('leisure') or t.get('man_made') or t.get('amenity'))
        for g in rings if k else []:
            if len(g) < 3:
                continue
            pts = clip(ring(g))
            if len(pts) < 3:
                continue
            area = {'k': k, 'p': flat(pts), 'a': shoelace(pts)}
            if k == 'pitch':
                area['s'] = t.get('sport', '')
            areas.append(area)
            if k in zones:
                zones[k].append(pts)

for b in buildings:
    pts = list(zip(b['p'][::2], b['p'][1::2]))
    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    if b['k'] == 'h':
        b['k'] = next((z[0] for z in ('ind', 'com', 'yard') if any(pip(c, poly) for poly in zones[z])), 'h')
areas.sort(key=lambda a: -a.pop('a'))

# Through traffic: drop cul-de-sacs so AI cars never need a three-point turn.
exits = {i for i, p in enumerate(nodes) if not inside(p)}
alive = [bool(e[3] & 1) for e in edges]
while True:
    deg = {}
    for e, ok in zip(edges, alive):
        if ok:
            deg[e[0]] = deg.get(e[0], 0) + 1
            deg[e[1]] = deg.get(e[1], 0) + 1
    dead = [i for i, e in enumerate(edges) if alive[i] and any(deg[n] == 1 and n not in exits for n in e[:2])]
    if not dead:
        break
    for i in dead:
        alive[i] = False
for e, ok in zip(edges, alive):
    e[3] |= 2 if ok else 0

pois = {k: xy({'lat': la, 'lon': lo}) for k, (la, lo) in POIS.items()}
for k, p in pois.items():
    assert inside(p, -10), f'POI {k} is outside the world'
drivable = [nodes[n] for a, b, _, f in edges if f & 9 for n in (a, b)]
for k, p in pois.items():
    assert min(math.dist(p, q) for q in drivable) < 120, f'no road near POI {k}'

out = {'w': WW, 'h': WH, 'roads': roads, 'nodes': flat(nodes), 'edges': flat(edges), 'areas': areas,
       'buildings': buildings, 'trees': flat(trees), 'hedges': hedges, 'fences': fences, 'pois': pois}
print('// Generated by tools/osm2map.py. Map data (c) OpenStreetMap contributors, ODbL.')
print('export const MAP = ' + json.dumps(out, separators=(',', ':'), ensure_ascii=False) + ';')
print(f'{len(roads)} roads, {len(nodes)} nodes, {len(buildings)} buildings, {len(areas)} areas, {len(trees)} trees, '
      f'{len(hedges)} hedges, {WW}x{WH} m', file=sys.stderr)
