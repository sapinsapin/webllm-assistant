## Plan: Geographic Heatmap of Benchmark Throughput

### Goal
Visualize the `benchmark_runs` table on a world map where each location's color/intensity reflects its average TPS (tokens/second). Users can see at a glance which regions / devices get the best on-device LLM performance.

### Current state
- `benchmark_runs` already stores `country` and `city` (from `ipapi.co` in `src/lib/deviceInfo.ts`)
- ~80+ runs across UK, PH, NL, US, ZA, etc. — enough data to be meaningful
- **Missing:** latitude/longitude — required to plot on a map

---

### Step 1 — Capture coordinates at submit time
- **DB migration:** add `latitude double precision` and `longitude double precision` (nullable) to `benchmark_runs`
- **`src/lib/deviceInfo.ts`:** `ipapi.co` already returns `latitude` / `longitude` in the same response — extend `fetchGeoLocation()` to capture them, no extra network call
- **Backfill existing rows:** one-off SQL using a static city→coords lookup for the top ~15 cities already in the table (covers ~95% of existing runs). Rows that can't be matched stay null and are simply omitted from the map.

### Step 2 — Add map dependencies
- `leaflet` + `react-leaflet` for the map
- `leaflet.heat` for the heatmap layer
- Use OpenStreetMap tiles (free, no API key)

### Step 3 — New `BenchmarkHeatmap` component
Location: `src/components/BenchmarkHeatmap.tsx`

- Fetches all runs with non-null lat/long from Supabase (single query, capped at e.g. 1000)
- Two view modes (toggle):
  - **Heatmap layer** — density + TPS-weighted intensity (warm colors = faster)
  - **Marker layer** — circle markers sized/colored by TPS, click to see device + model details
- Color scale tied to design tokens:
  - Red/orange (`--destructive` / `text-orange-400`) for slow (<10 TPS)
  - Amber (`text-amber-400`) for passable (10–30 TPS)
  - Emerald (`text-emerald-400`) for great (>30 TPS)
- Dark map theme (CartoDB dark tiles) to match the terminal UI
- Legend in the corner showing the TPS color scale
- Optional filter: by engine (mediapipe / webllm / wasm) and by model

### Step 4 — Surface the map in the UI
Add a new section to the **Benchmarks** page (`src/pages/Benchmarks.tsx`), placed alongside `CommunityBenchmarks`:
- Header: "Global Performance Heatmap"
- Subtitle: "Where on-device AI runs fastest"
- Collapsible / tabbed alongside the existing list view so it doesn't push the table off screen

### Step 5 — Performance & UX considerations
- Lazy-load `leaflet` (dynamic `import()`) so it doesn't bloat the initial bundle
- Mobile: full-width, ~320px tall; desktop: 500px tall
- Empty state if no rows have coords yet
- Aggregate runs at the same coordinate so cities with many submissions don't over-plot — show count in the popup

---

### Files touched
- **New migration:** `add_latitude_longitude_to_benchmark_runs`
- **New file:** `src/components/BenchmarkHeatmap.tsx`
- **Edit:** `src/lib/deviceInfo.ts` — capture lat/long
- **Edit:** `src/pages/Benchmarks.tsx` — render heatmap section
- **Edit:** `package.json` — add `leaflet`, `react-leaflet`, `leaflet.heat`, `@types/leaflet`

### Open questions before building
1. Should the map only show **local/on-device** runs, or include cloud and C2C runs too? (Cloud runs reflect server perf, not the user's location, so usually excluded from this view.)
2. Heatmap intensity — weight by **TPS only**, or also factor in **run count** per city (more contributors = more confidence)?
3. Placement — put it **above** the community benchmark list (hero visualization) or as a **toggle tab** within the same panel?
