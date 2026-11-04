/**
 * Global difficulty levers in one place. `scripts/balance.ts` plays complete
 * runs with bots of three skill levels against these numbers; see
 * docs/DESIGN_LOG.md "Balance pass" for the targets and measured results.
 */
export const BAL = {
  /** multiplier on every point of damage the player takes */
  enemyDamage: 1.4,
  /** extra enemy damage per sector (sector 1 = +0) */
  enemyDamagePerSector: 0.24,
  /** multiplier on enemy projectile speed */
  enemyShotSpeed: 1.7,
  /** multiplier on how far ahead aimed enemy shots lead the player */
  enemyLead: 1.6,
  /** multiplier on enemy fire cadence (higher = fires more often) */
  enemyFireRate: 1.5,
  /** seconds of grace after any hit (stops one volley landing as many hits) */
  hitGrace: 0.2,
  /** a beam can hit at most once per this many seconds */
  beamCooldown: 0.5,
  /** simultaneous attackers allowed: base + per sector */
  tokensBase: 4,
  tokensPerSector: 1,
  /** live enemy threat the director keeps on the field: base + per sector */
  liveThreatBase: 15,
  liveThreatPerSector: 5,
  /** total threat spent per encounter: base + per sector */
  budgetBase: 46,
  budgetPerSector: 26,
  /** multiplier on every regular enemy's HP */
  enemyHp: 1.35,
  /** multiplier on boss HP (core and parts) */
  bossHp: 1.3,
  /** fraction of the per-sector HP growth that bosses get */
  bossSectorHp: 0.6,
  /** multiplier on everything that hurts the player during a boss fight */
  bossDamage: 1.5,
  /** enemy HP growth per sector */
  sectorHp: 0.6,
  /** per map row within a sector: budget and HP (damage gets half) */
  perRow: 0.06,
  /** the director spawns up to this many times its baseline against a strong build */
  maxPower: 2.4,
};
