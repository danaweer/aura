# Atrium building / 01 — architecture and concept services

A furnished three-floor building using the retained revision A office plans. Open Projects → Atrium building / 01, or use `/#project/atrium-building`. The initial view shows the finished exterior. Use the inspection-view selector for front, rear, sides and roof; Office cutaway and floor isolation reveal the furnished rooms.

The existing model is the dimensional source: 40 × 24 m footprint, two 15 m wings around a 10 m central zone, 2.4 m main corridors, and occupied floor datums 0, 4.2 and 8.4 m. Room bounds, IDs, furniture inventory and internal circulation remain in `layout.js` and `interiors.js`. Front is +Z and rear is −Z, not geographic north. The exterior reference determines visual character, not dimensions.

The **Normal / Blueprint** buttons beside the viewer controls switch presentation without changing the camera, floor, selection or layer settings. Blueprint uses the same model and P01/R01/D02 objects, with crease outlines, restrained hatching and existing system colours. See [BLUEPRINT.md](BLUEPRINT.md) for implementation and verification notes.

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
- `device-plan.js` and `devices.js`: D02 room-device candidates, equipment instrumentation, lighting work zones and explicit unconnected data.
- `geometry.js`: reusable instanced boxes, beams, cylinders and plates with per-instance selection metadata.
- `visibility.js`: shared visibility rules and ancestor-aware selection filtering, also exercised in Node tests.
- `archive/shell-v1.js`: preserved phase-one architectural model before office-plan changes.
- `project.json`: requirements, planned phases, and an empty IoT assignment list.
- `preview.svg`: library thumbnail.

Bathroom, stair, plant, electrical, server and archive exterior walls are fully opaque, not darkened glazing. Office/meeting windows sit between opaque sills, piers and head bands. Stair partition enclosures extend to the underside of the next slab, without a claimed fire rating. Charcoal frames, warm off-white cladding and small wood-look fins unify the exterior. A local procedural environment supplies subtle glass reflections without network textures.

Roofs, ceilings and services are independent groups. Floor isolation hides upper/lower floors, roofs, ceilings and exterior cladding; invisible ancestors are excluded from picking. The Concept services toggle controls rooftop placeholders and connected supply/return/exhaust paths. The Service reserves toggle separately reveals planning volumes. Existing device assignments, server polling, saved room and telemetry behavior are unchanged.

P01 equipment and R01 routes now occupy the retained service rooms and rear-yard reservations. Room bounds, IDs and access remain. Rear external doors open directly to the clear service strip; a screened refuse enclosure sits farther back. No equipment is placed on the atrium skylight.

## Modeling assumptions requiring later coordination

- The source model's 40 × 24 m envelope and existing column grid are retained, but remain unsurveyed. External cladding is approximately 280 mm deep; the façade bands visually conceal slab edges and ceiling zones.
- Wing roof slab datum is 12.6 m, with a conceptual 240 mm slab, 180 mm insulation layer and shallow waterproof finish rising about 80 mm from rear to front. Parapets/coping, rear outlets and visible external downpipes represent drainage intent. Roof falls, waterproofing, overflow provision and drainage sizing need detailed design.
- Both outer stair cores now have complete landings at the actual occupied-floor datums: 0, 4.2 and 8.4 m. Corridor doors retain their positions and open 90° onto those landings. Flights turn at half-storey landings at the rear, rather than placing a half-storey landing behind each corridor door. Ground exterior exits move to the outer side walls at the ground landing; other rear service doors are unchanged. Stairwell cutouts and landings share one geometry definition. Roof arrival is approximately 12.9525 m, level with the maintenance walkway. Small roof-access enclosures keep the upper-flight opening weather-covered and unobstructed above; they are maintenance access, not a fourth occupied floor. Stair dimensions, guarding, structure and egress compliance remain to be engineered.
- Roof screens, maintenance aisles, roof access and separate sanitary outlets are retained. Earlier roof-AHU alternatives and roof-fed comfort-air routes are superseded and hidden by R01. Floor AHUs serve first/second floors, with a separate ground-yard ventilation reservation. Condensers remain heat-rejection placeholders, not fresh-air supplies.
- R01 uses the existing east HVAC compartment and distinct proposed electrical/data/fire-alarm containment zones; it adds FR beside the left wet zone and WR aligned with the right sanitary stack. Proposed space, support and penetration protection are not approved. The earlier west chase shell is retained, but is not asserted to supply the current ventilation model.
- Ceilings remain near 3.1 m. R01 assigns separate conceptual service levels and local crossing offsets, retaining terminal positions and independent bathroom extraction. See [MAIN-SERVICES.md](MAIN-SERVICES.md) for the dimensions, packed allowances and unresolved supports, barriers, sizing, slopes and access.
- Each second-floor balcony is 6 × 2.5 m and connects directly to its intended retained room (`L2-01` CEO, `L2-04` boardroom). Sliding-door openings are 1.25 m wide and clear the existing furniture. Slabs, steel cantilever/bracket supports, guarding, a small fall, threshold channel and external drain routes show intent only. Cantilever capacity, tie-backs, thermal bridges, guard design, threshold accessibility and waterproof detailing are unverified.
- The conventional 1.4 m entrance is alongside the retained revolving door. The site assumes level ground at the entrance datum and a roughly 51 × 42 m paved setting, without a site survey or boundary information. Landscaping and furniture stay outside the central approach and rear service-door access. Site drainage and real accessible gradients must be coordinated later.

This is an architectural and systems concept, not construction documentation or a code-certified design. Fire main/pump route reservations are conceptual; no installed or hydraulically designed sprinkler network or new IoT integration is asserted. The existing MXCHIP stays with the preserved meeting-room project.

## Exit wayfinding

The **Exit sign plan** follows the supplied Means of Egress PDF Rev E01: 57 scheduled positions across three floors, supplemental stair/non-exit identification, per-face directional signs and optional doorway-to-discharge paths. **Trace selected room to site edge** shows the real stair descent and a clearly assumed outdoor continuation. See [EGRESS.md](EGRESS.md) for the mapping, actual side-door adaptation, assumptions and verification. The original PDF is archived in `reference/means-of-egress-e01.pdf` and linked from the viewer.

- `egress-plan.js`: PDF sign IDs, viewer-relative chevrons, actual room-door routes and stair-descent coordinates.
- `egress.js`: physical sign cases/faces and independent route-overlay groups; no new dependencies or telemetry assignments.

## Portable extinguishers

The 27 stations and paired red location signs from PDF F01 are implemented across the existing three floors. See [EXTINGUISHERS.md](EXTINGUISHERS.md) for sheet mappings, mounting assumptions, controls and checks.

## Washroom concept

The six WC suites and three separate accessible WCs follow the supplied washroom reference. See [WASHROOMS.md](WASHROOMS.md) for fitted dimensions, routes, inspection controls and remaining assumptions.

## P01 equipment

Reserved rooms now contain the proposed equipment envelopes from the four-page equipment guide. See [EQUIPMENT.md](EQUIPMENT.md) for placements, access reservations, control layers, retained HVAC concepts and unresolved engineering assumptions.

## R01 main service routes

The four-page routing PDF is implemented with separate fire, air, VRF/condensate, wet-service, power, data and pending fire-alarm/smoke layers. See [MAIN-SERVICES.md](MAIN-SERVICES.md) for sheet mapping, controls, modeling assumptions and verification. Expand **Main service routes · R01** in the existing or fullscreen controls.

## D02 room device positions

All four pages of the device-position guide are mapped into the existing rooms and actual equipment. Expand **Room devices · D02** → **Device position plan** to inspect ground, first and second floors, with independent sensor, terminal, light, switch, plant and study layers. All device data remains unconnected/unavailable. See [DEVICES.md](DEVICES.md) for source mapping, retained BMS IDs, placement adaptations and pending design items.
