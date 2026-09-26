function r() {
  throw new Error('fixture override crash');
}
export { r as default };
