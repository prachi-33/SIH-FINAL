import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Filter, RotateCcw, Route as RouteIcon, ScanSearch, X } from 'lucide-react';
import { api, queryKeys } from '@/api';
import { PageFixed, PageToolbar } from '@/components/layout/Page';
import { DataTable, type Column } from '@/components/ui/DataTable';
import {
  Button,
  DetailRow,
  EmptyState,
  FieldLabel,
  IconButton,
  Input,
  Panel,
  PanelHeader,
  PlateChip,
  Select,
} from '@/components/ui/primitives';
import { formatPlate, normalisePlate } from '@/mock/vehicles';
import {
  downloadFile,
  formatCount,
  formatDateTime,
  toCsv,
} from '@/lib/format';
import { useCan } from '@/store/useAppStore';
import type { Detection, DetectionQuery } from '@/types';

/**
 * Read archive search.
 *
 * Simplified: Queries by plate, camera, zone. Returns simplified list.
 */

const PAGE_SIZE = 60;

interface Filters {
  plate: string;
  cameraId: string;
  zoneId: string;
}

const EMPTY_FILTERS: Filters = {
  plate: '',
  cameraId: 'all',
  zoneId: 'all',
};

export function SearchPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Detection | null>(null);

  const canExport = useCan('export');

  const cameras = useQuery({ queryKey: queryKeys.cameras, queryFn: () => api.getCameras(), staleTime: 60_000 });
  const zones = useQuery({ queryKey: queryKeys.zones, queryFn: () => api.getZones(), staleTime: Infinity });
  const watchlist = useQuery({ queryKey: queryKeys.watchlist, queryFn: () => api.getWatchlist(), staleTime: 60_000 });

  const camerasById = useMemo(
    () => new Map((cameras.data ?? []).map((camera) => [camera.id, camera])),
    [cameras.data],
  );

  const flaggedPlates = useMemo(
    () => new Set((watchlist.data ?? []).filter((entry) => entry.active).map((entry) => entry.plate)),
    [watchlist.data],
  );

  const query = useMemo<DetectionQuery>(
    () => ({
      plate: applied.plate ? normalisePlate(applied.plate) : undefined,
      cameraIds: applied.cameraId === 'all' ? undefined : [applied.cameraId],
      zoneIds: applied.zoneId === 'all' ? undefined : [applied.zoneId],
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [applied, page],
  );

  const results = useQuery({
    queryKey: queryKeys.detectionSearch(JSON.stringify(query)),
    queryFn: () => api.searchDetections(query),
    placeholderData: keepPreviousData,
  });

  const rows = results.data?.rows ?? [];
  const total = results.data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (applied.plate) count++;
    if (applied.cameraId !== 'all') count++;
    if (applied.zoneId !== 'all') count++;
    return count;
  }, [applied]);

  const apply = () => {
    setApplied(draft);
    setPage(0);
  };

  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(0);
  };

  const exportCsv = () => {
    downloadFile(
      `netra-reads-${Date.now()}.csv`,
      toCsv(
        [
          'Timestamp',
          'Plate',
          'Camera code',
          'Camera name',
          'Zone',
        ],
        rows.map((detection) => {
          const camera = camerasById.get(detection.cameraId);
          return [
            formatDateTime(detection.timestamp),
            detection.plate,
            camera?.code ?? '',
            camera?.name ?? '',
            zones.data?.find((zone) => zone.id === camera?.zoneId)?.name ?? '',
          ];
        }),
      ),
    );
  };

  const columns = useMemo<Array<Column<Detection>>>(
    () => [
      {
        id: 'time',
        header: 'Time',
        width: '8rem',
        sortValue: (row) => row.timestamp,
        cell: (row) => (
          <span className="nums font-mono text-[11px] text-ink">{formatDateTime(row.timestamp)}</span>
        ),
      },
      {
        id: 'plate',
        header: 'Registration',
        width: '12rem',
        sortValue: (row) => row.plate,
        cell: (row) => (
          <PlateChip
            plate={formatPlate(row.plate)}
            size="sm"
            flagged={flaggedPlates.has(row.plate)}
          />
        ),
      },
      {
        id: 'camera',
        header: 'Node',
        sortValue: (row) => camerasById.get(row.cameraId)?.name ?? '',
        cell: (row) => {
          const camera = camerasById.get(row.cameraId);
          return (
            <span className="block min-w-0">
              <span className="block truncate text-[11px] text-ink">{camera?.name ?? row.cameraId}</span>
              <span className="block truncate text-[10px] text-ink-dim">{camera?.code}</span>
            </span>
          );
        },
      },
    ],
    [camerasById, flaggedPlates],
  );

  return (
    <PageFixed>
      <PageToolbar>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <ScanSearch className="size-5 text-brand" />
          Read Search
        </h1>
        {canExport && (
          <Button
            variant="secondary"
            icon={<Download className="size-4" />}
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="ml-auto"
          >
            Export CSV
          </Button>
        )}
      </PageToolbar>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* --------------------------------------------------------- Filters */}
        <Panel flush className="w-64 shrink-0 overflow-y-auto">
          <PanelHeader className="border-b border-line p-3" title="Filters" icon={<Filter className="size-4" />} />
          <div className="flex flex-col gap-4 p-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Registration</FieldLabel>
              <Input
                placeholder="Exact or partial plate..."
                value={draft.plate}
                onChange={(e) => setDraft((d) => ({ ...d, plate: e.target.value.toUpperCase() }))}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                className="font-mono"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>Zone</FieldLabel>
              <Select
                value={draft.zoneId}
                onChange={(e) => setDraft((d) => ({ ...d, zoneId: e.target.value, cameraId: 'all' }))}
              >
                <option value="all">All zones</option>
                {(zones.data ?? []).map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>Node</FieldLabel>
              <Select
                value={draft.cameraId}
                onChange={(e) => setDraft((d) => ({ ...d, cameraId: e.target.value }))}
              >
                <option value="all">All nodes</option>
                {(cameras.data ?? [])
                  .filter((camera) => draft.zoneId === 'all' || camera.zoneId === draft.zoneId)
                  .map((camera) => (
                    <option key={camera.id} value={camera.id}>
                      {camera.name}
                    </option>
                  ))}
              </Select>
            </div>

            <div className="mt-4 flex flex-col gap-2 pt-4 border-t border-line">
              <Button variant="primary" onClick={apply} className="w-full">
                Apply filters
              </Button>
              {activeFilterCount > 0 && (
                <Button variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={reset} className="w-full">
                  Reset
                </Button>
              )}
            </div>
          </div>
        </Panel>

        {/* --------------------------------------------------------- Results */}
        <Panel flush className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="text-[11px] font-medium text-ink">
              {results.isLoading ? 'Searching...' : `${formatCount(total)} results`}
            </span>
            {activeFilterCount > 0 && (
              <span className="text-[11px] text-ink-dim">
                ({activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} active)
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {results.isLoading && rows.length === 0 ? (
              <div className="p-3">Loading...</div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<ScanSearch className="size-8" />}
                title="No reads found"
                description="Try broadening your filters or entering a partial plate."
              />
            ) : (
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                onRowClick={(row) => setSelected(row)}
                isRowActive={(row) => row.id === selected?.id}
                className="h-full border-none"
              />
            )}
          </div>

          <div className="flex items-center justify-between border-t border-line p-2">
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <span className="text-[11px] text-ink-dim">
              Page {page + 1} of {Math.max(1, pageCount)}
            </span>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        </Panel>

        {/* --------------------------------------------------------- Detail */}
        {selected && (
          <Panel flush className="w-80 shrink-0 flex flex-col">
            <PanelHeader
              className="border-b border-line p-3"
              title="Read detail"
              subtitle={selected.id}
              actions={
                <IconButton label="Close" onClick={() => setSelected(null)}>
                  <X className="size-4" />
                </IconButton>
              }
            />

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="border-b border-line p-3">
                <div className="flex items-center gap-2">
                  <PlateChip plate={formatPlate(selected.plate)} size="lg" flagged={flaggedPlates.has(selected.plate)} />
                  <Link to={`/track?plate=${selected.plate}`} className="ml-auto">
                    <Button variant="primary" size="xs" icon={<RouteIcon className="size-3" />}>
                      Track
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="flex flex-col border-b border-line p-3">
                <DetailRow label="Node">
                  {camerasById.get(selected.cameraId)?.name ?? selected.cameraId}
                </DetailRow>
                <DetailRow label="Time">{formatDateTime(selected.timestamp)}</DetailRow>
              </div>
            </div>
          </Panel>
        )}
      </div>
    </PageFixed>
  );
}
