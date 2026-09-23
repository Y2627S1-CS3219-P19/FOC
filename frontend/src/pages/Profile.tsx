import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi } from '../api';
import { ErrorBox, FieldError } from '../components';
import { ACCOUNT_CONSOLE_URL } from '../config';
import type { Profile } from '../types';

export function ProfilePage() {
  const api = useApi();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ displayName: '', contactNumber: '', defaultDeliveryLocation: '' });
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  // Load once. (`api` changes identity when the access token auto-renews; re-running would wipe unsaved edits.)
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    api<{ data: Profile }>('GET', '/v1/users/me')
      .then(({ data }) => {
        setProfile(data);
        setForm({ displayName: data.displayName, contactNumber: data.contactNumber ?? '', defaultDeliveryLocation: data.defaultDeliveryLocation ?? '' });
      })
      .catch(setLoadError);
  }, [api]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    try {
      const { data } = await api<{ data: Profile }>('PATCH', '/v1/users/me', form);
      setProfile({ ...profile!, ...data });
      setSaved(true);
    } catch (err) {
      setSaveError(err);
    }
  }

  if (loadError) return <ErrorBox error={loadError} />;
  if (!profile) return <p>Loading...</p>;

  return (
    <div className="stack">
      <h1>My profile</h1>
      {profile.suspension && (
        <div className="alert alert-error">
          <strong>Your account is suspended.</strong>
          {profile.suspension.reason && <div>Reason: {profile.suspension.reason}</div>}
          <div>
            Contact an administrator: <a href={`mailto:${profile.suspension.adminContact}`}>{profile.suspension.adminContact}</a>
          </div>
        </div>
      )}
      <div className="card">
        <dl className="details">
          <dt>Username</dt>
          <dd>{profile.username}</dd>
          <dt>Email</dt>
          <dd>{profile.email}</dd>
          <dt>Role</dt>
          <dd>{profile.role}</dd>
          <dt>Status</dt>
          <dd>{profile.status}</dd>
          <dt>Rating</dt>
          <dd>{profile.rating ?? 'No ratings yet'}</dd>
        </dl>
        <p className="muted">
          Username, email and role cannot be changed here. Change your password in the{' '}
          <a href={ACCOUNT_CONSOLE_URL} target="_blank" rel="noreferrer">
            Keycloak account page
          </a>
          .
        </p>
      </div>
      <form className="card stack narrow" onSubmit={save} noValidate>
        <h2>Edit details</h2>
        <ErrorBox error={saveError} />
        {saved && <div className="alert alert-ok">Saved.</div>}
        <label>
          Display name
          <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <FieldError error={saveError} field="displayName" />
        </label>
        <label>
          Contact number
          <input value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} placeholder="+65 9123 4567" />
          <FieldError error={saveError} field="contactNumber" />
        </label>
        <label>
          Default delivery location
          <input
            value={form.defaultDeliveryLocation}
            onChange={(e) => setForm({ ...form, defaultDeliveryLocation: e.target.value })}
            placeholder="e.g. PGP House 7 lobby"
          />
          <FieldError error={saveError} field="defaultDeliveryLocation" />
        </label>
        <button className="primary">Save</button>
      </form>
    </div>
  );
}
