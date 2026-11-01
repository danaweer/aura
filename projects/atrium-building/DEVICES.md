# Room device positions — D02

Implemented from all four pages of `AURA_Device_Positions_All_Floors.pdf`, dated 1 November 2026. The unchanged supplied document is archived as [reference/device-positions-d02.pdf](reference/device-positions-d02.pdf) and linked from the viewer. Its symbols are room-relative candidates and work zones, not installation coordinates or verified quantities. The retained 40 × 24 m model, floor datums, opaque partitions, furniture, doors, service routes and equipment ports govern placement.

## Source mapping

| Sheet | Model implementation |
| --- | --- |
| 1 — Ground | O occupancy, representative T wall positions, S/R ceiling zones, W near actual sanitary/pantry fixtures and L work zones. Q temperature/CO2 candidates in G-03 Meeting A, G-04 Meeting B and G-05 Training. Plant P symbols refer to actual equipment instrumentation from p.4. Reception/atrium lighting and sensing remain a separate coordination study. |
| 2 — First | Q in L1-07 Meeting D and L1-05 Meeting C; ordinary office packages in the retained team/project rooms. L1-01/L1-04 have two illustrative supply terminals each, without a coverage claim. L1-08 print/archive is flagged for contents/equipment review. |
| 3 — Second | Q in L2-07 Strategy, L2-04 Boardroom and L2-05 Executive meeting. Office packages serve CEO, executive, assistant and director rooms; L2-01/L2-04 have two illustrative supply terminals each. Lounge and records/store use needs remain flagged for review. |
| 4 — Plant | Separate fire-pump suction/discharge pressure probes on actual fittings; domestic-booster discharge pressure on its actual port; leak probes beside water equipment and server cooling condensate; representative plant-room T positions; optional rack-inlet sensing. Each upper AHU has temperature probes on its real supply/outdoor/return duct routes, a proposed filter differential-pressure interface and a separate controller feedback interface. Lighting is above the maintenance aisles. |
| 4 — Pending systems | Separate wing ceiling studies for detection, notification and sprinkler design; stair emergency-light/exit-device studies; a high-level atrium study. No one-per-room detector, sprinkler, manual station or door contact is inferred. Existing exit signs and extinguishers are retained. Tank-level sensing remains pending at each tank-space reservation until an actual tank exists. |

The current catalog has 429 selectable records: 40 O, 26 T, 8 Q, 15 W, 45 S, 28 R, 21 E, 92 illustrative/reused L fixtures, 49 SW switches, 19 P measurement/interface records, 69 lighting work zones and 17 pending studies. This includes retained fixtures and diagram records; it is neither a physical sensor count nor an engineered quantity schedule. One E plan glyph represents each washroom extraction zone while all three cubicle extracts remain separate physical objects in each main suite.

## Geometry coordination

- T/Q candidates mount on actual opaque internal walls at an assumed 1.50 m above floor datum, avoiding openings, furniture, columns and glazed atrium/exterior faces. Opposite faces of shared partitions use staggered candidates. Switches mount at an assumed 1.10 m on actual latch-side wall sections after checking the retained swings. These heights and mounting details require review.
- O ceiling pucks sit near 3.06 m, separate from lights and grilles. Team areas and closed cubicles still need sensor coverage review. The pre-existing individual washroom cubicle BMS points remain available separately.
- Low-level W bodies meet actual modeled finishes: sanitary tile top 47.5 mm, ordinary floor finish 23 mm above datum. Probe bodies are 25 mm high. Locations follow basin traps, accessible pantry plinths, actual pump/booster bases and the cooling-unit condensate path. Electrical-room wet-risk review remains pending; no arbitrary leak probe was added to its dry floor.
- Reused supply/return terminals were coordinated with their R01 branches and ceiling openings. Five additional illustrative supplies implement the large-room zones. Return positions were adjusted within their source room zones to clear the actual supply drops. Retained pantry return geometry remains available in ordinary R01 inspection but is excluded from the D02 plan because the sheet shows S, O and W there. Retained sanitary make-up supplies are marked supplemental and omitted from D02 symbols; separate cubicle extraction stays intact.
- Suspended ceiling slabs and luminaires now have separate groups, allowing lights and ceiling candidates to be inspected with slabs hidden. Fixtures were shifted locally to clear grilles and occupancy pucks. Plant lights are suspended above the actual service aisles. L outlines remain lighting work zones; neither fixture count nor normal/emergency illumination has been calculated.
- Plant probes follow transformed equipment/duct anchors. AHU filter taps straddle an explicitly assumed internal filter plane, which must be checked against the selected unit. Duct sections, tappings, isolation, sensor insertion, access, wiring and controller interfaces remain conceptual.
- Plan symbols use short leaders where needed to avoid overlap without shifting their physical assets. The entrance canopy hides with other overhead geometry in cutaway/floor views and returns in the finished exterior.

## Data and controls

Expand **Room devices · D02** → **Device position plan**, then choose a floor. Roofs and ceilings hide automatically. Categories independently control sensors, air terminals, lighting, switches, plant interfaces, lighting work zones and pending studies. Select an ID from the list, a physical device or a plan glyph to inspect it. The controls also work in fullscreen. Optional existing service routes and logical field-connection studies can be shown separately; dashed field links are proposed relationships, not installed circuits.

All records have stable asset/device, room, floor, source-page and system/category fields. `designStatus` is separate from `dataSource: unconnected` and `dataStatus: unavailable`. Hardware bindings and telemetry are null. No readings or operating states are synthesized. Q proposes temperature and CO2; RH is optional only when supported by future hardware. Air terminals and lights are physical assets, not automatically sensors. Controller command, running proof, availability and fault remain distinct signals; AURA provides no equipment command here and fire integration stays monitoring-only.

The original 78 washroom points and six fan interfaces retain their IDs. Eighteen D02 O/W candidates reference existing aisle occupancy/leak IDs; their alternate markers move to the same physical candidate and hide when its new body is shown. This prevents duplicate markers while keeping the earlier BMS inspection available. Existing meeting-room MXCHIP telemetry and device assignments are unchanged.

## Files and verification

`device-plan.js` defines the room programs and geometry-relative candidates. `devices.js` builds reusable device bodies, instrumentation and work/study overlays, with explicit unconnected metadata. Existing model, services, visibility, viewer, UI and server modules integrate the controls and archived PDF. No new dependency is required.

Node tests check the exact Q room set, IDs and unavailable states, actual terminal/branch endpoints, opaque-wall and latch-side mounting, leak-finish contact, legacy point reuse, equipment/duct anchors, separate command/proof signals, pending tank/fire design, light/grille clearance, floor/category isolation and hidden-object picking. Browser checks inspect all three floor plans and selected wall/leak/plant devices, reject overlapping visible plan symbols, exercise fullscreen/category/route controls, serve the archived PDF and retain the existing telemetry and model regression checks. Screenshots are saved as `test-results/devices-d02-*.png`.

This is a coordinated modeling concept. Coverage, final quantities, hardware, wiring, airflow, controls sequences, manufacturer details, barrier penetrations and locally applicable life-safety design remain unresolved.
