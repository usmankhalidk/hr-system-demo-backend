import '@testing-library/jest-dom';

// Silence missing CSS vars warnings in jsdom
Object.defineProperty(window, 'CSS', { value: { supports: () => false } });

// navigator.onLine default = true in jsdom
Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });

// localStorage / sessionStorage are already provided by jsdom
