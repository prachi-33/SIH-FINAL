import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Download,
  Play,
  Pause,
  Search,
  SkipBack,
  SkipForward,
  Clock,
  Car,
} from 'lucide-react';

import { PageFixed, PageToolbar } from '@/components/layout/Page';
import { CityMap } from '@/components/map/CityMap';
import {
  MapOverlay,
  RouteLegend,
} from '@/components/map/MapControls';

import {
  Badge,
  Button,
  Input,
  Panel,
  PanelHeader,
  PlateChip,
  Segmented,
  Spinner,
} from '@/components/ui/primitives';

import { buildNetwork } from '@/mock/city';
import { formatPlate } from '@/mock/vehicles';
import { downloadFile, formatDateTime, formatTime, toCsv } from '@/lib/format';
import { RANGE_LABEL, useAppStore, useCan, type RangePreset } from '@/store/useAppStore';

import type { LngLat } from '@/types';
import cctvRawData from '../../synthetic_cctv_traffic.json';

/**
 * Trajectory Tracking page.
 *
 * Merges the vehicle-tracking simulation logic:
 *  - Loads camera events + incidents from /sample_ingest_events.json and
 *    /sample_ingest_incidents.json (falling back to inline constants if the
 *    files are unavailable).
 *  - Map is always visible with all camera markers colour-coded by incident severity.
 *  - Sidebar lists every plate seen in the events data; clicking one traces the
 *    real road route (OSRM) between the cameras that captured it, in order.
 *  - Playback controls step through each sighting.
 */

// ─── Static camera network ────────────────────────────────────────────────────
const NETWORK = buildNetwork();

// Build a fast lookup: camera id → { lat, lng } (Leaflet axis order)
const CAM_LATLNG = new Map(
  NETWORK.cameras.map((c) => [c.id, { lat: c.position[1], lng: c.position[0] }]),
);

// ─── Ingest data types ────────────────────────────────────────────────────────
interface IngestEvent {
  camera_id: string;
  plate: string;
  /** ISO timestamp string */
  timestamp: string;
  confidence: number;
}

interface IngestIncident {
  camera_id: string;
  timestamp: string;
  type: 'density' | 'overspeeding' | 'faulty_driving';
  value: number;
  metadata: Record<string, unknown>;
}

// ─── Fallback data (used when JSON files are unreachable) ─────────────────────
/*const FALLBACK_EVENTS: IngestEvent[] = [
  { camera_id: 'c-dwarka-mor',     plate: 'DL7CQ1234', timestamp: '2026-09-09T10:02:00.000Z', confidence: 0.94 },
  { camera_id: 'c-dwarka-flyover', plate: 'DL7CQ1234', timestamp: '2026-09-09T10:06:30.000Z', confidence: 0.88 },
  { camera_id: 'c-mohan-garden',   plate: 'DL7CQ1234', timestamp: '2026-09-09T10:12:00.000Z', confidence: 0.91 },
  { camera_id: 'c-vikaspuri',      plate: 'DL7CQ1234', timestamp: '2026-09-09T10:18:45.000Z', confidence: 0.86 },
  { camera_id: 'c-nawada',         plate: 'DL4CAB5678', timestamp: '2026-09-09T09:50:00.000Z', confidence: 0.97 },
  { camera_id: 'c-dwarka-mor',     plate: 'DL4CAB5678', timestamp: '2026-09-09T09:55:20.000Z', confidence: 0.82 },
  { camera_id: 'c-bindapur',       plate: 'DL4CAB5678', timestamp: '2026-09-09T10:01:40.000Z', confidence: 0.79 },
  { camera_id: 'c-palam-crossing', plate: 'DL4CAB5678', timestamp: '2026-09-09T10:08:10.000Z', confidence: 0.91 },
  { camera_id: 'c-uttam-nagar-east', plate: 'DL1AB9087', timestamp: '2026-09-09T10:15:05.000Z', confidence: 0.76 },
  { camera_id: 'c-nawada',         plate: 'DL1AB9087', timestamp: '2026-09-09T10:21:30.000Z', confidence: 0.90 },
  { camera_id: 'c-dwarka-mor',     plate: 'DL1AB9087', timestamp: '2026-09-09T10:27:44.000Z', confidence: 0.95 },
  { camera_id: 'c-dwarka-flyover', plate: 'DL1AB9087', timestamp: '2026-09-09T10:34:58.000Z', confidence: 0.44 },
  { camera_id: 'c-dwarka-sec14',   plate: 'DL8PQ3311', timestamp: '2026-09-09T09:40:20.000Z', confidence: 0.89 },
  { camera_id: 'c-dwarka-sec7',    plate: 'DL8PQ3311', timestamp: '2026-09-09T09:47:10.000Z', confidence: 0.93 },
  { camera_id: 'c-dwarka-sec11',   plate: 'DL8PQ3311', timestamp: '2026-09-09T09:53:45.000Z', confidence: 0.85 },
  { camera_id: 'c-janakpuri-west', plate: 'DL3LZ7745', timestamp: '2026-09-09T10:30:10.000Z', confidence: 0.81 },
  { camera_id: 'c-vikaspuri',      plate: 'DL3LZ7745', timestamp: '2026-09-09T10:36:55.000Z', confidence: 0.79 },
  { camera_id: 'c-mohan-garden',   plate: 'DL3LZ7745', timestamp: '2026-09-09T10:42:03.000Z', confidence: 0.96 },
];*/

const FALLBACK_INCIDENTS: IngestIncident[] = [
  { camera_id: 'c-dwarka-mor',  timestamp: '2026-09-09T10:00:00.000Z', type: 'density',        value: 12,   metadata: { vehicle_class: 'mixed', window_sec: 5 } },
  { camera_id: 'c-vikaspuri',   timestamp: '2026-09-09T10:18:00.000Z', type: 'overspeeding',   value: 72.4, metadata: { vehicle_class: 'car',   speed_limit_kmph: 50 } },
  { camera_id: 'c-mohan-garden',timestamp: '2026-09-09T10:12:10.000Z', type: 'overspeeding',   value: 84.7, metadata: { vehicle_class: 'bike',  speed_limit_kmph: 50 } },
  { camera_id: 'c-palam-crossing',timestamp:'2026-09-09T10:08:00.000Z',type: 'faulty_driving', value: 1,    metadata: { vehicle_class: 'car',   reason: 'wrong_lane' } },
  { camera_id: 'c-dwarka-mor',  timestamp: '2026-09-09T10:03:00.000Z', type: 'faulty_driving', value: 1,    metadata: { vehicle_class: 'bike',  reason: 'signal_jump' } },
  { camera_id: 'c-bindapur',    timestamp: '2026-09-09T10:02:00.000Z', type: 'overspeeding',   value: 91.2, metadata: { vehicle_class: 'truck', speed_limit_kmph: 40 } },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/*async function fetchJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error('not ok');
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}*/

async function fetchRoadRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<LngLat[]> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('OSRM failed');
  const data = await res.json();
  if (!data.routes?.length) throw new Error('No route');
  // GeoJSON = [lng,lat] → keep as LngLat for CityMap
  return (data.routes[0].geometry.coordinates as [number, number][]) as LngLat[];
}

/** Colour for a camera based on the worst incident it has logged. */
/*function incidentColor(incidents: IngestIncident[], cameraId: string): string {
  const own = incidents.filter((i) => i.camera_id === cameraId);
  if (own.some((i) => i.type === 'overspeeding'))   return '#ef4444'; // red
  if (own.some((i) => i.type === 'faulty_driving')) return '#f59e0b'; // amber
  return '#3ba7ff'; // blue – clear / density only
}*/

// ─── Playback speeds ──────────────────────────────────────────────────────────
const PLAYBACK_SPEEDS = ['1', '2', '4'] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
const STEP_MS: Record<PlaybackSpeed, number> = { '1': 1400, '2': 750, '4': 380 };

// ─── Component ────────────────────────────────────────────────────────────────

export function TrajectoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const plateParam = searchParams.get('plate') ?? '';

  const [draft, setDraft] = useState(plateParam);

  // ── Ingest data loaded from JSON files ──
  const [events, setEvents] = useState<IngestEvent[]>([]);
  const [incidents, setIncidents] = useState<IngestIncident[]>([]);
  const [ingestLoaded, setIngestLoaded] = useState(false);

  // ── Tracked plate state ──
  const [activePlate, setActivePlate] = useState<string | null>(null);
  const [plateFilter, setPlateFilter] = useState('');
  const [activeSeq, setActiveSeq] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>('2');
  const [tripStatus, setTripStatus] = useState('Pick a plate in the sidebar to trace its route.');

  // ── Route drawn on map ──
  // We build raw LngLat[][] segments and pass them as RouteSegment[]
  const [routeSegments, setRouteSegments] = useState<
    Array<{ coordinates: LngLat[]; inferred: boolean; fromSeq: number; toSeq: number }>
  >([]);
  const [routePoints, setRoutePoints] = useState<
    Array<{ detection: { id: string; plate: string; cameraId: string; timestamp: string }; camera: (typeof NETWORK.cameras)[0]; seq: number }>
  >([]);
  const [fitTo, setFitTo] = useState<LngLat[] | null>(null);

  const range = useAppStore((s) => s.range);
  const setRange = useAppStore((s) => s.setRange);
  const mapLayers = useAppStore((s) => s.mapLayers);
  const canExport = useCan('export');

  // ── Load JSON files once ──────────────────────────────────────────────────
  useEffect(() => {
    const today = new Date();
    const toIsoTimestamp = (timeStr: string) => {
      const [hms, ms] = timeStr.split('.');
      const [h, m, s] = hms.split(':').map(Number);
      const d = new Date(today);
      d.setHours(h, m, s, ms ? Number(ms) : 0);
      return d.toISOString();
    };

    const mappedEvents: IngestEvent[] = (cctvRawData as any[]).map((entry) => ({
      camera_id: `c-node-${entry.node_number}`,
      plate: entry.license_plate,
      timestamp: toIsoTimestamp(entry.timestamp),
      confidence: 0.85 + Math.random() * 0.14,
    }));

    const remappedIncidents: IngestIncident[] = FALLBACK_INCIDENTS.map((inc, i) => ({
      ...inc,
      camera_id: `c-node-${(i % 3) + 1}`,
    }));

    setEvents(mappedEvents);
    setIncidents(remappedIncidents);
    setIngestLoaded(true);
  }, []);

  // We pass normal cameras to CityMap but override colors via cameraReads approach.
  // Actually we directly supply the cameras with a tweaked status to drive colour:
  const camerasForMap = useMemo(() => {
    return NETWORK.cameras.map((cam) => {
      const own = incidents.filter((i) => i.camera_id === cam.id);
      const hasOverspeed  = own.some((i) => i.type === 'overspeeding');
      const hasFaulty     = own.some((i) => i.type === 'faulty_driving');
      return {
        ...cam,
        // Map incident severity to camera status so CityMap colour-codes correctly.
        // 'offline' = red (overspeeding), 'degraded' = amber (faulty), 'online' = blue (clear)
        status: hasOverspeed ? ('offline' as const) : hasFaulty ? ('degraded' as const) : ('online' as const),
      };
    });
  }, [incidents]);

  // ── Plate sidebar list ────────────────────────────────────────────────────
  const plateRows = useMemo(() => {
    const groups: Record<string, IngestEvent[]> = {};
    events.forEach((e) => {
      if (!groups[e.plate]) groups[e.plate] = [];
      groups[e.plate].push(e);
    });
    return Object.entries(groups)
      .filter(([p]) => !plateFilter || p.toLowerCase().includes(plateFilter.toLowerCase()))
      .map(([plate, hits]) => {
        const sorted = [...hits].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const avgConf = hits.reduce((s, h) => s + h.confidence, 0) / hits.length;
        return { plate, count: hits.length, avgConf, firstSeen: sorted[0].timestamp };
      })
      .sort((a, b) => a.plate.localeCompare(b.plate));
  }, [events, plateFilter]);

  // ── Clear tracked route ───────────────────────────────────────────────────
  const clearRoute = useCallback(() => {
    setActivePlate(null);
    setRouteSegments([]);
    setRoutePoints([]);
    setFitTo(null);
    setActiveSeq(null);
    setPlaying(false);
    setTripStatus('Pick a plate in the sidebar to trace its route.');
  }, []);

  // Ref to abort an in-progress route fetch when a new plate is clicked
  const abortRef = useRef(false);

  // ── Track a plate ─────────────────────────────────────────────────────────
  const trackPlate = useCallback(
    async (plate: string) => {
      abortRef.current = true; // cancel any running fetch
      clearRoute();
      abortRef.current = false;

      setActivePlate(plate);
      setSearchParams({ plate }, { replace: false });

      const hits = events
        .filter((e) => e.plate === plate && CAM_LATLNG.has(e.camera_id))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      if (hits.length === 0) {
        setTripStatus(`No camera hits found for ${plate}.`);
        return;
      }

      setTripStatus(`Tracing ${plate} across ${hits.length} camera${hits.length > 1 ? 's' : ''}…`);

      // Build routePoints (seq pins on the map)
      const pts = hits.map((h, i) => ({
        detection: { id: `${h.plate}-${i}`, plate: h.plate, cameraId: h.camera_id, timestamp: h.timestamp },
        camera: NETWORK.camerasById.get(h.camera_id)!,
        seq: i + 1,
      }));
      setRoutePoints(pts);
      setActiveSeq(1);

      // Fit map to the sighting cameras
      const positions = hits.map((h) => {
        const ll = CAM_LATLNG.get(h.camera_id)!;
        return [ll.lng, ll.lat] as LngLat;
      });
      setFitTo(positions);

      // Fetch OSRM road routes between consecutive cameras
      let totalKm = 0;
      let anyFailed = false;
      const segs: Array<{ coordinates: LngLat[]; inferred: boolean; fromSeq: number; toSeq: number }> = [];

      for (let i = 0; i < hits.length - 1; i++) {
        if (abortRef.current) return; // another plate was clicked

        const from = CAM_LATLNG.get(hits[i].camera_id)!;
        const to   = CAM_LATLNG.get(hits[i + 1].camera_id)!;

        try {
          const coords = await fetchRoadRoute(from, to);
          segs.push({ coordinates: coords, inferred: false, fromSeq: i + 1, toSeq: i + 2 });
          // Rough km: sum of segment distances
          const d = Math.sqrt(
            Math.pow(to.lat - from.lat, 2) + Math.pow(to.lng - from.lng, 2),
          ) * 111;
          totalKm += d;
        } catch {
          anyFailed = true;
          segs.push({
            coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
            inferred: true,
            fromSeq: i + 1,
            toSeq: i + 2,
          });
        }
      }

      if (abortRef.current) return;
      setRouteSegments(segs);

      const spanMs = new Date(hits[hits.length - 1].timestamp).getTime() - new Date(hits[0].timestamp).getTime();
      const spanMin = (spanMs / 60_000).toFixed(0);

      setTripStatus(
        `${plate} · ${hits.length} cameras · span ${spanMin} min` +
        (totalKm > 0 ? ` · ~${totalKm.toFixed(1)} km` : '') +
        (anyFailed ? ' · some legs straight-line (OSRM unreachable)' : ''),
      );
    },
    [events, clearRoute, setSearchParams],
  );

  // Auto-track plate from URL param when data is loaded
  useEffect(() => {
    if (ingestLoaded && plateParam && plateParam !== activePlate) {
      void trackPlate(plateParam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingestLoaded, plateParam]);

  // ── Playback ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || routePoints.length === 0) return;
    const timer = setInterval(() => {
      setActiveSeq((current) => {
        const next = (current ?? 0) + 1;
        if (next > routePoints.length) { setPlaying(false); return routePoints.length; }
        return next;
      });
    }, STEP_MS[speed]);
    return () => clearInterval(timer);
  }, [playing, speed, routePoints.length]);

  // ── CSV export ────────────────────────────────────────────────────────────
  const exportCsv = () => {
    if (!activePlate || routePoints.length === 0) return;
    const rows = routePoints.map((pt) => [
      pt.seq,
      formatDateTime(pt.detection.timestamp),
      pt.camera.code,
      pt.camera.name,
      pt.camera.location,
      pt.camera.position[1].toFixed(6),
      pt.camera.position[0].toFixed(6),
    ]);
    downloadFile(
      `netra-trajectory-${activePlate}.csv`,
      toCsv(['Seq', 'Timestamp', 'Camera code', 'Camera name', 'Location', 'Latitude', 'Longitude'], rows),
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <PageFixed>
      {/* ── Toolbar ── */}
      <PageToolbar>
        <form
          onSubmit={(e) => { e.preventDefault(); if (draft.trim().length >= 4) void trackPlate(draft.trim().toUpperCase()); }}
          className="relative flex items-center gap-1.5"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-dim" />
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
              placeholder="MH12AB1234"
              aria-label="Registration number"
              className="w-60 pl-8 font-mono tracking-wider"
            />
          </div>
          <Button type="submit" variant="primary" disabled={draft.trim().length < 4}>
            Reconstruct
          </Button>
        </form>

        <Segmented
          value={range}
          onChange={(v) => setRange(v as RangePreset)}
          size="xs"
          options={(['15m', '1h', '6h', '24h'] as RangePreset[]).map((p) => ({
            value: p, label: p, title: RANGE_LABEL[p],
          }))}
        />

        <div className="ml-auto flex items-center gap-2">
          {activePlate && canExport && (
            <Button icon={<Download className="size-3.5" />} onClick={exportCsv}>
              Export CSV
            </Button>
          )}
        </div>
      </PageToolbar>

      {/* ── Main layout: map + sidebar ── */}
      <div className="flex min-h-0 flex-1 gap-3">

        {/* ── LEFT sidebar ── */}
        <div className="flex w-72 shrink-0 flex-col gap-3 overflow-hidden">

          {/* Plate list */}
          <Panel flush className="min-h-0 flex-1 flex flex-col">
            <PanelHeader
              className="border-b border-line p-3"
              title="Track a Vehicle"
              icon={<Car className="size-4" />}
            />

            <div className="p-3 pb-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-dim" />
                <Input
                  value={plateFilter}
                  onChange={(e) => setPlateFilter(e.target.value.toUpperCase())}
                  placeholder="Filter plates…"
                  className="w-full pl-8 text-xs font-mono"
                />
              </div>
            </div>

            {!ingestLoaded ? (
              <div className="flex flex-1 items-center justify-center">
                <Spinner />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-3 pb-3">
                {plateRows.length === 0 ? (
                  <p className="mt-4 text-center text-[11px] text-ink-dim">No plates found.</p>
                ) : (
                  plateRows.map((row) => (
                    <button
                      key={row.plate}
                      type="button"
                      onClick={() => trackPlate(row.plate)}
                      className={`mb-1.5 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
                        row.plate === activePlate
                          ? 'border-brand bg-brand/10 ring-1 ring-brand'
                          : 'border-line bg-surface-0 hover:border-line-strong hover:bg-surface-2'
                      }`}
                    >
                      <PlateChip plate={formatPlate(row.plate)} size="sm" />
                      <span className="ml-auto text-right text-[10px] text-ink-dim">
                        {row.count} cam{row.count > 1 ? 's' : ''}<br />
                        avg {(row.avgConf * 100).toFixed(0)}% conf
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            {activePlate && (
              <div className="border-t border-line p-3">
                <Button
                  className="w-full text-xs"
                  onClick={clearRoute}
                >
                  Clear tracked route
                </Button>
              </div>
            )}
          </Panel>

          {/* Legend */}
          <Panel className="shrink-0 p-3 text-[10px] text-ink-dim flex flex-col gap-1.5">
            <span className="font-semibold uppercase tracking-wider text-ink-muted">Camera status</span>
            {[
              { color: '#ef4444', label: 'Overspeeding detected' },
              { color: '#f59e0b', label: 'Faulty driving detected' },
              { color: '#3ba7ff', label: 'Clear / density only' },
            ].map(({ color, label }) => (
              <span key={label} className="flex items-center gap-2">
                <span className="size-2.5 rounded-full shrink-0" style={{ background: color }} />
                {label}
              </span>
            ))}
            <span className="mt-1 flex items-center gap-2">
              <span className="h-0.5 w-6 rounded-full bg-brand" />
              Observed road route
            </span>
            <span className="flex items-center gap-2">
              <span
                className="h-0.5 w-6 rounded-full"
                style={{ backgroundImage: 'repeating-linear-gradient(to right,#8b9bb4 0 4px,transparent 4px 7px)' }}
              />
              Inferred / straight-line
            </span>
          </Panel>
        </div>

        {/* ── MAP (always visible) ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <Panel flush className="relative min-w-0 flex-1 overflow-hidden bg-black">
            <CityMap
              cameras={camerasForMap}
              layers={{ ...mapLayers, heatmap: false, congestion: false, zones: false }}
              route={routeSegments}
              routePoints={routePoints}
              activeSeq={activeSeq}
              fitTo={fitTo ?? undefined}
              onSelectCamera={(id) => {
                const p = routePoints.find((pt) => pt.camera.id === id);
                if (p) { setActiveSeq(p.seq); setPlaying(false); }
              }}
            >
              <MapOverlay position="bottom-right">
                <RouteLegend />
              </MapOverlay>

              {/* Playback controls — only shown when a plate is being tracked */}
              {routePoints.length > 0 && (
                <MapOverlay
                  position="bottom-center"
                  className="flex items-center gap-1.5 rounded-full bg-surface-0/90 p-1.5 shadow-xl ring-1 ring-line-strong backdrop-blur-md"
                >
                  <div className="flex items-center gap-0.5 pr-2">
                    <Button
                      variant="ghost" size="xs"
                      icon={<SkipBack className="size-3.5" fill="currentColor" />}
                      disabled={activeSeq === null || activeSeq <= 1}
                      onClick={() => { setPlaying(false); setActiveSeq((s) => (s ? Math.max(1, s - 1) : 1)); }}
                    />
                    <Button
                      variant="ghost" size="xs"
                      icon={playing ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="size-3.5" fill="currentColor" />}
                      onClick={() => {
                        if (activeSeq === routePoints.length) setActiveSeq(1);
                        setPlaying(!playing);
                      }}
                    />
                    <Button
                      variant="ghost" size="xs"
                      icon={<SkipForward className="size-3.5" fill="currentColor" />}
                      disabled={activeSeq === routePoints.length}
                      onClick={() => { setPlaying(false); setActiveSeq((s) => (s ? Math.min(routePoints.length, s + 1) : routePoints.length)); }}
                    />
                  </div>
                  <div className="h-4 w-[1px] bg-line" />
                  <div className="flex items-center pl-1 pr-1">
                    <Segmented
                      value={speed}
                      onChange={(s) => setSpeed(s as PlaybackSpeed)}
                      size="xs"
                      options={PLAYBACK_SPEEDS.map((s) => ({ value: s, label: `${s}x` }))}
                    />
                  </div>
                </MapOverlay>
              )}
            </CityMap>
          </Panel>

          {/* Trip status bar */}
          <div className="flex shrink-0 items-center justify-between rounded-lg border border-line bg-surface-1 px-3 py-2">
            <p className="text-[11px] text-ink-dim">{tripStatus}</p>
            {activePlate && (
              <PlateChip plate={formatPlate(activePlate)} size="sm" />
            )}
          </div>
        </div>

        {/* ── RIGHT sidebar: timeline (only when plate is tracked) ── */}
        {routePoints.length > 0 && (
          <div className="flex w-80 shrink-0 flex-col gap-3">
            <Panel flush className="min-h-0 flex-1 flex flex-col">
              <PanelHeader
                className="border-b border-line p-3"
                title="Timeline"
                icon={<Clock className="size-4" />}
              />
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="relative">
                  <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-line-strong" />
                  <ol className="relative flex flex-col gap-4">
                    {routePoints.map((point, i) => {
                      const isActive = point.seq === activeSeq;
                      const event = events.find(
                        (e) => e.plate === point.detection.plate && e.camera_id === point.camera.id,
                      );
                      return (
                        <li key={point.seq} className="flex flex-col gap-1.5 pl-8">
                          <button
                            type="button"
                            onClick={() => { setPlaying(false); setActiveSeq(point.seq); }}
                            className="absolute left-[7px] mt-1.5 flex size-2.5 items-center justify-center rounded-full bg-surface-0 ring-2 ring-line-strong transition-colors hover:ring-brand"
                            style={isActive ? { backgroundColor: 'var(--color-brand)' } : undefined}
                          />
                          {i > 0 && (
                            <div className="mb-2 text-[10px] text-ink-dim">
                              <span className="inline-flex items-center gap-1.5 rounded bg-surface-2 px-1.5 py-0.5">
                                Hop {i} → {i + 1}
                              </span>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => { setPlaying(false); setActiveSeq(point.seq); }}
                            className={`flex flex-col gap-1 rounded-md border p-2.5 text-left transition-colors ${
                              isActive
                                ? 'border-brand bg-brand/5 ring-1 ring-brand'
                                : 'border-line bg-surface-0 hover:border-line-strong'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-ink">{point.camera.name}</span>
                              <span className="nums font-mono text-[10px] text-ink-dim">
                                {formatTime(point.detection.timestamp)}
                              </span>
                            </div>
                            <div className="text-[10px] text-ink-muted">
                              {point.camera.code} · {point.camera.location}
                            </div>
                            {event && (
                              <div className="text-[10px] text-ink-dim">
                                Confidence: {(event.confidence * 100).toFixed(0)}%
                                {incidents.filter((inc) => inc.camera_id === point.camera.id).length > 0 && (
                                  <Badge tone="warn" size="sm" className="ml-2">
                                    {incidents.filter((inc) => inc.camera_id === point.camera.id).length} incident{incidents.filter((inc) => inc.camera_id === point.camera.id).length > 1 ? 's' : ''}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            </Panel>
          </div>
        )}
      </div>
    </PageFixed>
  );
}