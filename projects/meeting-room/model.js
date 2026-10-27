/* Original meeting-room model, preserved as a selectable project. */
export function buildMeetingRoom({
  box,
  slab,
  stool,
  v,
  roomOn,
  alarmOn,
  sensorPosition,
}) {
  if (roomOn) {
    slab(0, 0, 11.2, 8.2, "#30485c");
    for (let i = -5.6; i <= 5.7; i += 0.8) slab(i, 0, 0.035, 8.22, "#2a4153");
    for (let i = -4.1; i <= 4.2; i += 0.8) slab(0, i, 11.25, 0.03, "#2a4153");
    box(0, 0, -4.13, 11.3, 3.72, 0.12, "#35546a");
    box(-5.67, 0, 0, 0.12, 3.72, 8.18, "#2e485f");
    // accent wall, linear architectural details
    box(0, 0, -4.04, 10.9, 0.12, 0.07, "#5b8791");
    box(0, 3.38, -4.05, 11.15, 0.045, 0.08, "#71919e");
    box(-5.59, 3.35, 0, 0.08, 0.05, 8.1, "#587489");
    // back wall acoustic panels
    for (let x = -5.05; x <= 4.6; x += 0.65)
      box(
        x,
        0.3,
        -4.018,
        0.51,
        2.8,
        0.045,
        Math.abs(x) < 2 ? "#35586c" : "#3e6471",
      );
    // wall mounted meeting screen (decorative)
    box(0.55, 1.15, -3.93, 3.25, 1.67, 0.1, "#0b1825");
    box(0.55, 1.25, -3.82, 3.03, 1.45, 0.032, "#1b4254");
    box(0.55, 1.62, -3.785, 2.56, 0.018, 0.015, "#4b918f");
    box(0.55, 1.42, -3.784, 1.89, 0.013, 0.018, "#4b918f");
    // presentation shelf
    box(0.55, 0.62, -3.77, 2.2, 0.1, 0.31, "#284558");
    // windows left and back, using blue 'glazing'
    box(3.92, 1.2, -3.975, 2.16, 1.66, 0.06, "#142d3e");
    box(3.92, 1.32, -3.926, 1.89, 1.38, 0.02, "#5c97aa");
    box(3.92, 1.32, -3.899, 0.035, 1.38, 0.013, "#c1d6e1");
    box(3.92, 2.02, -3.892, 1.9, 0.03, 0.018, "#c1d6e1");
    // left wall door
    box(-5.51, 0.02, 2.36, 0.095, 2.75, 1.34, "#153145");
    box(-5.42, 0.17, 2.34, 0.045, 2.37, 1.08, "#507383");
    box(-5.36, 1.25, 2.78, 0.065, 0.09, 0.13, "#d7c294");
    // alarm beacon / FACP model near left wall
    box(-5.32, 1.28, 1.05, 0.17, 0.63, 0.49, "#b04455");
    box(-5.17, 1.51, 1.05, 0.08, 0.24, 0.34, "#482b38");
    // floating sensors / ceiling fixtures
    box(-0.3, 3.27, -0.5, 0.56, 0.1, 0.56, "#dee1d1"); // detector model
    box(2.75, 3.38, 0.2, 1.6, 0.095, 0.56, "#607d8b"); // HVAC grille
    for (let n = 0; n < 5; n++)
      box(2.1 + n * 0.26, 3.47, 0.2, 0.05, 0.018, 0.47, "#243f53");
  }
  // table shadows and base
  slab(0, 0.29, 5.25, 2.45, "#1a3243");
  box(0, 0.42, 0.25, 4.78, 0.2, 1.88, "#aa8970");
  box(0, 0.29, 0.25, 4.42, 0.15, 1.65, "#6c5c53");
  for (const x of [-1.68, 1.68])
    for (const z of [-0.37, 0.9]) box(x, 0.06, z, 0.18, 0.32, 0.19, "#6c8187");
  // desk meeting items
  box(-0.92, 0.64, 0.15, 0.57, 0.025, 0.38, "#1b3647");
  box(-0.93, 0.66, 0.15, 0.5, 0.012, 0.32, "#537f8e");
  box(1.34, 0.64, 0.65, 0.45, 0.02, 0.32, "#d9ccb1");
  box(1.34, 0.665, 0.65, 0.34, 0.004, 0.18, "#a4c2c9");
  // onboard MXCHIP node represented by cyan board on the table
  const sensor = sensorPosition();
  box(sensor.x, sensor.y - 0.11, sensor.z, 0.39, 0.1, 0.25, "#25696e");
  box(sensor.x, sensor.y, sensor.z, 0.22, 0.02, 0.15, "#74d3bd");
  box(
    sensor.x,
    sensor.y + 0.035,
    sensor.z,
    0.04,
    0.015,
    0.06,
    alarmOn === null ? "#9dabb6" : alarmOn ? "#ff475b" : "#58edc7",
  );
  // chairs with orientations angled toward the table
  for (let x of [-1.55, 0, 1.55]) {
    stool(x, -1.41, Math.PI);
    stool(x, 1.94, 0);
  }
  stool(-3.03, 0.26, -Math.PI / 2);
  stool(3.04, 0.26, Math.PI / 2);
  // credenza at right
  box(4.15, 0.08, 1.5, 1.23, 0.69, 1.5, "#546676");
  box(4.15, 0.8, 1.5, 1.34, 0.08, 1.6, "#81949b");
  // greenery on right rear
  box(4.42, 0.14, -2.34, 0.46, 0.45, 0.46, "#847c68");
  box(4.42, 0.58, -2.34, 0.3, 0.49, 0.3, "#39756b");
  box(4.15, 0.79, -2.34, 0.43, 0.13, 0.24, "#4c887a");
  box(4.69, 0.91, -2.34, 0.43, 0.13, 0.24, "#4e867a");
  // alarm status beacon; purely visual cue, based on input register
  box(-4.63, 2.72, 1.05, 0.34, 0.29, 0.34, alarmOn ? "#ff3f60" : "#608ca0");
  box(-4.63, 2.99, 1.05, 0.24, 0.05, 0.24, alarmOn ? "#ffe09c" : "#9eabb4");
  if (alarmOn === true) {
    for (let a = 0; a < 3; a++) {
      const spread = a * 0.21;
      slab(
        -4.6,
        1.05,
        1.0 + spread,
        1.0 + spread,
        a % 2 ? "#833c4c" : "#653548",
      );
    }
  }
}
