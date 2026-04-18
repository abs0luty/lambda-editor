import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  history: vi.fn(),
  updateReviewState: vi.fn(),
  agent: vi.fn(),
  post: vi.fn(),
  streamAI: vi.fn(),
}));

vi.mock("../services/api", () => ({
  default: {
    post: apiMocks.post,
  },
  aiChatApi: {
    history: apiMocks.history,
    updateReviewState: apiMocks.updateReviewState,
    agent: apiMocks.agent,
  },
  streamAI: apiMocks.streamAI,
}));

import AIChat from "../components/AIChat";
import { useStore } from "../store/useStore";

const initialState = useStore.getState();

const user = {
  id: "user-1",
  email: "ada@example.com",
  username: "ada",
};

function resetStore() {
  useStore.setState(
    {
      ...initialState,
      user,
      token: "session",
      authReady: true,
      currentDoc: {
        id: "doc-1",
        title: "main.tex",
        path: "main.tex",
        kind: "latex",
        content: "\\section{Introduction}\nHello world",
        owner_id: user.id,
        project_id: "proj-1",
      },
    },
    true,
  );
}

describe("AIChat cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    localStorage.clear();
    localStorage.setItem("ai-disclosure-accepted:v2", "true");
    apiMocks.history.mockResolvedValue({ data: [] });
    apiMocks.updateReviewState.mockResolvedValue({ data: { ok: true } });
    apiMocks.agent.mockResolvedValue({ data: { content: "", status: "completed" } });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  it("cancels in-flight diff requests from the stop button", async () => {
    let capturedSignal: AbortSignal | undefined;

    apiMocks.post.mockImplementation(
      (_url: string, _body: unknown, config?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          capturedSignal = config?.signal;
          capturedSignal?.addEventListener(
            "abort",
            () => reject({ name: "CanceledError", code: "ERR_CANCELED", message: "canceled" }),
            { once: true },
          );
        }),
    );

    render(<AIChat socket={null} readOnly={false} currentDocTitle="main.tex" />);

    await waitFor(() => {
      expect(apiMocks.history).toHaveBeenCalledWith("proj-1", "doc-1");
    });

    fireEvent.click(screen.getByRole("button", { name: /ai edit/i }));
    const textarea = screen.getByPlaceholderText(/what to improve/i);
    fireEvent.change(textarea, { target: { value: "Tighten the introduction" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(apiMocks.post).toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
    });

    expect(await screen.findAllByText("Cancelled by user")).not.toHaveLength(0);
    expect(screen.getByText("cancelled")).toBeInTheDocument();
  });
});
