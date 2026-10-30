# Portable fire extinguishers — PDF F01 model coordination

Implemented from the five supplied PDF sheets, dated 29 October 2026 (original page numbers 10–14). The supplied Desktop location no longer existed; identical filenames were found under `/Users/danawer/Documents/AURA/Fire_extinguishers_placements`. Unchanged copies are retained in `reference/extinguishers-f01-p10.pdf` through `p14.pdf`. The adjacent handoff coordinate schedule was cross-checked against the three floor drawings and retained as `reference/extinguisher-placements-f01.json` for traceability and independent regression checks.

27 portable-unit models and 27 paired red/white identification signs:

| Floor | Extinguisher IDs | Number | PDF drawing |
| --- | --- | --- | --- |
| Ground | FE-G-01…11 / SG-G-01…11 | 11 | p.11 |
| First | FE-L1-01…08 / SG-L1-01…08 | 8 | p.12 |
| Second | FE-L2-01…08 / SG-L2-01…08 | 8 | p.13 |

Common positions 01/02 are on the WC exterior corridor walls immediately before the two stairs, outside the stair enclosures. Positions 03/04 are on the front-spine room walls. Positions 05/06 are on the main-corridor faces of the pantry and BMS/IT/facilities-office walls. Ground 07 is on the atrium-facing Meeting A wall near reception. Ground 08–11 are inside the pump, water, electrical and server/UPS rooms. First 07/08 are inside print/archive and AHU rooms; second 07/08 are inside records/store and AHU rooms.

## Coordinate and mounting assumptions

The existing 40 × 24 m geometry and floor elevations 0 / 4.2 / 8.4 m are retained. The reference drawing/schedule uses a front-left origin with X right and Y rear. Conversion is model X = source X − 20; model Z = 12 − source Y. The marked tangential coordinates are unchanged. Brackets are snapped to the relevant finished wall: 140 mm partitions or 280 mm exterior cladding, plus a 20 mm mounting stand-off. Cylinders project 195 mm from the bracket origin and are kept beside, rather than within, doorway sweeps. No room, door, furniture, stair or service reserve was relocated.

Per PDF p.14, the highest portable handle is 1.20 m above the local floor; identification sign centres are 2.10 m above it. Signs are 200 × 200 mm, with a code-drawn white extinguisher pictogram on red. Each corridor spine/reception station has one projecting sign housing with pictograms on its front and both sides; other stations have one wall plate directly above the unit. The projecting signs retain 200 × 200 mm faces and project 200 mm from their mounting brackets. This avoids the original single-blade signs disappearing edge-on when viewed directly above the extinguisher. These are separate from the green EXIT signs and stair-direction boards, whose heights and directions are retained.

The PDF labels are preserved as provisional categories: 19 ABC-O, 7 ABC-S and 1 CA-E. CA-E is represented by a light metal clean-agent placeholder in the server/UPS room. No extinguishing agent, capacity, certified rating or battery-protection solution has been selected by this model. Mounting heights and small-unit dimensions are coordination assumptions, not installation certification. Detailed hazard assessment, travel-distance coverage, accessibility and equipment specifications remain unverified, as stated by the reference sheets. No new HVAC, BMS wiring or telemetry was requested or added from the document's separate services guidance.

## Inspection and application behavior

Use **Extinguisher plan** to see numbered red badges on the isolated floor. Use **Inspect a fire extinguisher…**, a red plan badge, the cylinder or its sign to inspect the matching FE/SG station. **Fire extinguishers + signs** controls the layer independently of exit signs, furniture and conceptual HVAC. It is also available in the fullscreen side panel. Floor isolation hides stations on other floors, and hidden station objects are removed from selectable raycast results. All units remain model-only; the existing room and MXCHIP telemetry bindings are unchanged.

`extinguisher-plan.js` contains the schedule/coordinate conversion; `extinguishers.js` builds lightweight shared geometry and a shared canvas texture. Existing visibility, picking and UI conventions are used. Archived sheets are served only through the server's explicit static allowlist.

## Verification

Automated checks compare every station against the independent handoff schedule, including IDs, source wall coordinates, facing, room and category. Geometry checks verify local mounting heights, location inside special rooms, clearance from modeled door sweeps, and no cylinder intersections with existing structure, partitions, fixtures or furniture. Visibility/raycast checks cover hidden floors, the layer toggle, a front view of all 27 pictograms, and both corridor approaches to each projecting sign. Browser checks sample actual rendered red pictogram pixels above every unit; second-floor stations 01–08 each have a review screenshot. The browser suite inspects all 27 stations, all three floor plans, pairing, fullscreen controls, existing egress inspection, room selection and telemetry regression. Screenshots are written to `test-results/extinguishers-plan-0.png` through `-2.png`, plus representative `extinguisher-FE-*.png` views.
