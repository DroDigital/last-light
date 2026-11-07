import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LightRig } from '../src/render/pipeline';
import { Space } from '../src/render/space';
import { paletteById } from '../src/data/palettes';

describe('sector restoration', () => {
  it('smoothly brightens the star toward restored power without overshooting', () => {
    const space = new Space(new LightRig(), 100);
    space.starPower = 0.25;
    space.applyStarPower();
    space.build(paletteById('cradle'), 7);
    const before = space.starMat.uniforms.uPower!.value as number;
    space.setRestoration(1);
    space.update(0, new THREE.Vector3());
    space.update(1, new THREE.Vector3());
    const during = space.starMat.uniforms.uPower!.value as number;
    space.update(60, new THREE.Vector3());
    const after = space.starMat.uniforms.uPower!.value as number;
    expect(during).toBeGreaterThan(before);
    expect(during).toBeLessThan(1.25);
    expect(after).toBeCloseTo(1.25, 3);
  });

  it('does not show the restoration wave when motion is reduced', () => {
    const space = new Space(new LightRig(), 100);
    space.starPower = 0.25;
    space.applyStarPower();
    space.update(1, new THREE.Vector3());
    space.setRestoration(1, false);
    space.update(2, new THREE.Vector3());
    const landmark = space.group.children.find((child) => child.type === 'LineSegments') as THREE.LineSegments;
    const material = landmark.material as THREE.ShaderMaterial;
    expect(material.uniforms.uWave!.value).toBe(-2);
  });
});
