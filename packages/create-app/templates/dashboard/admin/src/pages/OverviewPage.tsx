import { h, createSignal, createShow, createEffect } from '@getforma/core';
import { createFetch } from '@getforma/core/http';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';

interface Metric { label: string; value: string; change: number; trend: string; }
interface ServiceStatusSummary { healthy: number; degraded: number; down: number; }
interface Service { name: string; status: string; uptime: number; latency_ms: number; region: string; }
interface RequestVolumePoint { hour: string; success: number; error: number; }
interface Deployment { id: number; service: string; version: string; status: string; deployed_by: string; time_ago: string; commit_hash: string; branch: string; environment: string; duration_secs: number; }
interface Incident { id: string; title: string; severity: string; status: string; service: string; time_ago: string; }

// SVG Area Chart — hand-rolled, no library dependency
function RequestVolumeChart({ data }: { data: RequestVolumePoint[] }) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const W = 600, H = 200, PAD = 40;
  const chartW = W - PAD * 2;
  const chartH = H - PAD * 2;
  const maxVal = Math.max(...data.map(p => p.success + p.error), 1);

  const points = data.map((p, i) => ({
    x: PAD + (i / (data.length - 1)) * chartW,
    ySuccess: PAD + chartH - (p.success / maxVal) * chartH,
    yTotal: PAD + chartH - ((p.success + p.error) / maxVal) * chartH,
  }));

  const successArea = `M ${points[0].x} ${PAD + chartH} ` +
    points.map(p => `L ${p.x} ${p.ySuccess}`).join(' ') +
    ` L ${points[points.length-1].x} ${PAD + chartH} Z`;

  const errorArea = `M ${points[0].x} ${points[0].ySuccess} ` +
    points.map(p => `L ${p.x} ${p.yTotal}`).join(' ') +
    ` ` + [...points].reverse().map(p => `L ${p.x} ${p.ySuccess}`).join(' ') + ` Z`;

  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
    y: PAD + chartH - pct * chartH,
    label: Math.round(maxVal * pct).toLocaleString(),
  }));

  const xLabels = data.filter((_, i) => i % 4 === 0).map((p) => ({
    x: PAD + ((data.indexOf(p)) / (data.length - 1)) * chartW,
    label: p.hour,
  }));

  // Hover state
  const [hoverIdx, setHoverIdx] = createSignal<number | null>(null);

  // Create persistent SVG hover elements (imperatively updated via createEffect)
  const hoverLine = document.createElementNS(SVG_NS, 'line');
  hoverLine.setAttribute('stroke', '#ebdbb2');
  hoverLine.setAttribute('stroke-width', '0.5');
  hoverLine.setAttribute('stroke-dasharray', '3 3');
  hoverLine.style.display = 'none';

  const successDot = document.createElementNS(SVG_NS, 'circle');
  successDot.setAttribute('r', '4');
  successDot.setAttribute('fill', '#83a598');
  successDot.setAttribute('stroke', '#282828');
  successDot.setAttribute('stroke-width', '2');
  successDot.style.display = 'none';

  const errorDot = document.createElementNS(SVG_NS, 'circle');
  errorDot.setAttribute('r', '3');
  errorDot.setAttribute('fill', '#fb4934');
  errorDot.setAttribute('stroke', '#282828');
  errorDot.setAttribute('stroke-width', '2');
  errorDot.style.display = 'none';

  // Create persistent tooltip element
  const tooltip = document.createElement('div');
  tooltip.className = 'absolute top-0 pointer-events-none bg-gruvbox-bg-hard border border-gruvbox-border rounded-md px-3 py-2 text-xs shadow-lg z-10';
  tooltip.style.display = 'none';

  // Reactively update hover elements when hoverIdx changes
  createEffect(() => {
    const idx = hoverIdx();
    if (idx === null) {
      hoverLine.style.display = 'none';
      successDot.style.display = 'none';
      errorDot.style.display = 'none';
      tooltip.style.display = 'none';
      return;
    }

    const pt = points[idx];
    const d = data[idx];

    // Update SVG elements
    hoverLine.setAttribute('x1', String(pt.x));
    hoverLine.setAttribute('y1', String(PAD));
    hoverLine.setAttribute('x2', String(pt.x));
    hoverLine.setAttribute('y2', String(PAD + chartH));
    hoverLine.style.display = '';

    successDot.setAttribute('cx', String(pt.x));
    successDot.setAttribute('cy', String(pt.ySuccess));
    successDot.style.display = '';

    errorDot.setAttribute('cx', String(pt.x));
    errorDot.setAttribute('cy', String(pt.yTotal));
    errorDot.style.display = '';

    // Update tooltip
    const leftPct = (pt.x / W) * 100;
    tooltip.style.cssText = `left: ${leftPct}%; transform: translateX(-50%); position: absolute; top: 0;`;
    tooltip.innerHTML = `<div class="space-y-1">
      <div class="text-gruvbox-fg font-medium">${d.hour}</div>
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-gruvbox-blue inline-block"></span>
        <span class="text-gruvbox-gray">Success:</span>
        <span class="text-gruvbox-fg font-mono">${d.success.toLocaleString()}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-gruvbox-red inline-block"></span>
        <span class="text-gruvbox-gray">Errors:</span>
        <span class="text-gruvbox-fg font-mono">${d.error.toLocaleString()}</span>
      </div>
    </div>`;
  });

  const onMouseMove = (e: MouseEvent) => {
    const svg = (e.currentTarget as SVGSVGElement);
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].x - mouseX);
      if (dist < minDist) { minDist = dist; nearest = i; }
    }
    setHoverIdx(nearest);
  };

  const onMouseLeave = () => setHoverIdx(null);

  return (
    <div class="relative">
      <svg viewBox={`0 0 ${W} ${H}`} class={() => `w-full h-auto`} onMousemove={onMouseMove} onMouseleave={onMouseLeave}>
        {/* Grid lines */}
        {yLabels.map(({ y }) => (
          <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#3c3836" stroke-width="0.5" />
        ))}
        {/* Y-axis labels */}
        {yLabels.map(({ y, label }) => (
          <text x={PAD - 8} y={y + 3} text-anchor="end" fill="#928374" font-size="9" font-family="system-ui">{label}</text>
        ))}
        {/* X-axis labels */}
        {xLabels.map(({ x, label }) => (
          <text x={x} y={H - 8} text-anchor="middle" fill="#928374" font-size="9" font-family="system-ui">{label}</text>
        ))}
        {/* Gradient definitions */}
        <defs>
          <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#83a598" stop-opacity="0.25" />
            <stop offset="100%" stop-color="#83a598" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fb4934" stop-opacity="0.25" />
            <stop offset="100%" stop-color="#fb4934" stop-opacity="0" />
          </linearGradient>
        </defs>
        {/* Error area */}
        <path d={errorArea} fill="url(#errorGrad)" fill-opacity="0.6" />
        {/* Success area */}
        <path d={successArea} fill="url(#successGrad)" fill-opacity="0.6" />
        {/* Success line */}
        <polyline
          points={points.map(p => `${p.x},${p.ySuccess}`).join(' ')}
          fill="none" stroke="#83a598" stroke-width="1.5"
        />
        {/* Persistent hover elements — updated via createEffect */}
        {hoverLine}
        {successDot}
        {errorDot}
      </svg>
      {/* Persistent tooltip — updated via createEffect */}
      {tooltip}
    </div>
  );
}

export function OverviewPage() {
  const metrics = createFetch<Metric[]>('/api/metrics');
  const summary = createFetch<ServiceStatusSummary>('/api/service-summary');
  const services = createFetch<Service[]>('/api/services');
  const volume = createFetch<RequestVolumePoint[]>('/api/request-volume');
  const deployments = createFetch<Deployment[]>('/api/deployments');
  const incidents = createFetch<Incident[]>('/api/incidents');

  return (
    <div class="space-y-6">
      {/* Stat Cards */}
      {createShow(
        () => !!metrics.data(),
        () => (
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {metrics.data()!.map((m, i) => (
              <StatCard label={m.label} value={m.value} change={m.change} trend={m.trend} index={i} />
            ))}
          </div>
        ),
      )}

      {/* Two-column: Chart + Service Status */}
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Request Volume Chart — spans 2 columns */}
        <div class="lg:col-span-2 bg-gruvbox-bg-soft border border-gruvbox-border rounded-lg p-5">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h3 class="text-sm font-semibold text-gruvbox-fg">Request Volume (24h)</h3>
              <p class="text-xs text-gruvbox-gray mt-0.5">Success and error requests per hour</p>
            </div>
            <div class="flex items-center gap-4 text-xs text-gruvbox-gray">
              <div class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-gruvbox-blue/40" />Success</div>
              <div class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-gruvbox-red/40" />Errors</div>
            </div>
          </div>
          {createShow(
            () => !!volume.data(),
            () => <RequestVolumeChart data={volume.data()!} />,
          )}
          {createShow(
            () => volume.loading() && !volume.data(),
            () => <div class="h-48 bg-gruvbox-border/20 rounded animate-pulse-slow" />,
          )}
        </div>

        {/* Service Status */}
        <div class="bg-gruvbox-bg-soft border border-gruvbox-border rounded-lg p-5">
          <h3 class="text-sm font-semibold text-gruvbox-fg mb-4">Service Status</h3>
          {createShow(
            () => !!summary.data(),
            () => {
              const s = summary.data()!;
              return (
                <div class="space-y-4">
                  <div class="grid grid-cols-3 gap-2">
                    <div class="text-center p-3 rounded-md bg-gruvbox-green/10">
                      <div class="text-2xl font-mono font-semibold text-gruvbox-green">{s.healthy}</div>
                      <div class="text-[10px] text-gruvbox-gray mt-1">Healthy</div>
                    </div>
                    <div class="text-center p-3 rounded-md bg-gruvbox-yellow/10">
                      <div class="text-2xl font-mono font-semibold text-gruvbox-yellow">{s.degraded}</div>
                      <div class="text-[10px] text-gruvbox-gray mt-1">Degraded</div>
                    </div>
                    <div class="text-center p-3 rounded-md bg-gruvbox-red/10">
                      <div class="text-2xl font-mono font-semibold text-gruvbox-red">{s.down}</div>
                      <div class="text-[10px] text-gruvbox-gray mt-1">Down</div>
                    </div>
                  </div>
                  {createShow(
                    () => !!services.data(),
                    () => (
                      <div class="space-y-2 mt-2">
                        {services.data()!.map(svc => (
                          <div class="flex items-center justify-between text-xs py-1.5">
                            <div class="flex items-center gap-2">
                              <StatusBadge status={svc.status} dot={true} />
                              <span class="text-gruvbox-fg">{svc.name}</span>
                            </div>
                            <span class="text-gruvbox-gray font-mono">{svc.latency_ms}ms</span>
                          </div>
                        ))}
                      </div>
                    ),
                  )}
                </div>
              );
            },
          )}
        </div>
      </div>

      {/* Two-column: Recent Deployments + Active Incidents */}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Deployments */}
        <div class="bg-gruvbox-bg-soft border border-gruvbox-border rounded-lg overflow-hidden">
          <div class="px-5 py-4 border-b border-gruvbox-border">
            <h3 class="text-sm font-semibold text-gruvbox-fg">Deployment Pipeline</h3>
          </div>
          {createShow(
            () => !!deployments.data(),
            () => (
              <div class="divide-y divide-gruvbox-border/50">
                {deployments.data()!.slice(0, 5).map((dep, i) => (
                  <div class="flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors animate-fade-in" style={`animation-delay: ${i * 40}ms`}>
                    <div class="flex items-center gap-3 min-w-0">
                      <StatusBadge status={dep.status} dot={true} />
                      <div class="min-w-0">
                        <div class="text-sm font-medium text-gruvbox-fg truncate">{dep.service}</div>
                        <div class="text-[11px] text-gruvbox-gray font-mono">{dep.version}</div>
                      </div>
                    </div>
                    <div class="text-right shrink-0 ml-4">
                      <div class="text-xs text-gruvbox-gray">{dep.deployed_by}</div>
                      <div class="text-[11px] text-gruvbox-gray">{dep.time_ago}</div>
                    </div>
                  </div>
                ))}
              </div>
            ),
          )}
        </div>

        {/* Active Incidents */}
        <div class="bg-gruvbox-bg-soft border border-gruvbox-border rounded-lg overflow-hidden">
          <div class="px-5 py-4 border-b border-gruvbox-border">
            <h3 class="text-sm font-semibold text-gruvbox-fg">Active Incidents</h3>
          </div>
          {createShow(
            () => !!incidents.data(),
            () => (
              <div class="divide-y divide-gruvbox-border/50">
                {incidents.data()!.map((inc, i) => (
                  <div class="px-5 py-3 hover:bg-white/[0.02] transition-colors animate-fade-in" style={`animation-delay: ${i * 40}ms`}>
                    <div class="flex items-center justify-between mb-1">
                      <div class="flex items-center gap-2">
                        <span class="text-[10px] text-gruvbox-gray font-mono">{inc.id}</span>
                        <StatusBadge status={inc.severity} />
                      </div>
                      <StatusBadge status={inc.status} />
                    </div>
                    <div class="text-sm text-gruvbox-fg">{inc.title}</div>
                    <div class="flex items-center justify-between mt-1.5">
                      <span class="text-[11px] text-gruvbox-gray">{inc.service}</span>
                      <span class="text-[11px] text-gruvbox-gray">{inc.time_ago}</span>
                    </div>
                  </div>
                ))}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
