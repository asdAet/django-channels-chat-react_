import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  avatarFallback,
  formatLastSeen,
  formatRegistrationDate,
} from "../shared/lib/format";
import type { UserProfile } from "../entities/user/types";
import { useUserProfile } from "../hooks/useUserProfile";
import { usePresence } from "../shared/presence";

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
  const { online: presenceOnline, status: presenceStatus } = usePresence();

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement | null>(null);

  const hasProfileImage = Boolean(user?.profileImage);
  const pinchState = useRef<{ distance: number; zoom: number } | null>(null);
  const dragState = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);

  const clampZoom = (value: number) => Math.min(15, Math.max(1, value));

  const clampPan = (nextX: number, nextY: number, zoomValue: number = zoom) => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return { x: nextX, y: nextY };
    }
    const currentZoom = zoom || 1;
    const baseWidth = rect.width / currentZoom;
    const baseHeight = rect.height / currentZoom;
    const nextWidth = baseWidth * zoomValue;
    const nextHeight = baseHeight * zoomValue;
    const maxX = Math.max(0, (nextWidth - window.innerWidth) / 2);
    const maxY = Math.max(0, (nextHeight - window.innerHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, nextX)),
      y: Math.min(maxY, Math.max(-maxY, nextY)),
    };
  };

  const applyZoomAtPoint = (
    clientX: number,
    clientY: number,
    nextZoom: number,
  ) => {
    const rect = contentRef.current?.getBoundingClientRect();
    setZoom((currentZoom) => {
      const clampedZoom = clampZoom(nextZoom);
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        if (clampedZoom <= 1) {
          setPan({ x: 0, y: 0 });
        }
        return clampedZoom;
      }
      const offsetX = clientX - rect.left;
      const offsetY = clientY - rect.top;
      const dx = offsetX - rect.width / 2;
      const dy = offsetY - rect.height / 2;
      const scale = clampedZoom / currentZoom;
      setPan((prev) => {
        const nextPan = {
          x: prev.x - dx * (scale - 1),
          y: prev.y - dy * (scale - 1),
        };
        return clampedZoom <= 1
          ? { x: 0, y: 0 }
          : clampPan(nextPan.x, nextPan.y, clampedZoom);
      });
      return clampedZoom;
    });
  };

  const openPreview = () => {
    if (!hasProfileImage) return;
    setZoom(1);
    setPan({ x: 0, y: 0 });
    pinchState.current = null;
    dragState.current = null;
    setIsPreviewOpen(true);
  };
  const closePreview = () => setIsPreviewOpen(false);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const step = event.deltaY < 0 ? 0.2 : -0.2;
    applyZoomAtPoint(event.clientX, event.clientY, zoom + step);
  };

  const getTouchDistance = (
    touches: ReactTouchEvent<HTMLDivElement>["touches"],
  ) => {
    if (touches.length < 2) return null;
    const first = touches.item(0);
    const second = touches.item(1);
    if (!first || !second) return null;
    const dx = first.clientX - second.clientX;
    const dy = first.clientY - second.clientY;
    return Math.hypot(dx, dy);
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 1 && zoom > 1) {
      const touch = event.touches.item(0);
      if (!touch) return;
      dragState.current = {
        x: touch.clientX,
        y: touch.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      return;
    }

    const distance = getTouchDistance(event.touches);
    if (!distance) return;
    pinchState.current = {
      distance,
      zoom,
    };
  };

  const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (dragState.current && event.touches.length === 1) {
      const touch = event.touches.item(0);
      if (!touch) return;
      event.preventDefault();
      const nextX =
        dragState.current.panX + (touch.clientX - dragState.current.x);
      const nextY =
        dragState.current.panY + (touch.clientY - dragState.current.y);
      setPan(clampPan(nextX, nextY));
      return;
    }

    if (!pinchState.current) return;
    const nextDistance = getTouchDistance(event.touches);
    if (!nextDistance) return;
    event.preventDefault();
    const first = event.touches.item(0);
    const second = event.touches.item(1);
    const scale = nextDistance / pinchState.current.distance;
    const nextZoom = clampZoom(pinchState.current.zoom * scale);
    if (first && second) {
      const centerX = (first.clientX + second.clientX) / 2;
      const centerY = (first.clientY + second.clientY) / 2;
      applyZoomAtPoint(centerX, centerY, nextZoom);
    } else {
      setZoom(nextZoom);
      setPan((prev) =>
        nextZoom <= 1 ? { x: 0, y: 0 } : clampPan(prev.x, prev.y, nextZoom),
      );
    }
  };

  const handleTouchEnd = () => {
    pinchState.current = null;
    dragState.current = null;
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    event.preventDefault();
    dragState.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    event.preventDefault();
    const nextX =
      dragState.current.panX + (event.clientX - dragState.current.x);
    const nextY =
      dragState.current.panY + (event.clientY - dragState.current.y);
    setPan(clampPan(nextX, nextY));
  };

  const handleMouseUp = () => {
    dragState.current = null;
  };

  const handleAvatarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!hasProfileImage) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPreview();
    }
  };

  useEffect(() => {
    if (!isPreviewOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [isPreviewOpen]);

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
  const isUserOnline =
    presenceStatus === "online" &&
    presenceOnline.some((entry) => entry.username === user.username);

  return (
    <div className="card wide">
      <div>
        <p className="eyebrow_profile">Профиль пользователя</p>
      </div>

      <div className="profile_avatar_wrapper">
        <div
          className={`profile_avatar readonly${hasProfileImage ? " clickable" : ""}`}
          role={hasProfileImage ? "button" : undefined}
          tabIndex={hasProfileImage ? 0 : -1}
          aria-label={hasProfileImage ? "Открыть аватар" : undefined}
          onClick={openPreview}
          onKeyDown={handleAvatarKeyDown}
        >
          {user.profileImage ? (
            <img src={user.profileImage} alt={user.username} />
          ) : (
            <span>{avatarFallback(user.username)}</span>
          )}
        </div>
      </div>

      {isPreviewOpen && user.profileImage && (
        <div
          className="avatar-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Аватар ${user.username}`}
          onClick={closePreview}
        >
          <div
            className={`avatar-lightbox__content${zoom > 1 ? " is-zoomed" : ""}`}
            ref={contentRef}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
            onClick={(event) => event.stopPropagation()}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <img
              className="avatar-lightbox__image"
              src={user.profileImage}
              alt={`Аватар ${user.username}`}
              draggable={false}
            />
          </div>
        </div>
      )}

      <div className="stack">
        <div>
          <h2>{user.username}</h2>
          <p className="muted">О себе</p>
          <p className="bio-text">{user.bio || "Пока ничего не указано."}</p>

          {isUserOnline ? (
            <p className="profile_meta profile_meta_right">В сети</p>
          ) : (
            <p className="profile_meta profile_meta_right">
              Последний раз в сети: {formatLastSeen(user.lastSeen) || "—"}
            </p>
          )}
          <p className="profile_meta profile_meta_right">
            Зарегистрирован: {formatRegistrationDate(user.registeredAt) || "—"}
          </p>
        </div>
        <div className="actions">
          {isSelf && (
            <button
              className="btn primary"
              onClick={() => onNavigate("/profile")}
            >
              Редактировать
            </button>
          )}
          {!isSelf && currentUser && (
            <button
              className="btn primary"
              onClick={() =>
                onNavigate(`/direct/@${encodeURIComponent(user.username)}`)
              }
            >
              Отправить сообщение
            </button>
          )}
          <button className="btn ghost" onClick={() => onNavigate("/")}>
            На главную
          </button>
          {isSelf && (
            <button className="btn logaut" type="button" onClick={onLogout}>
              Выйти
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
