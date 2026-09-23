/**
 * Category normalization helpers — case-insensitive + whitespace-collapsed identity.
 *
 * Requirement: same logical category must not produce separate groups due to
 * capitalization / whitespace differences.
 *
 * Example variants that resolve to same key:
 *  "Stock Market Basic to Advance"
 *  "Stock Market Basic To Advance"
 *  "stock market basic to advance"
 *  " Stock Market Basic to Advance "
 */

export function normalizeCategoryKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeCategoryDisplay(name: string): string {
  const collapsed = name.trim().replace(/\s+/g, ' ');
  return collapsed || 'General';
}

/**
 * Build a merged grouping: items with same normalizeCategoryKey share one group.
 * Display name = most-frequent original canonical variant within that key
 * (or first-seen if tie). This keeps UI human-readable without lowercasing.
 */
export function groupByCategoryMerged(items: any[]): { category: string; items: any[] }[] {
  const keyToGroup: Map<string, { display: string; items: any[]; displayCounts: Map<string, number> }> = new Map();

  for (const item of items) {
    const raw: string = (item.category_name ?? 'General') as string;
    const display = normalizeCategoryDisplay(raw);
    const key = normalizeCategoryKey(display);

    if (!keyToGroup.has(key)) {
      keyToGroup.set(key, { display, items: [item], displayCounts: new Map([[display, 1]]) });
    } else {
      const g = keyToGroup.get(key)!;
      g.items.push(item);
      g.displayCounts.set(display, (g.displayCounts.get(display) ?? 0) + 1);
      // If another display variant is now more frequent, promote it as canonical display
      const currentBest = g.display;
      const currentCount = g.displayCounts.get(currentBest) ?? 0;
      const thisCount = g.displayCounts.get(display) ?? 0;
      if (thisCount > currentCount) {
        g.display = display;
      }
    }
  }

  // Preserve DB order (category_sort_order) — insertion order = DB order
  const result = Array.from(keyToGroup.values()).map((g) => ({
    category: g.display,
    items: g.items,
  }));
  return result;
}

/**
 * Given a desired raw category name and the set of existing category display names
 * within a SINGLE batch, resolve the canonical stored name.
 * If a case-insensitive / whitespace-normalized match exists, reuse that existing
 * display; otherwise use the normalized display of the desired input.
 */
export function resolveCanonicalCategoryName(
  desiredRaw: string | undefined | null,
  existingCategories: string[],
): string {
  const displayDesired = normalizeCategoryDisplay(desiredRaw ?? 'General');
  if (!displayDesired) return 'General';
  const keyDesired = normalizeCategoryKey(displayDesired);

  // Build key -> most frequent display among existing
  const keyToDisplayCounts: Map<string, Map<string, number>> = new Map();
  const keyToBestDisplay: Map<string, string> = new Map();
  for (const raw of existingCategories) {
    const d = normalizeCategoryDisplay(raw);
    const k = normalizeCategoryKey(d);
    if (!keyToDisplayCounts.has(k)) keyToDisplayCounts.set(k, new Map());
    const m = keyToDisplayCounts.get(k)!;
    m.set(d, (m.get(d) ?? 0) + 1);
  }
  for (const [k, m] of keyToDisplayCounts) {
    let best = '';
    let bestCnt = -1;
    for (const [disp, cnt] of m) {
      if (cnt > bestCnt) {
        best = disp;
        bestCnt = cnt;
      }
    }
    keyToBestDisplay.set(k, best);
  }

  if (keyToBestDisplay.has(keyDesired)) {
    return keyToBestDisplay.get(keyDesired)!;
  }
  return displayDesired;
}

/**
 * For a bulk fetch of rows with batch_id + category_name, build a map:
 * batchId -> (normalizedKey -> canonicalDisplay)
 */
export function buildBatchCanonicalMap(
  rows: { batch_id: string; category_name: string | null }[],
): Map<string, Map<string, string>> {
  const perBatchRaw: Map<string, string[]> = new Map();
  for (const r of rows) {
    const batchId = (r as any).batch_id as string;
    const cat = (r as any).category_name as string | null;
    if (!perBatchRaw.has(batchId)) perBatchRaw.set(batchId, []);
    perBatchRaw.get(batchId)!.push(cat ?? 'General');
  }

  const result: Map<string, Map<string, string>> = new Map();
  for (const [batchId, cats] of perBatchRaw) {
    const keyToCounts: Map<string, Map<string, number>> = new Map();
    for (const raw of cats) {
      const d = normalizeCategoryDisplay(raw);
      const k = normalizeCategoryKey(d);
      if (!keyToCounts.has(k)) keyToCounts.set(k, new Map());
      const m = keyToCounts.get(k)!;
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    const keyToBest: Map<string, string> = new Map();
    for (const [k, m] of keyToCounts) {
      let best = '';
      let bestCnt = -1;
      for (const [disp, cnt] of m) {
        if (cnt > bestCnt) {
          best = disp;
          bestCnt = cnt;
        }
      }
      keyToBest.set(k, best);
    }
    result.set(batchId, keyToBest);
  }
  return result;
}
