type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function measurement(target: object, name: string, value: number): void {
  Object.defineProperty(target, name, { configurable: true, value });
}

export function resetGeometry(width = 320, height = 240): void {
  document.body.replaceChildren();
  document.body.removeAttribute('style');
  measurement(window, 'innerWidth', width);
  measurement(window, 'innerHeight', height);
  measurement(document.documentElement, 'scrollWidth', width);
}

export function rectangle(element: Element, box: Box): void {
  const rect: DOMRect = {
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => ({ ...box }),
  };
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  });
}

export function addBox(
  tag: string,
  box: Box,
  parent: Element = document.body,
): HTMLElement {
  const element = document.createElement(tag);
  rectangle(element, box);
  parent.appendChild(element);
  return element;
}

export function overhang(
  pixels: number,
  parent: Element = document.body,
): HTMLElement {
  return addBox('div', { left: 300 + pixels, top: 0, width: 20, height: 10 }, parent);
}
