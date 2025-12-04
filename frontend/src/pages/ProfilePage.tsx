import { useEffect, useRef, useState } from 'react';
import { avatarFallback } from '../shared/lib/format';
import type { UserProfile } from '../entities/user/types';

type Props = {
  user: UserProfile | null;
  onSave: (fields: {
    username: string;
    email: string;
    image?: File | null;
  }) => void;
  onNavigate: (path: string) => void;
};




export function ProfilePage({ user, onSave, onNavigate }: Props) {
  const [form, setForm] = useState({
    username: user?.username || '',
    email: user?.email || '',
  });


  const fileInputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(user?.profileImage || null);

  useEffect(() => {
    // чистим blob-URL, когда компонент размонтируется или меняется превью
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

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

  return (
    <div className="card wide">
      <div className="card-header">
        <div>
          <p className="eyebrow">Профиль</p>
        </div>
      </div>

    
      <div className="profile_avatar_wrapper">
        <div
          className="profile_avatar"
          onClick={() => fileInputRef.current?.click()}
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
            setPreviewUrl((prev) => {
              if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
              return file ? URL.createObjectURL(file) : user?.profileImage || null;
            });
          }}
        />
      </div>

      <form
        className="form two-col"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...form, image });
        }}
      >
        <label className="field">
          <span>Имя пользователя</span>
          <input
            type="text"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label className="field full">
          <span>Новый аватар</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setImage(file);
              setPreviewUrl((prev) => {
                if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                return file ? URL.createObjectURL(file) : user.profileImage || null;
              });
            }}
          />
        </label>
        <div className="actions">
          <button className="btn primary" type="submit">
            Сохранить
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => onNavigate('/')}
          >
            На главную
          </button>
        </div>
      </form>
    </div>
  );
}
