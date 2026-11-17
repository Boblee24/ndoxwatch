# NdoxWatch: Sentinel-1 flood mask (you, in the GEE Code Editor, about 1.5–2 h)

Goal: a GeoJSON flood mask for the **Oct 3–4, 2026 Dakar–Rufisque floods**, used as the satellite prior. Optional second mask: Ogbaru (Anambra), September 2026.

## Method (also goes in the README)
- Sentinel-1 GRD, IW mode, VV, one orbit direction only
- Median composites for a **pre** window (dry reference) and a **post** window (just after the event)
- Speckle: 50 m focal median
- Flood = backscatter **drop** of more than 3 dB **and** post VV below −16 dB
- Remove permanent water (JRC GSW occurrence ≥ 80%) and slopes > 5° (NASADEM); drop specks under 8 connected pixels
- Vectorize at 20 m and simplify to 30 m
- **Known limits (the core of the pitch):** in dense urban areas, flood water often *raises* backscatter (double bounce), so this method misses urban floods. Vegetated floodplains are also under-detected. Ground reports fill those gaps.

## Script (paste into code.earthengine.google.com, then adjust the AOI and dates)
```js
// --- AOI: Dakar–Rufisque (adjust by drawing a rectangle if needed)
var aoi = ee.Geometry.Rectangle([-17.55, 14.62, -17.10, 14.86]);

var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(aoi)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .select('VV');

// 1) Inspect what's available, then choose the orbit direction with scenes on both sides of the event
var win = s1.filterDate('2026-09-01', '2026-10-25');
print('dates', win.aggregate_array('system:time_start').map(function (t) { return ee.Date(t).format('YYYY-MM-dd'); }));
print('pass', win.aggregate_array('orbitProperties_pass'));
print('relOrbit', win.aggregate_array('relativeOrbitNumber_start'));

var PASS = 'ASCENDING';             // <- set from the prints above
var PRE  = ['2026-09-08', '2026-09-30'];
var POST = ['2026-10-03', '2026-10-14'];   // widen if there's no scene yet

function comp(range) {
  return s1.filter(ee.Filter.eq('orbitProperties_pass', PASS))
           .filterDate(range[0], range[1]).median().clip(aoi);
}
var pre  = comp(PRE).focal_median(50, 'circle', 'meters');
var post = comp(POST).focal_median(50, 'circle', 'meters');

var diff  = post.subtract(pre);                    // dB
var flood = diff.lt(-3).and(post.lt(-16));

var gsw = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence');
flood = flood.updateMask(gsw.unmask(0).lt(80));
var slope = ee.Terrain.slope(ee.Image('NASA/NASADEM_HGT/001').select('elevation'));
flood = flood.updateMask(slope.lt(5));
flood = flood.updateMask(flood.connectedPixelCount(25, true).gte(8)).selfMask();

Map.centerObject(aoi, 11);
Map.addLayer(pre,  {min: -25, max: 0}, 'pre VV');
Map.addLayer(post, {min: -25, max: 0}, 'post VV');
Map.addLayer(diff, {min: -6, max: 6, palette: ['red', 'white', 'blue']}, 'diff', false);
Map.addLayer(flood, {palette: ['0044ff']}, 'flood');

var vec = flood.reduceToVectors({
  geometry: aoi, scale: 20, geometryType: 'polygon',
  eightConnected: true, maxPixels: 1e10, labelProperty: 'flood'
}).map(function (f) { return f.simplify(30); });

print('polygons', vec.size());
Export.table.toDrive({
  collection: vec,
  description: 'flood_mask_dakar_2026_10',
  fileFormat: 'GeoJSON'
});
```

## Checklist
- [ ] Confirm scenes exist in both windows for one pass direction (widen the windows if not; note the final dates)
- [ ] Look at the flood layer over Rufisque/Pikine/Keur Massar. Tweak the thresholds (−2.5 to −4 dB; −15 to −18 dB) only if it's obviously noisy, and record the final values
- [ ] Export → download from Drive → rename to `flood_mask_dakar_2026_10.geojson` → put it in `ndoxwatch/seed/`
- [ ] If the file is over about 2 MB, simplify more (`f.simplify(60)`) or clip the AOI
- [ ] Write the pre/post dates, pass direction, thresholds and polygon count into `seed/MASK_METADATA.md` (the README will cite it)
- [ ] Optional: repeat for Ogbaru, Anambra (river flood, September 2026) with an AOI drawn around Ogbaru LGA. This gives the Nigerian judges a local example.
- [ ] Screenshot the pre/post/flood layers for the README and the video
