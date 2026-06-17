import { Outlet } from 'react-router';

// Structural layout for the signup route group (>=2 child routes; see routes.ts).
// Outlet-only: no side-effect-free shared loader read exists for this group, so per
// the design we do not invent one. AuthCard stays per-child (per-screen title).
export default function SignupLayout() {
  return <Outlet />;
}
