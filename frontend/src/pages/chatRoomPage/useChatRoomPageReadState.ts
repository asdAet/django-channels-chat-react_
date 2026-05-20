import {
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { chatController } from "../../controllers/ChatController";
import { useReadTracker } from "../../shared/chat/readTracker";
import {
  useRoomReadController,
  useRoomReadState,
} from "../../shared/roomReadState";
import type {
  UseChatRoomPageReadStateOptions,
  UseChatRoomPageReadStateResult,
} from "./useChatRoomPageReadState.types";
import { useChatViewportAnchor } from "./useChatScrollHeightAnchor";
import type {
  InitialPositioningPhase,
  InitialPositioningTarget,
  UnreadDividerRenderTarget,
} from "./utils";
import {
  clearPendingReadFromStorage,
  isOwnMessage,
  MARK_READ_DEBOUNCE_MS,
  MAX_HISTORY_JUMP_ATTEMPTS,
  MAX_HISTORY_NO_PROGRESS_ATTEMPTS,
  normalizeReadMessageId,
  readPendingReadFromStorage,
  resolveCsrfToken,
  writePendingReadToStorage,
} from "./utils";

/**
 * Управляет прокруткой, непрочитанным разделителем и синхронизацией чтения.
 *
 * @param options Зависимости списка, роутинга и persist-состояния.
 * @returns Ссылки на список, read-state и обработчики навигации.
 */
export function useChatRoomPageReadState({
  roomId,
  roomIdForRequests,
  roomApiRef,
  locationSearch,
  user,
  details,
  messages,
  loading,
  loadingMore,
  hasMore,
  error,
  loadMore,
  currentActorRef,
  resolvedRoomId,
  setActiveRoom,
  markDirectRoomRead,
}: UseChatRoomPageReadStateOptions): UseChatRoomPageReadStateResult {
  const listRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const prependingRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const messagesRef = useRef(messages);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(loadingMore);
  const deepLinkedMessageRef = useRef<number | null>(null);
  const lastReadSentRef = useRef(0);
  const markReadTimerRef = useRef<number | null>(null);
  const viewportReadRafRef = useRef<number | null>(null);
  const deepLinkJumpRafRef = useRef<number | null>(null);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const pendingBottomStickyReadRef = useRef(false);
  const initialPositioningPhaseRef = useRef<InitialPositioningPhase>("pending");
  const initialPositioningTargetRef = useRef<InitialPositioningTarget | null>(
    null,
  );
  const paginationInteractionRef = useRef(false);
  const pendingReadFlushRef = useRef<number>(
    readPendingReadFromStorage(roomId),
  );
  const pendingInitialViewportSyncRef = useRef(false);
  const unreadDividerAnchorRef = useRef<number | null>(null);
  const lastMessageSnapshotRef = useRef<{
    count: number;
    lastId: number | null;
  }>({
    count: messages.length,
    lastId:
      messages.length > 0 ? (messages[messages.length - 1]?.id ?? null) : null,
  });

  const [isInitialPositioningSettled, setInitialPositioningSettled] =
    useState(false);
  const [pendingReadFloor, setPendingReadFloor] = useState(() =>
    readPendingReadFromStorage(roomId),
  );
  const [unreadDividerAnchorId, setUnreadDividerAnchorId] = useState<
    number | null
  >(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    number | null
  >(null);
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const {
    initializeRoom,
    applyLocalRead: applyRoomLocalRead,
    setRoomDivider,
    setPendingMarkRead,
    acknowledgeServerRead,
  } = useRoomReadController();
  const roomReadState = useRoomReadState(roomIdForRequests);

  const beginProgrammaticScroll = useCallback(() => {
    isProgrammaticScrollRef.current = true;
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = null;
    }
  }, []);

  const endProgrammaticScroll = useCallback(
    (onDone?: () => void, delayMs = 140) => {
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
      }

      programmaticScrollTimerRef.current = window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        programmaticScrollTimerRef.current = null;
        onDone?.();
      }, delayMs);
    },
    [],
  );

  const updateUnreadDividerAnchor = useCallback<
    UseChatRoomPageReadStateResult["updateUnreadDividerAnchor"]
  >(
    (nextAnchorId) => {
      unreadDividerAnchorRef.current = nextAnchorId;
      setUnreadDividerAnchorId((prev) =>
        prev === nextAnchorId ? prev : nextAnchorId,
      );
      setRoomDivider(roomIdForRequests, nextAnchorId);
    },
    [roomIdForRequests, setRoomDivider],
  );

  const persistPendingRead = useCallback(
    (lastReadMessageId: number | null | undefined) => {
      const normalized = normalizeReadMessageId(lastReadMessageId);
      if (normalized < 1) {
        return;
      }

      if (normalized <= pendingReadFlushRef.current) {
        return;
      }

      pendingReadFlushRef.current = normalized;
      setPendingReadFloor(normalized);
      setPendingMarkRead(roomIdForRequests, normalized);
      writePendingReadToStorage(roomId, normalized);
    },
    [roomId, roomIdForRequests, setPendingMarkRead],
  );

  const clearPendingRead = useCallback(
    (upTo: number | null | undefined) => {
      const normalized = normalizeReadMessageId(upTo);
      if (normalized < pendingReadFlushRef.current) {
        return;
      }

      pendingReadFlushRef.current = 0;
      setPendingReadFloor(0);
      setPendingMarkRead(roomIdForRequests, null);
      acknowledgeServerRead(roomIdForRequests, normalized);
      clearPendingReadFromStorage(roomId);
    },
    [acknowledgeServerRead, roomId, roomIdForRequests, setPendingMarkRead],
  );

  const readStateEnabled = Boolean(user);
  const effectiveServerLastReadMessageId = Math.max(
    normalizeReadMessageId(details?.lastReadMessageId),
    pendingReadFloor,
  );

  const {
    localLastReadMessageId: trackedLocalLastReadMessageId,
    firstUnreadMessageId: trackedFirstUnreadMessageId,
    localUnreadCount: trackedLocalUnreadCount,
    applyViewportRead,
  } = useReadTracker({
    messages,
    currentActorRef,
    serverLastReadMessageId: effectiveServerLastReadMessageId,
    enabled: Boolean(readStateEnabled && isInitialPositioningSettled),
    resetKey: roomId,
  });

  const localLastReadMessageId = readStateEnabled
    ? Math.max(
        trackedLocalLastReadMessageId,
        roomReadState?.localLastReadMessageId ?? 0,
      )
    : 0;
  const firstUnreadMessageId = readStateEnabled
    ? roomReadState?.initialized
      ? roomReadState.firstUnreadMessageId
      : trackedFirstUnreadMessageId
    : null;
  const localUnreadCount = readStateEnabled
    ? roomReadState?.initialized
      ? roomReadState.unreadCount
      : trackedLocalUnreadCount
    : 0;
  const loadedUnreadCount = readStateEnabled
    ? roomReadState?.initialized
      ? roomReadState.loadedUnreadCount
      : trackedLocalUnreadCount
    : 0;
  const roomDataReady =
    !loading &&
    ((details?.roomId !== undefined &&
      String(details.roomId) === roomIdForRequests) ||
      Boolean(error));
  const initialUnreadHistoryPending =
    readStateEnabled &&
    roomDataReady &&
    localUnreadCount > loadedUnreadCount &&
    hasMore;
  const shouldStartUnreadEntryFromBottom = useMemo(() => {
    if (!readStateEnabled || localUnreadCount < 1 || !firstUnreadMessageId) {
      return false;
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (isOwnMessage(message, currentActorRef)) {
        continue;
      }

      return message.id === firstUnreadMessageId;
    }

    return false;
  }, [
    currentActorRef,
    firstUnreadMessageId,
    localUnreadCount,
    messages,
    readStateEnabled,
  ]);

  const unreadDividerRenderTarget = useMemo<UnreadDividerRenderTarget>(() => {
    if (!roomDataReady && unreadDividerAnchorId === null) {
      return { messageId: null, insertAtTop: false };
    }

    if (
      unreadDividerAnchorId !== null &&
      messages.some((msg) => msg.id === unreadDividerAnchorId)
    ) {
      return { messageId: unreadDividerAnchorId, insertAtTop: false };
    }

    const fallbackAllowed = !isInitialPositioningSettled || showScrollFab;

    if (unreadDividerAnchorId !== null) {
      return {
        messageId: null,
        insertAtTop: messages.length > 0,
      };
    }

    if (localUnreadCount < 1) {
      return { messageId: null, insertAtTop: false };
    }

    if (
      fallbackAllowed &&
      firstUnreadMessageId &&
      messages.some((msg) => msg.id === firstUnreadMessageId)
    ) {
      return { messageId: firstUnreadMessageId, insertAtTop: false };
    }

    return {
      messageId: null,
      insertAtTop: fallbackAllowed && messages.length > 0,
    };
  }, [
    firstUnreadMessageId,
    isInitialPositioningSettled,
    localUnreadCount,
    messages,
    roomDataReady,
    showScrollFab,
    unreadDividerAnchorId,
  ]);

  const scrollMessageIntoView = useCallback((messageId: number) => {
    const list = listRef.current;
    if (!list) {
      return false;
    }

    const element = list.querySelector<HTMLElement>(
      `article[data-message-id="${messageId}"]`,
    );
    if (!element) {
      return false;
    }

    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      list.scrollTop = Math.max(0, element.offsetTop - list.clientHeight / 2);
    }

    setHighlightedMessageId(messageId);
    window.setTimeout(() => {
      setHighlightedMessageId((prev) => (prev === messageId ? null : prev));
    }, 1800);
    return true;
  }, []);

  const ensureMessageLoaded = useCallback(
    async (messageId: number) => {
      let attempts = 0;
      let noProgressAttempts = 0;
      let previousOldestId = messagesRef.current[0]?.id ?? null;

      while (
        !messagesRef.current.some((msg) => msg.id === messageId) &&
        hasMoreRef.current &&
        attempts < MAX_HISTORY_JUMP_ATTEMPTS
      ) {
        if (!loadingMoreRef.current) {
          await loadMore();
        }

        attempts += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 70));

        const currentOldestId = messagesRef.current[0]?.id ?? null;
        if (currentOldestId === previousOldestId) {
          noProgressAttempts += 1;
          if (noProgressAttempts >= MAX_HISTORY_NO_PROGRESS_ATTEMPTS) {
            break;
          }
        } else {
          previousOldestId = currentOldestId;
          noProgressAttempts = 0;
        }
      }

      return messagesRef.current.some((msg) => msg.id === messageId);
    },
    [loadMore],
  );

  const jumpToMessageById = useCallback(
    async (messageId: number) => {
      if (scrollMessageIntoView(messageId)) {
        return true;
      }

      const loaded = await ensureMessageLoaded(messageId);
      if (!loaded) {
        return false;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 40));
      return scrollMessageIntoView(messageId);
    },
    [ensureMessageLoaded, scrollMessageIntoView],
  );

  useEffect(() => {
    messagesRef.current = messages;
    hasMoreRef.current = hasMore;
    loadingMoreRef.current = loadingMore;
  }, [hasMore, loadingMore, messages]);

  useEffect(() => {
    return () => {
      if (markReadTimerRef.current !== null) {
        window.clearTimeout(markReadTimerRef.current);
      }
      if (viewportReadRafRef.current !== null) {
        window.cancelAnimationFrame(viewportReadRafRef.current);
      }
      if (deepLinkJumpRafRef.current !== null) {
        window.cancelAnimationFrame(deepLinkJumpRafRef.current);
      }
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
      }

      isProgrammaticScrollRef.current = false;
    };
  }, []);

  const sendMarkReadIfNeeded = useCallback(
    (lastReadMessageId: number | null | undefined) => {
      if (
        !readStateEnabled ||
        !lastReadMessageId ||
        lastReadMessageId < 1 ||
        !roomApiRef
      ) {
        return;
      }

      persistPendingRead(lastReadMessageId);
      if (lastReadMessageId <= lastReadSentRef.current) {
        return;
      }

      lastReadSentRef.current = lastReadMessageId;
      void chatController
        .markRead(roomApiRef, lastReadMessageId)
        .then(() => {
          clearPendingRead(lastReadMessageId);
        })
        .catch(() => {
          if (lastReadSentRef.current === lastReadMessageId) {
            lastReadSentRef.current = Math.max(0, lastReadMessageId - 1);
          }
        });
    },
    [clearPendingRead, persistPendingRead, readStateEnabled, roomApiRef],
  );

  const isDirectRoomFullyRead = useCallback(
    (lastReadMessageId: number) => {
      if (!user || details?.kind !== "direct" || resolvedRoomId === null) {
        return false;
      }

      for (let index = messagesRef.current.length - 1; index >= 0; index -= 1) {
        const message = messagesRef.current[index];
        if (isOwnMessage(message, currentActorRef)) {
          continue;
        }

        return lastReadMessageId >= message.id;
      }

      return true;
    },
    [currentActorRef, details?.kind, resolvedRoomId, user],
  );

  const scheduleMarkRead = useCallback(
    (lastReadMessageId: number | null | undefined) => {
      if (!readStateEnabled || !lastReadMessageId || lastReadMessageId < 1) {
        return;
      }

      if (markReadTimerRef.current !== null) {
        window.clearTimeout(markReadTimerRef.current);
      }

      markReadTimerRef.current = window.setTimeout(() => {
        markReadTimerRef.current = null;
        sendMarkReadIfNeeded(lastReadMessageId);
        if (
          resolvedRoomId !== null &&
          isDirectRoomFullyRead(lastReadMessageId)
        ) {
          markDirectRoomRead(resolvedRoomId);
        }
      }, MARK_READ_DEBOUNCE_MS);
    },
    [
      isDirectRoomFullyRead,
      markDirectRoomRead,
      readStateEnabled,
      resolvedRoomId,
      sendMarkReadIfNeeded,
    ],
  );

  const flushPendingRead = useCallback(() => {
    if (!readStateEnabled) {
      return;
    }

    const baseline = normalizeReadMessageId(details?.lastReadMessageId);
    const candidate = Math.max(
      pendingReadFlushRef.current,
      normalizeReadMessageId(localLastReadMessageId),
    );
    if (candidate < 1 || candidate <= baseline || !roomApiRef) {
      return;
    }

    persistPendingRead(candidate);
    const encodedRoomId = encodeURIComponent(roomApiRef);
    const url = `/api/chat/${encodedRoomId}/read/`;
    const csrfToken = resolveCsrfToken();
    let beaconSent = false;

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const formData = new FormData();
      formData.append("lastReadMessageId", String(candidate));
      if (csrfToken) {
        formData.append("csrfmiddlewaretoken", csrfToken);
      }
      beaconSent = navigator.sendBeacon(url, formData);
    }

    if (beaconSent || typeof fetch !== "function") {
      return;
    }

    const headers = new Headers({ "Content-Type": "application/json" });
    if (csrfToken) {
      headers.set("X-CSRFToken", csrfToken);
    }

    void fetch(url, {
      method: "POST",
      body: JSON.stringify({ lastReadMessageId: candidate }),
      headers,
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {
      // Keep pending read marker in storage; it will be retried on next session.
    });
  }, [
    details?.lastReadMessageId,
    localLastReadMessageId,
    persistPendingRead,
    roomApiRef,
    readStateEnabled,
  ]);

  /**
   * Синхронно фиксирует прочитанные сообщения по текущему viewport.
   *
   * Используется после программного доскролла вниз, когда новое входящее
   * сообщение уже попало в экран и badge должен уменьшиться без дополнительного
   * scroll-события от пользователя.
   *
   * @param listOverride Явный контейнер списка, если нужно использовать уже
   *   захваченный экземпляр DOM-узла.
   * @returns Последний id сообщения, который удалось считать прочитанным.
   */
  const applyViewportReadNow = useCallback(
    (listOverride?: HTMLDivElement | null) => {
      const nextLastRead = applyViewportRead(listOverride ?? listRef.current);
      persistPendingRead(nextLastRead);
      const latestVisibleMessageId =
        messagesRef.current.length > 0
          ? (messagesRef.current[messagesRef.current.length - 1]?.id ?? 0)
          : 0;
      if (nextLastRead > 0 && nextLastRead <= latestVisibleMessageId) {
        applyRoomLocalRead({
          roomId: roomIdForRequests,
          lastReadMessageId: nextLastRead,
          messages: messagesRef.current,
          currentActorRef,
        });
        sendMarkReadIfNeeded(nextLastRead);
        if (resolvedRoomId !== null && isDirectRoomFullyRead(nextLastRead)) {
          markDirectRoomRead(resolvedRoomId);
        }
      }

      return nextLastRead;
    },
    [
      applyRoomLocalRead,
      applyViewportRead,
      currentActorRef,
      isDirectRoomFullyRead,
      markDirectRoomRead,
      persistPendingRead,
      resolvedRoomId,
      roomIdForRequests,
      sendMarkReadIfNeeded,
    ],
  );

  const scheduleViewportReadSync = useCallback(() => {
    if (!readStateEnabled) {
      return;
    }
    if (initialPositioningPhaseRef.current !== "settled") {
      return;
    }
    if (isProgrammaticScrollRef.current) {
      return;
    }
    if (viewportReadRafRef.current !== null) {
      return;
    }

    viewportReadRafRef.current = window.requestAnimationFrame(() => {
      viewportReadRafRef.current = null;
      applyViewportReadNow(listRef.current);
    });
  }, [applyViewportReadNow, readStateEnabled]);

  const shouldSuspendScrollHeightAnchor = useCallback(
    () =>
      prependingRef.current || initialPositioningPhaseRef.current !== "settled",
    [],
  );

  useChatViewportAnchor({
    listRef,
    enabled: isInitialPositioningSettled,
    isAtBottomRef,
    beginProgrammaticScroll,
    endProgrammaticScroll,
    scheduleViewportReadSync,
    shouldSuspend: shouldSuspendScrollHeightAnchor,
  });

  useEffect(() => {
    if (!readStateEnabled) {
      return;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingRead();
      }
    };
    const onPageHide = () => {
      flushPendingRead();
    };
    const onBeforeUnload = () => {
      flushPendingRead();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flushPendingRead, readStateEnabled]);

  useEffect(() => {
    return () => {
      if (!readStateEnabled) {
        return;
      }

      const baseline = normalizeReadMessageId(details?.lastReadMessageId);
      const pending = pendingReadFlushRef.current;
      if (pending <= baseline) {
        return;
      }

      sendMarkReadIfNeeded(pending);
    };
  }, [details?.lastReadMessageId, readStateEnabled, sendMarkReadIfNeeded]);

  useEffect(() => {
    if (!user || details?.kind !== "direct" || resolvedRoomId === null) {
      return;
    }

    setActiveRoom(resolvedRoomId);
    return () => {
      setActiveRoom(null);
    };
  }, [details?.kind, resolvedRoomId, setActiveRoom, user]);

  useEffect(() => {
    if (!readStateEnabled || !roomDataReady) {
      return;
    }

    initializeRoom({
      roomId: roomIdForRequests,
      serverLastReadMessageId: normalizeReadMessageId(
        details?.lastReadMessageId,
      ),
      pendingMarkReadMessageId: pendingReadFlushRef.current,
      messages,
      currentActorRef,
    });
  }, [
    currentActorRef,
    details?.lastReadMessageId,
    initializeRoom,
    messages,
    readStateEnabled,
    roomDataReady,
    roomReadState?.lastAuthoritativeVersion,
    roomIdForRequests,
  ]);

  useEffect(() => {
    if (!readStateEnabled || !roomDataReady || localLastReadMessageId < 1) {
      return;
    }

    applyRoomLocalRead({
      roomId: roomIdForRequests,
      lastReadMessageId: localLastReadMessageId,
      messages,
      currentActorRef,
    });
  }, [
    applyRoomLocalRead,
    currentActorRef,
    localLastReadMessageId,
    messages,
    readStateEnabled,
    roomDataReady,
    roomIdForRequests,
  ]);

  useEffect(() => {
    if (!readStateEnabled || !roomDataReady || localUnreadCount > 0) {
      return;
    }

    if (unreadDividerAnchorRef.current !== null) {
      updateUnreadDividerAnchor(null);
    }
  }, [
    localUnreadCount,
    readStateEnabled,
    roomDataReady,
    updateUnreadDividerAnchor,
  ]);

  useEffect(() => {
    if (!initialUnreadHistoryPending) {
      return;
    }
    if (initialPositioningPhaseRef.current !== "pending") {
      return;
    }
    if (initialPositioningTargetRef.current !== null) {
      return;
    }
    if (loadingMore || loading) {
      return;
    }

    void loadMore();
  }, [initialUnreadHistoryPending, loadMore, loading, loadingMore]);

  useEffect(() => {
    if (!roomDataReady) {
      return;
    }
    if (initialUnreadHistoryPending) {
      return;
    }
    if (initialPositioningPhaseRef.current !== "pending") {
      return;
    }
    if (initialPositioningTargetRef.current !== null) {
      return;
    }

    if (localUnreadCount > 0 && firstUnreadMessageId) {
      unreadDividerAnchorRef.current = firstUnreadMessageId;
      initialPositioningTargetRef.current = shouldStartUnreadEntryFromBottom
        ? "bottom"
        : "unread";
      return;
    }

    initialPositioningTargetRef.current = "bottom";
  }, [
    firstUnreadMessageId,
    initialUnreadHistoryPending,
    localUnreadCount,
    roomDataReady,
    shouldStartUnreadEntryFromBottom,
  ]);

  useEffect(() => {
    if (!roomDataReady) {
      return;
    }
    if (initialPositioningPhaseRef.current !== "pending") {
      return;
    }

    const initialTarget = initialPositioningTargetRef.current;
    if (!initialTarget) {
      return;
    }

    initialPositioningPhaseRef.current = "positioning";

    const list = listRef.current;
    if (!list) {
      window.requestAnimationFrame(() => {
        const latestMessages = messagesRef.current;
        lastMessageSnapshotRef.current = {
          count: latestMessages.length,
          lastId:
            latestMessages.length > 0
              ? (latestMessages[latestMessages.length - 1]?.id ?? null)
              : null,
        };
        pendingInitialViewportSyncRef.current = true;
        initialPositioningPhaseRef.current = "settled";
        setInitialPositioningSettled(true);
      });
      return;
    }

    beginProgrammaticScroll();
    window.requestAnimationFrame(() => {
      const unreadAnchorId = unreadDividerAnchorRef.current;
      if (initialTarget === "unread" && unreadAnchorId !== null) {
        updateUnreadDividerAnchor(unreadAnchorId);
      }

      const unreadTarget =
        initialTarget === "unread" && unreadAnchorId !== null
          ? list.querySelector<HTMLElement>(
              `article[data-message-id="${unreadAnchorId}"]`,
            )
          : null;

      if (unreadTarget) {
        if (typeof unreadTarget.scrollIntoView === "function") {
          unreadTarget.scrollIntoView({ block: "center" });
        } else {
          list.scrollTop = Math.max(
            0,
            unreadTarget.offsetTop - list.clientHeight / 2,
          );
        }
      } else {
        list.scrollTop = list.scrollHeight;
      }

      const atBottom =
        list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      isAtBottomRef.current = atBottom;
      setShowScrollFab(!atBottom);
      if (atBottom) {
        setNewMsgCount(0);
      }

      endProgrammaticScroll(() => {
        const latestMessages = messagesRef.current;
        lastMessageSnapshotRef.current = {
          count: latestMessages.length,
          lastId:
            latestMessages.length > 0
              ? (latestMessages[latestMessages.length - 1]?.id ?? null)
              : null,
        };
        pendingInitialViewportSyncRef.current = true;
        initialPositioningPhaseRef.current = "settled";
        setInitialPositioningSettled(true);
      });
    });
  }, [
    beginProgrammaticScroll,
    endProgrammaticScroll,
    roomDataReady,
    scheduleViewportReadSync,
    updateUnreadDividerAnchor,
  ]);

  useEffect(() => {
    if (!isInitialPositioningSettled) {
      return;
    }
    if (!pendingInitialViewportSyncRef.current) {
      return;
    }

    pendingInitialViewportSyncRef.current = false;
    scheduleViewportReadSync();
  }, [isInitialPositioningSettled, scheduleViewportReadSync]);

  useEffect(() => {
    if (!isInitialPositioningSettled || !user || localLastReadMessageId < 1) {
      return;
    }

    const persistedServerLastReadMessageId = normalizeReadMessageId(
      details?.lastReadMessageId,
    );
    if (localLastReadMessageId <= persistedServerLastReadMessageId) {
      return;
    }

    scheduleMarkRead(localLastReadMessageId);
  }, [
    details?.lastReadMessageId,
    isInitialPositioningSettled,
    localLastReadMessageId,
    scheduleMarkRead,
    user,
  ]);

  useEffect(() => {
    if (deepLinkJumpRafRef.current !== null) {
      window.cancelAnimationFrame(deepLinkJumpRafRef.current);
      deepLinkJumpRafRef.current = null;
    }

    const searchParams = new URLSearchParams(locationSearch);
    const raw = searchParams.get("message");
    if (!raw) {
      deepLinkedMessageRef.current = null;
      return;
    }

    const targetId = Number(raw);
    if (!Number.isFinite(targetId) || targetId < 1) {
      return;
    }
    if (deepLinkedMessageRef.current === targetId) {
      return;
    }

    deepLinkedMessageRef.current = targetId;
    deepLinkJumpRafRef.current = window.requestAnimationFrame(() => {
      deepLinkJumpRafRef.current = null;
      void jumpToMessageById(targetId);
    });
  }, [jumpToMessageById, locationSearch]);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const list = listRef.current;
      if (!list) {
        return;
      }
      if (initialPositioningPhaseRef.current !== "settled") {
        return;
      }
      if (isProgrammaticScrollRef.current) {
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = list;
      const atBottom = scrollHeight - scrollTop - clientHeight < 80;
      isAtBottomRef.current = atBottom;
      setShowScrollFab(!atBottom);
      if (atBottom) {
        setNewMsgCount(0);
      } else if (
        readStateEnabled &&
        unreadDividerAnchorRef.current === null &&
        localUnreadCount > 0 &&
        firstUnreadMessageId
      ) {
        updateUnreadDividerAnchor(firstUnreadMessageId);
      }
      scheduleViewportReadSync();

      const isUserInitiatedScroll = Boolean(
        (event.nativeEvent as Event | undefined)?.isTrusted,
      );
      if (
        isUserInitiatedScroll &&
        paginationInteractionRef.current &&
        scrollTop < 120 &&
        hasMore &&
        !loadingMore &&
        !loading
      ) {
        prependingRef.current = true;
        prevScrollHeightRef.current = scrollHeight;
        void loadMore();
      }
    },
    [
      firstUnreadMessageId,
      hasMore,
      loadMore,
      loading,
      loadingMore,
      localUnreadCount,
      readStateEnabled,
      scheduleViewportReadSync,
      updateUnreadDividerAnchor,
    ],
  );

  const armPaginationInteraction = useCallback(() => {
    if (initialPositioningPhaseRef.current !== "settled") {
      return;
    }

    paginationInteractionRef.current = true;
  }, []);

  const scrollToBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const snapToBottom = () => {
      const nextList = listRef.current;
      if (!nextList) {
        return;
      }

      nextList.scrollTop = nextList.scrollHeight;
    };

    beginProgrammaticScroll();
    if (typeof list.scrollTo === "function") {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    } else {
      list.scrollTop = list.scrollHeight;
    }

    isAtBottomRef.current = true;
    setShowScrollFab(false);
    setNewMsgCount(0);

    requestAnimationFrame(() => {
      snapToBottom();
      requestAnimationFrame(() => {
        snapToBottom();
        endProgrammaticScroll(() => {
          window.requestAnimationFrame(() => {
            applyViewportReadNow(listRef.current);
          });
        }, 120);
      });
    });
  }, [applyViewportReadNow, beginProgrammaticScroll, endProgrammaticScroll]);

  useEffect(() => {
    const previousSnapshot = lastMessageSnapshotRef.current;
    const currentSnapshot = {
      count: messages.length,
      lastId:
        messages.length > 0
          ? (messages[messages.length - 1]?.id ?? null)
          : null,
    };
    lastMessageSnapshotRef.current = currentSnapshot;

    if (!isInitialPositioningSettled) {
      return;
    }

    const list = listRef.current;
    if (!list) {
      return;
    }

    if (prependingRef.current) {
      const delta = list.scrollHeight - prevScrollHeightRef.current;
      list.scrollTop += delta;
      prependingRef.current = false;
      return;
    }

    const appendedNewMessage =
      currentSnapshot.count > previousSnapshot.count &&
      currentSnapshot.lastId !== null &&
      currentSnapshot.lastId !== previousSnapshot.lastId;
    if (!appendedNewMessage) {
      return;
    }
    const shouldStickToBottom =
      pendingBottomStickyReadRef.current || isAtBottomRef.current;
    pendingBottomStickyReadRef.current = false;
    if (!shouldStickToBottom) {
      return;
    }

    beginProgrammaticScroll();
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
      endProgrammaticScroll(() => {
        window.requestAnimationFrame(() => {
          applyViewportReadNow(list);
        });
      }, 80);
    });
  }, [
    applyViewportReadNow,
    beginProgrammaticScroll,
    endProgrammaticScroll,
    isInitialPositioningSettled,
    messages,
  ]);

  const handleIncomingForeignMessage = useCallback<
    UseChatRoomPageReadStateResult["handleIncomingForeignMessage"]
  >(
    (messageId) => {
      if (isAtBottomRef.current) {
        pendingBottomStickyReadRef.current = true;
        return;
      }

      setNewMsgCount((count) => count + 1);
      if (readStateEnabled && unreadDividerAnchorRef.current === null) {
        updateUnreadDividerAnchor(messageId);
      }
    },
    [readStateEnabled, updateUnreadDividerAnchor],
  );

  return {
    listRef,
    highlightedMessageId,
    showScrollFab,
    newMsgCount,
    unreadDividerAnchorId,
    unreadDividerRenderTarget,
    localLastReadMessageId,
    updateUnreadDividerAnchor,
    handleIncomingForeignMessage,
    handleScroll,
    armPaginationInteraction,
    scrollToBottom,
    jumpToMessageById,
  };
}
