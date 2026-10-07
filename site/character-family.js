// Native atlas coordinates. Every complete pose shares one scale and ground anchor.
export const CHARACTER_GEOMETRY = { height: 454, width: 188, actorWidth: 242 };
const sheets = {
  "core": "/images/alex-rivkin-family-core.png",
  "climb": "/images/alex-rivkin-family-climb-v6.png",
  "walk-front": "/images/alex-rivkin-family-walk-front.png",
  "walk-back": "/images/alex-rivkin-family-walk-back.png"
};
const frames = {
  "idle": {"sheet": "core", "bounds": [98, 43, 188, 454], "pivot": [189.5, 497]},
  "jump": {"sheet": "core", "bounds": [424, 50, 278, 419], "pivot": [564.0, 497]},
  "climb-a": {"sheet": "climb", "bounds": [287, 61, 417, 834], "pivot": [478.5, 895], "scale": 454 / 834},
  "climb-b": {"sheet": "climb", "bounds": [834, 61, 412, 834], "pivot": [1054.5, 895], "scale": 454 / 834},
  "fishing-reach": {"sheet": "core", "bounds": [87, 556, 205, 437], "pivot": [190.5, 993]},
  "fishing-ready": {"sheet": "core", "bounds": [354, 549, 302, 444], "pivot": [565.5, 993]},
  "fishing-cast": {"sheet": "core", "bounds": [738, 574, 457, 419], "pivot": [877.0, 993]},
  "fishing-idle": {"sheet": "core", "bounds": [1196, 564, 326, 429], "pivot": [1289.5, 993]},
  "walk-front-1": {"sheet": "walk-front", "bounds": [99, 41, 186, 453], "pivot": [191.0, 494]},
  "walk-front-2": {"sheet": "walk-front", "bounds": [483, 41, 186, 454], "pivot": [574.5, 495]},
  "walk-front-3": {"sheet": "walk-front", "bounds": [866, 41, 185, 454], "pivot": [959.0, 495]},
  "walk-front-4": {"sheet": "walk-front", "bounds": [1250, 41, 186, 454], "pivot": [1342.5, 495]},
  "walk-front-5": {"sheet": "walk-front", "bounds": [99, 553, 185, 450], "pivot": [190.0, 1003]},
  "walk-front-6": {"sheet": "walk-front", "bounds": [483, 553, 184, 450], "pivot": [574.5, 1003]},
  "walk-front-7": {"sheet": "walk-front", "bounds": [867, 553, 186, 450], "pivot": [958.0, 1003]},
  "walk-front-8": {"sheet": "walk-front", "bounds": [1251, 553, 186, 450], "pivot": [1342.0, 1003]},
  "walk-back-1": {"sheet": "walk-back", "bounds": [97, 41, 190, 455], "pivot": [192.0, 496]},
  "walk-back-2": {"sheet": "walk-back", "bounds": [481, 41, 190, 454], "pivot": [575.5, 495]},
  "walk-back-3": {"sheet": "walk-back", "bounds": [865, 41, 190, 454], "pivot": [959.5, 495]},
  "walk-back-4": {"sheet": "walk-back", "bounds": [1249, 41, 190, 454], "pivot": [1343.5, 495]},
  "walk-back-5": {"sheet": "walk-back", "bounds": [97, 552, 191, 454], "pivot": [192.5, 1006]},
  "walk-back-6": {"sheet": "walk-back", "bounds": [481, 552, 190, 454], "pivot": [575.0, 1006]},
  "walk-back-7": {"sheet": "walk-back", "bounds": [864, 552, 189, 454], "pivot": [958.0, 1006]},
  "walk-back-8": {"sheet": "walk-back", "bounds": [1249, 552, 190, 454], "pivot": [1343.5, 1006]}
};

export function setCharacterFrame(element, pose) {
  const frame = frames[pose];
  if (!element || !frame || element.dataset.characterPose === pose && element.dataset.characterReady) return;
  const [x, y, width, height] = frame.bounds;
  const [pivotX, pivotY] = frame.pivot;
  element.style.setProperty('--frame-scale', String(frame.scale ?? 1));
  for (const [name, value] of Object.entries({
    x, y, width, height, left: x - pivotX, top: y - pivotY,
  })) element.style.setProperty(`--frame-${name}`, String(value));
  element.style.backgroundImage = `url("${sheets[frame.sheet]}")`;
  element.dataset.characterPose = pose;
  element.dataset.characterReady = 'true';
}

export function initCharacterFrames() {
  for (const element of document.querySelectorAll('.character-frame[data-character-pose]')) {
    setCharacterFrame(element, element.dataset.characterPose);
  }
}

export function characterPoint(pose, x, y) {
  const frame = frames[pose];
  const [pivotX, pivotY] = frame.pivot;
  const scale = frame.scale ?? 1;
  return {
    x: CHARACTER_GEOMETRY.actorWidth / 2 + (x - pivotX) * scale,
    y: CHARACTER_GEOMETRY.height + (y - pivotY) * scale,
  };
}
