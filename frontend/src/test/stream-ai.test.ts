import { afterEach, describe, expect, it, vi } from "vitest";

import { streamAI } from "../services/api";

describe("streamAI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes aborted requests to onCancelled instead of onDone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const onCancelled = vi.fn();

    await streamAI("/stream", {}, onChunk, onDone, onError, onCancelled);

    expect(onCancelled).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onChunk).not.toHaveBeenCalled();
  });
});
