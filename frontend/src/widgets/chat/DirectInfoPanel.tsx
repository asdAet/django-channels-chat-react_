import { useCallback, useEffect, useMemo, useState } from "react";

import { chatController } from "../../controllers/ChatController";
import type { RoomAttachmentItem } from "../../domain/interfaces/IApiService";
import type { RoomDetails } from "../../entities/room/types";
import {
  formatAttachmentFileSize,
  formatAttachmentSentAt,
} from "../../shared/lib/attachmentDisplay";
import {
  isImageAttachment,
  resolveImagePreviewUrl,
} from "../../shared/lib/attachmentMedia";
import { resolveAttachmentTypeLabel } from "../../shared/lib/attachmentTypeLabel";
import { formatLastSeen, formatTimestamp } from "../../shared/lib/format";
import { resolveIdentityLabel } from "../../shared/lib/userIdentity";
import {
  AudioAttachmentPlayer,
  Avatar,
  FileAttachmentCard,
  Skeleton,
} from "../../shared/ui";
import styles from "../../styles/chat/DirectInfoPanel.module.css";

/**
 * Описывает входные props компонента `Props`.
 */
type Props = {
  roomId: string;
};

/**
 * Описывает структуру данных `Tab`.
 */
type Tab = "profile" | "attachments";

/**
 * Проверяет условие is video.
 * @param contentType MIME-тип файла.
 */
const isVideo = (contentType: string) => contentType.startsWith("video/");
/**
 * Проверяет условие is audio.
 * @param contentType MIME-тип файла.
 */
const isAudio = (contentType: string) => contentType.startsWith("audio/");

/**
 * React-компонент AttachmentCard отвечает за отрисовку и обработку UI-сценария.
 */
function AttachmentCard({ item }: { item: RoomAttachmentItem }) {
  const isImage = isImageAttachment(item.contentType, item.originalFilename);
  const isVideoFile = isVideo(item.contentType);
  const isAudioFile = isAudio(item.contentType);
  const displayName = resolveIdentityLabel(item);
  const fileSizeLabel = formatAttachmentFileSize(item.fileSize);
  const fileTypeLabel = resolveAttachmentTypeLabel(
    item.contentType,
    item.originalFilename,
  );
  const sentAtLabel = formatAttachmentSentAt(item.createdAt);
  const imageSrc = resolveImagePreviewUrl({
    url: item.url,
    thumbnailUrl: item.thumbnailUrl,
    contentType: item.contentType,
    fileName: item.originalFilename,
  });

  const renderCardMeta = (withTime: boolean) => (
    <div className={styles.cardMeta}>
      <span>{displayName}</span>
      {withTime && (
        <time dateTime={item.createdAt}>{formatTimestamp(item.createdAt)}</time>
      )}
    </div>
  );

  if (isImage && imageSrc) {
    const content = (
      <>
        <img
          src={imageSrc}
          alt={item.originalFilename}
          className={styles.media}
        />
        {renderCardMeta(true)}
      </>
    );

    if (item.url) {
      return (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.card}
        >
          {content}
        </a>
      );
    }

    return <div className={styles.card}>{content}</div>;
  }

  if (isVideoFile && item.url) {
    return (
      <div className={styles.card}>
        <video
          className={styles.media}
          src={item.url}
          preload="metadata"
          controls
        />
        {renderCardMeta(true)}
      </div>
    );
  }

  if (isAudioFile && item.url) {
    return (
      <div className={[styles.card, styles.cardAudio].join(" ")}>
        <div className={styles.attachmentCardBody}>
          <AudioAttachmentPlayer
            src={item.url}
            title={item.originalFilename}
            fileSizeLabel={fileSizeLabel}
            fileTypeLabel={fileTypeLabel}
            sentAtLabel={sentAtLabel}
            sentAtIso={item.createdAt}
            downloadName={item.originalFilename}
            compact
            className={styles.audioPlayer}
          />
        </div>
        {renderCardMeta(false)}
      </div>
    );
  }

  return (
    <div className={[styles.card, styles.cardFile].join(" ")}>
      <div className={styles.attachmentCardBody}>
        <FileAttachmentCard
          fileName={item.originalFilename}
          fileTypeLabel={fileTypeLabel}
          fileSizeLabel={fileSizeLabel}
          sentAtLabel={sentAtLabel}
          sentAtIso={item.createdAt}
          href={item.url}
          downloadName={item.originalFilename}
          compact
          className={styles.fileAttachmentCard}
        />
      </div>
      {renderCardMeta(false)}
    </div>
  );
}

function DirectInfoProfileSkeleton() {
  return (
    <div className={styles.profile} aria-busy="true">
      <Skeleton variant="circle" width={72} height={72} />
      <Skeleton variant="text" width="46%" height={16} />
      <Skeleton variant="text" width="58%" height={13} />
      <Skeleton height={74} radius={10} />
    </div>
  );
}

function DirectInfoAttachmentsSkeleton() {
  return (
    <div className={styles.grid} aria-busy="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div className={styles.card} key={index}>
          <Skeleton height={96} radius={0} />
          <div className={styles.cardMeta}>
            <Skeleton variant="text" width="42%" height={10} />
            <Skeleton variant="text" width="28%" height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * React-компонент DirectInfoPanel отвечает за отрисовку и обработку UI-сценария.
 */
export function DirectInfoPanel({ roomId }: Props) {
  const [tab, setTab] = useState<Tab>("profile");
  const [details, setDetails] = useState<RoomDetails | null>(null);
  const [attachments, setAttachments] = useState<RoomAttachmentItem[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [room, files] = await Promise.all([
        chatController.getRoomDetails(roomId),
        chatController.getRoomAttachments(roomId, { limit: 60 }),
      ]);
      setDetails(room);
      setAttachments(files.items);
      setHasMore(files.pagination.hasMore);
      setNextBefore(files.pagination.nextBefore);
    } catch {
      setDetails(null);
      setAttachments([]);
      setHasMore(false);
      setNextBefore(null);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const files = await chatController.getRoomAttachments(roomId, {
        limit: 60,
        before: nextBefore,
      });
      setAttachments((prev) => [...prev, ...files.items]);
      setHasMore(files.pagination.hasMore);
      setNextBefore(files.pagination.nextBefore);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextBefore, roomId]);

  const peer = details?.peer ?? null;
  const attachmentItems = useMemo(() => attachments, [attachments]);
  const peerDisplayName = peer ? resolveIdentityLabel(peer) : "";

  return (
    <div className={styles.root}>
      <div className={styles.tabs}>
        <button
          type="button"
          className={[styles.tab, tab === "profile" ? styles.tabActive : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setTab("profile")}
        >
          Профиль
        </button>
        <button
          type="button"
          className={[styles.tab, tab === "attachments" ? styles.tabActive : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setTab("attachments")}
        >
          Вложения
        </button>
      </div>

      {loading && tab === "profile" && <DirectInfoProfileSkeleton />}
      {loading && tab === "attachments" && <DirectInfoAttachmentsSkeleton />}

      {!loading && tab === "profile" && peer && (
        <div className={styles.profile}>
          <Avatar
            username={peerDisplayName}
            profileImage={peer.profileImage}
            avatarCrop={peer.avatarCrop}
            size="default"
          />
          <h4 className={styles.peerName}>{peerDisplayName}</h4>
          <p className={styles.meta}>
            Был(а) в сети: {formatLastSeen(peer.lastSeen ?? null) || "—"}
          </p>
          {peer.bio?.trim() ? (
            <div className={styles.bioSection}>
              <span className={styles.bioLabel}>О себе</span>
              <p className={styles.bioText}>{peer.bio}</p>
            </div>
          ) : null}
        </div>
      )}

      {!loading && tab === "attachments" && (
        <div className={styles.attachments}>
          {attachmentItems.length === 0 && (
            <p className={styles.empty}>В этом чате пока нет вложений.</p>
          )}

          {attachmentItems.length > 0 && (
            <div className={styles.grid}>
              {attachmentItems.map((item) => (
                <AttachmentCard key={item.id} item={item} />
              ))}
            </div>
          )}

          {hasMore && (
            <button
              type="button"
              className={styles.loadMoreBtn}
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "Загрузка..." : "Показать еще"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
