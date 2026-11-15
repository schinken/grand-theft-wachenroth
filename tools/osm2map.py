#!/usr/bin/env python3
"""Bake OpenStreetMap data for Wachenroth into map.js.

Usage: python3 tools/osm2map.py [cached-overpass.json [more files ...]] > map.js

More files add what OSM does not know. All of them are open data of the Bayerische Vermessungsverwaltung
(www.geodaten.bayern.de, CC BY 4.0) and are told apart by their ending:

  *.gml   3D building tiles: more buildings than OSM has, each with its measured heights, the shape of its roof and
          the way the ridge runs, and towers as buildings of their own. Wachenroth is on
          622_5510, 624_5510, 622_5512 and 624_5512 of https://download1.bayernwolke.de/a/lod2/citygml/<tile>.gml
  *.gpkg  single trees with their height: https://geodaten.bayern.de/odd/m/8/baeume3d/data/125021_baeume.gpkg
  *.png   two pictures of the map, one pixel per metre, told apart by whether one can see through them: the aerial
          photo for roof colours, paved yards and what grows on the fields, and the outlines of the parcels for
          garden fences and the borders of the fields. They start at the north edge and may end above the south
          edge: what lies below gets none of this.
          https://geoservices.bayern.de/od/wms/dop/v1/dop20?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=by_dop20c
          &STYLES=&SRS=EPSG:4326&BBOX=10.6950,49.7430,10.7300,49.7590&WIDTH=2517&HEIGHT=1779&FORMAT=image/png
          and the same from .../od/wms/alkis/v1/parzellarkarte? with LAYERS=by_alkis_parzellarkarte_umr_schwarz
          and &TRANSPARENT=TRUE
"""
import base64
import cmath
import itertools
import json
import math
import random
import sqlite3
import struct
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zlib

# The map: south, west, north, east. It grew 111 m to the south for the Koppel of Rock, whose gate lies just below the
# old edge of 49.7440.
S, W, N, E = 49.7430, 10.6950, 49.7590, 10.7300
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

ZONE = {'ind': 'i', 'com': 'm', 'yard': 'y'}  # land use -> kind of the buildings standing on it
# ALKIS roof codes -> flat, gable or hip. A lean-to roof reads as flat from above; mixed forms are left to the game.
ROOF = {'1000': 'f', '2100': 'f', '2200': 'f', '3100': 'g', '3200': 'p', '3300': 'p', '3400': 'p', '3500': 'p'}
GARAGE = ('31001_2463', '31001_2523')  # garages and transformer houses
UTM = (621900, 624800, 5511300, 5513500)  # the map with a margin, in UTM32: west, east, south, north
PAVED = ('resi', 'yard', 'school')  # where the photo decides between lawn and paved ground

# Places the missions use, as lat/lon read off OpenStreetMap (name tags, house numbers).
POIS = {
    'hq': (49.75477, 10.71925),        # Johann-Philipp-Ring 9
    'no14': (49.754393, 10.720043),    # a house modelled with its garden
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
    'butcher': (49.752165, 10.713714),   # Kellerstraße 1, in the house: its plot is painted
    'pond': (49.74498, 10.71090),    # carp pond
    'farmyard': (49.74890, 10.71823),       # farmyard by the old railway
    'playground': (49.75227, 10.71083),
    'club': (49.75088, 10.71262),   # Schwallclub clubhouse, Hauptstraße 2, opposite the bakery
    'roadworks': (49.75245, 10.71595),  # Schulstraße is being rebuilt
    'drinks': (49.74719, 10.72087),  # Getränke Braun, Kleinwachenroth 25
    'garage': (49.745715, 10.719340),  # Mechanic Monkeys, Bernhard's garage
    'forest': (49.75695, 10.719331),  # the wood north of Johann-Philipp-Ring, at its track
    'schul22': (49.753622, 10.714771),   # Schulstraße 22: Michi's hens, the house modelled with its garden
    'muehle': (49.748285, 10.720787),  # Kleinwachenrother Mühle, an inn with rooms
    # Koppel of Rock: the crossroads where Google Maps has it. The stage stands in the meadow north-east of it, the
    # campground in the one south-west.
    'koppel': (49.743891, 10.7237281),
    'warehouse': (49.75125, 10.71829),  # Lagerhaus, Am Graben 9
    'fairground': (49.7503858, 10.7130321),  # the Kerwa ground behind the parish office, where Google Maps has it
    'linsner': (49.75086, 10.71445),   # Gasthof Linsner, Hauptstraße 7
    'sammelstelle': (49.75098, 10.71742),  # the recycling containers, where the Christmas trees are collected
    'streuobst': (49.755250, 10.704037),  # the orchard meadow of the Obst- und Gartenbauverein, above the pitch
    'toxicity': (49.750962, 10.712070),  # Toxicity, the rock club on Hauptstraße
    'gumbrecht': (49.749289, 10.71403),  # Gumbrecht Tiefbau, Kirchstraße 11
    'dentist': (49.751197, 10.715213),  # Zahnarztpraxis Mickoleit, Schulstraße 2a
    # The Christmas tree plantation on the Weißer Berg (ALKIS: Weihnachtsbaumkultur): its gate on the track to the
    # south, and the finest spruce, deep in the northern block
    'xmasfarm': (49.757777, 10.712546),
    'fichte': (49.758622, 10.712936),
}

# Read off the state's aerial photo, as lat/lon, because no map has them: the five grain silos of the Lagerhaus, and
# two patches outside the village where the photo decides what is bare ground: the bike track and the car park of
# the sports ground.
SILOS = [(49.751396, 10.719124), (49.751418, 10.719184), (49.751353, 10.719138), (49.751311, 10.719164),
         (49.751316, 10.719235)]
BARE = [
    [(49.755871, 10.701037), (49.755806, 10.701312), (49.755563, 10.701688), (49.755385, 10.702338),
     (49.755191, 10.702288), (49.755142, 10.701838), (49.755239, 10.701537), (49.755433, 10.701187),
     (49.75566, 10.701024)],
    [(49.755312, 10.701187), (49.755223, 10.701412), (49.755029, 10.701187), (49.754899, 10.701162),
     (49.754794, 10.701099), (49.754907, 10.700724), (49.755142, 10.700937)],
]

# Buildings the survey models as one, split into the parts the photo shows, each with its own height and roof: a point
# in the building, then the parts with their corners as lat/lon. Pizzeria La Vite is a main block with a cross wing,
# a low wing, a porch and a roof over the entrance.
SPLIT = [
    (49.751833, 10.711545, [
        ({'h': 7.7, 'r': 'g', 't': 4.4, 'dir': 45},  # main block
         [(49.751908, 10.711542), (49.751826, 10.711672), (49.751762, 10.711573), (49.751844, 10.711442)]),
        ({'h': 6.8, 'r': 'g', 't': 3.1, 'dir': 135},  # cross wing
         [(49.751807, 10.711384), (49.751844, 10.711442), (49.751811, 10.711495), (49.751773, 10.711435)]),
        ({'h': 4.1, 'r': 'g', 't': 2.0, 'dir': 45},  # low wing
         [(49.751844, 10.711327), (49.751907, 10.711424), (49.751871, 10.711483),
          (49.751844, 10.711442), (49.751807, 10.711384)]),
        ({'h': 3.7, 'r': 'f'},  # porch
         [(49.751816, 10.711327), (49.751829, 10.711348), (49.751817, 10.711367), (49.751803, 10.711345)]),
        ({'h': 2.9, 'r': 'f'},  # entrance roof
         [(49.751788, 10.711459), (49.751811, 10.711495), (49.75179, 10.711528), (49.751766, 10.711494)]),
    ]),
]

# How single buildings look where the photo shows it better than any rule: a point in the building, and what it
# gets. The garage of Schulstraße 22 is covered with solar panels.
#
# With 'faces' the roof is drawn face by face as the survey measured it. 'slopes' gives the faces that look some way
# (degrees from north, clockwise) a roof of their own, 'panels' lays things on the faces: lat, lon, metres along and
# across the building, and True for a roof window or a colour for a dormer. 'chimney' is a lat, lon.
# The neighbours of Bernhard's garage, as the state's and Google's photos show them:
NEIGHBOURS = [
    # Kleinwachenroth 48: dark slope to the north-east with three dormers, two dormers to the south-west
    (49.745996, 10.719213, {'faces': 1, 'look': {'roof': 'tile3'}, 'slopes': {47: 'slate'},
                            'panels': [(49.746038, 10.719219, 1.7, 1.7, '#8a5048'),
                                       (49.746015, 10.719253, 1.7, 1.7, '#8a5048'),
                                       (49.745994, 10.719284, 1.7, 1.7, '#8a5048'),
                                       (49.745996, 10.719131, 1.4, 1.4, '#6e3a2c'),
                                       (49.745975, 10.719164, 1.4, 1.4, '#6e3a2c')],
                            'chimney': (49.745949, 10.719150)}),
    (49.745587, 10.719273, {'faces': 1, 'look': {'roof': 'tile1'}}),  # the barn beside the garage
    # Kleinwachenroth 54: grey-brown, four roof windows to the north, two to the south
    (49.745673, 10.719748, {'faces': 1, 'look': {'roof': 'tile5'},
                            'panels': [(49.745701, 10.719690, .6, .9, True), (49.745705, 10.719741, .6, .9, True),
                                       (49.745710, 10.719784, .6, .9, True), (49.745711, 10.719818, .6, .9, True),
                                       (49.745652, 10.719800, .9, .9, True), (49.745652, 10.719825, .9, .9, True)],
                            'chimney': (49.745663, 10.719768)}),
    (49.745556, 10.719609, {'faces': 1, 'look': {'roof': 'tile4'}}),  # the house across the road
    (49.745481, 10.719465, {'faces': 1, 'look': {'roof': 'tile1'}}),  # its barn
    (49.745407, 10.719491, {'look': {'roof': 'solar'}}),  # and the sheds behind it
    (49.745394, 10.719331, {'look': {'roof': 'tile1'}}),
    (49.745340, 10.719338, {'look': {'roof': 'tile1'}}),
]
# The same for the buildings at the places of the jobs.
LOOKS_PLACES = [
    # The long hall at Toxicity: dark roofs with solar panels on the slopes to the south-west, the high back part brown
    (49.750799, 10.712199, {'faces': 1, 'look': {'roof': 'slate'},
                            'panels': [(49.750776, 10.712192, 13, 4, False)]}),
    (49.750745, 10.712407, {'faces': 1, 'look': {'roof': 'slate'}, 'slopes': {296: 'tile3', 116: 'tile3'},
                            'panels': [(49.750717, 10.712396, 16, 4.5, False)]}),
    # Metzgerei Braun: dark to the north, grey to the south with two solar arrays
    (49.752165, 10.713714, {'faces': 1, 'look': {'roof': 'tile6'}, 'slopes': {19: 'slate'},
                            'panels': [(49.752162, 10.713647, 6.8, 4, False), (49.752138, 10.713799, 7.5, 4, False)],
                            'chimney': (49.752198, 10.713799)}),
]
LOOKS = [
    (49.753529, 10.714888, {'look': {'roof': 'solar', 'flat': True}}),
] + NEIGHBOURS + LOOKS_PLACES

# Buildings neither the survey nor OSM has, read off the photos: what they are, and their corners as lat/lon. The red
# shed north-west of Bernhard's garage.
SHEDS = [
    ({'h': 2.6, 'k': 'd', 'r': 'p', 't': 1.6, 'look': {'roof': 'tile1'}},
     [(49.745848, 10.719196), (49.745817, 10.719262), (49.745781, 10.719192), (49.745811, 10.719127)]),
]

# Garden pools, turquoise on the same photo: lat, lon, and how many metres they measure east-west and north-south.
POOLS = [(49.75277, 10.714879, 4.0, 7.0), (49.752167, 10.719626, 7.0, 4.0),
         (49.753636, 10.721236, 5.5, 3.5), (49.755039, 10.7105, 6.0, 4.5)]

# Areas OSM lacks, read off the same photo: their kind and their corners as lat/lon. The two meadows of the Koppel of
# Rock (the stage's and the campground's) and the orchard meadow north-east of the sports ground are mapped as parts of
# big fields; the orchard's trees are in the tree survey.
PATCHES = [
    ('meadow', [(49.743811, 10.722821), (49.743838, 10.723641), (49.743038, 10.723655), (49.743038, 10.722821)]),
    ('meadow', [(49.74614, 10.723502), (49.746158, 10.723697), (49.745583, 10.72442),
                (49.745511, 10.724462), (49.743991, 10.724573), (49.743955, 10.723613)]),
    ('meadow', [(49.755407, 10.704133), (49.755442, 10.704525), (49.755526, 10.704890), (49.755594, 10.705308),
                (49.755627, 10.705542), (49.755407, 10.705333), (49.755121, 10.704994), (49.754885, 10.704630),
                (49.754648, 10.704237), (49.754564, 10.703925), (49.754885, 10.703665), (49.755138, 10.703847)]),
]

# Ways OSM lacks, read off the same photo: their tags, the OSM node they start at, and where they go as lat/lon: the
# gravel drive from the bend of Kirchstraße to the Kerwa ground, and the drive from the bridge over the Reiche Ebrach
# into the yard of the Kleinwachenrother Mühle. Without it the road ended on the river bank.
WAYS = [
    ({'highway': 'track'}, 269367677,
     [(49.749883, 10.714128), (49.749875, 10.71392), (49.749928, 10.713735), (49.75001, 10.713572),
      (49.7501, 10.713446), (49.750212, 10.713342), (49.750317, 10.713272)]),
    ({'highway': 'service'}, 2481574253,
     [(49.747975, 10.720353), (49.748074, 10.72043), (49.748159, 10.720527), (49.748186, 10.720582)]),
]

KX = 111320 * math.cos(math.radians(49.7515))  # metres per degree at the village; fixed, so growing moves nothing
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


def corners(b):
    return list(zip(b['p'][::2], b['p'][1::2]))


def centre(b):
    pts = corners(b)
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def latlon(east, north):
    """ETRS89 / UTM zone 32N -> a point in degrees, as xy() takes it (Krueger series, exact to a millimetre)."""
    f = 1 / 298.257222101
    n = f / (2 - f)
    a = 6378137 / (1 + n) * (1 + n**2 / 4 + n**4 / 64) * 0.9996
    xi, eta = north / a, (east - 500000) / a
    beta = (n / 2 - 2 * n**2 / 3 + 37 * n**3 / 96, n**2 / 48 + n**3 / 15, 17 * n**3 / 480)
    delta = (2 * n - 2 * n**2 / 3 - 2 * n**3, 7 * n**2 / 3 - 8 * n**3 / 5, 56 * n**3 / 15)
    xi2 = xi - sum(b * math.sin(2 * j * xi) * math.cosh(2 * j * eta) for j, b in enumerate(beta, 1))
    eta2 = eta - sum(b * math.cos(2 * j * xi) * math.sinh(2 * j * eta) for j, b in enumerate(beta, 1))
    chi = math.asin(math.sin(xi2) / math.cosh(eta2))
    lat = chi + sum(d * math.sin(2 * j * chi) for j, d in enumerate(delta, 1))
    return {'lat': math.degrees(lat), 'lon': 9 + math.degrees(math.atan2(math.sinh(eta2), math.cos(xi2)))}


def tidy(pts, tol=0.3):
    """Drop corners that barely leave the line between their neighbours: the cadastre draws every 10 cm notch."""
    i = 0
    while i < len(pts) and len(pts) > 4:
        a, p, b = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
        off = abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / (math.dist(a, b) or 1)
        if off < tol:
            pts.pop(i)
            i = max(i - 1, 0)
        else:
            i += 1
    return pts


def hull(pts):
    """The convex outline around some points (Andrew's monotone chain), in the turning sense ring() gives."""
    def half(seq):
        out = []
        for p in seq:
            while len(out) > 1 and (out[-1][0] - out[-2][0]) * (p[1] - out[-2][1]) \
                    <= (out[-1][1] - out[-2][1]) * (p[0] - out[-2][0]):
                out.pop()
            out.append(p)
        return out[:-1]
    pts = sorted(set(pts))
    return half(pts) + half(pts[::-1])


assert hull([(0, 0), (2, 0), (2, 2), (0, 2), (1, 1), (1, 0)]) == [(0, 0), (2, 0), (2, 2), (0, 2)]


def lod2(paths):
    """The state's 3D buildings (CityGML LoD2) as building entries.

    Each has its outline p, kind k and wall height h, and where the roof was surveyed its shape r, the height t of
    the ridge above the eaves, and the direction dir the ridge runs in: degrees from east towards south, 0 to 179.
    """
    ns = {'b': 'http://www.opengis.net/citygml/building/1.0', 'g': 'http://www.opengis.net/gml',
          'n': 'http://www.opengis.net/citygml/generics/1.0', 'x': 'urn:oasis:names:tc:ciq:xsdschema:xAL:2.0'}
    out = []
    for path in paths:
        for el in ET.parse(path).getroot().iterfind('.//b:Building', ns):
            use = el.findtext('b:function', '', ns)
            pos = el.find('.//b:GroundSurface//g:posList', ns)
            if pos is None or not use.startswith(('31001', '51009_1610')):
                continue  # bridges, walls and the like
            v = pos.text.split()
            pts = tidy(ring([latlon(float(x), float(y)) for x, y in zip(v[::3], v[1::3])]))
            a = shoelace(pts)
            if a < 6 or not any(inside(p, 20) for p in pts):
                continue
            # Every roof face knows its size, its lowest and highest point above the ground and where it looks.
            faces = []
            for f in el.iterfind('.//b:RoofSurface', ns):
                face = {at.get('name'): float(at.findtext('n:value', '0', ns))
                        for at in f.iterfind('n:stringAttribute', ns)}
                if face.get('Flaeche', 0) > 0:
                    faces.append((face['Flaeche'], face['Z_MIN'], face['Z_MAX'], face['Dachorientierung'], f))
            if not faces:
                faces = [(a, top := float(el.findtext('b:measuredHeight', '3', ns)), top, -1, None)]
            mean = lambda of, part: sum(f[0] * of(f) for f in part) / sum(f[0] for f in part)
            # A few faces high above the rest are a tower: a building of its own, on top of this one.
            high = [f for f in faces if f[1] >= mean(lambda f: f[1], faces) + 6]
            if high and sum(f[0] for f in high) < sum(f[0] for f in faces) / 3:
                faces = [f for f in faces if f not in high]
            else:
                high = []
            # Walls end at the eaves, the low edge of the faces, and the ridge rises above them by what a face climbs:
            # big faces count most.
            eaves, rise = mean(lambda f: f[1], faces), mean(lambda f: f[2] - f[1], faces)
            # A house is what people live in, what has an address, or what serves the public; the rest are barns
            # and sheds.
            main = use[6:7] in '13' or el.find('.//x:ThoroughfareName', ns) is not None
            k = 'o' if use[0] == '5' else 'c' if use == '31001_3041' else 'g' if use in GARAGE \
                else 'h' if main else 'd' if a < 30 else 'y'
            roof = ROOF.get(el.findtext('b:roofType', '', ns)) if k != 'o' else None
            # A roof drawn flat lies at its middle height: a lean-to has no ridge.
            wall = eaves + (rise / 2 if roof == 'f' else 0)
            b = {'p': flat(pts), 'h': round(max(wall, 2.2), 1), 'a': round(a), 'k': k}
            # The faces as surveyed, for the few roofs drawn face by face (see LOOKS): where they look, and their
            # corners as UTM east, north and height above the sea, with the ground's height.
            b['_f'] = ([(f[3], f[4].find('.//g:posList', ns).text) for f in faces if f[4] is not None],
                       min(float(z) for z in v[2::3]))
            if roof:
                b['r'] = roof
            if roof != 'f' and k != 'o' and rise >= .5:
                b['t'] = round(rise, 1)
                # Faces look across the ridge. Opposite faces must add up, so the angles are doubled; a tent roof
                # looks every way and has no ridge to speak of.
                look = sum(f[0] * cmath.exp(2j * math.radians(f[3])) for f in faces if f[3] >= 0)
                if abs(look) > sum(f[0] for f in faces) * .3:
                    b['dir'] = round(math.degrees(cmath.phase(look)) / 2) % 180
            out.append(b)
            if high:
                v = [float(c) for f in high for c in f[4].find('.//g:posList', ns).text.split()]
                top = hull(ring([latlon(x, y) for x, y in zip(v[::3], v[1::3])]))
                foot, tip = min(f[1] for f in high), max(f[2] for f in high)
                # ponytail: two things far apart on one roof would be hulled into one block, so those are left out.
                if 6 < shoelace(top) < sum(f[0] for f in high) * 1.5:
                    spire = {'k': 't', 't': round(tip - foot, 1)} if k == 'c' else {'k': k, 'r': 'f'}
                    out.append({'p': flat(top), 'h': round(foot if k == 'c' else (foot + tip) / 2, 1),
                                'a': round(shoelace(top)), **spire})
    return out


def survey_faces(raw, slopes, panels):
    """The surveyed roof faces of one building as the game draws them: corners x, y and height above the ground, a
    roof of their own where slopes asks for it, and the panels w that lie on them."""
    looks, ground = raw
    out = []
    for look, text in looks:
        v = [float(c) for c in text.split()]
        pts = []
        for east, north, z in zip(v[::3], v[1::3], v[2::3]):
            p = (*xy(latlon(east, north)), round(z - ground, 1))
            if not pts or math.dist(p, pts[-1]) > .15:
                pts.append(p)
        while len(pts) > 2 and math.dist(pts[0], pts[-1]) <= .15:
            pts.pop()
        if len(pts) < 3 or abs(shoelace([q[:2] for q in pts])) < .3:
            continue  # a sliver where faces meet
        face = {'p': flat(pts)}
        own = [r for at, r in slopes.items() if look >= 0 and abs((look - at + 180) % 360 - 180) < 30]
        if own:
            face['r'] = own[0]
        out.append(face)
    for lat, lon, along, across, kind in panels:
        x, y = xy({'lat': lat, 'lon': lon})
        on = [f for f in out if pip((x, y), list(zip(f['p'][::3], f['p'][1::3])))]
        assert on, f'the panel at {lat}, {lon} lies on no face'
        on[0].setdefault('w', []).append([x, y, along, across, kind])
    return out


def trees_of(path):
    """The state's single trees (a GeoPackage, which is SQLite) as x, y and height in whole metres."""
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    table = db.execute('select table_name from gpkg_contents').fetchone()[0]
    rows = db.execute(f'select r.minx, r.miny, t.baumhoehe from "rtree_{table}_geom" r join "{table}" t '
                      'on t.fid = r.id where r.minx > ? and r.maxx < ? and r.miny > ? and r.maxy < ?', UTM)
    out = []
    for east, north, tall in rows:
        p = xy(latlon(east, north))
        if inside(p, 60):
            out.append((round(p[0]), round(p[1]), round(tall)))
    return sorted(out)


def read_png(path):
    """An 8-bit RGB or RGBA PNG as (width, height, bytes per pixel, pixel bytes)."""
    data = open(path, 'rb').read()
    at, packed = 8, []
    while at < len(data):
        size, kind = struct.unpack('>I4s', data[at:at + 8])
        if kind == b'IHDR':
            w, h, depth, colour, _, _, lace = struct.unpack('>IIBBBBB', data[at + 8:at + 21])
            assert depth == 8 and colour in (2, 6) and not lace, 'the photo must be a plain 8-bit RGB(A) PNG'
        elif kind == b'IDAT':
            packed.append(data[at + 8:at + 8 + size])
        at += size + 12
    n = 3 if colour == 2 else 4
    raw, line = zlib.decompress(b''.join(packed)), w * n
    out, up = bytearray(), bytearray(line)
    for y in range(h):
        how, row = raw[y * (line + 1)], bytearray(raw[y * (line + 1) + 1:(y + 1) * (line + 1)])
        if how == 1:
            for i in range(n, line):
                row[i] = (row[i] + row[i - n]) & 255
        elif how == 2:
            row = bytearray((a + b) & 255 for a, b in zip(row, up))
        elif how == 3:
            for i in range(line):
                row[i] = (row[i] + ((row[i - n] if i >= n else 0) + up[i]) // 2) & 255
        elif how == 4:
            for i in range(line):
                a, b, c = row[i - n] if i >= n else 0, up[i], up[i - n] if i >= n else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                row[i] = (row[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out += row
        up = row
    return w, h, n, out


def spans(pts, y):
    """Where the row of pixels y crosses a polygon: [from, to) pairs of pixel columns."""
    xs = sorted(a[0] + (y + .5 - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
                for a, b in zip(pts, pts[1:] + pts[:1]) if (a[1] > y + .5) != (b[1] > y + .5))
    cut = [(max(0, math.ceil(a - .5)), min(WW, math.ceil(b - .5))) for a, b in zip(xs[::2], xs[1::2])]
    return [(a, b) for a, b in cut if a < b]


def roofs(buildings, photo):
    """Read the colour of every roof off the photo.

    ponytail: solar panels are not read. At one metre per pixel they look like a slate roof or a slope in shadow;
    telling them apart needs the photo at its full 20 cm.
    """
    w, h, n, px = photo
    for b in buildings:
        pts = corners(b)
        rows = range(max(0, int(min(p[1] for p in pts))), min(h, int(max(p[1] for p in pts)) + 1))
        seen = [px[(y * w + x) * n:(y * w + x) * n + 3]
                for y in rows for x0, x1 in spans(pts, y) for x in range(x0, x1)]
        if len(seen) < 6 or b['k'] in 'ost':
            continue
        seen.sort(key=sum)
        r, g, bl = seen[len(seen) // 2]
        warm, light = r - bl, (r + g + bl) / 3
        # orange, red or brown tiles; weathered grey-brown; then the greys: light, dark or bluish (slate), in between
        b['c'] = 'o' if warm >= 38 else 'r' if warm >= 22 else ('w' if light >= 145 else 'b') if warm >= 8 \
            else 'l' if light >= 165 else 'd' if light < 125 or warm < -8 else 'g'


def stencil(rows, w):
    """A see-through PNG from rows of bits, each row a str of '0' and '1': black where a bit is set."""
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))
    wide = -(-w // 8)
    lines = [b'\0' + int(row.ljust(wide * 8, '0'), 2).to_bytes(wide, 'big') for row in rows]
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, len(rows), 1, 3, 0, 0, 0))
           + chunk(b'PLTE', bytes(6)) + chunk(b'tRNS', b'\0\xff') + chunk(b'IDAT', zlib.compress(b''.join(lines), 9))
           + chunk(b'IEND', b''))
    return 'data:image/png;base64,' + base64.b64encode(png).decode()


def fields(plan, photo, areas):
    """What grows on the fields, read off the photo parcel by parcel: a see-through PNG for each kind of field.

    OSM maps the farmland as a few huge areas; in truth it is a patchwork of some hundred fields. A parcel of the
    cadastre is nearly always one field, so every parcel gets the kind its mean colour shows: pale stubble, olive,
    fresh, middle or dark green. The pictures have a pixel every 2 m, which is plenty for fields.
    """
    w, h, n, px = plan
    pw, ph, pn, ppx = photo
    # 1 = field, of no parcel yet. The topmost area decides, as in the game, and the lines between parcels wait.
    grid = bytearray(w * h)
    for a in areas:
        pts = list(zip(a['p'][::2], a['p'][1::2]))
        for y in range(max(0, int(min(p[1] for p in pts))), min(h, ph, int(max(p[1] for p in pts)) + 1)):
            for x0, x1 in spans(pts, y):
                grid[y * w + x0:y * w + x1] = bytes([a['k'] == 'farm']) * (x1 - x0)
    lines = [i for i in range(w * h) if grid[i] and px[i * n + 3] > 128]
    for i in lines:
        grid[i] = 0
    kind = bytearray(w * h)
    for start in range(w * h):
        if grid[start] != 1:
            continue
        grid[start] = 2
        todo, parcel = [start], []
        while todo:
            i = todo.pop()
            parcel.append(i)
            for j in (i - w, i + w, i - 1 if i % w else -1, i + 1 if (i + 1) % w else -1):
                if 0 <= j < w * h and grid[j] == 1:
                    grid[j] = 2
                    todo.append(j)
        some = parcel[::7]  # a seventh of the pixels is plenty for a mean
        r, g, b = (sum(ppx[i * pn + c] for i in some) / len(some) for c in range(3))
        light, green = (r + g + b) / 3, g - (r + b) / 2
        k = 1 if green < 6 and light >= 140 else (2 if green < 14 else 3) if light >= 125 else 4 if light >= 98 else 5
        for i in parcel:
            kind[i] = k
    for _ in range(2):  # the lines between the parcels go to a neighbour
        for i in lines:
            kind[i] = kind[i] or max(kind[i - 1], kind[(i + 1) % (w * h)], kind[i - w], kind[(i + w) % (w * h)])
    return [stencil([kind[y * w:(y + 1) * w:2].translate(bytes(48 + (v == k) for v in range(256))).decode()
                     for y in range(0, h, 2)], -(-w // 2)) for k in range(1, 6)]


def yards(areas, photo):
    """Paved, gravelled and bare ground inside the village, read off the photo: a see-through PNG, 1 px per metre.

    Everything that is neither green nor in deep shadow counts, roofs and roads too: the game paints over those.
    The areas come in the order the game paints them, so a car park or a pitch inside the village stays as it is.
    """
    w, h, n, px = photo
    rows = [bytearray(w) for _ in range(h)]
    bare = [{'k': PAVED[0], 'p': flat(xy({'lat': lat, 'lon': lon}) for lat, lon in patch)} for patch in BARE]
    for a in areas + bare:
        pts = list(zip(a['p'][::2], a['p'][1::2]))
        for y in range(max(0, int(min(p[1] for p in pts))), min(h, int(max(p[1] for p in pts)) + 1)):
            for x0, x1 in spans(pts, y):
                at, to = (y * w + x0) * n, (y * w + x1) * n
                rows[y][x0:x1] = bytes(2 * g - r - b < 14 and r + g + b > 285 for r, g, b in
                                       zip(px[at:to:n], px[at + 1:to:n], px[at + 2:to:n])) \
                    if a['k'] in PAVED else bytes(x1 - x0)
    # A pixel stays when most of the 5 x 5 around it agree: no specks from cars and garden chairs.
    wide = []
    for row in rows:
        acc = [0, 0, 0] + list(itertools.accumulate(row)) + [sum(row)] * 2
        wide.append([b - a for a, b in zip(acc, acc[5:])])
    wide = [[0] * w] * 2 + wide + [[0] * w] * 2
    return stencil([''.join('1' if sum(v) > 12 else '0' for v in zip(*wide[y:y + 5])) for y in range(h)], w)


def paved(photo, x, y):
    """Whether the photo shows neither green nor deep shadow at a point."""
    w, h, n, px = photo
    at = (min(max(int(y), 0), h - 1) * w + min(max(int(x), 0), w - 1)) * n
    return 2 * px[at + 1] - px[at] - px[at + 2] < 14 and px[at] + px[at + 1] + px[at + 2] > 285


def thin(ink):
    """Peel lines of pixels down to a width of one (Zhang and Suen)."""
    ring = ((0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1))
    peeled = True
    while peeled:
        peeled = False
        for odd in (False, True):
            drop = []
            for x, y in ink:
                nb = [(x + dx, y + dy) in ink for dx, dy in ring]
                if not 2 <= sum(nb) <= 6 or sum(not a and b for a, b in zip(nb, nb[1:] + nb[:1])) != 1:
                    continue
                if (nb[0] and nb[2] and nb[6] or nb[0] and nb[4] and nb[6]) if odd \
                        else (nb[0] and nb[2] and nb[4] or nb[2] and nb[4] and nb[6]):
                    continue
                drop.append((x, y))
            ink.difference_update(drop)
            peeled = peeled or bool(drop)
    return ink


def chains(ink):
    """Follow thinned lines from one crossing or end to the next: lists of pixels."""
    def links(x, y):
        near = [(x + dx, y + dy) for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)) if (x + dx, y + dy) in ink]
        # A diagonal step counts only where no two straight steps lead to the same pixel.
        return near + [(x + dx, y + dy) for dx, dy in ((1, -1), (1, 1), (-1, 1), (-1, -1))
                       if (x + dx, y + dy) in ink and (x + dx, y) not in ink and (x, y + dy) not in ink]
    graph = {p: links(*p) for p in ink}
    ends = {p for p, near in graph.items() if len(near) != 2}
    out, done = [], set()
    for start in sorted(ends):
        for step in graph[start]:
            if (start, step) in done:
                continue
            line, cur = [start], step
            while cur not in ends:
                line.append(cur)
                cur = next(q for q in graph[cur] if q != line[-2])
            line.append(cur)
            done.add((cur, line[-2]))
            out.append(line)
    return out


def straighten(line, tol=.8):
    """Keep only the corners of a line of points (Douglas and Peucker)."""
    keep, todo = {0, len(line) - 1}, [(0, len(line) - 1)]
    while todo:
        i, j = todo.pop()
        (x0, y0), (x1, y1) = line[i], line[j]
        length = math.dist(line[i], line[j]) or 1
        off, at = max((abs((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)) / length, k)
                      for k, (x, y) in enumerate(line[i:j + 1], i))
        if off > tol:
            keep.add(at)
            todo += [(i, at), (at, j)]
    return [line[k] for k in sorted(keep)]


def borders(plan, photo, buildings, areas, roads):
    """Garden fences and hedges along the borders of the parcels, read off the cadastre's outline picture.

    The picture also outlines the buildings and names the streets: buildings and letters are rubbed out, and what
    lies on a road is left aside. The game's roads and pavements are wider than the real ones, so a border along a
    street is pushed back to the edge of the pavement, and stays open where the photo shows a paved drive behind it.
    ponytail: which borders get a fence, a hedge or nothing is diced, nobody mapped that.
    """
    w, h, n, px = plan
    # Borders are drawn crisp, letters with soft edges: ink that has soft pixels around it is a letter.
    ink = {(i % w, i // w) for i in range(w * h) if px[i * n + 3] >= 224}
    soft = {(i % w, i // w) for i in range(w * h) if 16 < px[i * n + 3] < 224}
    ink -= {(x, y) for x, y in ink
            if sum((x + dx, y + dy) in soft for dx in (-1, 0, 1) for dy in (-1, 0, 1)) > 1}
    for b in buildings:
        pts = corners(b)
        for a, c in zip(pts, pts[1:] + pts[:1]):
            steps = int(math.dist(a, c) * 2) + 1
            for i in range(steps + 1):
                x, y = a[0] + (c[0] - a[0]) * i / steps, a[1] + (c[1] - a[1]) * i / steps
                ink.difference_update((int(x + dx), int(y + dy)) for dx in (-.5, 0, .5) for dy in (-.5, 0, .5))
    # Gardens are in the village, but not in its car parks, school yards and playing fields.
    village = [bytearray(w) for _ in range(h)]
    for a in areas:
        pts = list(zip(a['p'][::2], a['p'][1::2]))
        for y in range(max(0, int(min(p[1] for p in pts))), min(h, int(max(p[1] for p in pts)) + 1)):
            for x0, x1 in spans(pts, y):
                village[y][x0:x1] = bytes([a['k'] in PAVED]) * (x1 - x0)
    # Every stretch of road, track, rail and brook, filed under the squares of 32 m it runs through: its ends, half
    # its width, and how far its verge or pavement reaches.
    lanes = {}
    for r in roads:
        pts, half = list(zip(r['p'][::2], r['p'][1::2])), r['w'] / 2
        verge = half + (2.3 if r['t'] in CAR and r['t'] != 'service' else .8)
        for a, c in zip(pts, pts[1:]):
            for gx in range(int(min(a[0], c[0]) - 8) // 32, int(max(a[0], c[0]) + 8) // 32 + 1):
                for gy in range(int(min(a[1], c[1]) - 8) // 32, int(max(a[1], c[1]) + 8) // 32 + 1):
                    lanes.setdefault((gx, gy), []).append((a, c, half, verge))

    def post(x, y):
        """Where a fence post meant for (x, y) may stand, or None: not on a road, not across a paved drive."""
        if not (0 <= x < w and 0 <= y < h and village[int(y)][int(x)]):
            return None
        back = 0, None  # how far to step back from the nearest road, and from which point of it
        for a, c, half, verge in lanes.get((int(x) // 32, int(y) // 32), ()):
            t = ((x - a[0]) * (c[0] - a[0]) + (y - a[1]) * (c[1] - a[1])) / (math.dist(a, c) ** 2 or 1)
            q = (a[0] + (c[0] - a[0]) * min(max(t, 0), 1), a[1] + (c[1] - a[1]) * min(max(t, 0), 1))
            far = math.dist((x, y), q)
            if far < half:
                return None
            back = max(back, (verge - far, (q, far, verge)), key=lambda v: v[0])
        if not back[1]:
            return x, y
        q, far, verge = back[1]
        ux, uy = (x - q[0]) / far, (y - q[1]) / far
        if photo and paved(photo, q[0] + ux * (verge + 2), q[1] + uy * (verge + 2)):
            return None
        return q[0] + ux * verge, q[1] + uy * verge

    fences, hedges = [], []
    for line in chains(thin(ink)):
        if len(line) < 5:
            continue  # a dot, or the rest of a letter
        line = straighten([(x + .5, y + .5) for x, y in line], 1.5)  # generous: letters leave lines ragged
        roll, run = random.Random(repr(line[0])).random(), []  # the same border, the same roll, whatever else changes
        into = None if roll < .3 else hedges if roll < .5 else fences
        # A post every metre; where none may stand, the fence so far is done.
        posts = [post(a[0] + (c[0] - a[0]) * i / steps, a[1] + (c[1] - a[1]) * i / steps)
                 for a, c in zip(line, line[1:]) for steps in [round(math.dist(a, c)) or 1] for i in range(steps)]
        for at in posts + [post(*line[-1]), None] if into is not None else []:
            if at:
                run.append(at)
                continue
            run = straighten(run, .5) if run else run
            if sum(map(math.dist, run, run[1:])) >= 3:
                into.append([round(v, 1) for q in run for v in q])
            run = []
    return fences, hedges


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

spot = {nid: q for e in els if e['type'] == 'way' for nid, q in zip(e.get('nodes', ()), e.get('geometry', ()))}
for i, (tags, start, pts) in enumerate(WAYS):
    # The new nodes get made-up numbers below zero, where OSM has none.
    els.append({'type': 'way', 'tags': tags, 'nodes': [start] + [-100 * i - j for j in range(1, len(pts) + 1)],
                'geometry': [spot[start]] + [{'lat': lat, 'lon': lon} for lat, lon in pts]})

roads, areas, buildings, trees, hedges, fences = [], [], [], [], [], []
node_ix, nodes, edges = {}, [], []
zones = {z: [] for z in ZONE}

for e in els:
    t = e.get('tags', {})
    if e['type'] == 'node':
        if t.get('natural') == 'tree' and inside(xy(e), 20):
            trees.append((*xy(e), 0))  # x, y and a height of 0 for "not known"
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

for lat, lon in SILOS:
    x, y = xy({'lat': lat, 'lon': lon})
    lid = [(round(x + 2.3 * math.cos(i * math.pi / 5), 1), round(y + 2.3 * math.sin(i * math.pi / 5), 1))
           for i in range(10)]
    buildings.append({'p': flat(lid), 'h': 12, 'a': 17, 'k': 's', 'look': {'wall': '#d6d8da'}})  # pale steel
tiles = [a for a in sys.argv[2:] if a.endswith('.gml')]
photo = plan = None
for picture in (read_png(a) for a in sys.argv[2:] if a.endswith('.png')):
    assert picture[0] == WW and picture[1] <= WH, f'the pictures must be {WW} pixels wide and at most {WH} high'
    if picture[2] == 4 and 0 in picture[3][3::4 * 97]:
        plan = picture  # one can see through it
    else:
        photo = picture
if tiles:
    # Build on the state's buildings. OSM adds what it knows better: that something is a church, a garage or an
    # open roof, the round silos, and the few buildings the state does not have.
    drawn, buildings = buildings, lod2(tiles)
    for b in drawn:
        pts, c = corners(b), centre(b)
        hits = [o for o in buildings if math.dist(c, centre(o)) < 150 and pip(centre(o), pts)]
        if b['k'] == 's':
            buildings = [o for o in buildings if o not in hits] + [b]
        elif not hits and not any(math.dist(c, centre(o)) < 150 and pip(c, corners(o)) for o in buildings):
            buildings.append(b)
            b['osm'] = 1
        for o in hits if b['k'] in 'cgo' else []:
            if o['k'] != 't':
                o['k'] = b['k']
                o.pop('r', None) if b['k'] == 'o' else None
    lone = sum(b.pop('osm', 0) for b in buildings)
    assert lone < len(drawn) / 5, f'{lone} OSM buildings have no state building: do the tiles line up?'
    print(f'{len(buildings)} buildings: {lone} only in OSM, {len(drawn)} drawn in OSM', file=sys.stderr)
for kind, patch in PATCHES:
    pts = ring([{'lat': lat, 'lon': lon} for lat, lon in patch])
    areas.append({'k': kind, 'p': flat(pts), 'a': shoelace(pts)})
for lat, lon, pieces in SPLIT:
    spot = xy({'lat': lat, 'lon': lon})
    whole = next((b for b in buildings if pip(spot, corners(b))), None)
    if whole:
        buildings.remove(whole)
        for shape, corner_list in pieces:
            pts = ring([{'lat': la, 'lon': lo} for la, lo in corner_list])
            buildings.append({'p': flat(pts), 'a': round(shoelace(pts)), 'k': whole['k'], **shape})
for shape, corner_list in SHEDS:
    pts = ring([{'lat': la, 'lon': lo} for la, lo in corner_list])
    buildings.append({'p': flat(pts), 'a': round(shoelace(pts)), **shape})
for b in buildings:
    if b['k'] in 'hy':
        c = centre(b)
        b['k'] = next((ZONE[z] for z in ZONE if any(pip(c, poly) for poly in zones[z])), b['k'])
areas.sort(key=lambda a: -a.pop('a'))
if photo:
    roofs(buildings, photo)
for lat, lon, changes in LOOKS:
    spot = xy({'lat': lat, 'lon': lon})
    for b in buildings:
        if pip(spot, corners(b)):
            b.update(changes)
for b in buildings:
    raw, faces = b.pop('_f', None), b.pop('faces', 0)
    slopes, panels, chimney = b.pop('slopes', {}), b.pop('panels', []), b.pop('chimney', None)
    if faces and raw:
        b['f'] = survey_faces(raw, slopes, panels)
    if chimney:
        b['ch'] = xy({'lat': chimney[0], 'lon': chimney[1]})
if plan:
    drawn = len(fences), len(hedges)
    more = borders(plan, photo, buildings, areas, roads)
    fences += more[0]
    hedges += more[1]
    print(f'{len(more[0])} fences and {len(more[1])} hedges along parcel borders, besides {drawn} in OSM',
          file=sys.stderr)
for path in sys.argv[2:]:
    if path.endswith('.gpkg'):
        trees += trees_of(path)

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
out['pools'] = [v for lat, lon, across, down in POOLS for v in (*xy({'lat': lat, 'lon': lon}), across, down)]
if photo:
    out['yards'] = yards(areas, photo)
if photo and plan:
    out['fields'] = fields(plan, photo, areas)
print('// Generated by tools/osm2map.py. Map data (c) OpenStreetMap contributors, ODbL.'
      + (' Buildings, trees, roof colours, yards and parcel borders: Bayerische Vermessungsverwaltung,'
         ' www.geodaten.bayern.de, CC BY 4.0, simplified.' if len(sys.argv) > 2 else ''))
print('export const MAP = ' + json.dumps(out, separators=(',', ':'), ensure_ascii=False) + ';')
print(f'{len(roads)} roads, {len(nodes)} nodes, {len(buildings)} buildings, {len(areas)} areas, {len(trees)} trees, '
      f'{len(hedges)} hedges, {WW}x{WH} m', file=sys.stderr)
