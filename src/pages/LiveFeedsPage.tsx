import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Cctv, Grid2x2, Grid3x3, LayoutGrid, Radio, Route as RouteIcon, X } from 'lucide-react';
import { api, queryKeys } from '@/api';
import { PageFixed, PageToolbar } from '@/components/layout/Page';
import { LiveReadList } from '@/components/anpr/LiveReadList';
import {
  Badge,
  Button,
  cn,
  DetailRow,
  EmptyState,
  FieldLabel,
  IconButton,
  Input,
  Panel,
  PanelHeader,
  PlateChip,
  Segmented,
  Select,
  Skeleton,
} from '@/components/ui/primitives';
import { useLiveFeed } from '@/providers/LiveFeedProvider';
import { formatPlate } from '@/mock/vehicles';
import {
  CAMERA_STATUS_COLOR,
  CAMERA_STATUS_LABEL,
  formatCompact,
  formatRelative,
  formatTime,
} from '@/lib/format';
import type { Camera, CameraStatus, Detection } from '@/types';

/**
 * Video wall.
 *
 * Each tile represents a node and shows the 3 junction video feeds
 * (oncoming, left, right) plus the latest reads.
 */

type Density = '2' | '3' | '4';

const DENSITY_CLASS: Record<Density, string> = {
  '2': 'grid-cols-1 md:grid-cols-2',
  '3': 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  '4': 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
};

const STATUS_PRIORITY: Record<CameraStatus, number> = {
  offline: 0,
  degraded: 1,
  maintenance: 2,
  online: 3,
};

export function LiveFeedsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [density, setDensity] = useState<Density>('2');
  const [statusFilter, setStatusFilter] = useState<'all' | CameraStatus>('all');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [search, setSearch] = useState('');

  const selectedCameraId = searchParams.get('camera');
  const setSelectedCameraId = (id: string | null) => {
    setSearchParams(
      (params) => {
        if (id) params.set('camera', id);
        else params.delete('camera');
        return params;
      },
      { replace: true },
    );
  };

  const { detections: liveDetections, cameraStatus } = useLiveFeed();

  const cameras = useQuery({ queryKey: queryKeys.cameras, queryFn: () => api.getCameras(), staleTime: 20_000 });
  const zones = useQuery({ queryKey: queryKeys.zones, queryFn: () => api.getZones(), staleTime: Infinity });
  const heatPoints = useQuery({ queryKey: queryKeys.heatPoints, queryFn: () => api.getHeatPoints() });
  const watchlist = useQuery({ queryKey: queryKeys.watchlist, queryFn: () => api.getWatchlist(), staleTime: 60_000 });

  const seed = useQuery({
    queryKey: queryKeys.recentDetections(600),
    queryFn: () => api.getRecentDetections(600),
    staleTime: 20_000,
  });

  const resolvedCameras = useMemo<Camera[]>(
    () =>
      (cameras.data ?? []).map((camera) =>
        cameraStatus[camera.id] ? { ...camera, status: cameraStatus[camera.id] } : camera,
      ),
    [cameras.data, cameraStatus],
  );

  const camerasById = useMemo(
    () => new Map(resolvedCameras.map((camera) => [camera.id, camera])),
    [resolvedCameras],
  );

  const readsByCamera = useMemo(
    () => new Map((heatPoints.data ?? []).map((point) => [point.cameraId, point.weight])),
    [heatPoints.data],
  );

  const flaggedPlates = useMemo(
    () => new Set((watchlist.data ?? []).filter((entry) => entry.active).map((entry) => entry.plate)),
    [watchlist.data],
  );

  const latestByCamera = useMemo(() => {
    const latest = new Map<string, Detection>();
    for (const detection of seed.data ?? []) {
      if (!latest.has(detection.cameraId)) latest.set(detection.cameraId, detection);
    }
    for (const detection of [...liveDetections].reverse()) {
      latest.set(detection.cameraId, detection);
    }
    return latest;
  }, [seed.data, liveDetections]);

  const visibleCameras = useMemo(() => {
    const query = search.trim().toLowerCase();

    return resolvedCameras
      .filter((camera) => {
        if (statusFilter !== 'all' && camera.status !== statusFilter) return false;
        if (zoneFilter !== 'all' && camera.zoneId !== zoneFilter) return false;
        if (query) {
          return (
            camera.name.toLowerCase().includes(query) ||
            camera.code.toLowerCase().includes(query) ||
            camera.location.toLowerCase().includes(query)
          );
        }
        return true;
      })
      .sort(
        (a, b) =>
          STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
          (readsByCamera.get(b.id) ?? 0) - (readsByCamera.get(a.id) ?? 0),
      );
  }, [resolvedCameras, statusFilter, zoneFilter, search, readsByCamera]);

  const selectedCamera = selectedCameraId ? camerasById.get(selectedCameraId) : undefined;

  const statusCounts = useMemo(() => {
    const counts: Record<CameraStatus, number> = { online: 0, degraded: 0, offline: 0, maintenance: 0 };
    for (const camera of resolvedCameras) counts[camera.status] += 1;
    return counts;
  }, [resolvedCameras]);

  return (
    <PageFixed>
      <PageToolbar>
        <div className="flex items-center gap-1.5">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by node, code or road…"
            aria-label="Filter cameras"
            className="w-56"
          />
        </div>

        <Select
          value={zoneFilter}
          onChange={(event) => setZoneFilter(event.target.value)}
          aria-label="Filter by zone"
        >
          <option value="all">All zones</option>
          {(zones.data ?? []).map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </Select>

        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as 'all' | CameraStatus)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="online">Online ({statusCounts.online})</option>
          <option value="degraded">Degraded ({statusCounts.degraded})</option>
          <option value="offline">Offline ({statusCounts.offline})</option>
          <option value="maintenance">Maintenance ({statusCounts.maintenance})</option>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-ink-dim sm:block">
            {visibleCameras.length} of {resolvedCameras.length} nodes
          </span>
          <Segmented
            value={density}
            onChange={setDensity}
            size="xs"
            options={[
              { value: '2', label: <Grid2x2 className="size-3.5" />, title: 'Two columns' },
              { value: '3', label: <Grid3x3 className="size-3.5" />, title: 'Three columns' },
              { value: '4', label: <LayoutGrid className="size-3.5" />, title: 'Four columns' },
            ]}
          />
        </div>
      </PageToolbar>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* -------------------------------------------------------- Tile grid */}
        <div className="min-w-0 flex-1 overflow-y-auto pr-0.5">
          {cameras.isLoading || seed.isLoading ? (
            <div className={cn('grid gap-3', DENSITY_CLASS[density])}>
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-52" />
              ))}
            </div>
          ) : visibleCameras.length === 0 ? (
            <EmptyState
              icon={<Cctv className="size-7" />}
              title="No cameras match these filters"
              description="Widen the zone or status filter, or clear the text search."
              action={
                <Button
                  onClick={() => {
                    setSearch('');
                    setZoneFilter('all');
                    setStatusFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className={cn('grid gap-3', DENSITY_CLASS[density])}>
              {visibleCameras.map((camera) => (
                <CameraTile
                  key={camera.id}
                  camera={camera}
                  detection={latestByCamera.get(camera.id)}
                  reads={readsByCamera.get(camera.id) ?? 0}
                  flagged={
                    latestByCamera.get(camera.id)
                      ? flaggedPlates.has(latestByCamera.get(camera.id)!.plate)
                      : false
                  }
                  selected={camera.id === selectedCameraId}
                  onSelect={() => setSelectedCameraId(camera.id === selectedCameraId ? null : camera.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ---------------------------------------------------- Detail drawer */}
        {selectedCamera && (
          <CameraDetailPanel
            camera={selectedCamera}
            reads={readsByCamera.get(selectedCamera.id) ?? 0}
            flaggedPlates={flaggedPlates}
            camerasById={camerasById}
            liveDetections={liveDetections}
            onClose={() => setSelectedCameraId(null)}
            onTrack={(plate) => navigate(`/track?plate=${plate}`)}
          />
        )}
      </div>
    </PageFixed>
  );
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

function CameraTile({
  camera,
  detection,
  reads,
  flagged,
  selected,
  onSelect,
}: {
  camera: Camera;
  detection?: Detection;
  reads: number;
  flagged: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const offline = camera.status === 'offline';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'panel group flex flex-col overflow-hidden p-0 text-left transition-all',
        selected ? 'ring-2 ring-brand' : 'hover:ring-1 hover:ring-line-strong',
        flagged && 'ring-2 ring-critical',
      )}
    >
      <header className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: CAMERA_STATUS_COLOR[camera.status] }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">
          {camera.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-ink-dim">{camera.code}</span>
      </header>

      <div className="relative border-b border-line">
        {offline ? (
          <div className="grid-fade flex aspect-video flex-col items-center justify-center gap-1.5">
            <Radio className="size-5 text-danger" />
            <span className="text-[11px] font-medium text-ink-muted">No signal</span>
            <span className="text-[10px] text-ink-dim">
              Last heartbeat {formatRelative(camera.lastHeartbeat)}
            </span>
          </div>
        ) : (
          <div className="flex bg-black">
            {camera.videoFeeds?.map((feed, i) => (
              <div key={i} className="relative flex-1 aspect-[4/3] border-r border-line last:border-0 overflow-hidden flex items-center justify-center bg-zinc-900">
                {feed.startsWith('#placeholder') ? (
                  <span className="text-[10px] text-white/50">{feed.split(':').pop()}</span>
                ) : feed.includes('youtube.com/embed') ? (
                  <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <iframe
                      src={feed}
                      allow="autoplay; encrypted-media"
                      className="border-0"
                      title="Camera feed"
                      style={{
                        position: 'absolute',
                        top: '-62px',
                        left: '-2px',
                        width: 'calc(100% + 4px)',
                        height: 'calc(100% + 122px)',
                      }}
                    />
                  </div>
                ) : (
                  <video
                    src={feed}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="h-full w-full object-cover"
                  />
                )}
                {/* Real video feed goes here */}
              </div>
            ))}
            <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-surface-0/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ok backdrop-blur-sm z-10">
              <span className="size-1.5 animate-pulse rounded-full bg-ok" />
              live
            </span>
            {flagged && (
              <span className="absolute right-1.5 top-1.5 rounded bg-critical px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-surface-0 z-10">
                watchlist
              </span>
            )}
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-1.5 px-2.5 py-2">
        {detection && (
          <div className="flex items-center gap-2">
            <PlateChip plate={formatPlate(detection.plate)} size="sm" flagged={flagged} />
            <span className="min-w-0 flex-1 truncate text-[10px] text-ink-dim">
              {/* placeholder for vehicle class if needed, or remove */}
            </span>
            <span className="nums shrink-0 text-[10px] text-ink-dim">
              {formatTime(detection.timestamp)}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 text-[10px] text-ink-dim">
          <span className="nums">{formatCompact(reads)} reads (24h)</span>
        </div>
      </footer>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

function CameraDetailPanel({
  camera,
  reads,
  flaggedPlates,
  camerasById,
  liveDetections,
  onClose,
  onTrack,
}: {
  camera: Camera;
  reads: number;
  flaggedPlates: Set<string>;
  camerasById: Map<string, Camera>;
  liveDetections: Detection[];
  onClose: () => void;
  onTrack: (plate: string) => void;
}) {
  const [selectedReadId, setSelectedReadId] = useState<string | null>(null);

  const history = useQuery({
    queryKey: queryKeys.cameraDetections(camera.id, 80),
    queryFn: () => api.getCameraDetections(camera.id, 80),
  });

  useEffect(() => setSelectedReadId(null), [camera.id]);

  const reads80 = useMemo(() => {
    const live = liveDetections.filter((detection) => detection.cameraId === camera.id);
    const seen = new Set<string>();
    return [...live, ...(history.data ?? [])].filter((detection) =>
      seen.has(detection.id) ? false : (seen.add(detection.id), true),
    );
  }, [liveDetections, history.data, camera.id]);

  const selectedRead = reads80.find((detection) => detection.id === selectedReadId) ?? reads80[0];

  return (
    <Panel flush className="hidden w-88 shrink-0 lg:flex">
      <PanelHeader
        className="border-b border-line p-3"
        title={camera.name}
        subtitle={`${camera.code} · ${camera.location}`}
        icon={<Cctv className="size-4" />}
        actions={
          <IconButton label="Close camera details" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedRead && (
          <div className="border-b border-line p-3">
            <div className="mt-2.5 flex items-center gap-2">
              <PlateChip
                plate={formatPlate(selectedRead.plate)}
                size="lg"
                flagged={flaggedPlates.has(selectedRead.plate)}
              />
              <Button
                variant="primary"
                size="xs"
                icon={<RouteIcon className="size-3" />}
                onClick={() => onTrack(selectedRead.plate)}
                className="ml-auto"
              >
                Track
              </Button>
            </div>
          </div>
        )}

        <div className="border-b border-line p-3">
          <FieldLabel className="mb-2">Node status</FieldLabel>
          <div className="flex flex-col">
            <DetailRow label="Status">
              <Badge
                tone={
                  camera.status === 'online'
                    ? 'ok'
                    : camera.status === 'degraded'
                      ? 'warn'
                      : camera.status === 'offline'
                        ? 'danger'
                        : 'neutral'
                }
                dot
              >
                {CAMERA_STATUS_LABEL[camera.status]}
              </Badge>
            </DetailRow>
            <DetailRow label="Last heartbeat">{formatRelative(camera.lastHeartbeat)}</DetailRow>
            <DetailRow label="Reads (24h)">{formatCompact(reads)}</DetailRow>
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <PanelHeader className="p-3" title="Recent reads at this node" />
          <LiveReadList
            detections={reads80.slice(0, 60)}
            camerasById={camerasById}
            flaggedPlates={flaggedPlates}
            loading={history.isLoading}
            hideCamera
            selectedId={selectedRead?.id ?? null}
            onSelect={(detection) => setSelectedReadId(detection.id)}
          />
        </div>
      </div>
    </Panel>
  );
}
