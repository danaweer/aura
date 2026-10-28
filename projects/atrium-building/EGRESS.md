# Exit wayfinding — Rev E01 implementation

Basis: the user-supplied [Means of Egress.pdf](reference/means-of-egress-e01.pdf), **28 October 2026, E01**, plans on pages 2–4, design basis on page 7 and sign schedules on pages 8–9. The archived PDF is unchanged. Its older architectural handoff notes do not replace the current building model. This implementation adds wayfinding to that model and retains all rooms, furniture, stairs, service reserves and existing telemetry assignments.

## Using the design

Open **Atrium building / 01 → Exit sign plan**. Choose Ground, Level 01 or Level 02 to see the PDF IDs and route arrows. Room labels have an independent toggle and are turned off by this shortcut for readability. The green plan badges show travel in world/plan orientation; the actual physical signs use chevrons for their own viewing approach.

The sign selector contains all 57 scheduled positions. Selecting one focuses its floor and physical board. The inspector reports its source page, mount, destination, face directions and any adaptation. Click a green plan badge to inspect it without moving the camera. Physical signs are also selectable. New assets use `EGRESS-*` IDs so that, for example, sign `G-01` cannot override the existing lounge room `G-01`.

Choose a room with the existing room selector, then **Trace selected room to site edge**. It opens the building and shows the route from that room's doorway, through its intended stair, down the real treads/landings to the ground side exit and along the side pedestrian path. Rear plant rooms use their dedicated exterior exits. Isolating a floor shows that stage; All floors shows the descent. **Show all routes** restores the general corridor overlay. Exit signs and Route overlay are independently switchable, including in the fullscreen sidebar. Hidden groups are excluded from raycasting; diagram strokes never intercept picking.

Green means wing-to-stair route intent. Dashed blue identifies atrium/gallery-related links. Dashed amber identifies **assumed outdoor continuation**, ending at the front paved site edge (`z = +22 m`), not a surveyed or legally established public way. Even green routes require review for atrium exposure. There is no invented assembly point or refuge provision. The lift and central stair are not assigned evacuation routes.

## Scheduled positions retained

| PDF positions | Intended placement |
| --- | --- |
| G-/1-/2-01 and -02 | Stair A/B corridor entrances; One angled double-sided EXIT sign above the corridor door, readable from both rear-spine approaches |
| G-/1-/2-03 and -04 | Front corridor spines, facing occupants walking toward the main corridor |
| G-/1-/2-05 and -06 | Main-to-rear-spine decisions, facing arrivals from the inner wing |
| G-/1-/2-07 and -08 | Rear-spine repeaters approaching the enclosed stairs |
| G-/1-/2-09 and -10 | Inner-wing/atrium junctions, one angled double-sided sign toward each wing's stair |
| G-/1-/2-11 and -12 | Rear atrium-side galleries toward main corridors and stairs; conditional on atrium strategy |
| G-20/1-17/2-17; G-21/1-18/2-18 | Front-to-main corridor T-junctions; left toward Stair A / right toward Stair B |
| G-13 | Interior side of the conventional entrance alongside the revolving door |
| G-14 and G-15 | Inside the actual ground discharge door of Stair A/B |
| G-16, G-17 and G-18 | Fire pump, water/mechanical and electrical rooms, inside their own exterior doors |
| G-19 | Training room `G-05`, above its east corridor door, room side |
| 1-13/1-14 and 2-13/2-14 | Upper front-gallery ends, toward corresponding side gallery and wing stair; conditional |
| 1-15 and 1-16 | Team workspaces `L1-01` and `L1-04`, room-side corridor doors |
| 2-15 and 2-16 | CEO office `L2-01` and boardroom `L2-04`, room-side corridor doors |

**21 ground + 18 first + 18 second = 57 scheduled positions.** This is not a procurement count. Every position has exactly one physical cabinet. Stair entrances and inner-wing junctions use opposite front/back lettering on that cabinet; the case is angled to the corridor approaches instead of crossing multiple boards. There are also **14 supplemental positions**: six stair/floor/descent identification boards, six lift/central-stair non-exit-route notices and two candidate outdoor direction boards. Supplemental IDs are separate from the PDF schedule.

## Adaptations and dimensional assumptions

- Geometry comes from `layout.js` and `stairs.js`, in metres: ground/first/second datums 0/4.2/8.4 m, front +Z. The PDF is not an installation drawing.
- **G-14/G-15 follow the corrected side-wall ground doors**, at `x = ±20, z = −6.8 m`; the PDF diagram put these at the rear. Returning to the diagram's rear position would disconnect the signs and discharge from the corrected floor landings. Both side paths remain continuous to the front paving edge in the modeled site.
- **G-13 follows the conventional door at x = 2.65, z = 11 m**, avoiding the revolving entrance as the assigned exit. Entrance suitability and hardware still require verification.
- Other room-side signs follow the actual recorded door positions. Front-gallery/atrium paths use the two side galleries at `x = ±4 m`, never the open central void. Service exits serve their own rooms only.
- Candidate sign centers are generally 2.65 m above each floor, with approximately 1.04 × 0.37 m cases, below the 3.1 m ceiling. Directional boards have suspension rods; entrance cabinets have small wall brackets projecting into the corridor above walking space. The dimensions, green/white palette, EXIT lettering and plain directional arrows are visual modeling choices, not specified/listed products or verified visibility distances. Stair pictogram centers match the EXIT-sign height of 2.65 m; these are conceptual identification boards, not a complete accessibility/tactile-sign package.
- Stair descent uses the existing tread elevations, floor landings and rear half-landings. No evacuation route goes upward to the maintenance roof. No basement is modeled.
- Outdoor paths use centerlines around `x = ±21.05 m`. Dedicated rear-service exits first join the clear rear strip at `z = −14.5 m`, outside the modeled external chases, then follow the side paths. The east rear-service leg briefly uses `x = 21.65 m` until `z = −6 m` to pass outside the modeled open Stair B door leaf, then returns to the side path. No new landscaping or door movement is required.
- Route overlays float just above walking surfaces and may draw through opaque objects for inspection. They are diagrams, not physical floor markings or a fire/smoke simulation. Traces begin at doorways; room-internal paths from the most remote occupant/furniture are not calculated.

## Verification and remaining design work

Automated geometry checks cover the 57 IDs and per-floor counts, orientation of printed chevrons, actual door alignment, room-to-stair walking segments against walls/furniture/posts, continuous descent over modeled tread/landing surfaces, clear side-path centerlines, and hidden-group picking behavior. Existing architecture, stair, layout and telemetry regression tests are retained. Chrome checks exercise the schedule selector, all three sign plans, traced room/plant routes, lift exclusion, fullscreen controls, telemetry and project switching, and capture views in `test-results/egress-*.png`.

These checks test the digital model; they do not establish compliant widths, egress capacity, safe travel distances, adequate number/remoteness of exits, fire resistance, door swing/locking/closer operation or tenability. The source PDF leaves those items open. It names **NFPA 101** as its basis, with adopted edition/local amendments and authority review still unknown; see the [official NFPA 101 overview](https://www.nfpa.org/codes-and-standards/all-codes-and-standards/101). This work does not claim a review of the complete adopted code.

Before installation, coordinate the surveyed site/public-way connection, approved atrium/fire strategy, stair/door suitability, accessible evacuation and any assistance/refuge requirements. Complete a sightline review from all occupied areas, both corridor approaches and open/closed door conditions; add rated-distance repeaters as required. Select approved/listed sign products, local language/pictograms/chevrons and mounting details. Emergency supply, route lighting, electrical circuits, functional tests and maintenance records remain separate design/commissioning tasks; the modeled luminous faces are not powered emergency equipment and have no BMS or IoT binding.

## Overlap correction and PDF position audit

The crossed three-board clusters at positions 01/02 and 09/10 on all three floors were replaced by **one angled cabinet per position**, with lettering on its two parallel sides. Back-face chevrons reverse left/right so both approaches point toward the same actual exit. Cabinet support offsets at stair doors keep the board clear of the enclosing wall. All 57 schedule anchors and IDs are retained; no PDF position was deleted or merged with a nearby decision sign.

The PDF plans (pages 2–4) and schedule (pages 8–9) were checked again against corridor, gallery and actual door locations. An independent test table records the corresponding floor-plan regions for every scheduled position. G-14/G-15 still use the corrected side-wall ground discharge doors, and G-13 remains above the conventional entrance beside the revolving door, as documented above. Tests additionally enforce one cabinet per position, opposite parallel lettering faces, clear cabinet separation and consistent exit direction.

## Stair descent pictograms

The six existing stair/floor identification positions (`EGRESS-STAIR-A-0…2` and `EGRESS-STAIR-B-0…2`) now use code-drawn running-person/exit pictograms in the same green/white palette as the EXIT boards. Each occupied floor in both stairs has one 1.10 × 0.62 m cabinet on the inside front enclosure wall, centered 2.65 m above its floor to match the EXIT signs. This upgrades the existing position rather than stacking another sign over it; the 57 PDF schedule positions remain unchanged.

First- and second-floor boards show descending stairs, a down-left arrow and **EXIT · DOWN TO GROUND**, with stair and floor identification. Viewed toward this wall, left on the board corresponds to world +X: the existing right-hand flight is the next descending flight in both stair cores. Ground boards omit the descent symbol and direct occupants toward the actual outer-wall door: **right on the Stair A board**, **left on the Stair B board**, followed by the existing exterior-discharge and outdoor guidance. No sign instructs occupants to descend below ground or climb toward the maintenance roof.

The sign selector includes a separate **Stair directions · each occupied floor** section. These signs obey Exit signs visibility and floor isolation, and remain individually selectable. The source image is a visual reference only; the displayed artwork is generated from canvas paths/text, not the low-resolution attachment. The pictograms are conceptual graphics rather than a claimed certified sign product. Tests check all six locations, arrow direction against the actual flights/ground doors, visibility from the arriving flight and absence of overlapping cabinets. Browser captures include each 3D landing sign and its 1024 × 576 face under `test-results/stair-pictogram-*.png`.
