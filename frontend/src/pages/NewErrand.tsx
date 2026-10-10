import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi, type Page } from '../api';
import { ErrorBox, FieldError } from '../components';
import { SummaryRow } from '../errandParts';
import { useWallet, type Order } from '../errands';
import type { Profile, Supplier } from '../types';

const EXPIRY_CHOICES = [
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
];

/** Requester: pick an open store, list items, set the offer, reserve credits and post. */
export function NewErrandPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { wallet } = useWallet();
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState(params.get('supplier') ?? '');
  const [items, setItems] = useState('');
  const [deliverTo, setDeliverTo] = useState('');
  const [expiryMinutes, setExpiryMinutes] = useState(45);
  const [offer, setOffer] = useState(3);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Only stores that are open right now can take an errand.
  useEffect(() => {
    const q = new URLSearchParams({ status: 'open_now', limit: '50', ...(search && { search }) });
    const t = setTimeout(() => {
      api<Page<Supplier>>('GET', `/v1/suppliers?${q}`).then((r) => setSuppliers(r.data), setError);
    }, 250);
    return () => clearTimeout(t);
  }, [api, search]);

  // Start from the student's saved default delivery location, if any.
  useEffect(() => {
    api<{ data: Profile }>('GET', '/v1/users/me').then(
      (r) => setDeliverTo((current) => current || r.data.defaultDeliveryLocation || ''),
      () => undefined,
    );
  }, [api]);

  const available = wallet?.availableBalance ?? null;
  const tooMuch = available !== null && offer > available;
  const chosen = suppliers?.find((s) => s.id === supplierId);
  const itemList = items
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api<{ data: Order }>('POST', '/v1/orders', {
        supplierId,
        deliveryLocation: deliverTo,
        items: itemList,
        creditAmount: offer,
        expiresAt: new Date(Date.now() + expiryMinutes * 60_000).toISOString(),
      });
      navigate(`/errands/${data.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="stack-tight">
        <span className="eyebrow">My errands / New</span>
        <h1>What do you need collected?</h1>
      </div>
      <ErrorBox error={error} />

      <div className="two-col">
        <div className="stack">
          <div className="card stack">
            <div className="row between">
              <b>Pick up from</b>
              <span className="small muted">{suppliers ? `${suppliers.length} open now` : 'Loading…'}</span>
            </div>
            <input placeholder="Search stores…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search stores" />
            <div className="picker" role="group" aria-label="Store">
              {suppliers?.map((s) => (
                <button key={s.id} type="button" className="pick" aria-pressed={s.id === supplierId} onClick={() => setSupplierId(s.id)}>
                  <span className="eyebrow">{s.facilityType}</span>
                  <b>{s.name}</b>
                  <span className="small muted">
                    {s.building} · open till {s.closesAt.slice(0, 5)}
                  </span>
                </button>
              ))}
              {suppliers?.length === 0 && <p className="muted">No stores match, or none are open right now.</p>}
            </div>
            <FieldError error={error} field="supplierId" />
          </div>

          <div className="card stack">
            <label>
              Items to collect
              <textarea
                rows={4}
                placeholder={'One item per line, e.g.\n1× iced latte, less ice, oat milk\n1× almond croissant'}
                value={items}
                onChange={(e) => setItems(e.target.value)}
              />
              <FieldError error={error} field="items" />
            </label>
            <label>
              Deliver to
              <input placeholder="e.g. COM1 Basement, seat 12" value={deliverTo} onChange={(e) => setDeliverTo(e.target.value)} />
              <FieldError error={error} field="deliveryLocation" />
            </label>
            <div className="stack-tight">
              <span className="eyebrow">Expires if nobody accepts in</span>
              <div className="chips">
                {EXPIRY_CHOICES.map((c) => (
                  <button key={c.minutes} type="button" className="chip" aria-pressed={expiryMinutes === c.minutes} onClick={() => setExpiryMinutes(c.minutes)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <FieldError error={error} field="expiresAt" />
            </div>
          </div>
        </div>

        <aside className="stack drawer">
          <div className="card stack">
            <span className="eyebrow">Your credit offer</span>
            <div className="stepper">
              <button type="button" onClick={() => setOffer((n) => Math.max(1, n - 1))} aria-label="Lower offer">
                −
              </button>
              <output aria-live="polite">{offer}</output>
              <button type="button" onClick={() => setOffer((n) => Math.min(1000, n + 1))} aria-label="Raise offer">
                +
              </button>
            </div>
            <span className="small muted">Higher offers tend to get picked up faster.</span>
            <FieldError error={error} field="creditAmount" />
          </div>

          <div className="card soft stack">
            <SummaryRow label="Store">{chosen?.name ?? '—'}</SummaryRow>
            <SummaryRow label="Available">
              {available ?? '—'} → <b>{available === null ? '—' : Math.max(0, available - offer)}</b>
            </SummaryRow>
            <SummaryRow label="Reserved when posted">{offer}</SummaryRow>
            <SummaryRow label="Expires if unaccepted">{EXPIRY_CHOICES.find((c) => c.minutes === expiryMinutes)?.label}</SummaryRow>
            {tooMuch && <div className="alert alert-error">You only have {available} credits available.</div>}
            <button className="primary big" type="submit" disabled={busy || !supplierId || tooMuch}>
              Reserve {offer} credits & post
            </button>
            <span className="small muted">
              Credits are held until you confirm delivery, and returned in full if you cancel or the errand expires. The items themselves you
              settle with your courier off-platform.
            </span>
          </div>
        </aside>
      </div>
    </form>
  );
}
