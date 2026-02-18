import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";

export const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  /**
   * Выполняет метод `cleanup`.
   * @returns Результат выполнения `cleanup`.
   */

  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

vi.stubGlobal("scrollTo", vi.fn());
