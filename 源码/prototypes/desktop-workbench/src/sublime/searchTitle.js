// Split literal matches for React's text renderer. Overlapping terms share one mark.
export function titleMatchParts(title, query) {
  const terms = [
    ...new Set(
      String(query || '')
        .trim()
        .split(/\s+/u)
        .filter(Boolean),
    ),
  ];
  const ranges = terms
    .flatMap((term) => Array.from(title.matchAll(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')), (m) => [m.index, m.index + m[0].length]))
    .sort((a, b) => a[0] - b[0]);
  if (!ranges.length) return null;
  const spans = [];
  for (const [a, b] of ranges) {
    const prior = spans.at(-1);
    if (prior && prior[1] >= a) prior[1] = Math.max(prior[1], b);
    else spans.push([a, b]);
  }
  const parts = [];
  let end = 0;
  for (const [a, b] of spans) {
    if (end < a) parts.push([title.slice(end, a), false]);
    parts.push([title.slice(a, b), true]);
    end = b;
  }
  if (end < title.length) parts.push([title.slice(end), false]);
  return parts;
}
