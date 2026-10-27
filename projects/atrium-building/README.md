# Atrium building / 01 — phase 02

A furnished three-floor building using the supplied revision A office concept plans. Open Projects → Atrium building / 01, or use `/#project/atrium-building`. Office cutaway opens the ground floor; use the floor selector and Top view to inspect the other plans.

The existing white structural frame, blue-green curtain walls, glazed pitched crowns, atrium, galleries, stairs, lift core and revolving entrance are adapted to the plans' 40 × 24 m working envelope. Two 15 m wings flank a 10 m central zone. Main corridors are 2.4 m wide; floor elevations are 0, 4.2 and 8.4 m. The roof is a separate, non-occupiable group. Front is +Z and rear is −Z, not a geographic orientation.

- Ground: reception, visitor lounge/workspace, 8- and 6-seat meeting rooms, 16-seat training room, HR, finance and BMS/security.
- First: two eight-desk team spaces, team lead and project offices, four-desk focus room, 8- and 6-seat meetings, print/archive, flexible office and IT support.
- Second: CEO suite with desk, lounge and discussion table; executive and assistant offices; 12-seat boardroom; strategy and executive meetings; director office, executive lounge, records and facilities office.
- All floors: doors and full-height partitions with optional low-wall display, vertically aligned toilets, accessible WC, janitor and pantry, core stairs/lift, and wet/dry/HVAC riser reserves.

- `model.js`: editable Three.js geometry, grouped by floor and architectural role.
- `layout.js`: room IDs, bounds, areas, doors, furniture capacities and service notes transcribed from the supplied concept plans.
- `interiors.js`: instanced furniture, partitions, door openings, room zoning and optional service-reserve volumes.
- `archive/shell-v1.js`: preserved phase-one architectural model before office-plan changes.
- `project.json`: requirements, planned phases, and an empty IoT assignment list.
- `preview.svg`: library thumbnail.

Plant, server/UPS, IDF and riser reserves remain empty. Rear exterior doors serve the ground-floor fire-pump, water/mechanical and electrical rooms. Upper-floor AHU reserves have gallery access. Separate dry/HVAC shaft compartments, slab openings and overhead corridor route allowances prepare the next modeling stage. The rear service yard reserves space without sized equipment; the glazed roof carries no plant.

These are schematic space-planning assumptions, not surveyed dimensions or construction documentation. Column locations, stair details, door clearances, structural openings, fire strategy and equipment sizing still need coordination. HVAC, fire systems, pumps, sprinklers, piping and IoT devices have not been installed. The existing MXCHIP stays with the preserved meeting-room project.
