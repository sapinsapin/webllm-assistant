import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Globe2, Map as MapIcon, Flame } from "lucide-react";

interface GeoRun {
  latitude: number;
  longitude: number;
  avg_tps: number;
  model_name: string;
  engine: string;
  device_model: string | null;
  city: string | null;
  country: string | null;
}

type ViewMode = "heat" | "markers";

// TPS → color (red → amber → emerald), matching existing iconography
function tpsColor(tps: number): string {
  if (tps >= 30) return "#10b981"; // emerald-500
  if (tps >= 10) return "#f59e0b"; // amber-500
  if (tps > 0) return "#fb923c";  // orange-400
  return "#ef4444";                // red-500
}

function tpsRadius(tps: number): number {
  // Scale marker between 6 and 22px
  return Math.max(6, Math.min(22, 6 + Math.sqrt(Math.max(tps, 0)) * 2.4));
}

export function BenchmarkHeatmap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const [runs, setRuns] = useState<GeoRun[]>([]);
  const [mode, setMode] = useState<ViewMode>("heat");
  const [loading, setLoading] = useState(true);

  // Fetch geo-tagged local runs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("benchmark_runs")
        .select("latitude,longitude,avg_tps,model_name,engine,device_model,city,country")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .neq("verdict", "Did not finish")
        .neq("verdict", "Crashed")
        .neq("engine", "cloud")
        .gt("avg_tps", 0)
        .limit(1000);
      if (cancelled) return;
      setRuns((data as GeoRun[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Lazy-init Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      await import("leaflet.heat");
      if (disposed || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [25, 10],
        zoom: 2,
        worldCopyJump: true,
        attributionControl: true,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      // Trigger redraw of layer once map mounts
      setMode((m) => m);
    })();
    return () => {
      disposed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Render layer when data or mode changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || runs.length === 0) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet.heat");
      if (cancelled) return;

      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }

      if (mode === "heat") {
        const maxTps = Math.max(...runs.map((r) => r.avg_tps), 1);
        const points = runs.map((r) => [r.latitude, r.longitude, r.avg_tps / maxTps]);
        // @ts-expect-error - leaflet.heat extends L
        const heat = L.heatLayer(points, {
          radius: 28,
          blur: 22,
          maxZoom: 6,
          minOpacity: 0.35,
          gradient: {
            0.0: "#ef4444",
            0.3: "#fb923c",
            0.55: "#f59e0b",
            0.8: "#10b981",
            1.0: "#34d399",
          },
        });
        heat.addTo(map);
        layerRef.current = heat;
      } else {
        const group = L.layerGroup();
        runs.forEach((r) => {
          const c = tpsColor(r.avg_tps);
          const marker = L.circleMarker([r.latitude, r.longitude], {
            radius: tpsRadius(r.avg_tps),
            color: c,
            fillColor: c,
            fillOpacity: 0.55,
            weight: 1.5,
          });
          marker.bindPopup(
            `<div style="font-family:ui-monospace,monospace;font-size:11px;line-height:1.4">
               <div style="color:${c};font-weight:700;font-size:13px">${r.avg_tps.toFixed(1)} tok/s</div>
               <div style="color:#e5e7eb">${r.model_name}</div>
               <div style="color:#9ca3af">${r.engine}${r.device_model ? " · " + r.device_model : ""}</div>
               <div style="color:#6b7280;margin-top:2px">📍 ${[r.city, r.country].filter(Boolean).join(", ") || "Unknown"}</div>
             </div>`
          );
          marker.addTo(group);
        });
        group.addTo(map);
        layerRef.current = group;
      }
    })();
    return () => { cancelled = true; };
  }, [runs, mode]);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Globe2 className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold font-mono text-foreground">Global Performance Heatmap</h2>
        <span className="rounded border border-border bg-secondary/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          {runs.length} geo-tagged runs
        </span>
        <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-secondary/30 p-0.5">
          <button
            onClick={() => setMode("heat")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-mono transition-colors ${
              mode === "heat" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Flame className="h-3 w-3" /> Heat
          </button>
          <button
            onClick={() => setMode("markers")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-mono transition-colors ${
              mode === "markers" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <MapIcon className="h-3 w-3" /> Markers
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground font-mono">
        Where on-device AI runs fastest — color reflects throughput (tokens/sec).
      </p>

      <div className="relative rounded-lg border border-border bg-card overflow-hidden">
        <div
          ref={containerRef}
          className="w-full h-[320px] md:h-[480px] bg-secondary/30"
        />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-sm">
            <p className="text-xs text-muted-foreground font-mono animate-pulse">Loading map…</p>
          </div>
        )}
        {!loading && runs.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs text-muted-foreground font-mono">No geo-tagged benchmarks yet.</p>
          </div>
        )}

        {/* Legend */}
        <div className="pointer-events-none absolute bottom-2 left-2 z-[400] rounded-md border border-border bg-background/85 backdrop-blur px-2 py-1.5 text-[10px] font-mono">
          <div className="text-muted-foreground mb-1">tok/s</div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#ef4444" }} />
            <span className="text-foreground">&lt;10</span>
            <span className="inline-block h-2 w-2 rounded-full ml-1" style={{ background: "#f59e0b" }} />
            <span className="text-foreground">10–30</span>
            <span className="inline-block h-2 w-2 rounded-full ml-1" style={{ background: "#10b981" }} />
            <span className="text-foreground">&gt;30</span>
          </div>
        </div>
      </div>
    </section>
  );
}