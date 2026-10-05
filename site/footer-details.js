export function initFooterDetails() {
  const clock = document.querySelector('#contact-local-time');
  if (!clock) return { cleanup() {} };
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  let timer;
  let disposed = false;

  function refresh() {
    clearTimeout(timer);
    if (disposed || document.hidden) return;
    const now = new Date();
    clock.textContent = formatter.format(now);
    clock.dateTime = now.toISOString();
    timer = setTimeout(refresh, 60000 - now.getTime() % 60000 + 20);
  }

  document.addEventListener('visibilitychange', refresh);
  refresh();

  return {
    cleanup() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
    },
  };
}
