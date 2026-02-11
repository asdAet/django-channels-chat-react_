import { useEffect, useRef, useState } from 'react';
import { avatarFallback } from '../shared/lib/format';
import type { UserProfile } from '../entities/user/types';

type SaveResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[]>; message?: string };

type Props = {
  user: UserProfile | null;
  onSave: (fields: {
    username: string;
    email: string;
    image?: File | null;
    bio?: string;
  }) => Promise<SaveResult>;
  onNavigate: (path: string) => void;
  onLogout?: () => void;
};

export function ProfilePage({ user, onSave, onNavigate, onLogout }: Props) {
  const [form, setForm] = useState({
    username: user?.username || '',
    email: user?.email || '',
    bio: user?.bio || '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const isUsernameValid = form.username.trim().length > 0;
  const isBioValid = form.bio.length <= 1000;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    user?.profileImage || null
  );

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  useEffect(() => {
    // Clean blob URLs on unmount or when preview changes
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!formError) return;
    if (!formError.includes('Проверьте введённые данные')) return;
    const t = window.setTimeout(() => setFormError(null), 4200);
    return () => window.clearTimeout(t);
  }, [formError]);

  if (!user) {
    return (
      <div className="panel">
        <p>Нужно войти, чтобы редактировать профиль.</p>
        <div className="actions">
          <button className="btn primary" onClick={() => onNavigate('/login')}>
            Войти
          </button>
          <button className="btn ghost" onClick={() => onNavigate('/register')}>
            Регистрация
          </button>
        </div>
      </div>
    );
  }

  const usernameError = fieldErrors.username?.[0];
  const emailError = fieldErrors.email?.[0];
  const bioError = fieldErrors.bio?.[0];
  const imageError = fieldErrors.image?.[0];
  const genericError =
    formError || fieldErrors.non_field_errors?.[0] || fieldErrors.__all__?.[0];

  return (
    <div className="card wide">
      <div>
        <p className="eyebrow_profile">Профиль</p>
      </div>

      {genericError && (
        <div className="toast danger" role="alert">
          {genericError}
        </div>
      )}

      <div className="profile_avatar_wrapper">
        <div
          className="profile_avatar"
          role="button"
          tabIndex={0}
          aria-label="Загрузить фото профиля"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          {previewUrl ? (
            <img src={previewUrl} alt={user.username} />
          ) : (
            <span>{avatarFallback(user.username)}</span>
          )}
          <div className="avatar_overlay"></div>
        </div>

        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setImage(file);
            setFormError(null);
            clearFieldError('image');
            setPreviewUrl((prev) => {
              if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
              return file
                ? URL.createObjectURL(file)
                : user?.profileImage || null;
            });
          }}
        />
      </div>
      {imageError && <p className="note error">{imageError}</p>}

      <form
        className="form two-col"
        onSubmit={async (event) => {
          event.preventDefault();
          setFormError(null);
          const result = await onSave({ ...form, image, bio: form.bio });
          if (result.ok) {
            setFieldErrors({});
            return;
          }
          if (result.errors) {
            setFieldErrors(result.errors);
          } else {
            setFieldErrors({});
          }
          if (result.message) {
            setFormError(result.message);
          }
        }}
      >
        <label className={`field ${usernameError ? 'error' : ''}`}>
          <span>Имя пользователя</span>
          <input
            type="text"
            value={form.username}
            onChange={(e) => {
              setForm({ ...form, username: e.target.value });
              setFormError(null);
              clearFieldError('username');
            }}
          />
          {usernameError && <span className="note error">{usernameError}</span>}
        </label>
        <label className={`field ${emailError ? 'error' : ''}`}>
          <span>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => {
              setForm({ ...form, email: e.target.value });
              setFormError(null);
              clearFieldError('email');
            }}
          />
          {emailError && <span className="note error">{emailError}</span>}
        </label>
        <label className={`field full ${bioError ? 'error' : ''}`}>
          <span>О себе</span>
          <textarea
            value={form.bio}
            onChange={(e) => {
              setForm({ ...form, bio: e.target.value });
              setFormError(null);
              clearFieldError('bio');
            }}
            placeholder="Расскажите пару слов о себе"
          />
          {!isBioValid && (
            <span className="note warning">Максимум 1000 символов.</span>
          )}
          {bioError && <span className="note error">{bioError}</span>}
        </label>
        <div className="actions">
          <button className="btn primary" type="submit" disabled={!isUsernameValid || !isBioValid}>
            Сохранить
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => onNavigate('/')}
          >
            На главную
          </button>
          {onLogout && (
            <button className="btn logaut" type="button" onClick={onLogout}>
              Выйти
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
