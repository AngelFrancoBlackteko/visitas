import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useT } from '../i18n/index.jsx';

export default function Users() {
  const qc = useQueryClient();
  const t = useT();
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/api/users'),
  });

  const [showNew, setShowNew] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);

  if (isLoading) return <div>{t('common.loading')}</div>;
  const users = data?.users ?? [];

  return (
    <>
      <div className="row between">
        <h1>{t('users.title')}</h1>
        <button onClick={() => setShowNew(s => !s)}>{showNew ? t('common.cancel') : t('users.add')}</button>
      </div>

      <p className="muted">
        {t('users.intro1')}<code>{t('role.admin')}</code>{t('users.intro2')}
        {' '}<code>{t('role.security')}</code>{t('users.intro3')}
        {' '}<code>{t('role.host')}</code>{t('users.intro4')}
      </p>

      {showNew && (
        <NewUser onCreated={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['users'] }); }} />
      )}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{t('users.username')}</th>
              <th>{t('users.displayName')}</th>
              <th>{t('users.role')}</th>
              <th>{t('common.email')}</th>
              <th>{t('common.phone')}</th>
              <th>{t('users.source')}</th>
              <th>{t('common.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <UserRow
                key={u.id}
                user={u}
                onReset={() => setResetTarget(u)}
                onChanged={() => qc.invalidateQueries({ queryKey: ['users'] })}
              />
            ))}
          </tbody>
        </table>
      </div>

      {resetTarget && (
        <ResetPassword user={resetTarget} onClose={() => setResetTarget(null)} />
      )}
    </>
  );
}

function UserRow({ user, onReset, onChanged }) {
  const t = useT();
  const [editingRole, setEditingRole] = useState(false);
  const [role, setRole] = useState(user.role);
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: (body) => api.patch(`/api/users/${user.id}`, body),
    onSuccess: () => { setEditingRole(false); setErr(null); onChanged(); },
    onError: (e) => setErr(e.data?.error || e.message),
  });

  return (
    <tr>
      <td>{user.username}</td>
      <td>{user.displayName || <span className="muted">—</span>}</td>
      <td>
        {editingRole ? (
          <span className="row">
            <select value={role} onChange={e => setRole(e.target.value)} style={{ width: 'auto' }}>
              <option value="host">{t('role.host')}</option>
              <option value="admin">{t('users.roleAdminHost')}</option>
              <option value="security">{t('role.security')}</option>
            </select>
            <button onClick={() => m.mutate({ role })} disabled={m.isPending || role === user.role}>{t('common.save')}</button>
            <button className="secondary" onClick={() => { setEditingRole(false); setRole(user.role); }}>{t('common.cancel')}</button>
          </span>
        ) : (
          <button className="secondary" onClick={() => setEditingRole(true)} title={t('users.changeRole')}>
            <span className={`badge ${user.role === 'security' ? '' : 'muted'}`}>{t(`role.${user.role}`)}</span>
          </button>
        )}
        {err && <div className="error" style={{ fontSize: 12 }}>{err}</div>}
      </td>
      <td>{user.email || <span className="muted">—</span>}</td>
      <td>{user.phone || <span className="muted">—</span>}</td>
      <td><span className={`badge ${user.source === 'ad' ? '' : 'muted'}`}>{user.source}</span></td>
      <td>
        {user.active
          ? (user.mustChangePassword ? <span className="badge muted">{t('users.mustChange')}</span> : <span className="badge muted">{t('common.active')}</span>)
          : <span className="badge disabled">{t('users.disabledBadge')}</span>}
      </td>
      <td style={{ textAlign: 'right' }}>
        <button className="secondary" onClick={onReset}>{t('users.resetPassword')}</button>
      </td>
    </tr>
  );
}

function NewUser({ onCreated }) {
  const t = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('host');
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: (body) => api.post('/api/users', body),
    onSuccess: onCreated,
    onError: (e) => setErr(e.data?.error || e.message),
  });

  const onSubmit = (e) => {
    e.preventDefault();
    setErr(null);
    m.mutate({
      username,
      password,
      role,
      email: email || null,
      displayName: displayName || null,
      phone: phone || null,
    });
  };

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>{t('users.newTitle')}</h2>
      <label htmlFor="new-user-role">{t('users.role')} <span className="req">*</span></label>
      <select id="new-user-role" value={role} onChange={e => setRole(e.target.value)}>
        <option value="host">{t('users.roleHostLong')}</option>
        <option value="admin">{t('users.roleAdminLong')}</option>
        <option value="security">{t('users.roleSecurityLong')}</option>
      </select>
      <label htmlFor="new-user-username">{t('users.username')} <span className="req">*</span></label>
      <input id="new-user-username" value={username} onChange={e => setUsername(e.target.value)} required autoFocus pattern="[A-Za-z0-9._-]+" />
      <label htmlFor="new-user-password">{t('users.initialPassword')} <span className="req">*</span></label>
      <input id="new-user-password" type="text" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} placeholder={t('users.passwordPlaceholder')} />
      <label htmlFor="new-user-display-name">{t('users.displayName')}</label>
      <input id="new-user-display-name" value={displayName} onChange={e => setDisplayName(e.target.value)} />
      <label htmlFor="new-user-email">{t('common.email')}</label>
      <input id="new-user-email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      <label htmlFor="new-user-phone">{t('users.mobile')}</label>
      <input id="new-user-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+15555550100" />
      {err && <div className="error">{err}</div>}
      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={m.isPending}>{m.isPending ? t('common.creating') : t('users.create')}</button>
      </div>
    </form>
  );
}

function ResetPassword({ user, onClose }) {
  const t = useT();
  const [generated, setGenerated] = useState(null);
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: () => api.post(`/api/users/${user.id}/reset-password`, {}),
    onSuccess: (r) => setGenerated(r.password),
    onError: (e) => setErr(e.data?.error || e.message),
  });

  return (
    <div className="panel">
      <h2>{t('users.resetTitle', { user: user.username })}</h2>
      {!generated && (
        <>
          <p className="muted">
            {t('users.resetHelp')}
          </p>
          <div className="row">
            <button onClick={() => m.mutate()} disabled={m.isPending}>{t('users.generate')}</button>
            <button className="secondary" onClick={onClose}>{t('common.cancel')}</button>
          </div>
          {err && <div className="error">{err}</div>}
        </>
      )}
      {generated && (
        <>
          <p>{t('users.newPassword')}</p>
          <pre className="panel" style={{ background: 'var(--panel-2)', padding: 12 }}>{generated}</pre>
          <button onClick={onClose}>{t('common.done')}</button>
        </>
      )}
    </div>
  );
}
