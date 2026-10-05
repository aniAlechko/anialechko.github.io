const GRID_SIZE = 48;
const GRID_LAST = GRID_SIZE - 1;
const INITIAL_ANGLE = 65 * Math.PI / 180;
const INITIAL_COS = Math.cos(INITIAL_ANGLE);
const INITIAL_SIN = Math.sin(INITIAL_ANGLE);
const TURN_COS = new Float64Array(5);
const TURN_SIN = new Float64Array(5);

for (let i = 0; i < 5; i++) {
  const angle = (i + 1) * Math.PI * 2 / 5;
  TURN_COS[i] = Math.cos(angle);
  TURN_SIN[i] = Math.sin(angle);
}

export function createWaterField() {
  const offsets = new Float32Array(GRID_SIZE * GRID_SIZE * 2);
  let gridScaleX = GRID_LAST;
  let gridScaleY = GRID_LAST;

  function update(width, height, timeSeconds, pointerX, pointerY) {
    width = Math.max(1, width);
    height = Math.max(1, height);
    gridScaleX = GRID_LAST / width;
    gridScaleY = GRID_LAST / height;
    const aspect = width / height;
    const centerX = .5 + .6 * (pointerX - .5);
    const centerY = .5 + .6 * (pointerY - .5);
    const drift = timeSeconds * .0384;
    const phase = timeSeconds * .1875;
    let offset = 0;

    for (let row = 0; row < GRID_SIZE; row++) {
      const v = row / GRID_LAST;
      const y = v * height;
      const originalY = v - centerY;
      for (let column = 0; column < GRID_SIZE; column++) {
        const u = column / GRID_LAST;
        const x = u * width;
        const originalX = (u - centerX) * aspect;
        let qx = INITIAL_COS * originalX - INITIAL_SIN * originalY;
        let qy = INITIAL_SIN * originalX + INITIAL_COS * originalY + drift;

        for (let i = 0; i < 5; i++) {
          const rotatedX = TURN_COS[i] * qx - TURN_SIN[i] * qy;
          qy = TURN_SIN[i] * qx + TURN_COS[i] * qy;
          qx = rotatedX;
          const frequency = 2.5 * (i + 1);
          qx += .094 * Math.cos(frequency * qy + phase);
          qy += .094 * Math.sin(frequency * qx + phase);
        }

        // Remove drift in the rotated coordinates before the inverse rotation.
        qy -= drift;
        const resultX = INITIAL_COS * qx + INITIAL_SIN * qy;
        const resultY = -INITIAL_SIN * qx + INITIAL_COS * qy;
        const edgeDistance = Math.min(x, width - x, y, height - y);
        const edge = Math.max(0, Math.min(1, edgeDistance / 48));
        const fade = edge * edge * (3 - 2 * edge);
        offsets[offset++] = (resultX - originalX) / aspect * width * .13 * fade;
        offsets[offset++] = (resultY - originalY) * height * .13 * fade;
      }
    }
  }

  function sample(x, y, out) {
    const gx = Math.max(0, Math.min(GRID_LAST, x * gridScaleX));
    const gy = Math.max(0, Math.min(GRID_LAST, y * gridScaleY));
    const column = Math.floor(gx);
    const row = Math.floor(gy);
    const fx = gx - column;
    const fy = gy - row;
    const topLeft = (row * GRID_SIZE + column) * 2;
    const topRight = topLeft + (column < GRID_LAST ? 2 : 0);
    const bottomLeft = topLeft + (row < GRID_LAST ? GRID_SIZE * 2 : 0);
    const bottomRight = bottomLeft + (column < GRID_LAST ? 2 : 0);

    for (let axis = 0; axis < 2; axis++) {
      const top = offsets[topLeft + axis] * (1 - fx) + offsets[topRight + axis] * fx;
      const bottom = offsets[bottomLeft + axis] * (1 - fx) + offsets[bottomRight + axis] * fx;
      out[axis] = top * (1 - fy) + bottom * fy;
    }
    return out;
  }

  return { update, sample };
}
