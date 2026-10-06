export function initGardenRabbits(garden) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const rabbits = [...garden.querySelectorAll('.garden-rabbit')].map((element, index) => ({
    element,
    sprite: element.querySelector('.garden-rabbit-sprite'),
    side: index % 2 ? -1 : 1,
    direction: index % 2 ? -1 : 1,
    x: 0,
    from: 0,
    to: 0,
    phase: 'rest',
    elapsed: 0,
    rest: index % 2 ? 1.9 : .55,
    duration: .6,
    height: .5,
    pose: -1,
  }));
  let visible = false;
  let frame = 0;
  let previousTime = 0;

  function draw(rabbit, lift, pose) {
    // Align each painted pose to the same ground line within its sprite cell.
    const baseline = [0, 0, .067, .164, .016][pose];
    rabbit.element.style.transform = `translateX(calc(${rabbit.x.toFixed(4)} * var(--rabbit-hop-distance, 64px)))`;
    rabbit.sprite.style.transform = `translateY(${((baseline - lift) * 100).toFixed(2)}%) scaleX(${rabbit.direction})`;
    if (pose !== rabbit.pose) {
      rabbit.sprite.style.backgroundPosition = `${(pose % 3) * 50}% ${pose < 3 ? 0 : 100}%`;
      rabbit.pose = pose;
    }
  }

  function advance(rabbit, dt) {
    rabbit.elapsed += dt;
    if (rabbit.phase === 'rest') {
      if (rabbit.elapsed < rabbit.rest) return;
      rabbit.from = rabbit.x;
      rabbit.to = Math.abs(rabbit.x) > .2 ? 0 : rabbit.side * (.5 + Math.random() * .28);
      rabbit.direction = Math.sign(rabbit.to - rabbit.from);
      rabbit.duration = .52 + Math.random() * .12;
      rabbit.height = .4 + Math.random() * .16;
      rabbit.phase = 'crouch';
      rabbit.elapsed = 0;
      draw(rabbit, 0, 1);
    } else if (rabbit.phase === 'crouch') {
      if (rabbit.elapsed < .14) return;
      rabbit.phase = 'hop';
      rabbit.elapsed = 0;
      draw(rabbit, 0, 2);
    } else if (rabbit.phase === 'hop') {
      const progress = Math.min(1, rabbit.elapsed / rabbit.duration);
      rabbit.x = rabbit.from + (rabbit.to - rabbit.from) * progress;
      const lift = 4 * rabbit.height * progress * (1 - progress);
      draw(rabbit, lift, progress < .24 || progress > .82 ? 2 : 3);
      if (progress === 1) {
        rabbit.phase = 'land';
        rabbit.elapsed = 0;
        draw(rabbit, 0, 4);
      }
    } else if (rabbit.elapsed >= .13) {
      rabbit.phase = 'rest';
      rabbit.elapsed = 0;
      rabbit.rest = 1.6 + Math.random() * 2.4;
      draw(rabbit, 0, 0);
    }
  }

  function tick(time) {
    frame = 0;
    if (!visible || reducedMotion.matches) return;
    const dt = previousTime ? Math.min(.05, (time - previousTime) / 1000) : 0;
    previousTime = time;
    rabbits.forEach(rabbit => advance(rabbit, dt));
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
    if (reducedMotion.matches) {
      rabbits.forEach(rabbit => {
        rabbit.phase = 'rest';
        rabbit.elapsed = 0;
        draw(rabbit, 0, 0);
      });
    } else if (visible) {
      frame = requestAnimationFrame(tick);
    }
  }

  rabbits.forEach(rabbit => draw(rabbit, 0, 0));
  reducedMotion.addEventListener('change', sync);
  return {
    setPlaying(playing) {
      if (visible === playing) return;
      visible = playing;
      sync();
    },
    cleanup() {
      visible = false;
      cancelAnimationFrame(frame);
      reducedMotion.removeEventListener('change', sync);
    },
  };
}
