import { avatarFallback } from "../shared/lib/format";
import type { UserProfile } from "../entities/user/types";
import { useUserProfile } from "../hooks/useUserProfile";

type Props = {
  user: UserProfile | null;
  onLogout: () => void;
  username: string;
  currentUser: UserProfile | null;
  onNavigate: (path: string) => void;
};

export function UserProfilePage({
  username,
  currentUser,
  onNavigate,
  onLogout,
}: Props) {
  const { user, loading, error } = useUserProfile(username);

  if (loading) {
    return (
      <div className="panel muted" aria-busy="true">
        Загрузка профиля...
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="panel">
        <p>Профиль не найден.</p>
        <div className="actions">
          <button className="btn ghost" onClick={() => onNavigate("/")}>
            На главную
          </button>
        </div>
      </div>
    );
  }

  const isSelf = currentUser?.username === user.username;

  return (
    <div className="card wide">
      <div>
        <p className="eyebrow_profile">Профиль пользователя</p>
      </div>

      <div className="profile_avatar_wrapper">
        <div className="profile_avatar readonly">
          {user.profileImage ? (
            <img src={user.profileImage} alt={user.username} />
          ) : (
            <span>{avatarFallback(user.username)}</span>
          )}
        </div>
      </div>

      <div className="stack">
        <div>
          <h2>{user.username}</h2>
          <p className="muted">О себе</p>
          <p className="bio-text">{user.bio || "Пока ничего не указано."}</p>
        </div>
        <div className="actions">
          {isSelf && (
            <button
              className="btn primary"
              onClick={() => onNavigate(`/users/${user.username}`)}
            >
              Редактировать
            </button>
          )}
          <button className="btn ghost" onClick={() => onNavigate("/")}>
            На главную
          </button>

          <button className="btn logaut" type="button" onClick={onLogout}>
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}
