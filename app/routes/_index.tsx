import { redirect } from 'react-router';

export function loader() {
  return redirect('/login'); // Phase 1 implements /login; until then this falls through to error.tsx
}

export default function Index() {
  return null;
}
