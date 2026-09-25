import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../api';
import { useAuth } from '../auth';
import { ConfirmButton, ErrorBox } from '../components';
import type { Supplier } from '../types';
import { OpenBadge } from './Suppliers';

export function SupplierDetailPage() {
  const { id } = useParams();
  const api = useApi();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ data: Supplier }>('GET', `/v1/suppliers/${id}`).then((r) => setSupplier(r.data), setError);
  }, [api, id]);

  async function act(method: 'PATCH' | 'DELETE', path: string) {
    setError(null);
    try {
      if (method === 'DELETE') {
        await api('DELETE', `/v1/suppliers/${id}`);
        navigate('/suppliers');
        return;
      }
      const r = await api<{ data: Supplier }>('PATCH', `/v1/suppliers/${id}/${path}`);
      setSupplier(r.data);
    } catch (err) {
      setError(err);
    }
  }

  if (!supplier) return error ? <ErrorBox error={error} /> : <p>Loading...</p>;
  return (
    <div className="stack">
      <Link to="/suppliers">← Back to suppliers</Link>
      <div className="card supplier-detail">
        {supplier.imageUrl && <img src={supplier.imageUrl} alt={supplier.name} />}
        <div className="stack">
          <h1>
            {supplier.name} <OpenBadge s={supplier} />
          </h1>
          <dl className="details">
            <dt>Facility type</dt>
            <dd>{supplier.facilityType}</dd>
            <dt>Building</dt>
            <dd>
              {supplier.building}
              {supplier.floor ? `, level ${supplier.floor}` : ''}
            </dd>
            <dt>Where exactly</dt>
            <dd>{supplier.locationDescription || '-'}</dd>
            <dt>Opening hours</dt>
            <dd>
              {supplier.opensAt} - {supplier.closesAt} {supplier.closesAt < supplier.opensAt && '(past midnight)'}
            </dd>
            <dt>Tags</dt>
            <dd>{supplier.tags.length ? supplier.tags.map((t) => <span key={t} className="badge">{t}</span>) : '-'}</dd>
          </dl>
        </div>
      </div>
      <ErrorBox error={error} />
      {isAdmin && (
        <div className="card row wrap">
          <strong>Admin:</strong>
          <Link className="button" to={`/suppliers/${supplier.id}/edit`}>
            Edit
          </Link>
          {supplier.isActive ? (
            <ConfirmButton label="Deactivate" confirmLabel="Yes, deactivate" onConfirm={() => act('PATCH', 'deactivate')} />
          ) : (
            <button onClick={() => act('PATCH', 'reactivate')}>Reactivate</button>
          )}
          <ConfirmButton label="Delete" confirmLabel="Yes, delete permanently" className="danger" onConfirm={() => act('DELETE', '')} />
        </div>
      )}
    </div>
  );
}
