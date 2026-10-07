const segments = 80;
const clamp = value => Math.min(1, Math.max(0, value));

// World coordinates and gait distance share one curve, independent of scrolling.
export function createWalkingPath({ width, center, viewportHeight, distance }) {
  if (![width, center, viewportHeight, distance].every(Number.isFinite)) {
    throw new TypeError('Walking path geometry must contain finite numbers.');
  }
  if (width <= 0 || viewportHeight <= 0 || distance < viewportHeight * 1.6) {
    throw new RangeError('Walking path requires positive dimensions and distance of at least 1.6 viewport heights.');
  }

  function position(progress) {
    const wave = Math.sin(Math.PI * progress);
    return {
      x: center - width * .18 * Math.sin(2 * Math.PI * progress) * wave,
      y: distance * progress - viewportHeight * .16 * wave,
    };
  }

  let traveled = 0;
  const points = [];
  for (let index = 0; index <= segments; index++) {
    const progress = index / segments;
    const point = position(progress);
    const previous = points[index - 1];
    if (previous) traveled += Math.hypot(point.x - previous.x, point.y - previous.y);
    points.push(Object.freeze({ progress, ...point, traveled }));
  }
  Object.freeze(points);

  return {
    points,
    sample(progress) {
      if (typeof progress !== 'number' || Number.isNaN(progress)) {
        throw new TypeError('Walking path progress must be a number.');
      }
      const value = clamp(progress);
      const index = Math.min(segments - 1, Math.floor(value * segments));
      const fraction = value * segments - index;
      const first = points[index];
      const next = points[index + 1];
      return {
        ...position(value),
        traveled: first.traveled + (next.traveled - first.traveled) * fraction,
      };
    },
    pathData() {
      return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    },
  };
}
