import assert from "node:assert/strict";
import test from "node:test";
import { introWordmarkMotion, introWordmarkScale } from "../lib/intro-motion.ts";

test("intro scale matches the bounded responsive wordmark size", () => {
  assert.equal(introWordmarkScale(320), 54 / 17);
  assert.equal(introWordmarkScale(1280), 112 / 17);
  assert.equal(introWordmarkScale(4000), 112 / 17);
});

test("intro transform centers the frozen dock rect without animating layout", () => {
  const dock = { left: 51.2, top: 22.5, width: 52.7, height: 17 };
  const viewport = { width: 1280, height: 720 };
  const motion = introWordmarkMotion(dock, viewport);
  const transformedCenterX = dock.left + dock.width / 2 + motion.translateX;
  const transformedCenterY = dock.top + dock.height / 2 + motion.translateY;
  assert.equal(transformedCenterX, viewport.width / 2);
  assert.equal(transformedCenterY, viewport.height / 2);
  assert.match(motion.transform, /^translate3d\(.+px, .+px, 0\) scale\(.+\)$/);
});
