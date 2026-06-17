import { redirect } from 'react-router';

export function loader() {
  return redirect('/signup'); // Phase 1 implements /signup; until then this falls through to error.tsx
}

export default function Index() {
  return null;
}
