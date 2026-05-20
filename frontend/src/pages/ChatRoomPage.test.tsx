import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../entities/message/types";
import type { RoomDetails } from "../entities/room/types";
import { NotificationProvider } from "../shared/notifications";

const wsState = vi.hoisted(() => ({
  status: "online" as "online" | "connecting" | "offline" | "error" | "closed",
  lastError: null as string | null,
  send: vi.fn<(payload: string) => boolean>(),
  options: null as {
    roomId?: number | null;
    onMessage?: (event: MessageEvent) => void;
    onOpen?: () => void;
    onClose?: (event: CloseEvent) => void;
    onError?: (event: Event) => void;
  } | null,
}));

const chatRoomMock = vi.hoisted(() => ({
  details: {
    roomId: 1,
    name: "Public",
    kind: "public",
    created: false,
    createdBy: null,
  } as RoomDetails,
  messages: [] as Message[],
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: null as string | null,
  loadMore: vi.fn(),
  reload: vi.fn(),
  setMessages: vi.fn(),
}));

const presenceMock = vi.hoisted(() => ({
  online: [] as Array<{
    publicRef: string;
    username: string;
    profileImage: string | null;
  }>,
  guests: 0,
  status: "online" as const,
  lastError: null as string | null,
}));

const infoPanelMock = vi.hoisted(() => ({
  open: vi.fn(),
}));

const mobileShellMock = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
  toggleDrawer: vi.fn(),
  isDrawerOpen: false,
  isMobileViewport: false,
}));

const directInboxMock = vi.hoisted(() => ({
  setActiveRoom: vi.fn(),
  markRead: vi.fn(),
}));

const locationMock = vi.hoisted(() => ({
  search: "",
  pathname: "/public",
}));

const permissionsMock = vi.hoisted(() => ({
  loading: false,
  raw: null,
  isMember: true,
  isBanned: false,
  canJoin: false,
  canRead: true,
  canWrite: true,
  canAttachFiles: true,
  canReact: true,
  canManageMessages: false,
  canManageRoles: false,
  canManageRoom: false,
  canKick: false,
  canBan: false,
  canInvite: false,
  canMute: false,
  isAdmin: false,
  refresh: vi.fn().mockResolvedValue(undefined),
}));

const groupControllerMock = vi.hoisted(() => ({
  joinGroup: vi.fn().mockResolvedValue(undefined),
}));

const chatControllerMock = vi.hoisted(() => ({
  editMessage: vi.fn().mockResolvedValue({}),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  addReaction: vi.fn().mockResolvedValue({}),
  removeReaction: vi.fn().mockResolvedValue(undefined),
  searchMessages: vi.fn().mockResolvedValue({ results: [] }),
  uploadAttachments: vi.fn().mockResolvedValue({}),
  markRead: vi.fn().mockResolvedValue({}),
  getMessageReaders: vi.fn().mockResolvedValue({
    roomKind: "direct",
    messageId: 1,
    readAt: null,
    readers: [],
  }),
}));

const customEmojiMock = vi.hoisted(() => ({
  emoji: {
    id: "Adaptive/1.webp",
    packId: "Adaptive",
    packName: "Adaptive",
    fileName: "1.webp",
    assetKind: "webp" as const,
    label: "Adaptive 1",
    src: null,
    token: "[[ce:Adaptive%2F1.webp]]",
  },
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => locationMock,
}));

vi.mock("../hooks/useChatRoom", () => ({
  useChatRoom: () => chatRoomMock,
}));

vi.mock("../hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("../shared/chatRealtime", () => ({
  useChatRealtimeRoom: (options: unknown) => {
    wsState.options = options as {
      roomId?: number | null;
      onMessage?: (event: MessageEvent) => void;
      onOpen?: () => void;
      onClose?: (event: CloseEvent) => void;
      onError?: (event: Event) => void;
    };
    return {
      status: wsState.status,
      lastError: wsState.lastError,
      send: wsState.send,
    };
  },
}));

vi.mock("../shared/presence", () => ({
  usePresence: () => presenceMock,
}));

vi.mock("../hooks/useTypingIndicator", () => ({
  useTypingIndicator: () => ({ sendTyping: vi.fn() }),
}));

vi.mock("../hooks/useRoomPermissions", () => ({
  useRoomPermissions: () => permissionsMock,
}));

vi.mock("../shared/directInbox", () => ({
  useDirectInbox: () => directInboxMock,
}));

vi.mock("../shared/config/limits", () => ({
  useChatMessageMaxLength: () => 2000,
  useChatAttachmentMaxSizeMb: () => 10,
  useChatAttachmentMaxPerMessage: () => 5,
  useChatAttachmentAllowedTypes: () => [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/plain",
    "video/mp4",
    "audio/mpeg",
    "audio/webm",
  ],
}));

vi.mock("../shared/layout/useInfoPanel", () => ({
  useInfoPanel: () => infoPanelMock,
}));

vi.mock("../shared/layout/useMobileShell", () => ({
  useMobileShell: () => mobileShellMock,
}));

vi.mock("../controllers/ChatController", () => ({
  chatController: chatControllerMock,
}));

vi.mock("../controllers/GroupController", () => ({
  groupController: groupControllerMock,
}));

vi.mock("../widgets/chat/TelegramEmojiPicker", () => ({
  TelegramEmojiPicker: ({
    onSelect,
  }: {
    onSelect: (emoji: typeof customEmojiMock.emoji) => void;
    onClose: () => void;
  }) => (
    <button type="button" onClick={() => onSelect(customEmojiMock.emoji)}>
      Mock custom emoji
    </button>
  ),
}));

import { ChatRoomPage } from "./ChatRoomPage";

type RenderOptions = Parameters<typeof rtlRender>[1];

const render = (ui: ReactElement, options?: RenderOptions) => {
  const UserWrapper = options?.wrapper;

  return rtlRender(ui, {
    ...options,
    wrapper: ({ children }: { children: ReactNode }) => (
      <NotificationProvider>
        {UserWrapper ? <UserWrapper>{children}</UserWrapper> : children}
      </NotificationProvider>
    ),
  });
};

const user = {
  publicRef: "demo",
  username: "demo",
  email: "demo@example.com",
  profileImage: null,
  bio: "",
  lastSeen: null,
  registeredAt: null,
};

const formatReadReceiptTimestamp = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));

const HEADER_SEARCH_DEBOUNCE_MS = 260;

const createDomRect = ({
  top,
  left,
  width,
  height,
}: {
  top: number;
  left: number;
  width: number;
  height: number;
}): DOMRect =>
  ({
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }) as DOMRect;

const setComposerText = (value: string) => {
  const input = screen.getByTestId("chat-message-input");
  input.textContent = value;
  fireEvent.input(input);
  return input;
};

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const installMobileViewport = () => {
  const originalMatchMedia = window.matchMedia;
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;
  const originalMaxTouchPoints = window.navigator.maxTouchPoints;

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 390,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 844,
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: 1,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query.includes("pointer: coarse") ||
        query.includes("any-pointer: coarse") ||
        query.includes("hover: none"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  return () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: originalMaxTouchPoints,
    });
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
      return;
    }
    Reflect.deleteProperty(window, "matchMedia");
  };
};

const mockResizeObservers: MockResizeObserver[] = [];

class MockResizeObserver {
  private readonly callback: ResizeObserverCallback;
  private readonly observedElements = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    mockResizeObservers.push(this);
  }

  observe = vi.fn((element: Element) => {
    this.observedElements.add(element);
  });

  unobserve = vi.fn((element: Element) => {
    this.observedElements.delete(element);
  });

  disconnect = vi.fn(() => {
    this.observedElements.clear();
  });

  trigger = () => {
    this.callback(
      Array.from(this.observedElements).map(
        (target) => ({ target }) as ResizeObserverEntry,
      ),
      this as unknown as ResizeObserver,
    );
  };
}

const installMockResizeObserver = () => {
  mockResizeObservers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    MockResizeObserver as unknown as typeof ResizeObserver,
  );
};

const triggerMockResizeObservers = () => {
  mockResizeObservers.forEach((observer) => observer.trigger());
};

/**
 * Создает сообщение от другого пользователя для проверки прав.
 * @param id Идентификатор сущности.
 * @param content Текстовое содержимое.
 * @returns Возвращает значение типа Message.
 */
const makeForeignMessage = (id: number, content: string): Message => ({
  id,
  publicRef: "alice",
  username: "alice",
  content,
  profilePic: null,
  createdAt: `2026-02-13T12:0${Math.max(0, id - 1)}:00.000Z`,
  editedAt: null,
  isDeleted: false,
  replyTo: null,
  attachments: [],
  reactions: [],
});

describe("ChatRoomPage", () => {
  beforeEach(() => {
    vi.useRealTimers();
    wsState.status = "online";
    wsState.lastError = null;
    wsState.send.mockReset().mockReturnValue(true);
    wsState.options = null;

    chatRoomMock.details = {
      roomId: 1,
      name: "Public",
      kind: "public",
      created: false,
      createdBy: null,
    } as RoomDetails;
    chatRoomMock.messages = [];
    chatRoomMock.loading = false;
    chatRoomMock.loadingMore = false;
    chatRoomMock.hasMore = false;
    chatRoomMock.error = null;
    chatRoomMock.loadMore.mockReset();
    chatRoomMock.reload.mockReset();
    chatRoomMock.setMessages.mockReset();
    chatRoomMock.setMessages.mockImplementation(
      (updater: ((prev: Message[]) => Message[]) | Message[]) => {
        chatRoomMock.messages =
          typeof updater === "function"
            ? updater(chatRoomMock.messages)
            : updater;
      },
    );
    permissionsMock.loading = false;
    permissionsMock.raw = null;
    permissionsMock.isMember = true;
    permissionsMock.isBanned = false;
    permissionsMock.canJoin = false;
    permissionsMock.canRead = true;
    permissionsMock.canWrite = true;
    permissionsMock.canAttachFiles = true;
    permissionsMock.canReact = true;
    permissionsMock.canManageMessages = false;
    permissionsMock.canManageRoles = false;
    permissionsMock.canManageRoom = false;
    permissionsMock.canKick = false;
    permissionsMock.canBan = false;
    permissionsMock.canInvite = false;
    permissionsMock.canMute = false;
    permissionsMock.isAdmin = false;
    permissionsMock.refresh.mockReset().mockResolvedValue(undefined);
    groupControllerMock.joinGroup.mockReset().mockResolvedValue(undefined);
    chatControllerMock.addReaction.mockReset().mockResolvedValue({});
    chatControllerMock.removeReaction.mockReset().mockResolvedValue(undefined);
    chatControllerMock.uploadAttachments.mockReset().mockResolvedValue({});
    chatControllerMock.markRead.mockReset().mockResolvedValue({});
    chatControllerMock.searchMessages.mockReset().mockResolvedValue({
      results: [],
    });
    chatControllerMock.getMessageReaders.mockReset().mockResolvedValue({
      roomKind: "direct",
      messageId: 1,
      readAt: null,
      readers: [],
    });
    presenceMock.online = [];
    presenceMock.status = "online";
    presenceMock.lastError = null;
    infoPanelMock.open.mockReset();
    mobileShellMock.openDrawer.mockReset();
    mobileShellMock.closeDrawer.mockReset();
    mobileShellMock.toggleDrawer.mockReset();
    mobileShellMock.isDrawerOpen = false;
    mobileShellMock.isMobileViewport = false;
    directInboxMock.setActiveRoom.mockReset();
    directInboxMock.markRead.mockReset();
    locationMock.search = "";
    locationMock.pathname = "/public";
    Object.defineProperty(window.navigator, "sendBeacon", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 720,
    });
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("shows read-only mode for guest in public room", () => {
    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={null}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByTestId("chat-auth-callout")).toBeInTheDocument();
    expect(screen.queryByLabelText("Сообщение")).toBeNull();
  });

  it("renders the public chat avatar icon in the chat header", () => {
    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByTestId("chat-header-public-icon")).toBeInTheDocument();
  });

  it("binds realtime to the resolved numeric room id", () => {
    chatRoomMock.details = {
      roomId: 7,
      name: "General",
      kind: "public",
      created: false,
      createdBy: null,
    } as RoomDetails;

    render(
      <ChatRoomPage
        roomId="general"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    expect(wsState.options?.roomId).toBe(7);
  });

  it("shows realtime errors through the notification service", () => {
    wsState.status = "error";
    wsState.lastError = "connection_error";

    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByTestId("notification-viewport")).toBeInTheDocument();
    expect(screen.getByText("Проблемы с соединением")).toBeInTheDocument();
    expect(
      screen.getByText("Проверьте сеть и попробуйте еще раз."),
    ).toBeInTheDocument();
  });

  it("opens the mobile drawer from room chats", () => {
    locationMock.pathname = "/public";

    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-mobile-open-button"));
    expect(mobileShellMock.openDrawer).toHaveBeenCalledTimes(1);
  });

  it("renders header search in a top-level layer and closes only on outside click", () => {
    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const searchButton = screen.getByTestId(
      "chat-header-search-anchor",
    ) as HTMLButtonElement;
    Object.defineProperty(searchButton, "getBoundingClientRect", {
      configurable: true,
      value: () => createDomRect({ top: 12, left: 280, width: 44, height: 44 }),
    });

    fireEvent.click(searchButton);

    const searchLayer = screen.getByTestId("chat-header-search-layer");
    expect(searchLayer).toBeInTheDocument();
    expect(
      within(screen.getByTestId("chat-header-actions")).queryByTestId(
        "chat-header-search-layer",
      ),
    ).toBeNull();

    fireEvent.mouseDown(within(searchLayer).getByRole("textbox"));
    expect(screen.getByTestId("chat-header-search-layer")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("chat-header-search-layer")).toBeNull();
  });

  it("clamps header search layer to the viewport on narrow screens", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 500,
    });

    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const searchButton = screen.getByTestId(
      "chat-header-search-anchor",
    ) as HTMLButtonElement;
    Object.defineProperty(searchButton, "getBoundingClientRect", {
      configurable: true,
      value: () => createDomRect({ top: 18, left: 270, width: 44, height: 44 }),
    });

    fireEvent.click(searchButton);

    const searchLayer = screen.getByTestId(
      "chat-header-search-layer",
    ) as HTMLDivElement;
    expect(searchLayer.style.left).toBe("8px");
    expect(searchLayer.style.width).toBe("304px");
    expect(searchLayer.style.maxHeight).toBe("418px");
  });

  it("closes header search after selecting a result from the top-level layer", async () => {
    vi.useFakeTimers();
    chatControllerMock.searchMessages.mockResolvedValueOnce({
      results: [
        {
          id: 17,
          publicRef: "alice",
          username: "alice",
          displayName: "Alice",
          content: "Found message",
          createdAt: "2026-02-13T12:10:00.000Z",
          highlight: "Found message",
        },
      ],
    });

    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const searchButton = screen.getByTestId(
      "chat-header-search-anchor",
    ) as HTMLButtonElement;
    Object.defineProperty(searchButton, "getBoundingClientRect", {
      configurable: true,
      value: () => createDomRect({ top: 12, left: 280, width: 44, height: 44 }),
    });

    fireEvent.click(searchButton);
    fireEvent.change(
      within(screen.getByTestId("chat-header-search-layer")).getByRole(
        "textbox",
      ),
      {
        target: { value: "found" },
      },
    );

    await act(async () => {
      vi.advanceTimersByTime(HEADER_SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(chatControllerMock.searchMessages).toHaveBeenCalledWith(
      "1",
      "found",
    );

    const resultText = screen.getByText("Found message");
    fireEvent.click(resultText);

    expect(screen.queryByTestId("chat-header-search-layer")).toBeNull();
  });

  it("sends message for authenticated user", () => {
    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    setComposerText("Hello from test");
    fireEvent.click(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    );

    const payload = wsState.send.mock.calls
      .map(([rawPayload]) => JSON.parse(rawPayload))
      .find((item) => item.message === "Hello from test");
    expect(payload).toBeTruthy();
    expect(payload.message).toBe("Hello from test");
    expect(payload.username).toBe("demo");
    expect(payload.clientMessageId).toEqual(expect.any(String));
    expect(chatRoomMock.messages).toEqual([
      expect.objectContaining({
        id: -1,
        clientMessageId: payload.clientMessageId,
        deliveryStatus: "pending",
        content: "Hello from test",
        publicRef: "demo",
      }),
    ]);
  });

  it("replaces optimistic own message with the server websocket echo", () => {
    const { rerender } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    setComposerText("fast path");
    fireEvent.click(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    );

    const outbound = JSON.parse(wsState.send.mock.calls.at(-1)?.[0] ?? "{}");
    expect(chatRoomMock.messages[0]).toEqual(
      expect.objectContaining({
        id: -1,
        clientMessageId: outbound.clientMessageId,
        deliveryStatus: "pending",
      }),
    );

    act(() => {
      wsState.options?.onMessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            id: 51,
            message: "fast path",
            publicRef: "demo",
            username: "demo",
            roomId: 1,
            clientMessageId: outbound.clientMessageId,
            createdAt: "2026-02-13T12:03:00.000Z",
            attachments: [],
          }),
        }),
      );
    });

    rerender(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    expect(chatRoomMock.messages).toEqual([
      expect.objectContaining({
        id: 51,
        clientMessageId: outbound.clientMessageId,
        deliveryStatus: undefined,
        content: "fast path",
      }),
    ]);
  });

  it("inserts selected custom emoji into the rich message input", () => {
    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const sendCallsBeforeSelect = wsState.send.mock.calls.length;

    fireEvent.click(screen.getByTestId("chat-emoji-button"));
    fireEvent.click(screen.getByRole("button", { name: "Mock custom emoji" }));

    const emojiNode = screen
      .getByTestId("chat-message-input")
      .querySelector(`[data-custom-emoji-id="${customEmojiMock.emoji.id}"]`);
    const copyFallback = emojiNode?.querySelector(
      "[data-custom-emoji-copy-placeholder]",
    );

    expect(emojiNode).toBeTruthy();
    expect(copyFallback).toHaveTextContent(customEmojiMock.emoji.token);
    expect(wsState.send.mock.calls).toHaveLength(sendCallsBeforeSelect);
  });

  it("serializes rapid toggles for the same reaction to the latest intended state", async () => {
    const removeDeferred = createDeferred<void>();
    const addDeferred = createDeferred<Record<string, never>>();

    chatRoomMock.messages = [
      {
        id: 41,
        publicRef: "alice",
        username: "alice",
        content: "react target",
        profilePic: null,
        createdAt: "2026-02-13T12:00:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [{ emoji: "👍", count: 1, me: true }],
      },
    ];
    chatControllerMock.removeReaction.mockReturnValueOnce(
      removeDeferred.promise,
    );
    chatControllerMock.addReaction.mockReturnValueOnce(addDeferred.promise);

    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const reactionChip = screen.getByRole("button", { name: "👍 1" });

    fireEvent.click(reactionChip);
    fireEvent.click(reactionChip);

    expect(chatControllerMock.removeReaction).toHaveBeenCalledTimes(1);
    expect(chatControllerMock.removeReaction).toHaveBeenCalledWith(
      "1",
      41,
      "👍",
    );
    expect(chatControllerMock.addReaction).not.toHaveBeenCalled();

    await act(async () => {
      removeDeferred.resolve(undefined);
      await removeDeferred.promise;
    });

    await waitFor(() => {
      expect(chatControllerMock.addReaction).toHaveBeenCalledTimes(1);
    });
    expect(chatControllerMock.addReaction).toHaveBeenCalledWith("1", 41, "👍");

    await act(async () => {
      addDeferred.resolve({});
      await addDeferred.promise;
    });
  });

  it("keeps pending reaction operations isolated per concrete emoji", () => {
    const removeDeferred = createDeferred<void>();

    chatRoomMock.messages = [
      {
        id: 42,
        publicRef: "alice",
        username: "alice",
        content: "react target",
        profilePic: null,
        createdAt: "2026-02-13T12:00:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [{ emoji: "👍", count: 1, me: true }],
      },
    ];
    chatControllerMock.removeReaction.mockReturnValueOnce(
      removeDeferred.promise,
    );

    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "👍 1" }));
    expect(chatControllerMock.removeReaction).toHaveBeenCalledTimes(1);

    const article = container.querySelector(
      'article[data-message-id="42"]',
    ) as HTMLElement;
    fireEvent.contextMenu(article);
    fireEvent.click(screen.getByText("Реакция"));
    fireEvent.click(screen.getByRole("button", { name: "Mock custom emoji" }));

    expect(chatControllerMock.addReaction).toHaveBeenCalledTimes(1);
    expect(chatControllerMock.addReaction).toHaveBeenCalledWith(
      "1",
      42,
      customEmojiMock.emoji.token,
    );
  });

  it("disables submit while websocket is not online", () => {
    wsState.status = "connecting";

    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    setComposerText("text");

    expect(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeDisabled();
  });

  it("keeps composer available after rate limit ws error event", () => {
    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    setComposerText("text");
    expect(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeEnabled();

    act(() => {
      wsState.options?.onMessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ error: "rate_limited", retry_after: 2 }),
        }),
      );
    });

    expect(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeEnabled();
  });

  it("shows online status for direct peer", () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "alice",
        username: "alice",
        profileImage: null,
        lastSeen: "2026-02-13T10:00:00.000Z",
      },
    } as RoomDetails;
    presenceMock.online = [
      { publicRef: "alice", username: "alice", profileImage: null },
    ];

    render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("В сети")).toBeInTheDocument();
  });

  it("highlights own messages", () => {
    chatRoomMock.messages = [
      {
        id: 3,
        publicRef: "demo",
        username: "demo",
        content: "mine",
        profilePic: null,
        createdAt: "2026-02-13T12:00:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [],
      },
      {
        id: 4,
        publicRef: "alice",
        username: "alice",
        content: "other",
        profilePic: null,
        createdAt: "2026-02-13T12:01:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [],
      },
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    expect(
      container.querySelector('article[data-own-message="true"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('article[data-own-message="false"]'),
    ).not.toBeNull();
  });

  it("keeps an opened media lightbox stable across live chat rerenders", async () => {
    chatRoomMock.messages = [
      {
        id: 41,
        publicRef: "alice",
        username: "alice",
        content: "video",
        profilePic: null,
        createdAt: "2026-02-13T12:00:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [
          {
            id: 501,
            originalFilename: "clip.mp4",
            contentType: "video/mp4",
            fileSize: 4096,
            url: "/media/clip.mp4",
            thumbnailUrl: "/media/thumb-clip.mp4",
            width: 720,
            height: 1280,
          },
        ],
        reactions: [],
      },
    ];

    const { rerender } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Открыть видео clip\.mp4/i }),
    );

    await screen.findByTestId("lightbox-video-player-desktop");
    expect(
      screen.getAllByRole("dialog", { name: /Просмотр видео/i }),
    ).toHaveLength(1);

    chatRoomMock.messages = [];
    rerender(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    expect(
      screen.getAllByRole("dialog", { name: /Просмотр видео/i }),
    ).toHaveLength(1);
    expect(
      screen.getByTestId("lightbox-video-player-desktop"),
    ).toBeInTheDocument();
  });

  it("opens only one playable video in mobile lightbox flow", async () => {
    const restoreViewport = installMobileViewport();
    chatRoomMock.messages = [
      {
        id: 51,
        publicRef: "alice",
        username: "alice",
        content: "video",
        profilePic: null,
        createdAt: "2026-02-13T12:00:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [
          {
            id: 601,
            originalFilename: "clip.mp4",
            contentType: "video/mp4",
            fileSize: 4096,
            url: "/media/clip.mp4",
            thumbnailUrl: "/media/thumb-clip.jpg",
            width: 720,
            height: 1280,
          },
          {
            id: 602,
            originalFilename: "clip-2.mp4",
            contentType: "video/mp4",
            fileSize: 4096,
            url: "/media/clip-2.mp4",
            thumbnailUrl: "/media/thumb-clip-2.jpg",
            width: 720,
            height: 1280,
          },
        ],
        reactions: [],
      },
    ];

    try {
      const { container } = render(
        <ChatRoomPage
          roomId="1"
          initialRoomKind="public"
          user={user}
          onNavigate={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /clip\.mp4/i }));

      await screen.findByTestId("lightbox-video-player-desktop");
      await waitFor(() => {
        expect(
          container.querySelectorAll('[data-lightbox-video-player="true"]'),
        ).toHaveLength(1);
      });
      expect(
        Array.from(container.querySelectorAll("video")).filter((video) =>
          Boolean(video.closest('[role="dialog"]')),
        ),
      ).toHaveLength(1);
    } finally {
      restoreViewport();
    }
  });

  it("groups consecutive messages from the same author", () => {
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
      {
        id: 3,
        publicRef: "demo",
        username: "demo",
        content: "mine",
        profilePic: null,
        createdAt: "2026-02-13T12:02:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [],
      },
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    expect(
      container.querySelectorAll('article[data-message-grouped="true"]').length,
    ).toBe(1);
    expect(
      container.querySelectorAll('article[data-message-avatar="true"]').length,
    ).toBe(2);
  });

  it("highlights own messages for fallback public id identity", () => {
    chatRoomMock.messages = [
      {
        id: 3,
        publicRef: "1234567890",
        username: "1234567890",
        content: "mine",
        profilePic: null,
        createdAt: "2026-02-13T12:00:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [],
      },
      {
        id: 4,
        publicRef: "alice",
        username: "alice",
        content: "other",
        profilePic: null,
        createdAt: "2026-02-13T12:01:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [],
      },
    ];

    const fallbackUser = {
      ...user,
      username: "",
      publicRef: "1234567890",
      publicId: "1234567890",
    };

    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={fallbackUser}
        onNavigate={vi.fn()}
      />,
    );

    expect(
      container.querySelector('article[data-own-message="true"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('article[data-own-message="false"]'),
    ).not.toBeNull();
  });

  it("shows join CTA and hides input for public group non-member", async () => {
    chatRoomMock.details = {
      roomId: 3,
      name: "Public Group",
      kind: "group",
      created: false,
      createdBy: null,
    } as RoomDetails;
    permissionsMock.loading = false;
    permissionsMock.isMember = false;
    permissionsMock.canWrite = false;
    permissionsMock.canJoin = true;

    render(
      <ChatRoomPage
        roomId="3"
        initialRoomKind="group"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByTestId("group-join-callout")).toBeInTheDocument();
    expect(screen.queryByLabelText("Сообщение")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Присоединиться" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(groupControllerMock.joinGroup).toHaveBeenCalledWith("3");
    expect(permissionsMock.refresh).toHaveBeenCalledTimes(1);
    expect(chatRoomMock.reload).toHaveBeenCalledTimes(1);
  });

  it("deduplicates mark-read for same last message id", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
    } as RoomDetails;
    chatRoomMock.messages = [
      {
        id: 1,
        publicRef: "alice",
        username: "alice",
        content: "first",
        profilePic: null,
        createdAt: "2026-02-13T12:00:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [],
      },
      {
        id: 2,
        publicRef: "alice",
        username: "alice",
        content: "second",
        profilePic: null,
        createdAt: "2026-02-13T12:01:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [],
      },
    ];

    const { container, rerender } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    /**
     * Эмулирует параметры viewport для тестового сценария.
     */
    const mockViewport = () => {
      Object.defineProperty(chatLog, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ bottom: 600 }),
      });
      chatLog
        .querySelectorAll<HTMLElement>("article[data-message-id]")
        .forEach((node, index) => {
          Object.defineProperty(node, "getBoundingClientRect", {
            configurable: true,
            value: () => ({ bottom: 120 + index * 120 }),
          });
        });
    };
    mockViewport();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    });
    fireEvent.scroll(chatLog);

    await waitFor(() => {
      expect(chatControllerMock.markRead).toHaveBeenCalledWith("2", 2);
    });
    expect(chatControllerMock.markRead).toHaveBeenCalledTimes(1);

    chatRoomMock.messages = [...chatRoomMock.messages];
    rerender(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    mockViewport();
    fireEvent.scroll(chatLog);

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    });
    expect(chatControllerMock.markRead).toHaveBeenCalledTimes(1);

    chatRoomMock.messages = [
      ...chatRoomMock.messages,
      {
        id: 3,
        publicRef: "alice",
        username: "alice",
        content: "third",
        profilePic: null,
        createdAt: "2026-02-13T12:02:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [],
      },
    ];
    rerender(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    mockViewport();
    fireEvent.scroll(chatLog);

    await waitFor(() => {
      expect(chatControllerMock.markRead).toHaveBeenCalledWith("2", 3);
    });
    expect(chatControllerMock.markRead).toHaveBeenCalledTimes(2);
  });

  it("accepts arbitrary attachment type on client", () => {
    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const invalidFile = new File(["payload"], "virus.exe", {
      type: "application/x-msdownload",
    });
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(
      screen.queryByText(/имеет неподдерживаемый тип/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeEnabled();
    expect(chatControllerMock.uploadAttachments).not.toHaveBeenCalled();
  });

  it("allows oversized attachment selection for superuser", () => {
    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={{ ...user, isSuperuser: true }}
        onNavigate={vi.fn()}
      />,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const oversizedFile = new File(
      [new Uint8Array(11 * 1024 * 1024)],
      "oversized.bin",
      { type: "application/octet-stream" },
    );
    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    expect(screen.getByText("Вложения: 1")).toBeInTheDocument();
    expect(screen.getByText("oversized.bin")).toBeInTheDocument();
    expect(screen.queryByText(/больше 10 МБ/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeEnabled();
  });

  it("allows attachment count above runtime limit for superuser", () => {
    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={{ ...user, isSuperuser: true }}
        onNavigate={vi.fn()}
      />,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const files = Array.from(
      { length: 6 },
      (_, index) =>
        new File(["x"], `file-${index + 1}.txt`, { type: "text/plain" }),
    );
    fireEvent.change(fileInput, { target: { files } });

    expect(screen.getByText("Вложения: 6")).toBeInTheDocument();
    expect(
      screen.queryByText(/Можно прикрепить не более 5 файлов/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeEnabled();
  });

  it("keeps attachment count limit for non-superuser", () => {
    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const files = Array.from(
      { length: 6 },
      (_, index) =>
        new File(["x"], `user-file-${index + 1}.txt`, { type: "text/plain" }),
    );
    fireEvent.change(fileInput, { target: { files } });

    expect(screen.getByText("Вложения: 5")).toBeInTheDocument();
    expect(
      screen.getByText(/Превышен лимит вложений \(5\)\./i),
    ).toBeInTheDocument();
  });

  it("keeps attachment size limit for non-superuser", () => {
    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const oversizedFile = new File(
      [new Uint8Array(11 * 1024 * 1024)],
      "user-oversized.bin",
      { type: "application/octet-stream" },
    );
    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    expect(screen.queryByText("Вложения: 1")).not.toBeInTheDocument();
    expect(
      screen.getByText('Файл "user-oversized.bin" больше 10 МБ.'),
    ).toBeInTheDocument();
  });

  it("queues pasted files from clipboard items", () => {
    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Сообщение");
    const pastedFile = new File(["clip"], "clipboard.bin", {
      type: "application/octet-stream",
    });

    fireEvent.paste(input, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "application/octet-stream",
            getAsFile: () => pastedFile,
          },
        ],
        files: [pastedFile],
      },
    });

    expect(screen.getByText("Вложения: 1")).toBeInTheDocument();
    expect(screen.getByText("clipboard.bin")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeEnabled();
  });

  it("queues pasted files from clipboard fallback files list", () => {
    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Сообщение");
    const pastedFile = new File(["mobile"], "mobile-clipboard.txt", {
      type: "text/plain",
    });

    fireEvent.paste(input, {
      clipboardData: {
        items: [
          {
            kind: "string",
            type: "text/plain",
            getAsFile: () => null,
          },
        ],
        files: [pastedFile],
      },
    });

    expect(screen.getByText("Вложения: 1")).toBeInTheDocument();
    expect(screen.getByText("mobile-clipboard.txt")).toBeInTheDocument();
  });

  it("shows drop overlay and queues dropped files", () => {
    render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const chatRoot = screen.getByTestId("chat-page-root");
    const droppedFile = new File(["drop"], "drag-drop.txt", {
      type: "text/plain",
    });

    fireEvent.dragEnter(chatRoot, {
      dataTransfer: {
        types: ["Files"],
        files: [droppedFile],
      },
    });
    expect(screen.getByTestId("chat-drop-overlay")).toBeInTheDocument();

    fireEvent.drop(chatRoot, {
      dataTransfer: {
        types: ["Files"],
        files: [droppedFile],
      },
    });

    expect(screen.queryByTestId("chat-drop-overlay")).toBeNull();
    expect(screen.getByText("Вложения: 1")).toBeInTheDocument();
    expect(screen.getByText("drag-drop.txt")).toBeInTheDocument();
  });

  it("uploads mixed attachment types and maps backend error by code", async () => {
    chatControllerMock.uploadAttachments.mockRejectedValueOnce({
      data: {
        code: "unsupported_type",
        details: { allowedTypes: ["text/plain"] },
      },
      message: "Request failed",
    });

    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const invalidFile = new File(["payload"], "bad.exe", {
      type: "application/x-msdownload",
    });
    const validFile = new File(["hello"], "ok.txt", { type: "text/plain" });
    fireEvent.change(fileInput, {
      target: { files: [invalidFile, validFile] },
    });

    expect(
      screen.queryByText(/имеет неподдерживаемый тип/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeEnabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(chatControllerMock.uploadAttachments).toHaveBeenCalledTimes(1);
    const filesArg = chatControllerMock.uploadAttachments.mock
      .calls[0][1] as File[];
    expect(filesArg).toHaveLength(2);
    expect(filesArg.map((f) => f.name)).toEqual(["bad.exe", "ok.txt"]);

    expect(
      screen.getByText("Тип файла не поддерживается. Разрешены: text/plain."),
    ).toBeInTheDocument();
  });

  it("renders chunk upload progress states in composer", async () => {
    type ProgressPayload = {
      phase: "uploading" | "processing";
      percent: number;
      uploadedBytes: number;
      totalBytes: number;
    };
    const preparingLabel = "Подготовка загрузки...";
    const uploadingLabel = "Загрузка файлов:";
    const processingLabel = "Публикуем сообщение";
    const cancelLabel = "Отменить загрузку";

    let resolveUpload: ((value: unknown) => void) | null = null;
    let capturedOptions: {
      onProgress?: (progress: ProgressPayload) => void;
      signal?: AbortSignal;
    } | null = null;

    chatControllerMock.uploadAttachments.mockImplementationOnce(
      (_roomId, _files, options) =>
        new Promise((resolve) => {
          capturedOptions = options as typeof capturedOptions;
          resolveUpload = resolve;
        }),
    );

    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["12345678"], "chunked.bin", {
      type: "application/octet-stream",
    });
    fireEvent.change(fileInput, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByTestId("chat-send-button"));

    await waitFor(() => {
      expect(chatControllerMock.uploadAttachments).toHaveBeenCalled();
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      `${preparingLabel} • 0 B / 8 B`,
    );

    act(() => {
      capturedOptions?.onProgress?.({
        phase: "uploading",
        percent: 25,
        uploadedBytes: 2,
        totalBytes: 8,
      });
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      `${uploadingLabel} 25.0% • 2 B / 8 B`,
    );

    act(() => {
      capturedOptions?.onProgress?.({
        phase: "processing",
        percent: 100,
        uploadedBytes: 8,
        totalBytes: 8,
      });
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      `${processingLabel} • 8 B / 8 B`,
    );
    expect(
      screen.getByRole("button", { name: cancelLabel }),
    ).toBeInTheDocument();

    act(() => {
      resolveUpload?.({ id: 11, content: "", attachments: [] });
    });

    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).toBeNull();
    });
  });

  it("cancels chunk upload from composer without surfacing an error", async () => {
    const cancelLabel = "Отменить загрузку";
    const uploadFailureLabel = "Не удалось загрузить файлы";
    let capturedSignal: AbortSignal | null = null;

    chatControllerMock.uploadAttachments.mockImplementationOnce(
      (_roomId, _files, options) =>
        new Promise((_resolve, reject) => {
          capturedSignal = options?.signal ?? null;
          capturedSignal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );

    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["1234"], "cancel.txt", { type: "text/plain" });
    fireEvent.change(fileInput, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByTestId("chat-send-button"));

    await waitFor(() => {
      expect(chatControllerMock.uploadAttachments).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: cancelLabel }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: cancelLabel })).toBeNull();
    });
    const uploadWasAborted =
      (capturedSignal as AbortSignal | null)?.aborted ?? false;
    expect(uploadWasAborted).toBe(true);
    expect(screen.queryByText(uploadFailureLabel)).toBeNull();
  });

  it("keeps unread divider anchored while partially reading and after full read in current chat", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 0,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
      makeForeignMessage(3, "third"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    /**
     * Устанавливает scroll metrics.
     * @param scrollTop Текущая позиция прокрутки сверху.
     * @param scrollHeight Полная высота области прокрутки.
     * @param clientHeight Высота видимой области.
     */
    const setScrollMetrics = (
      scrollTop: number,
      scrollHeight = 1200,
      clientHeight = 400,
    ) => {
      Object.defineProperty(chatLog, "scrollTop", {
        configurable: true,
        value: scrollTop,
        writable: true,
      });
      Object.defineProperty(chatLog, "scrollHeight", {
        configurable: true,
        value: scrollHeight,
      });
      Object.defineProperty(chatLog, "clientHeight", {
        configurable: true,
        value: clientHeight,
      });
    };

    /**
     * Устанавливает viewport.
     * @param listBottom Координата нижней границы списка.
     * @param bottoms Список координат нижних границ элементов.
     */
    const setViewport = (
      listBottom: number,
      bottoms: Record<number, number>,
    ) => {
      Object.defineProperty(chatLog, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ bottom: listBottom }),
      });
      chatLog
        .querySelectorAll<HTMLElement>("article[data-message-id]")
        .forEach((node) => {
          const id = Number(node.dataset.messageId);
          Object.defineProperty(node, "getBoundingClientRect", {
            configurable: true,
            value: () => ({ bottom: bottoms[id] ?? Number.MAX_SAFE_INTEGER }),
          });
        });
    };

    setScrollMetrics(160);
    setViewport(220, { 1: 180, 2: 360, 3: 520 });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });
    fireEvent.scroll(chatLog);

    let divider = chatLog.querySelector<HTMLElement>("[data-unread-divider]");
    expect(divider).not.toBeNull();
    expect(divider?.dataset.unreadAnchorId).toBe("1");

    const firstMessage = chatLog.querySelector('article[data-message-id="1"]');
    const indexOfDivider = Array.from(chatLog.children).findIndex(
      (node) => node === divider,
    );
    const indexOfFirstMessage = Array.from(chatLog.children).findIndex(
      (node) => node === firstMessage,
    );
    expect(indexOfDivider).toBeGreaterThanOrEqual(0);
    expect(indexOfDivider).toBeLessThan(indexOfFirstMessage);

    setScrollMetrics(200);
    setViewport(220, { 1: 120, 2: 180, 3: 410 });
    fireEvent.scroll(chatLog);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    });

    divider = chatLog.querySelector<HTMLElement>("[data-unread-divider]");
    expect(divider).not.toBeNull();
    expect(divider?.dataset.unreadAnchorId).toBe("1");

    setScrollMetrics(780, 1200, 400);
    setViewport(220, { 1: 110, 2: 150, 3: 190 });
    fireEvent.scroll(chatLog);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    divider = chatLog.querySelector<HTMLElement>("[data-unread-divider]");
    expect(divider).toBeNull();
    expect(directInboxMock.markRead).toHaveBeenCalledWith(2);
  });

  it("hides unread divider when current user sends a message", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 0,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      value: 160,
      writable: true,
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(chatLog, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 220 }),
    });
    chatLog
      .querySelectorAll<HTMLElement>("article[data-message-id]")
      .forEach((node, index) => {
        Object.defineProperty(node, "getBoundingClientRect", {
          configurable: true,
          value: () => ({ bottom: 180 + index * 180 }),
        });
      });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });
    fireEvent.scroll(chatLog);

    expect(chatLog.querySelector("[data-unread-divider]")).not.toBeNull();

    setComposerText("my message");
    fireEvent.click(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    );

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    });

    expect(chatLog.querySelector("[data-unread-divider]")).toBeNull();
  });

  it("does not show unread divider for incoming message when user is at bottom", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 2,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
    ];

    const { container, rerender } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    /**
     * Устанавливает scroll metrics.
     * @param scrollTop Текущая позиция прокрутки сверху.
     * @param scrollHeight Полная высота области прокрутки.
     * @param clientHeight Высота видимой области.
     */
    const setScrollMetrics = (
      scrollTop: number,
      scrollHeight = 1200,
      clientHeight = 400,
    ) => {
      Object.defineProperty(chatLog, "scrollTop", {
        configurable: true,
        value: scrollTop,
        writable: true,
      });
      Object.defineProperty(chatLog, "scrollHeight", {
        configurable: true,
        value: scrollHeight,
      });
      Object.defineProperty(chatLog, "clientHeight", {
        configurable: true,
        value: clientHeight,
      });
    };

    /**
     * Устанавливает viewport.
     * @param listBottom Координата нижней границы списка.
     * @param bottoms Список координат нижних границ элементов.
     */
    const setViewport = (
      listBottom: number,
      bottoms: Record<number, number>,
    ) => {
      Object.defineProperty(chatLog, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ bottom: listBottom }),
      });
      chatLog
        .querySelectorAll<HTMLElement>("article[data-message-id]")
        .forEach((node) => {
          const id = Number(node.dataset.messageId);
          Object.defineProperty(node, "getBoundingClientRect", {
            configurable: true,
            value: () => ({ bottom: bottoms[id] ?? Number.MAX_SAFE_INTEGER }),
          });
        });
    };

    setScrollMetrics(800, 1200, 400);
    setViewport(260, { 1: 120, 2: 170 });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    });
    fireEvent.scroll(chatLog);

    act(() => {
      wsState.options?.onMessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            id: 3,
            message: "third",
            publicRef: "alice",
            username: "alice",
            profile_pic: null,
            room: "dm_1",
            createdAt: "2026-02-13T12:03:00.000Z",
            attachments: [],
          }),
        }),
      );
    });

    rerender(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    setViewport(260, { 1: 120, 2: 170, 3: 210 });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 240));
    });

    expect(chatLog.querySelector("[data-unread-divider]")).toBeNull();
    await waitFor(() => {
      expect(chatControllerMock.markRead).toHaveBeenCalledWith("2", 3);
    });
  });

  it("performs a single initial scroll to bottom when unread messages are absent", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 3,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
      makeForeignMessage(3, "third"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    const scrollWrites: number[] = [];
    let scrollTopValue = 0;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollWrites.push(value);
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    expect(scrollWrites.filter((value) => value === 1200)).toHaveLength(1);
    expect(chatLog.querySelector("[data-unread-divider]")).toBeNull();
  });

  it("keeps the visible chat bottom anchored when rendered content grows", async () => {
    installMockResizeObserver();
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 3,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
      makeForeignMessage(3, "third"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    let scrollTopValue = 0;
    let scrollHeightValue = 1200;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => scrollHeightValue,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });
    await waitFor(() => expect(mockResizeObservers.length).toBeGreaterThan(0));

    scrollTopValue = 800;
    fireEvent.scroll(chatLog);

    await act(async () => {
      scrollHeightValue = 1320;
      triggerMockResizeObservers();
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    });

    expect(scrollTopValue).toBe(920);
  });

  it("anchors visible reaction growth while the user is reading above bottom", async () => {
    installMockResizeObserver();
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 3,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
      makeForeignMessage(3, "third"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    let scrollTopValue = 0;
    let scrollHeightValue = 1200;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => scrollHeightValue,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(chatLog, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 520 }),
    });
    let lowerVisibleShift = 0;
    chatLog
      .querySelectorAll<HTMLElement>("article[data-message-id]")
      .forEach((node, index) => {
        Object.defineProperty(node, "getBoundingClientRect", {
          configurable: true,
          value: () => ({
            bottom:
              220 +
              index * 120 +
              (index >= 2 ? lowerVisibleShift : 0) -
              (scrollTopValue - 160),
            top:
              140 +
              index * 120 +
              (index >= 2 ? lowerVisibleShift : 0) -
              (scrollTopValue - 160),
          }),
        });
      });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });
    await waitFor(() => expect(mockResizeObservers.length).toBeGreaterThan(0));

    scrollTopValue = 160;
    fireEvent.scroll(chatLog);

    await act(async () => {
      scrollHeightValue = 1248;
      lowerVisibleShift = 48;
      triggerMockResizeObservers();
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    });

    expect(scrollTopValue).toBe(208);
  });

  it("does not anchor loaded content below the visible viewport", async () => {
    installMockResizeObserver();
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 3,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
      makeForeignMessage(3, "third"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    let scrollTopValue = 0;
    let scrollHeightValue = 1200;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => scrollHeightValue,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(chatLog, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 520 }),
    });
    chatLog
      .querySelectorAll<HTMLElement>("article[data-message-id]")
      .forEach((node, index) => {
        Object.defineProperty(node, "getBoundingClientRect", {
          configurable: true,
          value: () => ({
            bottom: 780 + index * 120,
            top: 700 + index * 120,
          }),
        });
      });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });
    await waitFor(() => expect(mockResizeObservers.length).toBeGreaterThan(0));

    scrollTopValue = 160;
    fireEvent.scroll(chatLog);

    await act(async () => {
      scrollHeightValue = 1320;
      triggerMockResizeObservers();
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    });

    expect(scrollTopValue).toBe(160);
  });

  it("anchors repeated content growth once per actual scrollHeight delta", async () => {
    installMockResizeObserver();
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 3,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
      makeForeignMessage(3, "third"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    const scrollWrites: number[] = [];
    let scrollTopValue = 0;
    let scrollHeightValue = 1200;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollWrites.push(value);
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => scrollHeightValue,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(chatLog, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 520 }),
    });
    let lowerVisibleShift = 0;
    chatLog
      .querySelectorAll<HTMLElement>("article[data-message-id]")
      .forEach((node, index) => {
        Object.defineProperty(node, "getBoundingClientRect", {
          configurable: true,
          value: () => ({
            bottom: 220 + index * 120 + lowerVisibleShift,
            top: 140 + index * 120 + lowerVisibleShift,
          }),
        });
      });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });
    await waitFor(() => expect(mockResizeObservers.length).toBeGreaterThan(0));

    scrollTopValue = 800;
    fireEvent.scroll(chatLog);
    const writesBeforeResize = scrollWrites.length;

    await act(async () => {
      scrollHeightValue = 1300;
      lowerVisibleShift = 100;
      triggerMockResizeObservers();
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    });

    expect(scrollTopValue).toBe(900);
    expect(scrollWrites).toHaveLength(writesBeforeResize + 1);

    await act(async () => {
      triggerMockResizeObservers();
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    });

    expect(scrollTopValue).toBe(900);
    expect(scrollWrites).toHaveLength(writesBeforeResize + 1);

    await act(async () => {
      scrollHeightValue = 1350;
      lowerVisibleShift = 150;
      triggerMockResizeObservers();
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    });

    expect(scrollTopValue).toBe(950);
    expect(scrollWrites).toHaveLength(writesBeforeResize + 2);
  });

  it("does not jump to bottom while positioning to first unread on enter", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 0,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
      makeForeignMessage(3, "third"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    const scrollWrites: number[] = [];
    let scrollTopValue = 0;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollWrites.push(value);
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });

    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoViewSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewSpy,
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }

    expect(scrollIntoViewSpy).toHaveBeenCalled();
    expect(scrollWrites).not.toContain(1200);
  });

  it("starts from bottom when only the latest foreign message is unread", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 1,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    const scrollWrites: number[] = [];
    let scrollTopValue = 0;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollWrites.push(value);
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(chatLog, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 600 }),
    });
    chatLog
      .querySelectorAll<HTMLElement>("article[data-message-id]")
      .forEach((node, index) => {
        Object.defineProperty(node, "getBoundingClientRect", {
          configurable: true,
          value: () => ({ bottom: 160 + index * 120 }),
        });
      });

    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoViewSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewSpy,
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }

    expect(scrollWrites).toContain(1200);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(chatControllerMock.markRead).toHaveBeenCalledWith("2", 2);
    });
  });

  it("marks the very first direct message as read when it is immediately visible", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 0,
    } as RoomDetails;
    chatRoomMock.messages = [makeForeignMessage(1, "first")];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    const scrollWrites: number[] = [];
    let scrollTopValue = 0;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollWrites.push(value);
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => 220,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(chatLog, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 600 }),
    });
    chatLog
      .querySelectorAll<HTMLElement>("article[data-message-id]")
      .forEach((node) => {
        Object.defineProperty(node, "getBoundingClientRect", {
          configurable: true,
          value: () => ({ bottom: 180 }),
        });
      });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    expect(scrollWrites).toContain(220);

    await waitFor(() => {
      expect(chatControllerMock.markRead).toHaveBeenCalledWith("2", 1);
    });
  });

  it("marks the first direct message as read when the route is opened by publicRef", async () => {
    chatRoomMock.details = {
      roomId: 13,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "2104489155",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: null,
    } as RoomDetails;
    chatRoomMock.messages = [
      {
        ...makeForeignMessage(1, "first"),
        id: 244,
        createdAt: "2026-02-13T12:44:00.000Z",
      },
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2104489155"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    const scrollWrites: number[] = [];
    let scrollTopValue = 0;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollWrites.push(value);
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => 220,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(chatLog, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 600 }),
    });
    chatLog
      .querySelectorAll<HTMLElement>("article[data-message-id]")
      .forEach((node) => {
        Object.defineProperty(node, "getBoundingClientRect", {
          configurable: true,
          value: () => ({ bottom: 180 }),
        });
      });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    expect(scrollWrites).toContain(220);

    await waitFor(() => {
      expect(chatControllerMock.markRead).toHaveBeenCalledWith("13", 244);
    });
  });

  it("does not inherit unread divider from previous room while next chat is loading", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 0,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
    ];
    chatRoomMock.loading = false;

    const { container, rerender } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    const dividerInFirstChat = container.querySelector<HTMLElement>(
      "[data-unread-divider]",
    );
    expect(dividerInFirstChat).not.toBeNull();
    expect(dividerInFirstChat?.dataset.unreadAnchorId).toBe("1");

    chatRoomMock.loading = true;
    rerender(
      <ChatRoomPage
        roomId="22"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-unread-divider]")).toBeNull();

    chatRoomMock.loading = false;
    chatRoomMock.details = {
      roomId: 22,
      name: "dm2",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@bob",
        username: "bob",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 2,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "other-first"),
      makeForeignMessage(2, "other-second"),
    ];
    rerender(
      <ChatRoomPage
        roomId="22"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    expect(container.querySelector("[data-unread-divider]")).toBeNull();
  });

  it("does not auto-reposition on non-append message updates", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 0,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    const scrollWrites: number[] = [];
    let scrollTopValue = 160;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollWrites.push(value);
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(chatLog, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 260 }),
    });
    chatLog
      .querySelectorAll<HTMLElement>("article[data-message-id]")
      .forEach((node, index) => {
        Object.defineProperty(node, "getBoundingClientRect", {
          configurable: true,
          value: () => ({ bottom: 140 + index * 80 }),
        });
      });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });
    scrollTopValue = 160;
    fireEvent.scroll(chatLog);
    const writesBeforeEdit = scrollWrites.length;

    act(() => {
      wsState.options?.onMessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message_edit",
            messageId: 1,
            content: "edited",
            editedAt: "2026-02-13T12:05:00.000Z",
            editedBy: "alice",
          }),
        }),
      );
    });

    expect(scrollWrites.length).toBe(writesBeforeEdit);
    expect(scrollTopValue).toBe(160);
  });

  it("does not auto-scroll for incoming message when user is away from bottom", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 2,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
    ];

    const { container, rerender } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    const scrollWrites: number[] = [];
    let scrollTopValue = 0;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollWrites.push(value);
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => 1320,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(chatLog, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 260 }),
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    scrollTopValue = 160;
    fireEvent.scroll(chatLog);
    const writesBeforeIncoming = scrollWrites.length;

    act(() => {
      wsState.options?.onMessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            id: 3,
            message: "third",
            publicRef: "alice",
            username: "alice",
            roomId: 1,
            createdAt: "2026-02-13T12:03:00.000Z",
            attachments: [],
            type: "chat_message",
          }),
        }),
      );
    });

    rerender(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    });

    expect(scrollWrites.length).toBe(writesBeforeIncoming);
    expect(scrollTopValue).toBe(160);
  });

  it("does not auto-reposition on read receipt events", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "@alice",
        username: "alice",
        profileImage: null,
        lastSeen: null,
      },
      lastReadMessageId: 0,
    } as RoomDetails;
    chatRoomMock.messages = [
      {
        id: 1,
        publicRef: "demo",
        username: "demo",
        content: "mine",
        profilePic: null,
        createdAt: "2026-02-13T12:00:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [],
      },
      makeForeignMessage(2, "second"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    const scrollWrites: number[] = [];
    let scrollTopValue = 160;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollWrites.push(value);
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(chatLog, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 260 }),
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });
    scrollTopValue = 160;
    fireEvent.scroll(chatLog);
    const writesBeforeReceipt = scrollWrites.length;

    act(() => {
      wsState.options?.onMessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "read_receipt",
            userId: 2,
            publicRef: "alice",
            username: "alice",
            lastReadMessageId: 1,
            lastReadAt: "2026-02-13T12:05:00.000Z",
            roomId: 1,
          }),
        }),
      );
    });

    expect(scrollWrites.length).toBe(writesBeforeReceipt);
    expect(scrollTopValue).toBe(160);
  });

  it("group chat: performs a single initial scroll to bottom when unread messages are absent", async () => {
    chatRoomMock.details = {
      roomId: 4,
      name: "Team",
      kind: "group",
      created: false,
      createdBy: "owner",
      lastReadMessageId: 3,
      isPublic: false,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
      makeForeignMessage(3, "third"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="4"
        initialRoomKind="group"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    const scrollWrites: number[] = [];
    let scrollTopValue = 0;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollWrites.push(value);
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    expect(scrollWrites.filter((value) => value === 1200)).toHaveLength(1);
    expect(chatLog.querySelector("[data-unread-divider]")).toBeNull();
  });

  it("group chat: does not jump to bottom while positioning to first unread on enter", async () => {
    chatRoomMock.details = {
      roomId: 4,
      name: "Team",
      kind: "group",
      created: false,
      createdBy: "owner",
      lastReadMessageId: 0,
      isPublic: false,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
      makeForeignMessage(3, "third"),
    ];

    const { container } = render(
      <ChatRoomPage
        roomId="4"
        initialRoomKind="group"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    const scrollWrites: number[] = [];
    let scrollTopValue = 0;
    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollWrites.push(value);
      },
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      get: () => 400,
    });

    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoViewSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewSpy,
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }

    expect(scrollIntoViewSpy).toHaveBeenCalled();
    expect(scrollWrites).not.toContain(1200);
  });

  it("group chat: ignores non-user scroll events for loadMore on enter", async () => {
    chatRoomMock.details = {
      roomId: 4,
      name: "Team",
      kind: "group",
      created: false,
      createdBy: "owner",
      lastReadMessageId: 0,
      isPublic: false,
    } as RoomDetails;
    chatRoomMock.messages = [
      makeForeignMessage(1, "first"),
      makeForeignMessage(2, "second"),
    ];
    chatRoomMock.hasMore = true;
    chatRoomMock.loading = false;
    chatRoomMock.loadingMore = false;

    const { container } = render(
      <ChatRoomPage
        roomId="4"
        initialRoomKind="group"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;

    Object.defineProperty(chatLog, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(chatLog, "clientHeight", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(chatLog, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 260 }),
    });
    chatLog
      .querySelectorAll<HTMLElement>("article[data-message-id]")
      .forEach((node, index) => {
        Object.defineProperty(node, "getBoundingClientRect", {
          configurable: true,
          value: () => ({ bottom: 140 + index * 80 }),
        });
      });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    fireEvent.scroll(chatLog);
    expect(chatRoomMock.loadMore).not.toHaveBeenCalled();
  });

  it("flushes pending read with sendBeacon on pagehide", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "DM",
      kind: "direct",
      created: false,
      createdBy: null,
      lastReadMessageId: 0,
    } as RoomDetails;
    chatRoomMock.messages = [];
    window.sessionStorage.setItem("chat.pendingRead.2", "5");

    const sendBeaconSpy = vi.fn().mockReturnValue(true);
    Object.defineProperty(window.navigator, "sendBeacon", {
      configurable: true,
      value: sendBeaconSpy,
    });

    render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(sendBeaconSpy).toHaveBeenCalled();
    const [url, payload] = sendBeaconSpy.mock.calls.at(-1) as [
      string,
      FormData,
    ];
    expect(url).toBe("/api/chat/2/read/");
    expect(payload).toBeInstanceOf(FormData);
    expect(payload.get("lastReadMessageId")).toBe("5");
  });

  it("falls back to fetch keepalive when sendBeacon is unavailable", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "DM",
      kind: "direct",
      created: false,
      createdBy: null,
      lastReadMessageId: 0,
    } as RoomDetails;
    chatRoomMock.messages = [];
    window.sessionStorage.setItem("chat.pendingRead.2", "6");

    const sendBeaconSpy = vi.fn().mockReturnValue(false);
    Object.defineProperty(window.navigator, "sendBeacon", {
      configurable: true,
      value: sendBeaconSpy,
    });

    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const previousVisibilityState = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(sendBeaconSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/chat/2/read/",
      expect.objectContaining({
        method: "POST",
        keepalive: true,
        credentials: "same-origin",
      }),
    );

    if (previousVisibilityState) {
      Object.defineProperty(
        document,
        "visibilityState",
        previousVisibilityState,
      );
    }
    vi.unstubAllGlobals();
  });

  it("smoothly scrolls to bottom after sending own message", () => {
    const { container } = render(
      <ChatRoomPage
        roomId="1"
        initialRoomKind="public"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const chatLog = container.querySelector(
      '[aria-live="polite"]',
    ) as HTMLDivElement;
    expect(chatLog).toBeTruthy();

    const scrollToSpy = vi.fn();
    Object.defineProperty(chatLog, "scrollTo", {
      configurable: true,
      value: scrollToSpy,
    });
    Object.defineProperty(chatLog, "scrollHeight", {
      configurable: true,
      value: 840,
    });

    setComposerText("scroll test");
    fireEvent.click(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    );

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 840, behavior: "smooth" });
  });

  it("opens direct readers menu for own message with avatar and profile action", async () => {
    chatRoomMock.details = {
      roomId: 2,
      name: "dm",
      kind: "direct",
      created: false,
      createdBy: null,
      peer: {
        publicRef: "alice",
        username: "alice",
        displayName: "Alice",
        profileImage: "https://cdn.example.com/alice.jpg",
        lastSeen: null,
      },
    } as RoomDetails;
    chatRoomMock.messages = [
      {
        id: 1,
        publicRef: "demo",
        username: "demo",
        content: "mine",
        profilePic: null,
        createdAt: "2026-02-13T12:00:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [],
      },
    ];
    chatControllerMock.getMessageReaders.mockResolvedValueOnce({
      roomKind: "direct",
      messageId: 1,
      readAt: "2026-02-13T12:10:00.000Z",
      readers: [],
    });

    const { container } = render(
      <ChatRoomPage
        roomId="2"
        initialRoomKind="direct"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const article = container.querySelector(
      'article[data-message-id="1"]',
    ) as HTMLElement;

    fireEvent.contextMenu(article);
    fireEvent.click(screen.getByText("Кто прочитал"));

    await waitFor(() => {
      expect(chatControllerMock.getMessageReaders).toHaveBeenCalledWith("2", 1);
    });
    const readersMenu = screen.getByRole("menu", { name: "Кто прочитал" });
    expect(await within(readersMenu).findByText("Alice")).toBeInTheDocument();
    expect(
      await within(readersMenu).findByRole("img", { name: "Alice" }),
    ).toBeInTheDocument();
    expect(
      within(readersMenu).getByText(
        formatReadReceiptTimestamp("2026-02-13T12:10:00.000Z"),
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(readersMenu).getByRole("menuitem", { name: /Alice/ }),
    );
    expect(infoPanelMock.open).toHaveBeenCalledWith("profile", "alice");
  });

  it("opens group readers menu with avatars and profile action", async () => {
    chatRoomMock.details = {
      roomId: 4,
      name: "Team",
      kind: "group",
      created: false,
      createdBy: "owner",
      isPublic: false,
    } as RoomDetails;
    chatRoomMock.messages = [
      {
        id: 8,
        publicRef: "demo",
        username: "demo",
        content: "mine",
        profilePic: null,
        createdAt: "2026-02-13T12:00:00.000Z",
        editedAt: null,
        isDeleted: false,
        replyTo: null,
        attachments: [],
        reactions: [],
      },
    ];
    chatControllerMock.getMessageReaders.mockResolvedValueOnce({
      roomKind: "group",
      messageId: 8,
      readAt: null,
      readers: [
        {
          userId: 2,
          publicRef: "alice",
          username: "alice",
          displayName: "Alice",
          profileImage: "https://cdn.example.com/alice.jpg",
          avatarCrop: null,
          readAt: "2026-02-13T12:10:00.000Z",
        },
        {
          userId: 3,
          publicRef: "bob",
          username: "bob",
          displayName: "Bob",
          profileImage: "https://cdn.example.com/bob.jpg",
          avatarCrop: null,
          readAt: "2026-02-13T12:09:00.000Z",
        },
      ],
    });

    const { container } = render(
      <ChatRoomPage
        roomId="4"
        initialRoomKind="group"
        user={user}
        onNavigate={vi.fn()}
      />,
    );
    const article = container.querySelector(
      'article[data-message-id="8"]',
    ) as HTMLElement;

    fireEvent.contextMenu(article);
    fireEvent.click(screen.getByText("Кто прочитал"));

    await waitFor(() => {
      expect(chatControllerMock.getMessageReaders).toHaveBeenCalledWith("4", 8);
    });
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(
      await screen.findByRole("img", { name: "Alice" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(formatReadReceiptTimestamp("2026-02-13T12:10:00.000Z")),
    ).toBeInTheDocument();
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Bob" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /Alice/ }));
    expect(infoPanelMock.open).toHaveBeenCalledWith("profile", "alice");
  });
});
