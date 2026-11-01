import { h, VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Icon } from '../../ui/icons.js';
import { api } from '../../api/client.js';

interface PasswordModalProps {
  isOpen: boolean;
  onSuccess: () => void;
}

export function PasswordModal({ isOpen, onSuccess }: PasswordModalProps): VNode | null {
  if (!isOpen) return null;
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) api.setSessionToken(data.token);
        onSuccess();
      } else {
        setError('Invalid team password');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="modal-backdrop doks-modal-backdrop" style={{ zIndex: 99999 }}>
      <div class="modal-card doks-modal-dialog liquid-glass-surface" style={{ maxWidth: '420px', width: '92vw', textAlign: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '16px 8px' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(139, 92, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c084fc' }}>
            <Icon name="lock" size={24} />
          </div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f3f4f6' }}>Team Access</h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', lineHeight: 1.4 }}>
            Enter the team password to access collaborative boards
          </p>
          <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
            <input
              type="password"
              placeholder="Team password..."
              value={password}
              onInput={(e: any) => setPassword(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: error ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.15)', background: 'rgba(0, 0, 0, 0.4)', color: '#fff', fontSize: '14px', outline: 'none' }}
              autoFocus
            />
            {error && <span style={{ color: '#f87171', fontSize: '12px', textAlign: 'left' }}>{error}</span>}
            <button type="submit" class="btn-primary" disabled={loading} style={{ width: '100%', padding: '10px', fontSize: '14px', fontWeight: 600, borderRadius: '8px', cursor: 'pointer' }}>
              {loading ? 'Authenticating...' : 'Enter Workspace'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
