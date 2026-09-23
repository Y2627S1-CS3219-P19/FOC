import { useState, type FormEvent } from 'react';
import { apiRequest } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, FieldError } from '../components';
import { MAILPIT_URL } from '../config';

export function RegisterPage() {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ data: { message: string } }>('POST', '/v1/auth/register', { body: form });
      setDone(res.data.message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="card stack">
        <h1>Check your email</h1>
        <p>{done}</p>
        <p className="muted">
          Dev: open Mailpit at <a href={MAILPIT_URL} target="_blank" rel="noreferrer">{MAILPIT_URL}</a> and click the link.
        </p>
        <button className="primary" onClick={() => login('/profile')}>
          Log in
        </button>
      </div>
    );

  return (
    <form className="card stack narrow" onSubmit={submit} noValidate>
      <h1>Sign up</h1>
      <ErrorBox error={error} />
      <label>
        Username
        <input value={form.username} onChange={set('username')} autoComplete="username" />
        <FieldError error={error} field="username" />
      </label>
      <label>
        NUS email (@u.nus.edu)
        <input type="email" value={form.email} onChange={set('email')} autoComplete="email" placeholder="e0123456@u.nus.edu" />
        <FieldError error={error} field="email" />
      </label>
      <label>
        Password
        <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
        <span className="muted">At least 8 characters with an uppercase letter, a lowercase letter and a digit.</span>
        <FieldError error={error} field="password" />
      </label>
      <label>
        Confirm password
        <input type="password" value={form.confirmPassword} onChange={set('confirmPassword')} autoComplete="new-password" />
        <FieldError error={error} field="confirmPassword" />
      </label>
      <button className="primary" disabled={busy}>
        {busy ? 'Creating account...' : 'Create account'}
      </button>
    </form>
  );
}
