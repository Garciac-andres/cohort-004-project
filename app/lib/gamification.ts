export function xpRequiredForLevel(level: number): number {
  return Math.round(80 * Math.pow(level, 1.3));
}

export function getLevelFromTotalXp(totalXp: number): number {
  let level = 1;
  let cumulativeXp = 0;

  while (true) {
    const needed = xpRequiredForLevel(level);
    if (cumulativeXp + needed > totalXp) break;
    cumulativeXp += needed;
    level++;
  }

  return level;
}

export function getProgressToNextLevel(totalXp: number): {
  level: number;
  currentLevelXp: number;
  xpForNextLevel: number;
  progressPercent: number;
} {
  let level = 1;
  let cumulativeXp = 0;

  while (true) {
    const needed = xpRequiredForLevel(level);
    if (cumulativeXp + needed > totalXp) {
      const currentLevelXp = totalXp - cumulativeXp;
      return {
        level,
        currentLevelXp,
        xpForNextLevel: needed,
        progressPercent: Math.round((currentLevelXp / needed) * 100),
      };
    }
    cumulativeXp += needed;
    level++;
  }
}
