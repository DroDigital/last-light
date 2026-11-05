import { describe, expect, it } from 'vitest';
import { Build } from '../src/game/build';
import { World } from '../src/game/world';
import { HULLS } from '../src/data/world';
import { STARTER_WEAPONS } from '../src/meta/save';
import { emptyControls } from '../src/game/player';
import { updateWeapons } from '../src/game/weapons';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(STARTER_WEAPONS), tier2: true, heat: 0 });

describe('side-mounted weapon effects', () => {
  it('uses each side’s own status parameters and color for alternating primary shots', () => {
    const build = new Build(HULLS[0]!, meta());
    build.effects.port[0] = 'ember';
    build.effects.starboard[0] = 'frost';
    const world = new World('SIDES', build);
    world.refreshParams();
    const controls = emptyControls();
    controls.fire1 = true;
    const shots: number[] = [];
    world.events.on('shot', (shot) => shots.push(shot.side));
    for (let i = 0; i < 30; i++) world.update(controls, 1 / 60);
    expect(shots).toContain(-1);
    expect(shots).toContain(1);
    const port = world.sideSrc('port');
    const starboard = world.sideSrc('starboard');
    expect(world.params[port]!.burn).toBeGreaterThan(build.primary.params.burn);
    expect(world.params[starboard]!.cryo).toBeGreaterThan(build.primary.params.cryo);
    expect(world.colorOf(port)).not.toEqual(world.colorOf(starboard));
    expect(Array.from(world.proj.src.slice(0, world.proj.n))).toContain(port);
    expect(Array.from(world.proj.src.slice(0, world.proj.n))).toContain(starboard);
  });

  it.each(['lance', 'arc', 'railgun'])('%s applies the firing side to hitscan damage', (weapon) => {
    const build = new Build(HULLS[0]!, meta(), weapon);
    build.effects.port[0] = 'ember';
    build.effects.starboard[0] = 'frost';
    const world = new World('HITS-' + weapon, build);
    world.player.pos.set(0, 0, 0);
    const target = world.spawnEnemy('scrapper', 0, 0, -40);
    target.hp = target.maxHp = 1e8;
    target.radius = 8;
    target.spawnT = 0;
    const sources = new Set<number>();
    world.events.on('hit', () => sources.add(target.lastSrc));
    const controls = emptyControls();
    controls.fire1 = true;
    for (let i = 0; i < 180; i++) updateWeapons(world, controls, 1 / 60);
    expect(sources).toContain(world.sideSrc('port'));
    expect(sources).toContain(world.sideSrc('starboard'));
  });

  it.each(['lance', 'railgun'])('Prism Echo increases %s direct damage', (weapon) => {
    const shotDamage = (prism: boolean) => {
      const build = new Build(HULLS[0]!, meta(), weapon);
      if (prism) build.effects.port[0] = 'prism';
      const world = new World('PRISM', build);
      world.player.pos.set(0, 0, 0);
      const target = world.spawnEnemy('scrapper', 0, 0, -40);
      target.hp = target.maxHp = 1e6;
      target.radius = 8;
      target.armor = 0;
      const controls = emptyControls();
      controls.fire1 = true;
      updateWeapons(world, controls, 1 / 60);
      return target.maxHp - target.hp;
    };
    expect(shotDamage(true)).toBeGreaterThan(shotDamage(false));
  });
});
