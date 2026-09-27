// An override that is broken on purpose (S05).
export default function Throws(): never {
  throw new Error('fixture override crash');
}
