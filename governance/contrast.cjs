async function scanContrast(page) {
  return page.evaluate(async () => {
    // Measure settled colors, excluding infinite decorative animations.
    const finite = document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.all(finite.map((animation) => animation.finished.catch(() => {})));
    const rgb = (text) => {
      const v = text.match(/[\d.]+/g)?.map(Number);
      if (!v || v.length < 3) return null;
      // color-mix(in srgb, ...) computes to normalized color(srgb ...) values.
      const scale = /^color\(srgb\s/.test(text) ? 255 : 1;
      return [v[0] * scale, v[1] * scale, v[2] * scale, v[3] ?? 1];
    };
    const over = (a, b) => a.slice(0, 3).map((x, i) => x * a[3] + b[i] * (1 - a[3]));
    const light = (c) =>
      c
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const results = [];
    for (const el of document.querySelectorAll('.sublime-workspace *')) {
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('')
        .trim();
      if (!text || el.closest('[aria-hidden="true"],svg,[disabled],.se-sr-only,.sp-sr-only')) continue;
      const rect = el.getBoundingClientRect(),
        style = getComputedStyle(el);
      if (
        !rect.width ||
        !rect.height ||
        rect.bottom <= 0 ||
        rect.top >= innerHeight ||
        rect.right <= 0 ||
        rect.left >= innerWidth ||
        style.visibility !== 'visible'
      )
        continue;
      const chain = [];
      for (let p = el; p; p = p.parentElement) chain.unshift(p);
      let bg = [17, 17, 17],
        opacity = 1;
      for (const p of chain) {
        const s = getComputedStyle(p),
          color = rgb(s.backgroundColor);
        if (color && p !== el) bg = over(color, bg);
        opacity *= Number(s.opacity);
      }
      const local = rgb(style.backgroundColor);
      if (local) bg = over(local, bg);
      const fg = rgb(style.color);
      if (!fg || opacity <= 0.001) continue;
      fg[3] *= opacity;
      const seen = over(fg, bg),
        a = light(seen),
        b = light(bg),
        ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      results.push({ text: text.slice(0, 50), ratio: Math.round(ratio * 100) / 100, color: style.color, background: bg.map(Math.round) });
    }
    return { checked: results.length, lowest: Math.min(...results.map((x) => x.ratio)), failures: results.filter((x) => x.ratio < 4.5) };
  });
}
module.exports = { scanContrast };
