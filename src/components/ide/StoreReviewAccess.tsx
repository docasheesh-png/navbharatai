/** Review never presents an empty body while server authority is unknown or refused. */
export function StoreReviewAccess({ loading, isAdmin, problem, onRetry, onAdminLogin }: {
  loading: boolean; isAdmin: boolean; problem: string | null; onRetry: () => void; onAdminLogin: () => void;
}) {
  if (!loading && !problem && isAdmin) return null;
  return (
    <section className="mb-4 rounded-xl border border-line bg-card p-4 space-y-3" aria-live="polite">
      <h2 className="font-semibold">Manage apps</h2>
      {loading ? <p role="status">Checking your App Mart admin access…</p> : <>
        <p role="alert">{problem || 'This session does not have App Mart moderation access. Sign in to Admin Panel or use an approved reviewer account.'}</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onRetry} className="underline">Retry access check</button>
          <button type="button" onClick={onAdminLogin} className="underline">Open Admin Panel</button>
        </div>
      </>}
    </section>
  );
}
