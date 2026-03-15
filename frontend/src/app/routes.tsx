import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { decodePublicRefParam, decodeRoomRefParam } from "../dto";
import type { UserProfile } from "../entities/user/types";
import { ChatRoomPage } from "../pages/ChatRoomPage";
import { DirectChatByUsernamePage } from "../pages/DirectChatByUsernamePage";
import { DirectChatsPage } from "../pages/DirectChatsPage";
import { HomePage } from "../pages/HomePage";
import { LoginPage } from "../pages/LoginPage";
import { ProfilePage } from "../pages/ProfilePage";
import { RegisterPage } from "../pages/RegisterPage";
import { FriendsPage } from "../pages/FriendsPage";
import { GroupsPage } from "../pages/GroupsPage";
import { InvitePreviewPage } from "../pages/InvitePreviewPage";
import { SettingsPage } from "../pages/SettingsPage";
import { UserProfilePage } from "../pages/UserProfilePage";

type ProfileFieldErrors = Record<string, string[]>;
type ProfileSaveResult =
  | { ok: true }
  | { ok: false; errors?: ProfileFieldErrors; message?: string };

type AppRoutesProps = {
  user: UserProfile | null;
  error: string | null;
  passwordRules: string[];
  googleAuthDisabledReason: string | null;
  onNavigate: (path: string) => void;
  onLogin: (identifier: string, password: string) => Promise<void>;
  onGoogleOAuth: () => Promise<void>;
  onRegister: (payload: {
    login: string;
    password: string;
    passwordConfirm: string;
    name: string;
    username?: string;
    email?: string;
  }) => Promise<void>;
  onLogout: () => Promise<void>;
  onProfileSave: (fields: {
    name?: string;
    username?: string;
    image?: File | null;
    bio?: string;
  }) => Promise<ProfileSaveResult>;
};

/**
 * Обертка для пользовательского профиля с получением username из URL.
 */
function UserProfileRoute({
  user,
  onNavigate,
  onLogout,
}: Pick<AppRoutesProps, "user" | "onNavigate" | "onLogout">) {
  const params = useParams<{ ref: string }>();
  const ref = decodePublicRefParam(params.ref);
  if (!ref) {
    return <Navigate to="/" replace />;
  }

  return (
    <UserProfilePage
      key={ref}
      user={user}
      username={ref}
      currentUser={user}
      onNavigate={onNavigate}
      onLogout={onLogout}
    />
  );
}

/**
 * Обертка для direct-чата по username из URL.
 */
function DirectRoute({
  user,
  onNavigate,
}: Pick<AppRoutesProps, "user" | "onNavigate">) {
  const params = useParams<{ ref: string }>();
  const ref = decodePublicRefParam(params.ref);
  if (!ref) {
    return <Navigate to="/direct" replace />;
  }

  return <DirectChatByUsernamePage user={user} publicRef={ref} onNavigate={onNavigate} />;
}

/**
 * Обертка для комнаты с валидацией roomRef.
 */
function RoomRoute({
  user,
  onNavigate,
}: Pick<AppRoutesProps, "user" | "onNavigate">) {
  const params = useParams<{ roomRef: string }>();
  const roomRef = decodeRoomRefParam(params.roomRef);
  if (!roomRef) {
    return <Navigate to="/" replace />;
  }

  return (
    <ChatRoomPage key={roomRef} slug={roomRef} user={user} onNavigate={onNavigate} />
  );
}

/**
 * Обертка для инвайт-превью с получением code из URL.
 */
function InviteRoute({ onNavigate }: Pick<AppRoutesProps, "onNavigate">) {
  const params = useParams<{ code: string }>();
  const code = params.code || "";
  if (!code) {
    return <Navigate to="/" replace />;
  }
  return <InvitePreviewPage code={code} onNavigate={onNavigate} />;
}

/**
 * Декларация всех frontend-маршрутов приложения.
 */
export function AppRoutes({
  user,
  error,
  passwordRules,
  googleAuthDisabledReason,
  onNavigate,
  onLogin,
  onGoogleOAuth,
  onRegister,
  onLogout,
  onProfileSave,
}: AppRoutesProps) {
  return (
    <Routes>
      <Route
        path="/"
        element={<HomePage user={user} onNavigate={onNavigate} />}
      />
      <Route
        path="/login"
        element={
          <LoginPage
            onSubmit={onLogin}
            onGoogleAuth={onGoogleOAuth}
            onNavigate={onNavigate}
            googleAuthDisabledReason={googleAuthDisabledReason}
            error={error}
          />
        }
      />
      <Route
        path="/register"
        element={
          <RegisterPage
            onSubmit={onRegister}
            onGoogleAuth={onGoogleOAuth}
            googleAuthDisabledReason={googleAuthDisabledReason}
            onNavigate={onNavigate}
            error={error}
            passwordRules={passwordRules}
          />
        }
      />
      <Route
        path="/profile"
        element={
          <ProfilePage
            key={user?.username || "guest"}
            user={user}
            onSave={onProfileSave}
            onNavigate={onNavigate}
          />
        }
      />
      <Route
        path="/settings"
        element={
          <SettingsPage
            user={user}
            onNavigate={onNavigate}
            onLogout={onLogout}
          />
        }
      />
      <Route
        path="/friends"
        element={<FriendsPage user={user} onNavigate={onNavigate} />}
      />
      <Route
        path="/groups"
        element={<GroupsPage user={user} onNavigate={onNavigate} />}
      />
      <Route
        path="/invite/:code"
        element={<InviteRoute onNavigate={onNavigate} />}
      />
      <Route
        path="/direct"
        element={<DirectChatsPage user={user} onNavigate={onNavigate} />}
      />
      <Route
        path="/direct/:ref"
        element={<DirectRoute user={user} onNavigate={onNavigate} />}
      />
      <Route
        path="/users/:ref"
        element={
          <UserProfileRoute
            user={user}
            onNavigate={onNavigate}
            onLogout={onLogout}
          />
        }
      />
      <Route
        path="/rooms/:roomRef"
        element={<RoomRoute user={user} onNavigate={onNavigate} />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
