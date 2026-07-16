// App version for display (HUD, pause menu). __APP_VERSION__ is a compile-time
// constant injected by Vite's `define` from package.json (see vite.config.js);
// the typeof guard keeps this module importable outside Vite, e.g. plain-Node
// tests, where it falls back to 'dev'.
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
