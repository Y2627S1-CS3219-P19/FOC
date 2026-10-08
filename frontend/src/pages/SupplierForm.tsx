import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../api';
import { ErrorBox, FieldError } from '../components';
import type { Supplier } from '../types';

const EMPTY = { name: '', facilityType: '', building: '', floor: '', locationDescription: '', opensAt: '09:00', closesAt: '18:00' };

/** Create (no id) or edit (with id). Admin only - the server enforces this with 403 too. */
export function SupplierFormPage() {
  const { id } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [types, setTypes] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ data: { facilityTypes: string[] } }>('GET', '/v1/suppliers/filter-options').then((r) => setTypes(r.data.facilityTypes), () => undefined);
    if (!id) return;
    api<{ data: Supplier }>('GET', `/v1/suppliers/${id}`).then(({ data: s }) =>
      setForm({
        name: s.name,
        facilityType: s.facilityType,
        building: s.building,
        floor: s.floor ?? '',
        locationDescription: s.locationDescription,
        opensAt: s.opensAt,
        closesAt: s.closesAt,
      }),
      setError,
    );
  }, [api, id]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      ...form,
      floor: form.floor || null,
    };
    try {
      const { data } = id
        ? await api<{ data: Supplier }>('PATCH', `/v1/suppliers/${id}`, body)
        : await api<{ data: Supplier }>('POST', '/v1/suppliers', body);
      navigate(`/suppliers/${data.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack narrow" onSubmit={submit} noValidate>
      <Link to={id ? `/suppliers/${id}` : '/suppliers'}>← Cancel</Link>
      <h1>{id ? 'Edit supplier' : 'New supplier'}</h1>
      <ErrorBox error={error} />
      <label>
        Name
        <input value={form.name} onChange={set('name')} />
        <FieldError error={error} field="name" />
      </label>
      <label>
        Facility type
        <input value={form.facilityType} onChange={set('facilityType')} list="facility-types" placeholder="e.g. Food, Printing" />
        <datalist id="facility-types">
          {types.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <FieldError error={error} field="facilityType" />
      </label>
      <div className="grid-2">
        <label>
          Building
          <input value={form.building} onChange={set('building')} />
          <FieldError error={error} field="building" />
        </label>
        <label>
          Floor
          <input value={form.floor} onChange={set('floor')} />
          <FieldError error={error} field="floor" />
        </label>
      </div>
      <label>
        Location description
        <textarea value={form.locationDescription} onChange={set('locationDescription')} rows={2} />
        <FieldError error={error} field="locationDescription" />
      </label>
      <div className="grid-2">
        <label>
          Opens at
          <input type="time" value={form.opensAt} onChange={set('opensAt')} />
          <FieldError error={error} field="opensAt" />
        </label>
        <label>
          Closes at
          <input type="time" value={form.closesAt} onChange={set('closesAt')} />
          <FieldError error={error} field="closesAt" />
        </label>
      </div>
      <button className="primary" disabled={busy}>
        {busy ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}
