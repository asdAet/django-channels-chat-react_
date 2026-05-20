import { type RefObject, useLayoutEffect, useRef } from "react";

type BooleanRef = {
  current: boolean;
};

type UseChatViewportAnchorOptions = {
  listRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  isAtBottomRef: BooleanRef;
  beginProgrammaticScroll: () => void;
  endProgrammaticScroll: (onDone?: () => void, delayMs?: number) => void;
  scheduleViewportReadSync: () => void;
  shouldSuspend?: () => boolean;
  bottomThresholdPx?: number;
};

type ViewportAnchor = {
  messageId: string;
  viewportBottom: number;
};

type ViewportSnapshot = {
  anchor: ViewportAnchor | null;
  atBottom: boolean;
  scrollHeight: number;
};

type ViewportAnchorController = {
  restoreAfterLayoutChange: () => void;
};

const DEFAULT_BOTTOM_THRESHOLD_PX = 80;
const PROGRAMMATIC_ANCHOR_SCROLL_DELAY_MS = 80;
const MESSAGE_SELECTOR = "article[data-message-id]";

const getBottomDistance = (
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
): number => scrollHeight - scrollTop - clientHeight;

const readFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const getViewportBounds = (list: HTMLDivElement) => {
  const rect = list.getBoundingClientRect();
  const top = readFiniteNumber(rect.top, Number.NEGATIVE_INFINITY);
  const bottom = readFiniteNumber(rect.bottom, top + list.clientHeight);
  return { top, bottom };
};

const isMessageVisible = (
  node: HTMLElement,
  viewportTop: number,
  viewportBottom: number,
): boolean => {
  const rect = node.getBoundingClientRect();
  const top = readFiniteNumber(rect.top, Number.NEGATIVE_INFINITY);
  const bottom = readFiniteNumber(rect.bottom, Number.POSITIVE_INFINITY);
  return bottom > viewportTop && top < viewportBottom;
};

const findLowerVisibleMessageAnchor = (
  list: HTMLDivElement,
): ViewportAnchor | null => {
  const viewport = getViewportBounds(list);
  let anchor: ViewportAnchor | null = null;

  list.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR).forEach((node) => {
    if (!isMessageVisible(node, viewport.top, viewport.bottom)) {
      return;
    }

    const messageId = node.dataset.messageId;
    if (!messageId) {
      return;
    }

    const rect = node.getBoundingClientRect();
    anchor = {
      messageId,
      viewportBottom: readFiniteNumber(rect.bottom, viewport.bottom),
    };
  });

  return anchor;
};

const findMessageAnchorNode = (
  list: HTMLDivElement,
  anchor: ViewportAnchor,
): HTMLElement | null =>
  Array.from(list.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)).find(
    (node) => node.dataset.messageId === anchor.messageId,
  ) ?? null;

export function useChatViewportAnchor({
  listRef,
  enabled,
  isAtBottomRef,
  beginProgrammaticScroll,
  endProgrammaticScroll,
  scheduleViewportReadSync,
  shouldSuspend,
  bottomThresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX,
}: UseChatViewportAnchorOptions): void {
  const snapshotRef = useRef<ViewportSnapshot | null>(null);
  const controllerRef = useRef<ViewportAnchorController | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      snapshotRef.current = null;
      controllerRef.current = null;
      return undefined;
    }

    const list = listRef.current;
    if (!list) {
      snapshotRef.current = null;
      controllerRef.current = null;
      return undefined;
    }

    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    const observedChildren = new Set<Element>();

    const captureSnapshot = (): ViewportSnapshot => {
      const atBottom =
        getBottomDistance(
          list.scrollHeight,
          list.scrollTop,
          list.clientHeight,
        ) <= bottomThresholdPx;
      isAtBottomRef.current = atBottom;

      return {
        anchor: findLowerVisibleMessageAnchor(list),
        atBottom,
        scrollHeight: list.scrollHeight,
      };
    };

    const syncObservedChildren = () => {
      if (!resizeObserver) {
        return;
      }

      const nextChildren = new Set<Element>(Array.from(list.children));
      observedChildren.forEach((child) => {
        if (!nextChildren.has(child)) {
          resizeObserver?.unobserve(child);
          observedChildren.delete(child);
        }
      });

      nextChildren.forEach((child) => {
        if (observedChildren.has(child)) {
          return;
        }

        resizeObserver?.observe(child);
        observedChildren.add(child);
      });
    };

    const updateAtBottomState = () => {
      isAtBottomRef.current =
        getBottomDistance(
          list.scrollHeight,
          list.scrollTop,
          list.clientHeight,
        ) <= bottomThresholdPx;
    };

    const applyScrollDelta = (scrollDelta: number) => {
      if (scrollDelta === 0) {
        updateAtBottomState();
        return;
      }

      beginProgrammaticScroll();
      list.scrollTop = Math.max(0, list.scrollTop + scrollDelta);
      updateAtBottomState();
      endProgrammaticScroll(() => {
        scheduleViewportReadSync();
      }, PROGRAMMATIC_ANCHOR_SCROLL_DELAY_MS);
    };

    const restoreAfterLayoutChange = () => {
      syncObservedChildren();

      const snapshot = snapshotRef.current;
      if (!snapshot || shouldSuspend?.()) {
        snapshotRef.current = captureSnapshot();
        return;
      }

      if (snapshot.atBottom) {
        applyScrollDelta(list.scrollHeight - snapshot.scrollHeight);
        snapshotRef.current = captureSnapshot();
        return;
      }

      const anchor = snapshot.anchor;
      if (anchor) {
        const anchorNode = findMessageAnchorNode(list, anchor);
        if (!anchorNode) {
          updateAtBottomState();
          snapshotRef.current = captureSnapshot();
          return;
        }

        const nextBottom = readFiniteNumber(
          anchorNode.getBoundingClientRect().bottom,
          anchor.viewportBottom,
        );
        applyScrollDelta(nextBottom - anchor.viewportBottom);
      } else {
        updateAtBottomState();
      }

      snapshotRef.current = captureSnapshot();
    };

    const captureStableSnapshot = () => {
      snapshotRef.current = captureSnapshot();
    };

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        if (entries.some((entry) => entry.target !== list)) {
          restoreAfterLayoutChange();
        }
      });
      resizeObserver.observe(list);
      syncObservedChildren();
    }

    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(() => {
        syncObservedChildren();
        restoreAfterLayoutChange();
      });
      mutationObserver.observe(list, { childList: true });
    }

    snapshotRef.current = captureSnapshot();
    controllerRef.current = { restoreAfterLayoutChange };
    list.addEventListener("scroll", captureStableSnapshot, {
      passive: true,
    });

    return () => {
      list.removeEventListener("scroll", captureStableSnapshot);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      observedChildren.clear();
      snapshotRef.current = null;
      controllerRef.current = null;
    };
  }, [
    beginProgrammaticScroll,
    bottomThresholdPx,
    enabled,
    endProgrammaticScroll,
    isAtBottomRef,
    listRef,
    scheduleViewportReadSync,
    shouldSuspend,
  ]);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    controllerRef.current?.restoreAfterLayoutChange();
  });
}
