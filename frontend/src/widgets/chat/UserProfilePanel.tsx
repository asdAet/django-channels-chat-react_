import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { friendsController } from "../../controllers/FriendsController";
import type {
  BlockedUser,
  Friend,
  FriendRequest,
} from "../../entities/friend/types";
import { useUserProfile } from "../../hooks/useUserProfile";
import { useInfoPanel } from "../../shared/layout/useInfoPanel";
import { formatFullName, formatLastSeen } from "../../shared/lib/format";
import {
  buildDirectPath,
  formatPublicRef,
  normalizePublicRef,
} from "../../shared/lib/publicRef";
import { resolveIdentityLabel } from "../../shared/lib/userIdentity";
import { usePresence } from "../../shared/presence";
import { Avatar, Skeleton } from "../../shared/ui";
import styles from "../../styles/chat/UserProfilePanel.module.css";

/**
 * Описывает входные props компонента `Props`.
 */
type Props = {
  publicRef: string;
  currentPublicRef?: string | null;
};

/**
 * Описывает структуру состояния `Relation`.
 */
type RelationState =
  | "self"
  | "none"
  | "outgoing"
  | "incoming"
  | "friend"
  | "blocked";

/**
 * Описывает структуру данных `RelationSnapshot`.
 */
type RelationSnapshot = {
  state: RelationState;
  userId: number | null;
  requestId: number | null;
};

const EMPTY_RELATION: RelationSnapshot = {
  state: "none",
  userId: null,
  requestId: null,
};

/**
 * Нормализует данные.
 * @param value Входное значение для преобразования.
 */
const normalize = (value: string) => normalizePublicRef(value).toLowerCase();

/**
 * Экспорт `resolveUserRef` предоставляет инициализированный экземпляр для повторного использования в модуле.
 */
const resolveUserRef = (item: {
  publicRef: string;
  username: string;
}): string => item.publicRef;

/**
 * Определяет relation.
 * @param targetPublicRef Публичный идентификатор пользователя или комнаты.
 * @param currentPublicRef Публичный идентификатор пользователя или комнаты.
 * @param friends Список `friends`, который обрабатывается функцией.
 * @param incoming Новые данные, пришедшие из внешнего источника.
 * @param outgoing Аргумент `outgoing` текущего вызова.
 * @param blocked Аргумент `blocked` текущего вызова.
 * @returns Разрешенное значение с учетом fallback-логики.
 */
const resolveRelation = (
  targetPublicRef: string,
  currentPublicRef: string | null | undefined,
  friends: Friend[],
  incoming: FriendRequest[],
  outgoing: FriendRequest[],
  blocked: BlockedUser[],
): RelationSnapshot => {
  const target = normalize(targetPublicRef);
  const current = currentPublicRef ? normalize(currentPublicRef) : null;
  if (current && current === target) {
    return { state: "self", userId: null, requestId: null };
  }

  const blockedItem = blocked.find(
    (item) => normalize(resolveUserRef(item)) === target,
  );
  if (blockedItem) {
    return {
      state: "blocked",
      userId: blockedItem.userId,
      requestId: blockedItem.id,
    };
  }

  const incomingItem = incoming.find(
    (item) => normalize(resolveUserRef(item)) === target,
  );
  if (incomingItem) {
    return {
      state: "incoming",
      userId: incomingItem.userId,
      requestId: incomingItem.id,
    };
  }

  const outgoingItem = outgoing.find(
    (item) => normalize(resolveUserRef(item)) === target,
  );
  if (outgoingItem) {
    return {
      state: "outgoing",
      userId: outgoingItem.userId,
      requestId: outgoingItem.id,
    };
  }

  const friendItem = friends.find(
    (item) => normalize(resolveUserRef(item)) === target,
  );
  if (friendItem) {
    return {
      state: "friend",
      userId: friendItem.userId,
      requestId: friendItem.id,
    };
  }

  return EMPTY_RELATION;
};

function UserProfilePanelSkeleton() {
  return (
    <div className={styles.root} aria-busy="true">
      <div className={styles.profile}>
        <Skeleton variant="circle" width={72} height={72} />
        <Skeleton variant="text" width="48%" height={16} />
        <Skeleton variant="text" width="36%" height={12} />
        <Skeleton variant="text" width="58%" height={13} />
        <Skeleton height={74} radius={10} />
        <div className={styles.profileActions}>
          <Skeleton height={44} radius={10} />
          <Skeleton height={44} radius={10} />
        </div>
      </div>
    </div>
  );
}

/**
 * React-компонент UserProfilePanel отвечает за отрисовку и обработку UI-сценария.
 */
export function UserProfilePanel({ publicRef, currentPublicRef }: Props) {
  const navigate = useNavigate();
  const { close: closeInfoPanel } = useInfoPanel();
  const { online: presenceOnline } = usePresence();
  const { user, loading, error } = useUserProfile(publicRef);
  const [relation, setRelation] = useState<RelationSnapshot>(EMPTY_RELATION);
  const [relationLoading, setRelationLoading] = useState(true);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRelationState = useCallback(async () => {
    const normalizedCurrent = currentPublicRef
      ? normalize(currentPublicRef)
      : null;
    const normalizedTarget = normalize(publicRef);
    if (normalizedCurrent && normalizedCurrent === normalizedTarget) {
      setRelation({ state: "self", userId: null, requestId: null });
      setRelationLoading(false);
      return;
    }

    setRelationLoading(true);
    try {
      const [friends, incoming, outgoing, blocked] = await Promise.all([
        friendsController.getFriends(),
        friendsController.getIncomingRequests(),
        friendsController.getOutgoingRequests(),
        friendsController.getBlockedUsers(),
      ]);
      setRelation(
        resolveRelation(
          publicRef,
          currentPublicRef,
          friends,
          incoming,
          outgoing,
          blocked,
        ),
      );
    } catch {
      setRelation(EMPTY_RELATION);
    } finally {
      setRelationLoading(false);
    }
  }, [currentPublicRef, publicRef]);

  useEffect(() => {
    let active = true;
    setActionStatus(null);
    setRelationLoading(true);

    /**
     * Обрабатывает run.
     */
    const run = async () => {
      try {
        const normalizedCurrent = currentPublicRef
          ? normalize(currentPublicRef)
          : null;
        const normalizedTarget = normalize(publicRef);
        if (normalizedCurrent && normalizedCurrent === normalizedTarget) {
          if (active) {
            setRelation({ state: "self", userId: null, requestId: null });
          }
          return;
        }

        const [friends, incoming, outgoing, blocked] = await Promise.all([
          friendsController.getFriends(),
          friendsController.getIncomingRequests(),
          friendsController.getOutgoingRequests(),
          friendsController.getBlockedUsers(),
        ]);
        if (!active) return;
        setRelation(
          resolveRelation(
            publicRef,
            currentPublicRef,
            friends,
            incoming,
            outgoing,
            blocked,
          ),
        );
      } catch {
        if (!active) return;
        setRelation(EMPTY_RELATION);
      } finally {
        if (active) {
          setRelationLoading(false);
        }
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [currentPublicRef, publicRef]);

  const runAction = useCallback(
    async (
      work: () => Promise<void>,
      successMessage: string,
      errorMessage: string,
    ) => {
      setBusy(true);
      setActionStatus(null);
      try {
        await work();
        setActionStatus(successMessage);
        await loadRelationState();
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: string }).message || errorMessage)
            : errorMessage;
        setActionStatus(message);
      } finally {
        setBusy(false);
      }
    },
    [loadRelationState],
  );

  const handleAddFriend = useCallback(() => {
    void runAction(
      async () => {
        await friendsController.sendFriendRequest(publicRef);
      },
      "Запрос в друзья отправлен",
      "Не удалось отправить запрос",
    );
  }, [publicRef, runAction]);

  const handleCancelRequest = useCallback(() => {
    if (!relation.requestId) return;
    void runAction(
      async () => {
        await friendsController.cancelOutgoingFriendRequest(
          relation.requestId as number,
        );
      },
      "Запрос в друзья отменен",
      "Не удалось отменить запрос",
    );
  }, [relation.requestId, runAction]);

  const handleAcceptRequest = useCallback(() => {
    if (!relation.requestId) return;
    void runAction(
      async () => {
        await friendsController.acceptFriendRequest(
          relation.requestId as number,
        );
      },
      "Запрос принят",
      "Не удалось принять запрос",
    );
  }, [relation.requestId, runAction]);

  const handleDeclineRequest = useCallback(() => {
    if (!relation.requestId) return;
    void runAction(
      async () => {
        await friendsController.declineFriendRequest(
          relation.requestId as number,
        );
      },
      "Запрос отклонен",
      "Не удалось отклонить запрос",
    );
  }, [relation.requestId, runAction]);

  const handleRemoveFriend = useCallback(() => {
    if (!relation.userId) return;
    void runAction(
      async () => {
        await friendsController.removeFriend(relation.userId as number);
      },
      "Пользователь удален из друзей",
      "Не удалось удалить из друзей",
    );
  }, [relation.userId, runAction]);

  const handleBlock = useCallback(() => {
    void runAction(
      async () => {
        await friendsController.blockUser(publicRef);
      },
      "Пользователь заблокирован",
      "Не удалось заблокировать пользователя",
    );
  }, [publicRef, runAction]);

  const handleUnblock = useCallback(() => {
    if (!relation.userId) return;
    void runAction(
      async () => {
        await friendsController.unblockUser(relation.userId as number);
      },
      "Пользователь разблокирован",
      "Не удалось разблокировать пользователя",
    );
  }, [relation.userId, runAction]);

  const handleStartDirect = useCallback(() => {
    const targetRef = (user?.publicRef ?? publicRef).trim();
    closeInfoPanel();
    navigate(buildDirectPath(targetRef));
  }, [closeInfoPanel, navigate, publicRef, user?.publicRef]);

  const isUserOnline = useMemo(() => {
    const targetRef = (user?.publicRef ?? publicRef).trim();
    if (!targetRef) return false;
    const normalizedTarget = normalize(targetRef);
    return presenceOnline.some(
      (entry) => normalize(entry.publicRef) === normalizedTarget,
    );
  }, [presenceOnline, publicRef, user?.publicRef]);

  if (loading) {
    return <UserProfilePanelSkeleton />;
  }

  if (error || !user) {
    return (
      <div className={styles.centered}>
        <p className={styles.meta}>Пользователь не найден</p>
      </div>
    );
  }

  const fullName =
    formatFullName(
      user.name,
      (user as { last_name?: string | null }).last_name,
    ) || resolveIdentityLabel(user, "Без имени");

    
  const targetPublicRef = (user.publicRef || publicRef || "").trim();
  const isSelf = relation.state === "self";
  const lastSeenLabel = formatLastSeen(user.lastSeen ?? null);
  const presenceLabel = isUserOnline
    ? "В сети"
    : `Был(а) в сети: ${lastSeenLabel || "давно"}`;
  const disabled = busy || relationLoading;

  return (
    <div className={styles.root}>
      <div className={styles.profile}>
        <Avatar
          username={resolveIdentityLabel({ name: fullName, username: user.username, publicRef: targetPublicRef }, "user")}
          profileImage={user.profileImage}
          avatarCrop={user.avatarCrop}
          size="default"
        />
        <h4 className={styles.peerName}>{fullName}</h4>
        {targetPublicRef && (
          <p className={styles.usernameHandle}>
            {formatPublicRef(targetPublicRef)}
          </p>
        )}
        <p className={styles.meta}>{presenceLabel}</p>

        {user.bio?.trim() ? (
          <div className={styles.bioSection}>
            <span className={styles.bioLabel}>О себе</span>
            <p className={styles.bioText}>{user.bio}</p>
          </div>
        ) : null}

        {actionStatus && <p className={styles.meta}>{actionStatus}</p>}

        {!isSelf && !relationLoading && (
          <div className={styles.profileActions}>
            {relation.state === "none" && (
              <>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonPrimary,
                  ].join(" ")}
                  onClick={handleAddFriend}
                  disabled={disabled}
                >
                  Добавить в друзья
                </button>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonGhost,
                  ].join(" ")}
                  onClick={handleStartDirect}
                  disabled={disabled}
                >
                  Написать сообщение
                </button>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonDanger,
                  ].join(" ")}
                  onClick={handleBlock}
                  disabled={disabled}
                >
                  Заблокировать
                </button>
              </>
            )}

            {relation.state === "outgoing" && (
              <>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonPrimary,
                  ].join(" ")}
                  onClick={handleCancelRequest}
                  disabled={disabled}
                >
                  Отменить запрос
                </button>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonGhost,
                  ].join(" ")}
                  onClick={handleStartDirect}
                  disabled={disabled}
                >
                  Написать сообщение
                </button>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonDanger,
                  ].join(" ")}
                  onClick={handleBlock}
                  disabled={disabled}
                >
                  Заблокировать
                </button>
              </>
            )}

            {relation.state === "incoming" && (
              <>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonPrimary,
                  ].join(" ")}
                  onClick={handleAcceptRequest}
                  disabled={disabled}
                >
                  Принять
                </button>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonGhost,
                  ].join(" ")}
                  onClick={handleDeclineRequest}
                  disabled={disabled}
                >
                  Отклонить
                </button>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonGhost,
                  ].join(" ")}
                  onClick={handleStartDirect}
                  disabled={disabled}
                >
                  Написать сообщение
                </button>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonDanger,
                  ].join(" ")}
                  onClick={handleBlock}
                  disabled={disabled}
                >
                  Заблокировать
                </button>
              </>
            )}

            {relation.state === "friend" && (
              <>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonGhost,
                  ].join(" ")}
                  onClick={handleRemoveFriend}
                  disabled={disabled}
                >
                  Удалить из друзей
                </button>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonGhost,
                  ].join(" ")}
                  onClick={handleStartDirect}
                  disabled={disabled}
                >
                  Написать сообщение
                </button>
                <button
                  type="button"
                  className={[
                    styles.actionButton,
                    styles.actionButtonDanger,
                  ].join(" ")}
                  onClick={handleBlock}
                  disabled={disabled}
                >
                  Заблокировать
                </button>
              </>
            )}

            {relation.state === "blocked" && (
              <button
                type="button"
                className={[styles.actionButton, styles.actionButtonGhost].join(
                  " ",
                )}
                onClick={handleUnblock}
                disabled={disabled}
              >
                Разблокировать
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

