export type IntroDockRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type IntroViewport = {
  width: number;
  height: number;
};

export function introWordmarkScale(viewportWidth: number) {
  const introFontSize = Math.min(112, Math.max(54, viewportWidth * 0.09));
  return introFontSize / 17;
}

export function introWordmarkMotion(dockRect: IntroDockRect, viewport: IntroViewport) {
  const scale = introWordmarkScale(viewport.width);
  const dockCenterX = dockRect.left + dockRect.width / 2;
  const dockCenterY = dockRect.top + dockRect.height / 2;
  const translateX = viewport.width / 2 - dockCenterX;
  const translateY = viewport.height / 2 - dockCenterY;
  return {
    scale,
    translateX,
    translateY,
    transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`,
  };
}
