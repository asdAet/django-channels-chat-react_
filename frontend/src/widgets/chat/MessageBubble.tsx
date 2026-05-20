import {
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  Message,
  ReactionSummary,
  ReplyTo,
} from "../../entities/message/types";
import { useChatAttachmentMaxPerMessage } from "../../shared/config/limits";
import {
  type CustomEmoji,
  CustomEmojiNode,
  getSelectedCustomEmojiNodeIndexes,
  getSingleCustomEmojiOnly,
  parseCustomEmojiText,
  serializeCustomEmojiSelection,
  writeCustomEmojiClipboardContent,
  writeCustomEmojiClipboardData,
} from "../../shared/customEmoji";
import {
  formatAttachmentFileSize,
  formatAttachmentSentAt,
} from "../../shared/lib/attachmentDisplay";
import {
  isVideoAttachment,
  resolveResponsiveImageSource,
} from "../../shared/lib/attachmentMedia";
import { resolveAttachmentTypeLabel } from "../../shared/lib/attachmentTypeLabel";
import {
  copyImageUrlToClipboard,
  triggerFileDownload,
} from "../../shared/lib/fileActions";
import { formatTimestamp } from "../../shared/lib/format";
import {
  isFallbackPublicId,
  normalizePublicRef,
} from "../../shared/lib/publicRef";
import type { ContextMenuItem } from "../../shared/ui";
import {
  AudioAttachmentPlayer,
  Avatar,
  ContextMenu,
  FileAttachmentCard,
  ImageLightbox,
} from "../../shared/ui";
import styles from "../../styles/chat/MessageBubble.module.css";
import {
  buildAttachmentRenderItems,
  buildMediaTileLayout,
  splitAttachmentRenderItems,
} from "./lib/attachmentLayout";
import { TelegramEmojiPicker } from "./TelegramEmojiPicker";
import { VideoAttachmentPreview } from "./VideoAttachmentPreview";

/**
 * Описывает входные props компонента `Props`.
 */
type Props = {
  message: Message;
  isOwn: boolean;
  showAvatar?: boolean;
  showHeader?: boolean;
  grouped?: boolean;
  canModerate?: boolean;
  canViewReaders?: boolean;
  isRead?: boolean;
  highlighted?: boolean;
  onlineUsernames: Set<string>;
  onReply?: (msg: Message) => void;
  onEdit?: (msg: Message) => void;
  onDelete?: (msg: Message) => void;
  onReact?: (msgId: number, emoji: string) => void;
  onViewReaders?: (msg: Message, anchor: { x: number; y: number }) => void;
  onReplyQuoteClick?: (replyToId: number) => void;
  onAvatarClick?: (actorRef: string) => void;
  onOpenMediaAttachment?: (attachmentId: number) => void;
};

/**
 * Определяет тип медиа, которое открывается в модальном просмотрщике.
 */
type LightboxMediaKind = "image" | "video";

/**
 * Хранит метаданные вложения для подписи в модальном просмотрщике.
 */
type LightboxMediaMetadata = {
  attachmentId: number;
  fileName: string;
  contentType: string;
  fileSize: number;
  sentAt: string;
  width: number | null;
  height: number | null;
};

/**
 * Описывает состояние активного предпросмотра вложения.
 */
type LightboxMediaItem = {
  src: string;
  previewSrc?: string | null;
  downloadUrl?: string | null;
  kind: LightboxMediaKind;
  alt?: string;
  metadata: LightboxMediaMetadata;
};

/**
 * Форматирует размер файла для отображения рядом с вложением.
 * @param bytes Размер файла в байтах.
 * @returns Строка в отформатированном виде.
 */

const IconEmoji = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <line x1="9" y1="9" x2="9.01" y2="9" />
    <line x1="15" y1="9" x2="15.01" y2="9" />
  </svg>
);

/**
 * Проверяет, относится ли MIME-тип к видео.
 * @param contentType MIME-тип вложения.
 * @param fileName Имя файла, используется как дополнительная эвристика.
 * @returns Логический флаг результата проверки.
 */

const isVideoType = (contentType: string, fileName: string) =>
  isVideoAttachment(contentType, fileName);
/**
 * Проверяет, относится ли MIME-тип к аудио.
 * @param ct MIME-тип вложения.
 * @returns Логический флаг результата проверки.
 */

const isAudioType = (ct: string) => ct.startsWith("audio/");
/**
 * Нормализует публичный идентификатор пользователя для сравнения online-статуса.
 * @param value Входное значение для преобразования.
 */

const normalizeActorRef = (value: string) =>
  normalizePublicRef(value).toLowerCase();

type MessageAuthorLike = {
  username?: string | null;
  publicRef?: string | null;
  displayName?: string | null;
  userId?: number | string | null;
};

const pickAuthorLabelPart = (
  value: string | number | null | undefined,
): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const pickHumanAuthorLabelPart = (
  value: string | number | null | undefined,
): string | null => {
  const label = pickAuthorLabelPart(value);
  return label && !isFallbackPublicId(label) ? label : null;
};

/**
 * Возвращает стабильную подпись автора для заголовка сообщения и fallback-аватарки.
 *
 * @param author Данные автора сообщения или цитируемого сообщения.
 * @param fallback Подпись на случай, если имя и публичные поля автора отсутствуют.
 * @returns Человеческое имя автора, затем публичный handle, без показа numeric public id.
 */
const resolveMessageAuthorLabel = (
  author: MessageAuthorLike,
  fallback = "Пользователь",
): string => {
  const displayName = pickHumanAuthorLabelPart(author.displayName);
  if (displayName) {
    return displayName;
  }

  const username = pickHumanAuthorLabelPart(author.username);
  if (username) {
    return normalizePublicRef(username) || username;
  }

  const publicRef = normalizePublicRef(author.publicRef);
  if (publicRef && !isFallbackPublicId(publicRef)) {
    return publicRef;
  }

  return fallback;
};

const MOBILE_MENU_IGNORE_SELECTOR =
  'a,button,input,textarea,select,video,audio,img,[role="button"],[data-message-menu-ignore="true"]';
const MOBILE_MEDIA_ACTION_TARGET_SELECTOR =
  '[data-message-media-action-target="true"]';
const MOBILE_LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const MOBILE_MENU_CLICK_SUPPRESS_MS = 420;

type MobileTapMenuState = {
  pointerId: number | null;
  target: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
};

/**
 * Проверяет, что тап был по интерактивному элементу и меню открывать не нужно.
 * @param target DOM-элемент, по которому пришло событие.
 * @returns Логический флаг, нужно ли выполнять действие.
 */

const shouldIgnoreMobileMenuGesture = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  if (target.closest(MOBILE_MEDIA_ACTION_TARGET_SELECTOR)) return true;
  return Boolean(target.closest(MOBILE_MENU_IGNORE_SELECTOR));
};

const resolveAttachmentIdFromTarget = (
  target: EventTarget | null,
): number | null => {
  if (!(target instanceof Element)) {
    return null;
  }

  const mediaTarget = target.closest<HTMLElement>("[data-attachment-id]");
  const rawAttachmentId = mediaTarget?.dataset.attachmentId;
  if (!rawAttachmentId) {
    return null;
  }

  const attachmentId = Number(rawAttachmentId);
  return Number.isInteger(attachmentId) ? attachmentId : null;
};

const areSetsEqual = (first: Set<number>, second: Set<number>) => {
  if (first.size !== second.size) {
    return false;
  }

  for (const value of first) {
    if (!second.has(value)) {
      return false;
    }
  }

  return true;
};

function MessageContent({ content }: { content: string }) {
  const contentRef = useRef<HTMLParagraphElement>(null);
  const parts = parseCustomEmojiText(content);
  const singleEmoji = getSingleCustomEmojiOnly(content);
  const [selectedEmojiIndexes, setSelectedEmojiIndexes] = useState<Set<number>>(
    () => new Set(),
  );

  const updateSelectedEmojiIndexes = useCallback(() => {
    const root = contentRef.current;
    const nextIndexes = root
      ? getSelectedCustomEmojiNodeIndexes(root)
      : new Set<number>();

    setSelectedEmojiIndexes((currentIndexes) =>
      areSetsEqual(currentIndexes, nextIndexes) ? currentIndexes : nextIndexes,
    );
  }, []);

  useEffect(() => {
    const ownerDocument = contentRef.current?.ownerDocument ?? document;

    ownerDocument.addEventListener(
      "selectionchange",
      updateSelectedEmojiIndexes,
    );
    return () => {
      ownerDocument.removeEventListener(
        "selectionchange",
        updateSelectedEmojiIndexes,
      );
    };
  }, [updateSelectedEmojiIndexes]);

  const handleCopy = useCallback(
    (event: ReactClipboardEvent<HTMLParagraphElement>) => {
      const selectedContent = serializeCustomEmojiSelection(
        event.currentTarget,
      );
      if (!selectedContent) {
        return;
      }

      event.preventDefault();
      writeCustomEmojiClipboardData(event.clipboardData, selectedContent);
    },
    [],
  );

  const emojiIndexByPartIndex = new Map(
    parts
      .map((part, index) => ({ index, part }))
      .filter(({ part }) => part.type === "emoji")
      .map(({ index }, emojiIndex) => [index, emojiIndex] as const),
  );

  return (
    <p
      ref={contentRef}
      className={[
        styles.content,
        singleEmoji ? styles.customEmojiOnlyContent : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onCopy={handleCopy}
    >
      {parts.map((part, index) => {
        if (part.type === "text") {
          return <span key={`text-${index}`}>{part.value}</span>;
        }

        const emojiIndex = emojiIndexByPartIndex.get(index) ?? -1;
        const emojiSelected = selectedEmojiIndexes.has(emojiIndex);

        return (
          <CustomEmojiNode
            key={`${part.value.id}-${index}`}
            emoji={part.value}
            size={singleEmoji ? 72 : 26}
            className={[
              singleEmoji ? styles.customEmojiLarge : styles.customEmojiInline,
              emojiSelected ? styles.customEmojiSelected : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        );
      })}
    </p>
  );
}
/**
 * Компонент ReplyQuote рендерит UI текущего раздела и связывает действия пользователя с обработчиками.
 */
function ReplyQuote({
  replyTo,
  onClick,
}: {
  replyTo: ReplyTo;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        className={[styles.replyQuote, styles.replyQuoteClickable].join(" ")}
        onClick={onClick}
      >
        <span className={styles.replyUser}>
          {resolveMessageAuthorLabel(replyTo, "?")}
        </span>
        <span className={styles.replyText}>{replyTo.content}</span>
      </button>
    );
  }
  return (
    <div className={styles.replyQuote}>
      <span className={styles.replyUser}>
        {resolveMessageAuthorLabel(replyTo, "?")}
      </span>
      <span className={styles.replyText}>{replyTo.content}</span>
    </div>
  );
}
/**
 * Компонент ReactionChip рендерит UI текущего раздела и связывает действия пользователя с обработчиками.
 */
function ReactionChip({
  reaction,
  onToggle,
}: {
  reaction: ReactionSummary;
  onToggle: () => void;
}) {
  const customEmoji = getSingleCustomEmojiOnly(reaction.emoji);
  const reactionLabel = customEmoji?.label ?? reaction.emoji;

  return (
    <button
      type="button"
      className={[styles.reaction, reaction.me ? styles.reactionMine : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggle}
      aria-label={`${reactionLabel} ${reaction.count}`}
    >
      <span className={styles.reactionGlyph}>
        {customEmoji ? (
          <CustomEmojiNode
            emoji={customEmoji}
            size={22}
            className={styles.reactionCustomEmoji}
          />
        ) : (
          reaction.emoji
        )}
      </span>
      <span className={styles.reactionCount}>{reaction.count}</span>
    </button>
  );
}
/**
 * React-компонент CheckMark отвечает за отрисовку и обработку UI-сценария.
 */
function CheckMark({
  isRead,
  isPending,
}: {
  isRead: boolean;
  isPending: boolean;
}) {
  const ariaLabel = isPending
    ? "Отправляется"
    : isRead
      ? "Прочитано"
      : "Отправлено";

  return (
    <span
      data-testid="message-read-marker"
      data-read={isRead ? "true" : "false"}
      data-pending={isPending ? "true" : "false"}
      className={[styles.checkMark, isRead ? styles.checkRead : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel}
    >
      <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
        <path
          d="M1 5.5L4.5 9L11 1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {isRead && (
          <path
            d="M5.5 5.5L9 9L15.5 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </span>
  );
}
/**
 * Компонент MessageBubble рендерит UI текущего раздела и связывает действия пользователя с обработчиками.
 */
export function MessageBubble({
  message,
  isOwn,
  showAvatar = true,
  showHeader = true,
  grouped = false,
  canModerate = false,
  canViewReaders = false,
  isRead = false,
  highlighted = false,
  onlineUsernames,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onViewReaders,
  onReplyQuoteClick,
  onAvatarClick,
  onOpenMediaAttachment,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    attachmentId: number | null;
  } | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [lightboxOpenIndex, setLightboxOpenIndex] = useState<number | null>(
    null,
  );
  const lastRightMouseDownTsRef = useRef<number>(0);
  const mobileTapMenuRef = useRef<MobileTapMenuState | null>(null);
  const suppressClickUntilRef = useRef(0);

  const openContextMenuAt = useCallback(
    (x: number, y: number, attachmentId: number | null = null) => {
      setContextMenu({ x, y, attachmentId });
    },
    [],
  );

  const resolveMenuPosition = useCallback(
    (
      target: HTMLElement,
      fallbackX: number,
      fallbackY: number,
    ): { x: number; y: number } => {
      if (fallbackX > 0 && fallbackY > 0) {
        return { x: fallbackX, y: fallbackY };
      }
      const rect = target.getBoundingClientRect();
      return {
        x: Math.min(rect.right - 12, window.innerWidth - 12),
        y: Math.max(rect.top + 12, 12),
      };
    },
    [],
  );

  const handleReact = useCallback(
    (emoji: string) => onReact?.(message.id, emoji),
    [message.id, onReact],
  );
  const handleCustomReactionSelect = useCallback(
    (emoji: CustomEmoji) => handleReact(emoji.token),
    [handleReact],
  );

  /**
   * Собирает метаданные вложения для отображения в просмотрщике.
   *
   * @param attachment Вложение из сообщения.
   * @returns Метаданные для подписи под медиа.
   */
  const buildLightboxMetadata = useCallback(
    (attachment: Message["attachments"][number]): LightboxMediaMetadata => ({
      attachmentId: attachment.id,
      fileName: attachment.originalFilename,
      contentType: attachment.contentType,
      fileSize: attachment.fileSize,
      sentAt: message.createdAt,
      width: attachment.width,
      height: attachment.height,
    }),
    [message.createdAt],
  );

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (message.isDeleted) return;
      e.preventDefault();
      if (e.timeStamp - lastRightMouseDownTsRef.current < 250) return;
      openContextMenuAt(
        e.clientX,
        e.clientY,
        resolveAttachmentIdFromTarget(e.target),
      );
    },
    [message.isDeleted, openContextMenuAt],
  );

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (message.isDeleted || event.button !== 2) return;
      lastRightMouseDownTsRef.current = event.timeStamp;
      const position = resolveMenuPosition(
        event.currentTarget,
        event.clientX,
        event.clientY,
      );
      openContextMenuAt(
        position.x,
        position.y,
        resolveAttachmentIdFromTarget(event.target),
      );
      event.preventDefault();
    },
    [message.isDeleted, openContextMenuAt, resolveMenuPosition],
  );

  const clearMobileTapMenu = useCallback(() => {
    const state = mobileTapMenuRef.current;
    if (!state) return false;

    mobileTapMenuRef.current = null;
    return true;
  }, []);

  const finishMobileTapMenu = useCallback(
    (pointerId: number | null, fallbackX?: number, fallbackY?: number) => {
      const state = mobileTapMenuRef.current;
      if (!state || state.pointerId !== pointerId) return false;

      mobileTapMenuRef.current = null;
      if (message.isDeleted) {
        return false;
      }

      const attachmentId = resolveAttachmentIdFromTarget(state.target);
      const position = resolveMenuPosition(
        state.target,
        fallbackX ?? state.x,
        fallbackY ?? state.y,
      );
      suppressClickUntilRef.current =
        Date.now() + MOBILE_MENU_CLICK_SUPPRESS_MS;
      openContextMenuAt(position.x, position.y, attachmentId);
      return true;
    },
    [message.isDeleted, openContextMenuAt, resolveMenuPosition],
  );

  const startMobileTapMenu = useCallback(
    (target: HTMLElement, pointerId: number | null, x: number, y: number) => {
      clearMobileTapMenu();

      const state: MobileTapMenuState = {
        pointerId,
        target,
        startX: x,
        startY: y,
        x,
        y,
      };

      mobileTapMenuRef.current = state;
    },
    [clearMobileTapMenu],
  );

  const cancelMobileTapMenuOnMove = useCallback(
    (pointerId: number | null, x: number, y: number) => {
      const state = mobileTapMenuRef.current;
      if (!state || state.pointerId !== pointerId) return;

      const movedDistance = Math.hypot(x - state.startX, y - state.startY);
      if (movedDistance > MOBILE_LONG_PRESS_MOVE_TOLERANCE_PX) {
        clearMobileTapMenu();
        return;
      }

      state.x = x;
      state.y = y;
    },
    [clearMobileTapMenu],
  );

  const handleMobilePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (message.isDeleted) return;
      if (event.pointerType !== "touch" && event.pointerType !== "pen") {
        return;
      }
      if (shouldIgnoreMobileMenuGesture(event.target)) return;

      startMobileTapMenu(
        event.currentTarget,
        event.pointerId,
        event.clientX,
        event.clientY,
      );
    },
    [message.isDeleted, startMobileTapMenu],
  );

  const handleMobilePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      cancelMobileTapMenuOnMove(event.pointerId, event.clientX, event.clientY);
    },
    [cancelMobileTapMenuOnMove],
  );

  const handleMobilePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") {
        return;
      }
      if (finishMobileTapMenu(event.pointerId, event.clientX, event.clientY)) {
        event.preventDefault();
      }
    },
    [finishMobileTapMenu],
  );

  const handleMobilePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") {
        return;
      }
      clearMobileTapMenu();
    },
    [clearMobileTapMenu],
  );

  const handleMobileTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      if (typeof window !== "undefined" && "PointerEvent" in window) return;
      if (message.isDeleted) return;
      if (shouldIgnoreMobileMenuGesture(event.target)) return;

      const touch = event.touches.item(0);
      if (!touch) return;

      startMobileTapMenu(
        event.currentTarget,
        null,
        touch.clientX,
        touch.clientY,
      );
    },
    [message.isDeleted, startMobileTapMenu],
  );

  const handleMobileTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      if (typeof window !== "undefined" && "PointerEvent" in window) return;

      const touch = event.touches.item(0);
      if (!touch) return;

      cancelMobileTapMenuOnMove(null, touch.clientX, touch.clientY);
    },
    [cancelMobileTapMenuOnMove],
  );

  const handleMobileTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      if (typeof window !== "undefined" && "PointerEvent" in window) return;

      const touch = event.changedTouches.item(0);
      if (finishMobileTapMenu(null, touch?.clientX, touch?.clientY)) {
        event.preventDefault();
      }
    },
    [finishMobileTapMenu],
  );

  const handleMobileTouchCancel = useCallback(() => {
    if (typeof window !== "undefined" && "PointerEvent" in window) return;
    clearMobileTapMenu();
  }, [clearMobileTapMenu]);

  useEffect(
    () => () => {
      clearMobileTapMenu();
    },
    [clearMobileTapMenu],
  );

  const handleMessageClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (Date.now() >= suppressClickUntilRef.current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const maxVisibleImageAttachments = useChatAttachmentMaxPerMessage();
  if (message.isDeleted) {
    return null;
  }

  const authorLabel = resolveMessageAuthorLabel(message);
  const isCustomEmojiOnlyMessage =
    Boolean(getSingleCustomEmojiOnly(message.content)) &&
    message.attachments.length === 0 &&
    !message.replyTo;
  const isAttachmentOnlyMessage =
    message.attachments.length > 0 &&
    message.content.trim().length === 0 &&
    !message.replyTo;
  const attachmentItems = buildAttachmentRenderItems(message.attachments);
  const attachmentBuckets = splitAttachmentRenderItems(
    attachmentItems,
    maxVisibleImageAttachments,
  );
  const selectedMenuAttachment =
    contextMenu?.attachmentId !== null &&
    contextMenu?.attachmentId !== undefined
      ? (message.attachments.find(
          (attachment) => attachment.id === contextMenu.attachmentId,
        ) ?? null)
      : message.attachments.length === 1
        ? message.attachments[0]
        : null;
  const selectedMenuAttachmentUrl = selectedMenuAttachment?.url ?? null;
  const selectedMenuAttachmentIsImage =
    Boolean(selectedMenuAttachmentUrl) &&
    Boolean(selectedMenuAttachment?.contentType.startsWith("image/"));

  const contextMenuItems: ContextMenuItem[] = [];
  if (!message.isDeleted) {
    const canManageMessage = isOwn || canModerate;
    const messageText = message.content.trim();

    contextMenuItems.push({
      label: "Ответить",
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <polyline points="9 17 4 12 9 7" />
          <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
        </svg>
      ),
      disabled: !onReply,
      onClick: () => onReply?.(message),
    });

    if (messageText.length > 0) {
      contextMenuItems.push({
        label: "Копировать текст",
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        ),
        onClick: () => void writeCustomEmojiClipboardContent(messageText),
      });
    }

    if (selectedMenuAttachmentUrl && selectedMenuAttachment) {
      contextMenuItems.push({
        label: "Скачать",
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        ),
        onClick: () =>
          triggerFileDownload(
            selectedMenuAttachmentUrl,
            selectedMenuAttachment.originalFilename,
          ),
      });
    }

    if (
      selectedMenuAttachmentUrl &&
      selectedMenuAttachment &&
      selectedMenuAttachmentIsImage
    ) {
      contextMenuItems.push({
        label: "Скопировать картинку",
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        ),
        onClick: () => {
          void copyImageUrlToClipboard(selectedMenuAttachmentUrl);
        },
      });
    }

    contextMenuItems.push({
      label: "Реакция",
      icon: <IconEmoji />,
      disabled: !onReact,
      onClick: () => {
        if (!onReact) return;
        setEmojiPickerOpen(true);
      },
    });

    if (canViewReaders) {
      contextMenuItems.push({
        label: "Кто прочитал",
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ),
        disabled: !onViewReaders,
        onClick: () =>
          onViewReaders?.(message, contextMenu ?? { x: 12, y: 12 }),
      });
    }

    if (!isOwn) {
      contextMenuItems.push({
        label: "Профиль",
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ),
        disabled: !onAvatarClick,
        onClick: () => onAvatarClick?.(message.publicRef),
      });
    }

    if (canManageMessage) {
      contextMenuItems.push({
        label: "Редактировать",
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        ),
        disabled: !onEdit,
        onClick: () => onEdit?.(message),
      });

      contextMenuItems.push({
        label: "Удалить",
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        ),
        danger: true,
        disabled: !onDelete,
        onClick: () => onDelete?.(message),
      });
    }
  }
  const lightboxMediaItems: LightboxMediaItem[] = attachmentItems.flatMap(
    (item) => {
      const { attachment } = item;
      if (!attachment.url) {
        return [];
      }
      const isVideo = isVideoType(
        attachment.contentType,
        attachment.originalFilename,
      );
      if (!isVideo && !item.isImage) {
        return [];
      }
      return [
        {
          src: attachment.url,
          previewSrc: attachment.thumbnailUrl,
          downloadUrl: attachment.url,
          kind: isVideo ? "video" : "image",
          alt: attachment.originalFilename,
          metadata: buildLightboxMetadata(attachment),
        },
      ];
    },
  );

  const openLightboxByAttachmentId = (attachmentId: number) => {
    if (onOpenMediaAttachment) {
      onOpenMediaAttachment(attachmentId);
      return;
    }

    const targetIndex = lightboxMediaItems.findIndex(
      (item) => item.metadata.attachmentId === attachmentId,
    );
    if (targetIndex < 0) return;
    setLightboxOpenIndex(targetIndex);
  };

  return (
    <>
      <article
        className={[
          styles.message,
          isOwn ? styles.messageOwn : "",
          grouped ? styles.messageGrouped : "",
          highlighted ? styles.highlighted : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-message-id={message.id}
        data-own-message={isOwn ? "true" : "false"}
        data-message-grouped={grouped ? "true" : "false"}
        data-message-avatar={showAvatar ? "true" : "false"}
        data-message-header={showHeader ? "true" : "false"}
        onClickCapture={handleMessageClickCapture}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onPointerDown={handleMobilePointerDown}
        onPointerMove={handleMobilePointerMove}
        onPointerUp={handleMobilePointerUp}
        onPointerCancel={handleMobilePointerCancel}
        onPointerLeave={handleMobilePointerCancel}
        onTouchStart={handleMobileTouchStart}
        onTouchMove={handleMobileTouchMove}
        onTouchEnd={handleMobileTouchEnd}
        onTouchCancel={handleMobileTouchCancel}
      >
        {showAvatar && (
          <button
            type="button"
            className={styles.avatarBtn}
            onClick={() => onAvatarClick?.(message.publicRef)}
            aria-label={`Профиль ${authorLabel}`}
          >
            <Avatar
              username={authorLabel}
              profileImage={message.profilePic}
              avatarCrop={message.avatarCrop}
              size="small"
              online={onlineUsernames.has(
                normalizeActorRef(message.publicRef || ""),
              )}
            />
          </button>
        )}

        <div className={styles.body}>
          {message.replyTo && (
            <ReplyQuote
              replyTo={message.replyTo}
              onClick={
                onReplyQuoteClick
                  ? () => onReplyQuoteClick(message.replyTo!.id)
                  : undefined
              }
            />
          )}

          <div
            className={[
              styles.bubble,
              isCustomEmojiOnlyMessage ? styles.customEmojiOnlyBubble : "",
              isAttachmentOnlyMessage ? styles.attachmentOnlyBubble : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {showHeader && (
              <div className={styles.meta}>
                <span className={styles.username}>{authorLabel}</span>
              </div>
            )}

            {message.content && <MessageContent content={message.content} />}

            {message.attachments.length > 0 && (
              <div className={styles.attachments}>
                {attachmentBuckets.imageGroups.map((imageGroup, groupIndex) => {
                  const mediaLayout = buildMediaTileLayout(imageGroup);
                  const isSingleTile = imageGroup.length === 1;

                  return (
                    <div
                      key={`media-group-${message.id}-${groupIndex}`}
                      className={styles.mediaCollage}
                      data-testid="message-media-grid"
                      data-count={imageGroup.length}
                      style={
                        {
                          aspectRatio:
                            mediaLayout.containerAspectRatio.toFixed(4),
                        } satisfies CSSProperties
                      }
                    >
                      {mediaLayout.items.map((item) => {
                        const tileImageSource = resolveResponsiveImageSource({
                          url: item.attachment.url,
                          thumbnailUrl: item.attachment.thumbnailUrl,
                          contentType: item.attachment.contentType,
                          fileName: item.attachment.originalFilename,
                          expectedWidthPx: (420 * item.widthPercent) / 100,
                        });

                        return (
                          <button
                            key={item.attachment.id}
                            type="button"
                            className={[
                              styles.mediaTile,
                              styles.mediaTileAbsolute,
                              isSingleTile
                                ? styles.mediaTileSingle
                                : styles.mediaTileGrouped,
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            style={
                              {
                                left: `${item.leftPercent.toFixed(4)}%`,
                                top: `${item.topPercent.toFixed(4)}%`,
                                width: `${item.widthPercent.toFixed(4)}%`,
                                height: `${item.heightPercent.toFixed(4)}%`,
                              } satisfies CSSProperties
                            }
                            data-attachment-id={item.attachment.id}
                            data-message-media-action-target="true"
                            onClick={() =>
                              openLightboxByAttachmentId(item.attachment.id)
                            }
                            aria-label={`Открыть изображение ${item.attachment.originalFilename}`}
                          >
                            <img
                              src={tileImageSource.src ?? item.imageSrc}
                              srcSet={tileImageSource.srcSet}
                              sizes={tileImageSource.sizes}
                              alt={item.attachment.originalFilename}
                              width={item.attachment.width ?? undefined}
                              height={item.attachment.height ?? undefined}
                              className={[
                                styles.attachImage,
                                isSingleTile
                                  ? styles.attachImageSingle
                                  : styles.attachImageGrouped,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              loading="lazy"
                              decoding="async"
                              draggable={false}
                            />
                          </button>
                        );
                      })}
                    </div>
                  );
                })}

                {attachmentBuckets.others.length > 0 && (
                  <div className={styles.fileAttachments}>
                    {attachmentBuckets.others.map(({ attachment: att }) => {
                      const fileSizeLabel = formatAttachmentFileSize(
                        att.fileSize,
                      );
                      const fileTypeLabel = resolveAttachmentTypeLabel(
                        att.contentType,
                        att.originalFilename,
                      );
                      const sentAtLabel = formatAttachmentSentAt(
                        message.createdAt,
                      );

                      if (
                        isVideoType(att.contentType, att.originalFilename) &&
                        att.url
                      ) {
                        return (
                          <VideoAttachmentPreview
                            key={att.id}
                            attachment={att}
                            onOpen={() => openLightboxByAttachmentId(att.id)}
                          />
                        );
                      }
                      if (isAudioType(att.contentType) && att.url) {
                        return (
                          <AudioAttachmentPlayer
                            key={att.id}
                            src={att.url}
                            title={att.originalFilename}
                            fileSizeLabel={fileSizeLabel}
                            fileTypeLabel={fileTypeLabel}
                            sentAtLabel={sentAtLabel}
                            sentAtIso={message.createdAt}
                            downloadName={att.originalFilename}
                            compact
                          />
                        );
                      }
                      return (
                        <FileAttachmentCard
                          key={att.id}
                          fileName={att.originalFilename}
                          fileTypeLabel={fileTypeLabel}
                          fileSizeLabel={fileSizeLabel}
                          sentAtLabel={sentAtLabel}
                          sentAtIso={message.createdAt}
                          href={att.url}
                          downloadName={att.originalFilename}
                          compact
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className={styles.footerInfo}>
              {message.editedAt && (
                <span className={styles.editedTag}>ред.</span>
              )}
              <span className={styles.time}>
                {formatTimestamp(message.createdAt)}
              </span>
              {isOwn && (
                <CheckMark
                  isRead={isRead}
                  isPending={message.deliveryStatus === "pending"}
                />
              )}
            </div>
          </div>

          {message.reactions.length > 0 && (
            <div className={styles.reactions}>
              {message.reactions.map((r) => (
                <ReactionChip
                  key={r.emoji}
                  reaction={r}
                  onToggle={() => handleReact(r.emoji)}
                />
              ))}
            </div>
          )}
        </div>
      </article>

      {contextMenu && contextMenuItems.length > 0 && (
        <ContextMenu
          items={contextMenuItems}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
      {emojiPickerOpen && (
        <TelegramEmojiPicker
          placement="overlay"
          onSelect={handleCustomReactionSelect}
          onClose={() => setEmojiPickerOpen(false)}
        />
      )}
      {!onOpenMediaAttachment &&
        lightboxOpenIndex !== null &&
        lightboxMediaItems.length > 0 && (
          <ImageLightbox
            mediaItems={lightboxMediaItems}
            initialIndex={lightboxOpenIndex}
            onClose={() => setLightboxOpenIndex(null)}
          />
        )}
    </>
  );
}
