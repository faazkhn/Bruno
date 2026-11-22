const STOP = new Set(
  'a an the about my me i we you our your it its this that these those is are was were be been am to of for on in at by from with and or not no as can could would please hi hello thanks thank any some have has had do does did will just so if but'.split(' '),
);

/** Lower-case word tokens (a–z, 0–9, ≥ 2 chars), stop words removed, unique, in order of first appearance. */
export function tokenize(s: string): string[] {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 2 && !STOP.has(w)) out.add(w);
  return [...out];
}

/** Tokens present in at least `minShare` of the items (learn split only — never the holdout). */
export function vocabulary(items: Iterable<Set<string>>, minShare = 0.01): Set<string> {
  const counts = new Map<string, number>();
  let n = 0;
  for (const t of items) {
    n++;
    for (const w of t) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, c]) => c >= minShare * n).map(([w]) => w).sort());
}
