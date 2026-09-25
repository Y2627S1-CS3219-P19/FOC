import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, type Page } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Pagination } from '../components';
import type { Supplier } from '../types';

const DEFAULTS = { search: '', facilityType: '', building: '', status: 'active', sort: 'name', order: 'asc', page: '1', limit: '10' };
type Filters = typeof DEFAULTS;

export function OpenBadge({ s }: { s: Supplier }) {
  if (!s.isActive) return <span className="badge badge-off">Deactivated</span>;
  return s.isOpenNow ? <span className="badge badge-open">Open now</span> : <span className="badge">Closed</span>;
}

export function SuppliersPage() {
  const api = useApi();
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const filters: Filters = { ...DEFAULTS, ...Object.fromEntries(params) };
  const [result, setResult] = useState<Page<Supplier> | null>(null);
  const [options, setOptions] = useState<{ facilityTypes: string[]; buildings: string[] }>({ facilityTypes: [], buildings: [] });
  const [error, setError] = useState<unknown>(null);
  const [searchText, setSearchText] = useState(filters.search);

  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, page: '1', ...patch };
    const clean = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== '' && v !== DEFAULTS[k as keyof Filters]));
    setParams(clean, { replace: true });
  };

  useEffect(() => {
    api<{ data: typeof options }>('GET', '/v1/suppliers/filter-options').then((r) => setOptions(r.data), setError);
  }, [api]);

  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '')).toString();
  useEffect(() => {
    setError(null);
    api<Page<Supplier>>('GET', `/v1/suppliers?${query}`).then(setResult, setError);
  }, [api, query]);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => searchText !== filters.search && update({ search: searchText }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Suppliers</h1>
        {isAdmin && (
          <Link className="button primary" to="/suppliers/new">
            + New supplier
          </Link>
        )}
      </div>

      <div className="filters card">
        <input placeholder="Search name or location..." value={searchText} onChange={(e) => setSearchText(e.target.value)} aria-label="Search" />
        <select value={filters.facilityType} onChange={(e) => update({ facilityType: e.target.value })} aria-label="Facility type">
          <option value="">All facility types</option>
          {options.facilityTypes.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={filters.building} onChange={(e) => update({ building: e.target.value })} aria-label="Building">
          <option value="">All buildings</option>
          {options.buildings.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select value={filters.status} onChange={(e) => update({ status: e.target.value })} aria-label="Status">
          <option value="active">Active</option>
          <option value="open_now">Open now</option>
          {isAdmin && <option value="inactive">Deactivated (admin)</option>}
          {isAdmin && <option value="all">All (admin)</option>}
        </select>
        <select value={filters.sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort by">
          <option value="name">Sort: name</option>
          <option value="location">Sort: location</option>
          <option value="facilityType">Sort: facility type</option>
        </select>
        <button onClick={() => update({ order: filters.order === 'asc' ? 'desc' : 'asc' })} aria-label="Toggle order">
          {filters.order === 'asc' ? 'A→Z' : 'Z→A'}
        </button>
        <select value={filters.limit} onChange={(e) => update({ limit: e.target.value })} aria-label="Page size">
          {['10', '20', '50'].map((n) => (
            <option key={n} value={n}>
              {n} per page
            </option>
          ))}
        </select>
      </div>

      <ErrorBox error={error} />
      {result && (
        <>
          {result.data.length === 0 ? (
            <p className="muted">No suppliers match these filters.</p>
          ) : (
            <table className="responsive">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th>Hours</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Name">
                      <Link to={`/suppliers/${s.id}`}>{s.name}</Link>
                    </td>
                    <td data-label="Type">{s.facilityType}</td>
                    <td data-label="Location">
                      {s.building}
                      {s.floor ? `, level ${s.floor}` : ''}
                      <div className="muted">{s.locationDescription}</div>
                    </td>
                    <td data-label="Hours">
                      {s.opensAt}-{s.closesAt}
                    </td>
                    <td data-label="Status">
                      <OpenBadge s={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pagination page={result.page} limit={result.limit} total={result.total} onPage={(p) => update({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
