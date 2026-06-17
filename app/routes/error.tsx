import { AuthCard } from '@/components/auth-card/auth-card';
import { authErrorMessage } from '@/utils/errors/auth-error';
import { useSearchParams } from 'react-router';

// MERGE DECISION (Phase 0 review authoritative):
// 1. export function meta() — keeps document-title axe rule satisfied (static string fine).
// 2. text-foreground — muted-foreground fails WCAG AA at 3.47:1 in this theme (Phase 0 Task 12 fix).
// 3. {title}/{body} plain — they come from a FIXED code→message table, not the URL, so there is
//    no variable URL text to translate; static copy elsewhere uses <Trans>. No i18n here by design.
// 4. Reads ONLY ?code from the URL and maps it to a fixed message (authErrorMessage). The raw query
//    value is never rendered: title/error used to be read straight from the URL, which was ugly and
//    user-tamperable. An unknown/missing/tampered code falls back to a safe generic message.
export function meta() {
  return [{ title: 'Something went wrong' }];
}

export default function ErrorScreen() {
  const [params] = useSearchParams();
  const { title, body } = authErrorMessage(params.get('code'));
  return (
    <AuthCard title={title}>
      <p className="text-foreground text-center">{body}</p>
    </AuthCard>
  );
}
