/**
 * Go-live PR 14 — the wallet page's header: exactly three primary buttons. Presentational; the
 * page decides what each door shows. Rendered only when WALLET_V2_UI is on (wired in a follow-up).
 */
import { WALLET_DOORS, WALLET_DOOR_LABEL, type WalletDoor } from '../../lib/walletIntent';

export function WalletDoors({ active, onSelect }: { active: WalletDoor; onSelect: (d: WalletDoor) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="tablist" data-testid="wallet-doors">
      {WALLET_DOORS.map((d) => (
        <button
          key={d}
          type="button"
          role="tab"
          aria-selected={d === active}
          className={`rounded-lg px-3 py-2 text-sm font-medium ${d === active ? 'bg-accent text-on-accent' : 'bg-raised text-ink hover:bg-card'}`}
          onClick={() => onSelect(d)}
        >
          {WALLET_DOOR_LABEL[d]}
        </button>
      ))}
    </div>
  );
}
