// The contextual help sheet lives in the Shell; anything (a page header, a key, an empty state)
// asks for it through this event, so ui/ never imports the app shell.
const EVT = 'vendua:help';

export const openHelp = () => window.dispatchEvent(new Event(EVT));

export function onHelp(fn: () => void) {
  window.addEventListener(EVT, fn);
  return () => window.removeEventListener(EVT, fn);
}
