import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import type { UserProfile } from "../../entities/user/types";
import { useConversationList } from "../../shared/conversationList/ConversationListProvider";
import { useDirectInbox } from "../../shared/directInbox";
import { formatFullName } from "../../shared/lib/format";
import { buildUserProfilePath, formatPublicRef } from "../../shared/lib/publicRef";
import { Avatar, Button } from "../../shared/ui";
import { ConversationList } from "../sidebar/ConversationList";
import styles from "../../styles/layout/Sidebar.module.css";

type Props = {
  user: UserProfile | null;
  onNavigate: (path: string) => void;
  onLogout: () => void;
};

const IconMenu = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const IconSearch = () => (
  <svg
    className={styles.searchIcon}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconHome = () => (
  <svg
    className={styles.drawerIcon}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const IconFriends = () => (
  <svg
    className={styles.drawerIcon}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <line x1="20" y1="8" x2="20" y2="14" />
    <line x1="23" y1="11" x2="17" y2="11" />
  </svg>
);

const IconGroup = () => (
  <svg
    className={styles.drawerIcon}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const IconSettings = () => (
  <svg
    className={styles.drawerIcon}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconLogout = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export function Sidebar({ user, onNavigate, onLogout }: Props) {
  const location = useLocation();
  const { unreadDialogsCount } = useDirectInbox();
  const { searchQuery, setSearchQuery } = useConversationList();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isActive = useCallback(
    (path: string) => {
      if (path === "/") return location.pathname === "/";
      return location.pathname.startsWith(path);
    },
    [location.pathname],
  );

  const navAndClose = useCallback(
    (path: string) => {
      setDrawerOpen(false);
      onNavigate(path);
    },
    [onNavigate],
  );

  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [drawerOpen]);

  const fullName = user
    ? formatFullName(
        user.name,
        (user as { last_name?: string | null }).last_name,
      ) || "Без имени"
    : "Без имени";
  const publicUsername = (user?.username || "").trim();
  const publicRef = (user?.publicRef || publicUsername).trim();
  const profileIdentity = publicUsername || publicRef || fullName;
  const profilePath = publicRef ? buildUserProfilePath(publicRef) : "/profile";

  return (
    <aside className={styles.sidebar}>
      {drawerOpen && (
        <div
          className={styles.drawerOverlay}
          onClick={() => setDrawerOpen(false)}
        >
          <nav
            className={styles.drawer}
            onClick={(e) => e.stopPropagation()}
            role="navigation"
            aria-label="Main menu"
          >
            {user && (
              <div className={styles.drawerHeader}>
                <Avatar
                  username={profileIdentity}
                  profileImage={user.profileImage}
                  avatarCrop={user.avatarCrop}
                  size="default"
                />
                <div className={styles.userIdentity}>
                  <span className={styles.drawerUserName}>{fullName}</span>
                  {publicRef && (
                    <span className={styles.userHandle}>{formatPublicRef(publicRef)}</span>
                  )}
                </div>
              </div>
            )}

            <div className={styles.drawerDivider} />

            <button
              type="button"
              className={[
                styles.drawerItem,
                isActive("/") ? styles.drawerActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => navAndClose("/")}
            >
              <IconHome />
              <span>Главная</span>
            </button>

            {user && (
              <button
                type="button"
                className={[
                  styles.drawerItem,
                  isActive("/friends") ? styles.drawerActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => navAndClose("/friends")}
              >
                <IconFriends />
                <span>Друзья</span>
              </button>
            )}

            {user && (
              <button
                type="button"
                className={[
                  styles.drawerItem,
                  isActive("/groups") ? styles.drawerActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => navAndClose("/groups")}
              >
                <IconGroup />
                <span>Группы</span>
              </button>
            )}

            <button
              type="button"
              className={[
                styles.drawerItem,
                isActive("/settings") ? styles.drawerActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => navAndClose("/settings")}
            >
              <IconSettings />
              <span>Настройки</span>
            </button>

            <div className={styles.drawerDivider} />

            {user && (
              <button
                type="button"
                className={[styles.drawerItem, styles.drawerDanger]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setDrawerOpen(false);
                  onLogout();
                }}
              >
                <IconLogout />
                <span>Выйти</span>
              </button>
            )}
          </nav>
        </div>
      )}

      <div className={styles.sidebarWrap}>
        <div className={styles.header}>
          <button
            type="button"
            className={styles.menuBtn}
            aria-label="Меню"
            onClick={() => setDrawerOpen(true)}
          >
            <IconMenu />
          </button>
          <div className={styles.searchBox}>
            <IconSearch />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Поиск"
              aria-label="Поиск"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.conversations}>
          {user ? (
            <ConversationList onNavigate={onNavigate} />
          ) : (
            <div className={styles.emptyHint}>Войдите, чтобы видеть беседы</div>
          )}
        </div>
      </div>

      {user ? (
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.userInfo}
            onClick={() => onNavigate(profilePath)}
          >
            <Avatar
              username={profileIdentity}
              profileImage={user.profileImage}
              avatarCrop={user.avatarCrop}
              size="tiny"
            />
            <div className={styles.userIdentity}>
              <span className={styles.userName}>{fullName}</span>
              {publicRef && (
                <span className={styles.userHandle}>{formatPublicRef(publicRef)}</span>
              )}
            </div>
          </button>
          {unreadDialogsCount > 0 && (
            <span className={styles.navBadge}>{unreadDialogsCount}</span>
          )}
          <button
            type="button"
            className={styles.logoutBtn}
            onClick={onLogout}
            aria-label="Выйти"
            title="Выйти"
          >
            <IconLogout />
          </button>
        </div>
      ) : (
        <div className={styles.authButtons}>
          <Button
            variant="primary"
            fullWidth
            onClick={() => onNavigate("/login")}
          >
            Войти
          </Button>
          <Button
            variant="ghost"
            fullWidth
            onClick={() => onNavigate("/register")}
          >
            Регистрация
          </Button>
        </div>
      )}
    </aside>
  );
}
