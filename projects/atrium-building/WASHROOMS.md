# Washroom concept W01

The supplied layout, HVAC/plumbing sheet, BMS table and corrected perspective are fitted into the existing AURA rooms. Three occupied levels, all room IDs, corridor/stair geometry, extinguisher stations and exit-sign locations are retained.

## Fitted layouts

| Rooms on each of G / L1 / L2 | Per room | Retained gross envelope |
| --- | --- | --- |
| W01, west suite | Two standard cubicles, one larger cubicle, two basins | 4.0 × 5.6 m / 22.4 m² |
| W04, east suite | Mirrored W01 | 4.0 × 5.6 m / 22.4 m² |
| W02, separate accessible WC | One WC, one basin, proposed assistance point | 4.0 × 3.2 m / 12.8 m² |

Totals: six multi-user suites plus three separate accessible rooms; 21 WCs and 15 washbasins. Janitor rooms and wet-service reservations are retained.

Standard cubicles have proposed clear dimensions 1.70 × 1.05 m; the larger cubicle has at least 1.70 × 2.0 m clear. A 200 mm service lining runs along the outer WC wall. Basins project 450 mm from the opposite wall, leaving approximately 1.30 m of aisle. A 1.60 m turning circle is reserved at the rear of each main aisle; W02 rooms also have turning/transfer reservations. These are model dimensions, not certified accessibility clearances.

Existing corridor doors remain in their actual positions (main suites: model Z = −1.8 m). As these differ from the schematic entrance position, the basins are spaced along the aisle to clear the retained openings. No corridor or service access is narrowed.

Warm stone-look tiled floors, sage opaque screens, wall-hung WC pans, concealed-cistern flush plates, chrome-look fittings, mirrors, soap, paper towels, toilet-paper dispensers, hooks, bins and grab/fold-up rails follow the reference palette. Basins have open space below; transfer-side fold-up rails are shown raised. Dividers are 2.30 m high and cubicle doors 2.10 m. Perimeter walls and exterior cladding remain opaque. Entry and cubicle doors are closed in finished views. The optional inspection state opens standard cubicle doors inward and larger doors outward. Door swings, fixture quantities and hardware require further review.

## Services

Each of the 18 main-suite cubicles has its own connected extract branch and grille. W02 and janitor rooms have extraction too: 24 sanitary extract terminals in total. These connect to existing separate sanitary-exhaust risers and roof discharges, never office return air. Direct tempered make-up branches connect each sanitary room to the supply spine, away from the extract sources. No transfer grille is cut into a corridor wall or door.

Existing suspended ceilings, lights and access panels are retained, with terminal openings updated. Extract balancing-damper reservations and six floor/wing inline-fan placeholders have stable IDs. Air volumes, negative pressure, acoustics, fan duty, smoke/fire response and discharge clearances remain undesigned; the model does not assert performance or a fire rating.

Cold and tempered water, concealed cistern feeds, basin traps, waste branches, cleanout reservations and soil/vent stacks form connected conceptual routes. Main suites use local stacks inside their service linings, mirrored on the east so no wet pipe crosses the atrium. W02 and janitor branches use retained R01. Slab and solid-wing roof openings are reserved at stack positions. Ground branches depict candidate below-ground routes toward the water/mechanical-room zone and explicitly unverified drainage connections.

Water supply/treatment, drainage levels, gradients, pipe sizes/protection, structural penetrations, waterproofing, maintenance access and approved connections require engineering coordination. The new 220 × 220 mm stack openings are reservations, not structural approval. No public-sewer connection or calculated equipment selection is implied.

## Digital-twin inspection

Select a room, then **Washroom detail**. This inspection mode lowers perimeter partitions while leaving cubicles full height; finished views restore the walls. Optional controls show clearance overlays, open cubicle doors and planned BMS points. These controls are also available in fullscreen. Floor isolation, roof/ceiling controls and hidden-object picking remain intact.

Stable BMS IDs cover aisle/cubicle occupancy, lighting, two leak points per room, a domestic branch meter, temperature/humidity and an assistance point in W02. Fan enable, running proof and fault are separate planned signals. All are explicitly **UNAVAILABLE / MODEL ONLY**, with no live reading or command assigned. The assistance point is a reservation, not an installed alarm system. Existing MXCHIP telemetry is unchanged.

## Files and validation

`washroom-plan.js` defines the local dimensions, mirror transform, fixture/terminal positions and openings. `washrooms.js` builds sanitaryware, cubicles, accessories, overlays and markers. `washroom-plumbing.js` builds connected pipes and vent terminations. Integration uses existing interior, service, slab/roof, visibility and viewer modules; no dependencies were added.

Tests cover fixture counts, mirror geometry, cubicle dimensions, closed-door privacy, opening directions, turning-space obstruction, extraction, continuous stacks, real slab openings, floor isolation and unavailable BMS states. Browser checks inspect all nine rooms and capture `test-results/washroom-G-W01.png` through `washroom-L2-W02.png`, plus services/BMS. Existing egress, room selection, extinguisher signs, fullscreen and telemetry checks remain in place.
