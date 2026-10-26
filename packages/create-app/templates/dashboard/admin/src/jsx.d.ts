// The dashboard uses these platform tags beyond Forma's minimal JSX catalogue.
// Keep this augmentation local to the app; it adds no runtime dependency.
export {};
declare global {
  namespace JSX {
    interface IntrinsicElements {
      kbd: HTMLAttributes;
      linearGradient: SVGAttributes;
      stop: SVGAttributes & { offset?: string; 'stop-color'?: string; 'stop-opacity'?: string };
    }
  }
}
