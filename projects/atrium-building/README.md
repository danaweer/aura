# Atrium building / 01 — architecture and concept services

A furnished three-floor building using the retained revision A office plans. Open Projects → Atrium building / 01, or use `/#project/atrium-building`. The initial view shows the finished exterior. Use the inspection-view selector for front, rear, sides and roof; Office cutaway and floor isolation reveal the furnished rooms.

The existing model is the dimensional source: 40 × 24 m footprint, two 15 m wings around a 10 m central zone, 2.4 m main corridors, and occupied floor datums 0, 4.2 and 8.4 m. Room bounds, IDs, furniture inventory and internal circulation remain in `layout.js` and `interiors.js`. Front is +Z and rear is −Z, not geographic north. The exterior reference determines visual character, not dimensions.

- Ground: reception, visitor lounge/workspace, 8- and 6-seat meeting rooms, 16-seat training room, HR, finance and BMS/security.
- First: two eight-desk team spaces, team lead and project offices, four-desk focus room, 8- and 6-seat meetings, print/archive, flexible office and IT support.
- Second: CEO suite with desk, lounge and discussion table; executive and assistant offices; 12-seat boardroom; strategy and executive meetings; director office, executive lounge, records and facilities office.
- All floors: doors and full-height partitions with optional low-wall display, vertically aligned toilets, accessible WC, janitor and pantry, core stairs/lift, and wet/dry/HVAC riser reserves.

- `model.js`: editable Three.js geometry, grouped by floor and architectural role.
- `layout.js`: room IDs, bounds, areas, doors, furniture capacities and service notes transcribed from the supplied concept plans.
- `interiors.js`: instanced furniture, partitions, door openings, room zoning and optional service-reserve volumes.
- `stairs.js`: shared stair-core geometry for floor-level landings, half-landings, flights, roof arrival and coordinated slab openings.
- `architecture.js`: room-aware opaque walls/windows, balconies, solid roof assemblies/access, drainage, entrance and site.
- `services.js`: suspended ceilings/lights/access panels, connected air-distribution paths and rooftop equipment placeholders.
- `geometry.js`: reusable instanced boxes, beams, cylinders and plates with per-instance selection metadata.
- `visibility.js`: shared visibility rules and ancestor-aware selection filtering, also exercised in Node tests.
- `archive/shell-v1.js`: preserved phase-one architectural model before office-plan changes.
- `project.json`: requirements, planned phases, and an empty IoT assignment list.
- `preview.svg`: library thumbnail.

Bathroom, stair, plant, electrical, server and archive exterior walls are fully opaque, not darkened glazing. Office/meeting windows sit between opaque sills, piers and head bands. Stair partition enclosures extend to the underside of the next slab, without a claimed fire rating. Charcoal frames, warm off-white cladding and small wood-look fins unify the exterior. A local procedural environment supplies subtle glass reflections without network textures.

Roofs, ceilings and services are independent groups. Floor isolation hides upper/lower floors, roofs, ceilings and exterior cladding; invisible ancestors are excluded from picking. The Concept services toggle controls rooftop placeholders and connected supply/return/exhaust paths. The Service reserves toggle separately reveals planning volumes. Existing device assignments, server polling, saved room and telemetry behavior are unchanged.

The ground fire-pump, water/mechanical, electrical and server/UPS rooms, upper AHU reserves and IDF rooms retain their bounds, IDs and access, without fitted equipment. Rear external doors open directly to the clear service strip; a screened refuse enclosure is set farther back. The west rear yard remains an empty future plant reservation. No equipment sits on the atrium skylight.

## Modeling assumptions requiring later coordination

- The source model's 40 × 24 m envelope and existing column grid are retained, but remain unsurveyed. External cladding is approximately 280 mm deep; the façade bands visually conceal slab edges and ceiling zones.
- Wing roof slab datum is 12.6 m, with a conceptual 240 mm slab, 180 mm insulation layer and shallow waterproof finish rising about 80 mm from rear to front. Parapets/coping, rear outlets and visible external downpipes represent drainage intent. Roof falls, waterproofing, overflow provision and drainage sizing need detailed design.
- Both outer stair cores now have complete landings at the actual occupied-floor datums: 0, 4.2 and 8.4 m. Corridor doors retain their positions and open 90° onto those landings. Flights turn at half-storey landings at the rear, rather than placing a half-storey landing behind each corridor door. Ground exterior exits move to the outer side walls at the ground landing; other rear service doors are unchanged. Stairwell cutouts and landings share one geometry definition. Roof arrival is approximately 12.9525 m, level with the maintenance walkway. Small roof-access enclosures keep the upper-flight opening weather-covered and unobstructed above; they are maintenance access, not a fourth occupied floor. Stair dimensions, guarding, structure and egress compliance remain to be engineered.
- Open-top louver screens contain generic cooling units and AHUs on support-base placeholders. A central maintenance aisle and continuous roof-access approaches remain clear. The east exhaust route is kept outside the roof stair enclosure. Cooling units represent heat rejection; AHUs have distinct outdoor-air intakes. Exhaust discharges are visually separated and raised. No capacities, acoustic limits, ventilation rates or safe dispersion distances have been calculated.
- The existing east HVAC compartment carries conceptual supply, return and a separate sanitary-exhaust route through coordinated slab/roof openings. The west has no reserved air shaft: a new external supply/return chase at approximately x=−9, z=−12.52 and a separate sanitary-exhaust chase at x=−20.48, z=−2.8 avoid the wet riser and rear service doors. Weathering, shaft segregation, penetration sealing, dampers and detailed structural openings are not designed.
- Ceilings are near 3.1 m above each floor. Supply routes center at 3.64 m, returns at 3.38 m and sanitary exhaust at 3.83 m, above occupied space and below existing slab undersides. Branches connect to their corresponding main routes and terminals; bathroom exhaust does not join office return air. Tests check retained column and roof-maintenance clearances. Unmodeled beams, hangers, insulation, pressure losses, balancing, transfer-air paths and fire/smoke strategy still require engineering.
- Each second-floor balcony is 6 × 2.5 m and connects directly to its intended retained room (`L2-01` CEO, `L2-04` boardroom). Sliding-door openings are 1.25 m wide and clear the existing furniture. Slabs, steel cantilever/bracket supports, guarding, a small fall, threshold channel and external drain routes show intent only. Cantilever capacity, tie-backs, thermal bridges, guard design, threshold accessibility and waterproof detailing are unverified.
- The conventional 1.4 m entrance is alongside the retained revolving door. The site assumes level ground at the entrance datum and a roughly 51 × 42 m paved setting, without a site survey or boundary information. Landscaping and furniture stay outside the central approach and rear service-door access. Site drainage and real accessible gradients must be coordinated later.

This is an architectural and systems concept, not construction documentation or a code-certified design. No fire protection, pump/sprinkler network or new IoT integration has been installed. The existing MXCHIP stays with the preserved meeting-room project.

## Exit wayfinding

The **Exit sign plan** follows the supplied Means of Egress PDF Rev E01: 57 scheduled positions across three floors, supplemental stair/non-exit identification, per-face directional signs and optional doorway-to-discharge paths. **Trace selected room to site edge** shows the real stair descent and a clearly assumed outdoor continuation. See [EGRESS.md](EGRESS.md) for the mapping, actual side-door adaptation, assumptions and verification. The original PDF is archived in `reference/means-of-egress-e01.pdf` and linked from the viewer.

- `egress-plan.js`: PDF sign IDs, viewer-relative chevrons, actual room-door routes and stair-descent coordinates.
- `egress.js`: physical sign cases/faces and independent route-overlay groups; no new dependencies or telemetry assignments.

## Portable extinguishers

The 27 stations and paired red location signs from PDF F01 are implemented across the existing three floors. See [EXTINGUISHERS.md](EXTINGUISHERS.md) for sheet mappings, mounting assumptions, controls and checks.

## Washroom concept

The six WC suites and three separate accessible WCs follow the supplied washroom reference. See [WASHROOMS.md](WASHROOMS.md) for fitted dimensions, routes, inspection controls and remaining assumptions.
