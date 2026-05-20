import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../entities/message/types";
import {
  DEFAULT_RUNTIME_CONFIG,
  setRuntimeConfig,
} from "../../shared/config/runtimeConfig";
import {
  CUSTOM_EMOJI_CLIPBOARD_MIME,
  type CustomEmoji,
  getCustomEmojiPackSummaries,
} from "../../shared/customEmoji";
import { MessageBubble } from "./MessageBubble";

const baseMessage: Message = {
  id: 1,
  publicRef: "alice",
  username: "alice",
  content: "audio message",
  profilePic: null,
  avatarCrop: null,
  createdAt: "2026-03-11T10:00:00.000Z",
  editedAt: null,
  isDeleted: false,
  replyTo: null,
  attachments: [],
  reactions: [],
};

const createImageAttachment = (id: number, filename: string) => ({
  id,
  originalFilename: filename,
  contentType: "image/png",
  fileSize: 1024,
  url: `/media/${filename}`,
  thumbnailUrl: `/media/thumb-${filename}`,
  width: 1280,
  height: 720,
});

const getTestEmoji = (index = 0) => {
  const emoji = getCustomEmojiPackSummaries()[index]?.preview;
  if (!emoji) {
    throw new Error("Expected custom emoji test fixture");
  }

  return emoji;
};

const mockPickerEmoji: CustomEmoji = {
  id: "Animated/1.tgs",
  packId: "Animated",
  packName: "Animated",
  fileName: "1.tgs",
  assetKind: "tgs",
  label: "Animated 1",
  src: "/mock/custom-emoji.tgs",
  token: "[[ce:Animated%2F1.tgs]]",
};

vi.mock("./TelegramEmojiPicker", () => ({
  TelegramEmojiPicker: ({
    onSelect,
  }: {
    onSelect: (emoji: CustomEmoji) => void;
    onClose: () => void;
  }) => (
    <button type="button" onClick={() => onSelect(mockPickerEmoji)}>
      Pick custom emoji reaction
    </button>
  ),
}));

/**
 * Настраивает эмуляцию touch-устройства через matchMedia.
 */
const installTouchMatchMedia = () => {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("(hover: none)") || query.includes("coarse"),
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
    if (original) {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: original,
      });
      return;
    }
    Reflect.deleteProperty(window, "matchMedia");
  };
};

/**
 * Настраивает модель ввода для десктопного сценария.
 */
const installDesktopInputModel = () => {
  const originalMatchMedia = window.matchMedia;
  const hadTouchStart = Object.prototype.hasOwnProperty.call(
    window,
    "ontouchstart",
  );
  const originalTouchStart = (window as Window & { ontouchstart?: unknown })
    .ontouchstart;
  const originalInnerWidth = window.innerWidth;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1280,
  });
  Reflect.deleteProperty(window, "ontouchstart");

  return () => {
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    if (hadTouchStart) {
      Object.defineProperty(window, "ontouchstart", {
        configurable: true,
        value: originalTouchStart,
      });
      return;
    }
    Reflect.deleteProperty(window, "ontouchstart");
  };
};

const fireTouchPointerEvent = (
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: {
    pointerId?: number;
    clientX: number;
    clientY: number;
    buttons?: number;
  },
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 1 },
    pointerType: { value: "touch" },
    isPrimary: { value: true },
    button: { value: 0 },
    buttons: { value: init.buttons ?? (type === "pointerup" ? 0 : 1) },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
  });

  fireEvent(target, event);
};

describe("MessageBubble", () => {
  beforeEach(() => {
    setRuntimeConfig({ ...DEFAULT_RUNTIME_CONFIG });
  });

  it("renders nothing for deleted messages", () => {
    const { container } = render(
      <MessageBubble
        message={{ ...baseMessage, isDeleted: true, content: "" }}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    expect(container.querySelector("[data-message-id]")).toBeNull();
    expect(screen.queryByText("Сообщение удалено")).toBeNull();
  });

  it("shows the display name instead of the numeric public id", () => {
    render(
      <MessageBubble
        message={{
          ...baseMessage,
          username: "1234567890",
          publicRef: "1234567890",
          displayName: "Name",
        }}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.queryByText("1234567890")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Профиль Name" }),
    ).toBeInTheDocument();
  });

  it("renders AudioAttachmentPlayer for audio attachments", () => {
    const message: Message = {
      ...baseMessage,
      attachments: [
        {
          id: 10,
          originalFilename: "voice.mp3",
          contentType: "audio/mpeg",
          fileSize: 1024,
          url: "/media/voice.mp3",
          thumbnailUrl: null,
          width: null,
          height: null,
        },
      ],
    };

    render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    expect(screen.getByTestId("audio-attachment-player")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Воспроизвести" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle("voice.mp3")).toBeInTheDocument();
    expect(screen.getByText("voice")).toBeInTheDocument();
    expect(screen.getByText("mp3")).toBeInTheDocument();
  });

  it("renders concise file type label for non-media attachment", () => {
    const message: Message = {
      ...baseMessage,
      attachments: [
        {
          id: 11,
          originalFilename: "archive.custom",
          contentType: "application/octet-stream",
          fileSize: 2048,
          url: null,
          thumbnailUrl: null,
          width: null,
          height: null,
        },
      ],
    };

    render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    expect(screen.getByTitle("archive.custom")).toBeInTheDocument();
    expect(screen.getByText("archive")).toBeInTheDocument();
    expect(screen.getByText("custom")).toBeInTheDocument();
  });

  it("renders svg attachment as image even when content type is generic", () => {
    const message: Message = {
      ...baseMessage,
      attachments: [
        {
          id: 12,
          originalFilename: "pizza.svg",
          contentType: "text/plain",
          fileSize: 1024,
          url: "/media/pizza.svg",
          thumbnailUrl: null,
          width: null,
          height: null,
        },
      ],
    };

    render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    const image = screen.getByAltText("pizza.svg");
    expect(image.tagName).toBe("IMG");
    expect(image).toHaveAttribute("src", "/media/pizza.svg");
  });

  it("renders a strictly single custom emoji in the large variant", () => {
    const firstEmoji = getTestEmoji();

    const message: Message = {
      ...baseMessage,
      content: firstEmoji.token,
    };

    const { container } = render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    const emoji = container.querySelector(
      `[data-custom-emoji-id="${firstEmoji.id}"]`,
    );
    const content = container.querySelector("p");

    expect(emoji?.className).toContain("customEmojiLarge");
    expect(content?.className).toContain("customEmojiOnlyContent");
  });

  it("renders single custom emoji messages without the regular bubble background", () => {
    const firstEmoji = getTestEmoji();

    const message: Message = {
      ...baseMessage,
      content: firstEmoji.token,
    };

    const { container } = render(
      <MessageBubble
        message={message}
        isOwn
        onlineUsernames={new Set<string>()}
      />,
    );

    const bubble = container.querySelector("[class*='bubble']");
    expect(bubble?.className).toContain("customEmojiOnlyBubble");
    expect(
      container.querySelector("[class*='footerInfo']"),
    ).toBeInTheDocument();
  });

  it("renders attachment-only messages without the regular bubble background", () => {
    const message: Message = {
      ...baseMessage,
      content: "",
      attachments: [
        {
          id: 13,
          originalFilename: "document.pdf",
          contentType: "application/pdf",
          fileSize: 4096,
          url: "/media/document.pdf",
          thumbnailUrl: null,
          width: null,
          height: null,
        },
      ],
    };

    const { container } = render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    const bubble = container.querySelector("[class*='bubble']");
    expect(bubble?.className).toContain("attachmentOnlyBubble");
  });

  it("copies a sent custom emoji with the rich clipboard payload", () => {
    const firstEmoji = getTestEmoji();

    const message: Message = {
      ...baseMessage,
      content: firstEmoji.token,
    };

    const { container } = render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    const content = container.querySelector("p");
    const placeholder = container.querySelector(
      "[data-custom-emoji-copy-placeholder]",
    );
    const placeholderText = placeholder?.firstChild;
    if (!content || !placeholderText) {
      throw new Error("Expected rendered custom emoji copy placeholder");
    }

    const range = document.createRange();
    range.setStart(placeholderText, 0);
    range.setEnd(placeholderText, 1);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);

    const clipboardData = {
      setData: vi.fn(),
    };
    fireEvent.copy(content, { clipboardData });

    expect(clipboardData.setData).toHaveBeenCalledWith(
      CUSTOM_EMOJI_CLIPBOARD_MIME,
      firstEmoji.token,
    );
    expect(clipboardData.setData).toHaveBeenCalledWith(
      "text/plain",
      firstEmoji.token,
    );
  });

  it("copies message text from the context menu with portable custom emoji tokens", async () => {
    const restoreDesktopInputModel = installDesktopInputModel();
    const firstEmoji = getTestEmoji();
    const originalClipboard = navigator.clipboard;
    const writeText =
      vi.fn<Clipboard["writeText"]>().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      const message: Message = {
        ...baseMessage,
        content: `hello ${firstEmoji.token}`,
      };

      const { container } = render(
        <MessageBubble
          message={message}
          isOwn={false}
          onlineUsernames={new Set<string>()}
          onReply={vi.fn()}
          onReact={vi.fn()}
        />,
      );

      const article = container.querySelector(
        'article[data-message-id="1"]',
      ) as HTMLElement;

      fireEvent.contextMenu(article);
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Копировать текст" }),
      );

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(`hello ${firstEmoji.token}`);
      });
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
      restoreDesktopInputModel();
    }
  });

  it("visually marks sent custom emoji inside the browser selection", async () => {
    const firstEmoji = getTestEmoji();

    const message: Message = {
      ...baseMessage,
      content: `A${firstEmoji.token}B`,
    };

    const { container } = render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    const content = container.querySelector("p");
    const emoji = container.querySelector(
      `[data-custom-emoji-id="${firstEmoji.id}"]`,
    );
    const firstText = content?.childNodes[0]?.firstChild;
    const secondText = content?.childNodes[2]?.firstChild;
    if (!content || !emoji || !firstText || !secondText) {
      throw new Error("Expected mixed text and custom emoji content");
    }

    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(secondText, 1);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(emoji.className).toContain("customEmojiSelected");
    });
  });

  it("visually marks sent custom emoji when selection starts on the emoji itself", async () => {
    const firstEmoji = getTestEmoji();

    const message: Message = {
      ...baseMessage,
      content: `A${firstEmoji.token}B`,
    };

    const { container } = render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    const emoji = container.querySelector(
      `[data-custom-emoji-id="${firstEmoji.id}"]`,
    );
    const placeholder = emoji?.querySelector<HTMLElement>(
      "[data-custom-emoji-copy-placeholder]",
    );
    const placeholderText = placeholder?.firstChild;
    if (!emoji || !placeholder || !placeholderText) {
      throw new Error("Expected selectable custom emoji hit area");
    }

    expect(emoji.className).toContain("customEmojiInline");
    expect(placeholder.style.position).toBe("absolute");
    expect(placeholder.style.pointerEvents).toBe("auto");
    expect(placeholder.style.width).toBe("100%");

    const range = document.createRange();
    range.setStart(placeholderText, 0);
    range.setEnd(placeholderText, 1);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(emoji.className).toContain("customEmojiSelected");
    });
  });

  it("visually marks a directly selected large custom emoji", async () => {
    const firstEmoji = getTestEmoji();

    const message: Message = {
      ...baseMessage,
      content: firstEmoji.token,
    };

    const { container } = render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    const emoji = container.querySelector(
      `[data-custom-emoji-id="${firstEmoji.id}"]`,
    );
    const placeholderText = emoji?.querySelector(
      "[data-custom-emoji-copy-placeholder]",
    )?.firstChild;
    if (!emoji || !placeholderText) {
      throw new Error("Expected selectable large custom emoji hit area");
    }

    expect(emoji.className).toContain("customEmojiLarge");

    const range = document.createRange();
    range.setStart(placeholderText, 0);
    range.setEnd(placeholderText, 1);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(emoji.className).toContain("customEmojiSelected");
    });
  });

  it("renders multiple custom emoji in the compact variant", () => {
    const firstEmoji = getTestEmoji();
    const secondEmoji = getTestEmoji(1);

    const message: Message = {
      ...baseMessage,
      content: `${firstEmoji.token}${secondEmoji.token}`,
    };

    const { container } = render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    const emojis = container.querySelectorAll("[data-custom-emoji-token]");
    const content = container.querySelector("p");

    expect(emojis).toHaveLength(2);
    emojis.forEach((emoji) => {
      expect(emoji.className).toContain("customEmojiInline");
    });
    expect(content?.className).not.toContain("customEmojiOnlyContent");
  });

  it("renders custom emoji reactions as Animated reaction glyphs", () => {
    const firstEmoji = getTestEmoji();

    const message: Message = {
      ...baseMessage,
      reactions: [{ emoji: firstEmoji.token, count: 2, me: true }],
    };

    const { container } = render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
        onReact={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: `${firstEmoji.label} 2` }),
    ).toBeInTheDocument();
    const emojiNode = container.querySelector(
      `[data-custom-emoji-id="${firstEmoji.id}"]`,
    );
    const copyFallback = emojiNode?.querySelector(
      "[data-custom-emoji-copy-placeholder]",
    );

    expect(emojiNode).toBeTruthy();
    expect(copyFallback).toHaveTextContent(firstEmoji.token);
  });

  it("adds a custom emoji reaction from the reaction picker", async () => {
    const restoreDesktopInputModel = installDesktopInputModel();

    try {
      const onReact = vi.fn();
      const { container } = render(
        <MessageBubble
          message={baseMessage}
          isOwn={false}
          onlineUsernames={new Set<string>()}
          onReply={vi.fn()}
          onReact={onReact}
        />,
      );

      const article = container.querySelector(
        'article[data-message-id="1"]',
      ) as HTMLElement;

      fireEvent.contextMenu(article);
      fireEvent.click(screen.getByText("Реакция"));
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Pick custom emoji reaction",
        }),
      );

      await waitFor(() => {
        expect(onReact).toHaveBeenCalledWith(
          baseMessage.id,
          mockPickerEmoji.token,
        );
      });
    } finally {
      restoreDesktopInputModel();
    }
  });

  it("splits more than ten image attachments into consecutive media grids preserving order", () => {
    const message: Message = {
      ...baseMessage,
      attachments: [
        createImageAttachment(1, "01.png"),
        createImageAttachment(2, "02.png"),
        createImageAttachment(3, "03.png"),
        createImageAttachment(4, "04.png"),
        createImageAttachment(5, "05.png"),
        createImageAttachment(6, "06.png"),
        createImageAttachment(7, "07.png"),
        createImageAttachment(8, "08.png"),
        createImageAttachment(9, "09.png"),
        createImageAttachment(10, "10.png"),
        createImageAttachment(11, "11.png"),
        createImageAttachment(12, "12.png"),
      ],
    };

    render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    const grids = screen.getAllByTestId("message-media-grid");
    expect(grids).toHaveLength(2);
    expect(grids[0]).toHaveAttribute(
      "data-count",
      String(DEFAULT_RUNTIME_CONFIG.chatAttachmentMaxPerMessage),
    );
    expect(grids[1]).toHaveAttribute("data-count", "2");
    expect(screen.queryByText(/\+\d+/)).not.toBeInTheDocument();

    const renderedAltOrder = grids
      .flatMap((grid) => within(grid).getAllByRole("img"))
      .map((image) => image.getAttribute("alt"));
    expect(renderedAltOrder).toEqual([
      "01.png",
      "02.png",
      "03.png",
      "04.png",
      "05.png",
      "06.png",
      "07.png",
      "08.png",
      "09.png",
      "10.png",
      "11.png",
      "12.png",
    ]);
  });

  it("renders image grid and other attachments in separate sections", () => {
    const message: Message = {
      ...baseMessage,
      attachments: [
        createImageAttachment(30, "pic-a.png"),
        createImageAttachment(31, "pic-b.png"),
        {
          id: 32,
          originalFilename: "voice.mp3",
          contentType: "audio/mpeg",
          fileSize: 1024,
          url: "/media/voice.mp3",
          thumbnailUrl: null,
          width: null,
          height: null,
        },
        {
          id: 33,
          originalFilename: "report.pdf",
          contentType: "application/pdf",
          fileSize: 4096,
          url: "/media/report.pdf",
          thumbnailUrl: null,
          width: null,
          height: null,
        },
      ],
    };

    render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    expect(screen.getByTestId("message-media-grid")).toBeInTheDocument();
    expect(screen.getByTestId("audio-attachment-player")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /report\.pdf/i }),
    ).toBeInTheDocument();
  });

  it("opens image preview modal with metadata", async () => {
    const message: Message = {
      ...baseMessage,
      attachments: [createImageAttachment(90, "preview.png")],
    };

    render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Открыть изображение preview\.png/i }),
    );

    expect(
      screen.getByRole("dialog", { name: "Просмотр изображения" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("preview.png")).toBeInTheDocument();
    expect(await screen.findByText(/1\.0 KB/i)).toBeInTheDocument();
    expect(await screen.findByText(/1280\s*×\s*720/i)).toBeInTheDocument();
  });

  it("opens video preview modal with metadata", async () => {
    const message: Message = {
      ...baseMessage,
      attachments: [
        {
          id: 91,
          originalFilename: "video.mp4",
          contentType: "video/mp4",
          fileSize: 5 * 1024 * 1024,
          url: "/media/video.mp4",
          thumbnailUrl: null,
          width: 1920,
          height: 1080,
        },
      ],
    };

    render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Открыть видео video\.mp4/i }),
    );

    expect(
      screen.getByRole("dialog", { name: "Просмотр видео" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("video.mp4")).toBeInTheDocument();
    expect(await screen.findByText(/5\.0 MB/i)).toBeInTheDocument();
    expect(await screen.findByText(/1920\s*×\s*1080/i)).toBeInTheDocument();
  });

  it.skip("renders inline video preview with duration badge for video attachments", () => {
    const message: Message = {
      ...baseMessage,
      attachments: [
        {
          id: 191,
          originalFilename: "video.mp4",
          contentType: "video/mp4",
          fileSize: 5 * 1024 * 1024,
          url: "/media/video.mp4",
          thumbnailUrl: "/media/video-thumb.jpg",
          width: 1920,
          height: 1080,
        },
      ],
    };

    const { container } = render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Открыть видео video\.mp4/i }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        'button[aria-label="Открыть видео video.mp4"] img',
      )?.tagName,
    ).toBe("VIDEO");
  });

  it("renders working inline video preview with a bottom-right duration badge", () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    const message: Message = {
      ...baseMessage,
      attachments: [
        {
          id: 291,
          originalFilename: "preview-video.mp4",
          contentType: "video/mp4",
          fileSize: 5 * 1024 * 1024,
          url: "/media/preview-video.mp4",
          thumbnailUrl: "/media/preview-video-thumb.jpg",
          width: 1920,
          height: 1080,
        },
      ],
    };

    const { container } = render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    const previewButton = screen.getByRole("button", {
      name: /preview-video\.mp4/i,
    });
    const previewVideo = container.querySelector(
      'button[aria-label="Открыть видео preview-video.mp4"] video',
    ) as HTMLVideoElement | null;

    expect(previewButton).toBeInTheDocument();
    expect(previewVideo?.tagName).toBe("VIDEO");
    expect(previewVideo?.muted).toBe(true);

    if (!previewVideo) {
      throw new Error("Expected inline video preview");
    }

    Object.defineProperty(previewVideo, "duration", {
      configurable: true,
      get: () => 95,
    });
    fireEvent.loadedMetadata(previewVideo);

    expect(screen.getByText("01:35")).toBeInTheDocument();
  });

  it("treats known video extensions as video preview even with generic content type", async () => {
    const message: Message = {
      ...baseMessage,
      attachments: [
        {
          id: 92,
          originalFilename: "clip.mkv",
          contentType: "application/octet-stream",
          fileSize: 1024 * 1024,
          url: "/media/clip.mkv",
          thumbnailUrl: null,
          width: null,
          height: null,
        },
      ],
    };

    render(
      <MessageBubble
        message={message}
        isOwn={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Открыть видео clip\.mkv/i }),
    );

    expect(
      screen.getByRole("dialog", { name: "Просмотр видео" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("clip.mkv")).toBeInTheDocument();
  });

  it("opens full own-message action menu on touch release", () => {
    const restoreMatchMedia = installTouchMatchMedia();
    try {
      const onReply = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn();
      const onReact = vi.fn();

      const { container } = render(
        <MessageBubble
          message={baseMessage}
          isOwn={true}
          onlineUsernames={new Set<string>()}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onReact={onReact}
        />,
      );

      const article = container.querySelector(
        'article[data-message-id="1"]',
      ) as HTMLElement;

      fireTouchPointerEvent(article, "pointerdown", {
        pointerId: 1,
        clientX: 120,
        clientY: 160,
      });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      fireTouchPointerEvent(article, "pointerup", {
        pointerId: 1,
        clientX: 120,
        clientY: 160,
      });

      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    } finally {
      restoreMatchMedia();
    }
  });

  it("cancels touch action menu tap when the finger moves", () => {
    const restoreMatchMedia = installTouchMatchMedia();
    try {
      const { container } = render(
        <MessageBubble
          message={baseMessage}
          isOwn={true}
          onlineUsernames={new Set<string>()}
          onReply={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onReact={vi.fn()}
        />,
      );

      const article = container.querySelector(
        'article[data-message-id="1"]',
      ) as HTMLElement;

      fireTouchPointerEvent(article, "pointerdown", {
        pointerId: 1,
        clientX: 120,
        clientY: 160,
      });
      fireTouchPointerEvent(article, "pointermove", {
        pointerId: 1,
        clientX: 120,
        clientY: 178,
      });
      fireTouchPointerEvent(article, "pointerup", {
        pointerId: 1,
        clientX: 120,
        clientY: 178,
      });

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    } finally {
      restoreMatchMedia();
    }
  });

  it("opens context menu on right click for desktop", () => {
    const restoreDesktopInputModel = installDesktopInputModel();
    try {
      const { container } = render(
        <MessageBubble
          message={baseMessage}
          isOwn={true}
          onlineUsernames={new Set<string>()}
          onReply={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onReact={vi.fn()}
        />,
      );

      const article = container.querySelector(
        'article[data-message-id="1"]',
      ) as HTMLElement;

      fireEvent.contextMenu(article);
      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    } finally {
      restoreDesktopInputModel();
    }
  });

  it("shows edit and delete actions for non-own message when canModerate=true", () => {
    const restoreDesktopInputModel = installDesktopInputModel();
    try {
      const { container } = render(
        <MessageBubble
          message={baseMessage}
          isOwn={false}
          canModerate={true}
          onlineUsernames={new Set<string>()}
          onReply={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onReact={vi.fn()}
          onAvatarClick={vi.fn()}
        />,
      );

      const article = container.querySelector(
        'article[data-message-id="1"]',
      ) as HTMLElement;

      fireEvent.contextMenu(article);
      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(screen.getByText("Редактировать")).toBeInTheDocument();
      expect(screen.getByText("Удалить")).toBeInTheDocument();
    } finally {
      restoreDesktopInputModel();
    }
  });

  it("opens context menu from right mouse down fallback on desktop", () => {
    const restoreDesktopInputModel = installDesktopInputModel();
    try {
      const { container } = render(
        <MessageBubble
          message={baseMessage}
          isOwn={true}
          onlineUsernames={new Set<string>()}
          onReply={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onReact={vi.fn()}
        />,
      );

      const article = container.querySelector(
        'article[data-message-id="1"]',
      ) as HTMLElement;

      fireEvent.mouseDown(article, { button: 2, clientX: 120, clientY: 160 });
      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    } finally {
      restoreDesktopInputModel();
    }
  });

  it("does not open context menu on normal left click for desktop", () => {
    const restoreDesktopInputModel = installDesktopInputModel();
    try {
      const { container } = render(
        <MessageBubble
          message={baseMessage}
          isOwn={true}
          onlineUsernames={new Set<string>()}
          onReply={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onReact={vi.fn()}
        />,
      );

      const article = container.querySelector(
        'article[data-message-id="1"]',
      ) as HTMLElement;

      fireEvent.click(article);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    } finally {
      restoreDesktopInputModel();
    }
  });

  it("does not render inline action buttons", () => {
    render(
      <MessageBubble
        message={baseMessage}
        isOwn={true}
        onlineUsernames={new Set<string>()}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onReact={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Like" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Редактировать" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Удалить" }),
    ).not.toBeInTheDocument();
  });

  it("opens media on media tap and actions on nearby message tap", () => {
    const restoreMatchMedia = installTouchMatchMedia();
    try {
      const onOpenMediaAttachment = vi.fn();
      const message: Message = {
        ...baseMessage,
        attachments: [
          {
            id: 22,
            originalFilename: "photo.jpg",
            contentType: "image/jpeg",
            fileSize: 2048,
            url: "/media/photo.jpg",
            thumbnailUrl: "/media/photo-thumb.jpg",
            width: 1280,
            height: 720,
          },
        ],
      };

      render(
        <MessageBubble
          message={message}
          isOwn={true}
          onlineUsernames={new Set<string>()}
          onReply={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onReact={vi.fn()}
          onOpenMediaAttachment={onOpenMediaAttachment}
        />,
      );

      const mediaButton = screen.getByRole("button", {
        name: "Открыть изображение photo.jpg",
      });
      fireTouchPointerEvent(mediaButton, "pointerdown", {
        pointerId: 1,
        clientX: 120,
        clientY: 160,
      });
      fireTouchPointerEvent(mediaButton, "pointerup", {
        pointerId: 1,
        clientX: 120,
        clientY: 160,
      });
      fireEvent.click(mediaButton);

      expect(onOpenMediaAttachment).toHaveBeenCalledWith(22);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();

      const article = document.querySelector(
        'article[data-message-id="1"]',
      ) as HTMLElement;
      fireTouchPointerEvent(article, "pointerdown", {
        pointerId: 2,
        clientX: 96,
        clientY: 152,
      });
      fireTouchPointerEvent(article, "pointerup", {
        pointerId: 2,
        clientX: 96,
        clientY: 152,
      });

      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Скачать" })).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "Скопировать картинку" }),
      ).toBeInTheDocument();
    } finally {
      restoreMatchMedia();
    }
  });

  it("renders read marker state for own messages", () => {
    const { rerender } = render(
      <MessageBubble
        message={baseMessage}
        isOwn={true}
        isRead={false}
        onlineUsernames={new Set<string>()}
      />,
    );

    expect(screen.getByTestId("message-read-marker")).toHaveAttribute(
      "data-read",
      "false",
    );

    rerender(
      <MessageBubble
        message={baseMessage}
        isOwn={true}
        isRead={true}
        onlineUsernames={new Set<string>()}
      />,
    );

    expect(screen.getByTestId("message-read-marker")).toHaveAttribute(
      "data-read",
      "true",
    );
  });

  it("shows readers action only when canViewReaders is enabled", () => {
    const restoreDesktopInputModel = installDesktopInputModel();
    try {
      const onViewReaders = vi.fn();
      const { container, rerender } = render(
        <MessageBubble
          message={baseMessage}
          isOwn={true}
          canViewReaders={true}
          onViewReaders={onViewReaders}
          onlineUsernames={new Set<string>()}
          onReply={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onReact={vi.fn()}
        />,
      );

      const article = container.querySelector(
        'article[data-message-id="1"]',
      ) as HTMLElement;

      fireEvent.contextMenu(article);
      fireEvent.click(screen.getByText("Кто прочитал"));
      expect(onViewReaders).toHaveBeenCalledWith(
        baseMessage,
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      );

      rerender(
        <MessageBubble
          message={baseMessage}
          isOwn={true}
          canViewReaders={false}
          onlineUsernames={new Set<string>()}
          onReply={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onReact={vi.fn()}
        />,
      );

      fireEvent.contextMenu(article);
      expect(screen.queryByText("Кто прочитал")).toBeNull();
    } finally {
      restoreDesktopInputModel();
    }
  });

  it("hides avatar and header for grouped follow-up message", () => {
    const { container } = render(
      <MessageBubble
        message={baseMessage}
        isOwn={false}
        showAvatar={false}
        showHeader={false}
        grouped={true}
        onlineUsernames={new Set<string>()}
      />,
    );

    expect(
      container.querySelector('article[data-message-grouped="true"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('article[data-message-avatar="false"]'),
    ).not.toBeNull();
    expect(screen.queryByText("alice")).toBeNull();
  });
});
