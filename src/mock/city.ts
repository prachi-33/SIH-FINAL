import type { Camera, LngLat, RoadLink, Zone } from '@/types';

/**
 * Hardcoded 3-node camera deployment.
 *
 * Three cameras connected as a triangle, using real GPS coordinates
 * and video clip references.
 */

export const ZONES: Zone[] = [
  {
    id: 'z-dwarka',
    name: 'Dwarka Zone',
    division: 'Zone I · Dwarka Sub-City',
    center: [77.0366, 28.605],
  },
];

interface CameraSeed {
  id: string;
  name: string;
  location: string;
  zoneId: string;
  position: LngLat; // [longitude, latitude] — GeoJSON order
  /** Relative traffic pull. Drives synthetic volumes. */
  weight: number;
  /** Video file URL served from public/videos/. */
  videoUrl: string;
}

const CAMERA_SEEDS: CameraSeed[] = [
  {
    id: 'c-node-1',
    name: 'Camera Node 1',
    location: 'Node 1 — Dwarka Corridor',
    zoneId: 'z-dwarka',
    position: [77.034794, 28.609012],
    weight: 1.4,
    videoUrl: 'https://www.youtube.com/embed/-H1tPNwAYOY?autoplay=1&mute=1&loop=1&playlist=-H1tPNwAYOY&controls=0',
  },
  {
    id: 'c-node-2',
    name: 'Camera Node 2',
    location: 'Node 2 — Dwarka Corridor',
    zoneId: 'z-dwarka',
    position: [77.041662, 28.602264],
    weight: 1.2,
    videoUrl: 'https://www.youtube.com/embed/lxKbuIlzA7M?autoplay=1&mute=1&loop=1&playlist=lxKbuIlzA7M&controls=0',
  },
  {
    id: 'c-node-3',
    name: 'Camera Node 3',
    location: 'Node 3 — Dwarka Corridor',
    zoneId: 'z-dwarka',
    position: [77.033444, 28.603842],
    weight: 1.1,
    videoUrl: 'https://www.youtube.com/embed/yFlo2BW3TKU?autoplay=1&mute=1&loop=1&playlist=yFlo2BW3TKU&controls=0',
  },
];

/** Triangle topology — all three nodes connected to each other. */
const LINK_TABLE: Array<[string, string, string]> = [
  ['c-node-1', 'c-node-2', 'Dwarka Corridor N–E'],
  ['c-node-2', 'c-node-3', 'Dwarka Corridor E–S'],
  ['c-node-3', 'c-node-1', 'Dwarka Corridor S–N'],
];

/** Great-circle distance in km. */
export function haversineKm(a: LngLat, b: LngLat): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Roads are never straight. Scale crow-flies distance for realistic routing. */
const ROAD_WINDING_FACTOR = 1.3;

export interface CityNetwork {
  cameras: Camera[];
  camerasById: Map<string, Camera>;
  zones: Zone[];
  zonesById: Map<string, Zone>;
  links: RoadLink[];
  /** Directed adjacency list: camera id → outgoing links. */
  adjacency: Map<string, RoadLink[]>;
  /** Relative traffic weight per camera, keyed by id. */
  weights: Map<string, number>;
}

/**
 * Builds the immutable network description.
 */
export function buildNetwork(): CityNetwork {
  const cameras: Camera[] = CAMERA_SEEDS.map((seed, i) => {
    const zone = ZONES.find((z) => z.id === seed.zoneId)!;
    const zoneIndex = ZONES.indexOf(zone) + 1;
    return {
      id: seed.id,
      code: `DL-Z${zoneIndex}-${String(i + 1).padStart(3, '0')}`,
      name: seed.name,
      location: seed.location,
      zoneId: seed.zoneId,
      position: seed.position,
      status: 'online' as const,
      videoFeeds: [seed.videoUrl],
      lastHeartbeat: new Date().toISOString(),
    };
  });

  const camerasById = new Map(cameras.map((c) => [c.id, c]));
  const links: RoadLink[] = [];
  const adjacency = new Map<string, RoadLink[]>(cameras.map((c) => [c.id, []]));

  for (const [a, b, corridor] of LINK_TABLE) {
    const ca = camerasById.get(a);
    const cb = camerasById.get(b);
    if (!ca || !cb) throw new Error(`LINK_TABLE references unknown camera: ${a} / ${b}`);

    const distanceKm = Number(
      (haversineKm(ca.position, cb.position) * ROAD_WINDING_FACTOR).toFixed(3),
    );

    for (const [from, to] of [
      [ca, cb],
      [cb, ca],
    ] as const) {
      const link: RoadLink = {
        id: `l-${from.id.slice(2)}__${to.id.slice(2)}`,
        fromCameraId: from.id,
        toCameraId: to.id,
        distanceKm,
        corridor,
      };
      links.push(link);
      adjacency.get(from.id)!.push(link);
    }
  }

  return {
    cameras,
    camerasById,
    zones: ZONES,
    zonesById: new Map(ZONES.map((z) => [z.id, z])),
    links,
    adjacency,
    weights: new Map(CAMERA_SEEDS.map((s) => [s.id, s.weight])),
  };
}

/** Bounding box of the whole network, for initial map fit. */
export function networkBounds(cameras: Camera[]): [[number, number], [number, number]] {
  const lngs = cameras.map((c) => c.position[0]);
  const lats = cameras.map((c) => c.position[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
