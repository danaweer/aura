# P01 equipment placement

Implemented from the four-page `AURA_Equipment_Placement_Guide.pdf` found in Downloads after the four supplied Desktop paths were unavailable. The complete source is archived unchanged as `reference/equipment-placement-p01.pdf` and linked from the equipment controls. Source sheets are placement guidance; the existing building controls scale, room bounds, floors and actual doors.

## What is placed

22 proposed equipment groups, plus two tank-space reservations:

| Room / zone | Stable IDs |
| --- | --- |
| G-M01, fire pump | FP-01 main pump/motor; JP-01 jockey pump; CP-FP-01 and CP-JP-01 separate controllers |
| G-M02, domestic water | BS-G-01 two-pump booster; PV-G-01 pressure vessel; CP-BS-G-01 control panel |
| G-E01, electrical | MDB-G-01 along the west side wall, front facing the room |
| G-I01, server/UPS | SR-G-01 rack with front/rear access; UPS-G-01; CRAC-G-01 dedicated cooling reservation |
| G-B01, BMS/security | GW-G-01 on an accessible wall; existing operator desks/displays retained |
| G/L1/L2-I02 | NET-G-01 / NET-L1-01 / NET-L2-01 network racks, distinct from DB-G / DB-L1 / DB-L2 electrical zones |
| L1-M01 / L2-M01 | AHU-L1-01 / AHU-L2-01, long axis front to back; west-facing service panels |
| Rear yard | ODU-YARD-A and ODU-YARD-B condenser placeholders; existing asset IDs ROOF-West-COOL and ROOF-East-COOL are preserved despite relocation |
| Rear yard | RES-FIRE-TANK and RES-DOMESTIC-TANK: translucent space reservations, no fitted or sized tank |

Wet, dry and HVAC shafts remain free of large floor-standing equipment. Washroom extract fans/routes and current sanitary plumbing are retained. Offices, stairs, lift, room IDs, furniture, washrooms, exit signs, extinguishers and device bindings are retained. The existing 1.30 m west-wall doors into upper AHU rooms already resolve the source drawing's missing-door question at concept level; their leaves are shown fully open for access inspection. Handling and whole-unit replacement are not verified.

## Dimensions and access

Source p.4 illustrative envelopes are used: main pump 2.0 × 0.9 × 1.1 m, jockey pump 0.5 × 0.5 × 1.0 m, main controller 0.8 × 0.4 × 1.8 m, booster 1.5 × 0.8 × 1.2 m, MDB 2.4 × 0.8 × 2.0 m, rack 0.6 × 1.0 × 2.0 m, UPS 0.6 × 0.8 × 1.2 m, and AHU 3.0 × 1.2 × 1.5 m with the 3 m axis along model Z. Other unit dimensions and working-space depths are explicit local modeling assumptions in `equipment-plan.js`, not manufacturer selections or code clearances.

Separate translucent working spaces follow each movable asset group. The rack includes rear access; AHU west-side space reserves service/filter/coil access. Clearance and connection diagrams do not raycast, so they cannot block equipment selection. Distinct IDF rack/DB envelopes do not establish verified electrical/IT separation.

Two 3 × 3 × 2.4 m tank-space boxes fit near the prior rear service-yard allowance, with no claimed storage capacity. The proposed condenser yard has slatted, open-top screens and a 1.4 m access gap. The yard stays behind the rear path at Z = −14.5 m; the side stair discharges and three dedicated rear service doors remain clear. Actual yard size, airflow separation, foundations, tank need and supply strategy remain to be designed.

## Connections and existing HVAC concepts

Every equipment group has named connection ports. [R01 main services](MAIN-SERVICES.md) now connect actual pump, booster, AHU, condenser, board and network ports. Upper AHU air connections rise from the top, leaving the west service faces clear; the gateway has a separate network/BMS entry. The earlier P01 dashed proposals are suppressed to prevent competing diagrams, and the equipment panel's R01 service switch mirrors the master Concept services control.

The two former outdoor roof cooling meshes remain in the ground yard with their stable IDs. R01 uses the indoor floor AHUs plus a ground-yard ventilation reservation. Earlier roof-AHU alternatives and roof-fed comfort-air geometry are hidden, while their catalog IDs, roof screens/access and sanitary discharges remain. These are candidate networks, not a balanced or commissioned system; condensers remain separate from outdoor-air supplies.

## AURA controls and data

Expand **Equipment placement** in the existing controls/fullscreen side panel. Choose an equipment ID to inspect it, or select its body/port directly. Optional layers show equipment, working clearances, labelled ports and reserved connections independently. **Eye-level equipment** sets a 1.65 m viewpoint within the proposed service aisle with a wider field of view; ordinary room/view presets restore the normal camera. Small equipment groups can be inspected more closely without changing the building scale.

All new asset states say **SIMULATED / MODEL ONLY / NOT CONNECTED**. This labels the placement model; no running proof, live telemetry, calculated performance or numerical simulation has been synthesized. Fire-system integration is monitoring-only, with no start/stop control. Existing washroom BMS points remain unavailable and existing meeting-room MXCHIP telemetry is unchanged.

## Validation and files

`equipment-plan.js` contains the placements and nominal sizes; `equipment.js` builds separate asset groups, clearance objects, ports, yard and connection reservations. Existing model, service, visibility, viewer, UI and static-server modules integrate them. No new dependency or external asset download is needed.

Tests compare source envelope dimensions and stable IDs, verify body/clearance fit within rooms, check existing walls/doors/furniture/columns, prevent equipment bodies from intruding into other working spaces, preserve empty shafts and front-to-back AHU orientation, and verify floor isolation and selection through diagram layers. Browser checks inspect all 24 equipment/reservation groups, capture oblique and person-height views, exercise fullscreen layers and retain existing egress, extinguisher, washroom, room selection and telemetry regression checks. Screenshots are in `test-results/equipment-*.png`.

## Alignment review — 31 October 2026

Equipment bases now meet the actual modeled finishes: 23 mm above the structural floor datum indoors, and the 50 mm condenser-yard pad outdoors. These values follow the existing model, not a surveyed construction detail. Pump pedestals, pressure-vessel feet, condenser feet and fan housings meet their supported bodies; the main pump includes a connecting drive shaft and discharge neck.

Pump suction/discharge markers match the physical manifold or flange geometry, including the main pump's upward-facing discharge. AHU and condenser connection reservations start at the named ports after each asset's translation and rotation. Closely spaced condenser and cooling-unit labels are staggered vertically with leaders, without moving their physical connection points. Tests check these contacts and anchors, all equipment port labels for overlap, and the retained room/door/furniture/structure clearance checks.

D02 adds selectable pressure, duct-temperature, assumed filter-DP and controller-interface candidates on these actual equipment objects and routes. Separate command/proof/fault signals remain unconnected. Local maintenance lights and leak probes preserve access; tank levels await actual tanks. See [DEVICES.md](DEVICES.md) for the page-4 mapping and remaining assumptions.
