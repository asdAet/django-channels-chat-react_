import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("../pages/HomePage", () => ({
  HomePage: () => <div>HOME_PAGE</div>,
}));

vi.mock("../pages/LoginPage", () => ({
  LoginPage: () => <div>LOGIN_PAGE</div>,
}));

vi.mock("../pages/RegisterPage", () => ({
  RegisterPage: () => <div>REGISTER_PAGE</div>,
}));

vi.mock("../pages/ProfilePage", () => ({
  ProfilePage: () => <div>PROFILE_PAGE</div>,
}));

vi.mock("../pages/DirectChatsPage", () => ({
  DirectChatsPage: () => <div>DIRECT_CHATS_PAGE</div>,
}));

vi.mock("../pages/DirectChatByUsernamePage", () => ({
  DirectChatByUsernamePage: ({ publicRef }: { publicRef: string }) => (
    <div>DIRECT_BY_REF_PAGE:{publicRef}</div>
  ),
}));

vi.mock("../pages/UserProfilePage", () => ({
  UserProfilePage: ({ username }: { username: string }) => (
    <div>USER_PAGE:{username}</div>
  ),
}));

vi.mock("../pages/ChatRoomPage", () => ({
  ChatRoomPage: ({ slug }: { slug: string }) => <div>ROOM_PAGE:{slug}</div>,
}));

import { AppRoutes } from "./routes";

const handlers = {
  onNavigate: vi.fn(),
  onLogin: vi.fn(async () => {}),
  onGoogleOAuth: vi.fn(async () => {}),
  onRegister: vi.fn(async () => {}),
  onLogout: vi.fn(async () => {}),
  onProfileSave: vi.fn(async () => ({ ok: true as const })),
};

describe("AppRoutes", () => {
  it("renders login route", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <AppRoutes
          user={null}
          error={null}
          passwordRules={[]}
          googleAuthDisabledReason={null}
          {...handlers}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("LOGIN_PAGE")).toBeInTheDocument();
  });

  it("renders register route", () => {
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AppRoutes
          user={null}
          error={null}
          passwordRules={[]}
          googleAuthDisabledReason={null}
          {...handlers}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("REGISTER_PAGE")).toBeInTheDocument();
  });

  it("renders direct by ref route", () => {
    render(
      <MemoryRouter initialEntries={["/direct/alice"]}>
        <AppRoutes
          user={null}
          error={null}
          passwordRules={[]}
          googleAuthDisabledReason={null}
          {...handlers}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("DIRECT_BY_REF_PAGE:alice")).toBeInTheDocument();
  });

  it("treats legacy /@username route as invalid and redirects to home", () => {
    render(
      <MemoryRouter initialEntries={["/@alice"]}>
        <AppRoutes
          user={null}
          error={null}
          passwordRules={[]}
          googleAuthDisabledReason={null}
          {...handlers}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("HOME_PAGE")).toBeInTheDocument();
  });

  it("renders room route for valid slug", () => {
    render(
      <MemoryRouter initialEntries={["/rooms/public"]}>
        <AppRoutes
          user={null}
          error={null}
          passwordRules={[]}
          googleAuthDisabledReason={null}
          {...handlers}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("ROOM_PAGE:public")).toBeInTheDocument();
  });

  it("normalizes ref route by trimming only one leading @", () => {
    render(
      <MemoryRouter initialEntries={["/users/%40%40%40%40"]}>
        <AppRoutes
          user={null}
          error={null}
          passwordRules={[]}
          googleAuthDisabledReason={null}
          {...handlers}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("USER_PAGE:@@@")).toBeInTheDocument();
  });

  it("redirects invalid room slug to home", () => {
    render(
      <MemoryRouter initialEntries={["/rooms/a"]}>
        <AppRoutes
          user={null}
          error={null}
          passwordRules={[]}
          googleAuthDisabledReason={null}
          {...handlers}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("HOME_PAGE")).toBeInTheDocument();
  });
});
