import { describe, it, expect } from "vitest";
import {
  xpRequiredForLevel,
  getLevelFromTotalXp,
  getProgressToNextLevel,
} from "./gamification";

describe("gamification", () => {
  describe("xpRequiredForLevel", () => {
    it("requires 80 XP from level 1 to level 2", () => {
      expect(xpRequiredForLevel(1)).toBe(80);
    });

    it("requires ~197 XP from level 2 to level 3", () => {
      expect(xpRequiredForLevel(2)).toBe(197);
    });

    it("requires ~334 XP from level 3 to level 4", () => {
      expect(xpRequiredForLevel(3)).toBe(Math.round(80 * Math.pow(3, 1.3)));
    });

    it("requires ~648 XP from level 5 to level 6", () => {
      expect(xpRequiredForLevel(5)).toBe(Math.round(80 * Math.pow(5, 1.3)));
    });

    it("requires ~1596 XP from level 10 to level 11", () => {
      expect(xpRequiredForLevel(10)).toBe(1596);
    });

    it("scales infinitely", () => {
      const level50 = xpRequiredForLevel(50);
      expect(level50).toBeGreaterThan(xpRequiredForLevel(49));
    });
  });

  describe("getLevelFromTotalXp", () => {
    it("returns level 1 with 0 XP", () => {
      expect(getLevelFromTotalXp(0)).toBe(1);
    });

    it("returns level 1 with 79 XP", () => {
      expect(getLevelFromTotalXp(79)).toBe(1);
    });

    it("returns level 2 with exactly 80 XP", () => {
      expect(getLevelFromTotalXp(80)).toBe(2);
    });

    it("returns level 2 with 100 XP", () => {
      expect(getLevelFromTotalXp(100)).toBe(2);
    });

    it("returns level 3 with 277 XP (80 + 197)", () => {
      expect(getLevelFromTotalXp(277)).toBe(3);
    });

    it("returns level 4 with 611 XP (80 + 197 + 334)", () => {
      expect(getLevelFromTotalXp(611)).toBe(4);
    });

    it("handles very large XP values", () => {
      const level = getLevelFromTotalXp(100000);
      expect(level).toBeGreaterThan(10);
    });
  });

  describe("getProgressToNextLevel", () => {
    it("returns correct progress at 0 XP", () => {
      const result = getProgressToNextLevel(0);
      expect(result.level).toBe(1);
      expect(result.currentLevelXp).toBe(0);
      expect(result.xpForNextLevel).toBe(80);
      expect(result.progressPercent).toBe(0);
    });

    it("returns correct progress at 40 XP (50% to level 2)", () => {
      const result = getProgressToNextLevel(40);
      expect(result.level).toBe(1);
      expect(result.currentLevelXp).toBe(40);
      expect(result.xpForNextLevel).toBe(80);
      expect(result.progressPercent).toBe(50);
    });

    it("returns correct progress at exactly 80 XP (level 2, 0% to level 3)", () => {
      const result = getProgressToNextLevel(80);
      expect(result.level).toBe(2);
      expect(result.currentLevelXp).toBe(0);
      expect(result.xpForNextLevel).toBe(197);
      expect(result.progressPercent).toBe(0);
    });

    it("returns correct progress at 150 XP (level 2, partway to level 3)", () => {
      const result = getProgressToNextLevel(150);
      expect(result.level).toBe(2);
      expect(result.currentLevelXp).toBe(70);
      expect(result.xpForNextLevel).toBe(197);
      expect(result.progressPercent).toBe(Math.round((70 / 197) * 100));
    });
  });
});
