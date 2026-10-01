import { createPluginStateKeyedStoreForTests } from "openclaw/plugin-sdk/plugin-state-test-runtime";
import { createPluginRuntimeMock } from "openclaw/plugin-sdk/plugin-test-runtime";
import { closeOpenClawStateDatabaseAsync } from "openclaw/plugin-sdk/sqlite-runtime-testing";
import { withOpenClawTestState } from "openclaw/plugin-sdk/test-state";
import { expect, it, vi } from "vitest";
import { createImapState, initializeImapCursor } from "./state.js";

it("resets an obsolete out-of-range cursor from production persisted state", async () => {
  await withOpenClawTestState({ label: "imap-cursor-upgrade" }, async (testState) => {
    const runtime = createPluginRuntimeMock({
      state: {
        openKeyedStore: (options) =>
          createPluginStateKeyedStoreForTests("imap", { ...options, env: testState.env }),
      },
    });
    const openState = () => createImapState(runtime);
    // The previous initializer could persist this finite value from a
    // ten-digit UIDNEXT accepted by ImapFlow 2.0.5.
    const obsolete = { uidValidity: "1", lastSeenUid: Math.max(0, 4294967297 - 1), updatedAt: 123 };
    await openState().cursors.register("account", obsolete);
    await closeOpenClawStateDatabaseAsync();

    const reopened = openState();
    expect(await reopened.cursors.lookup("account")).toEqual(obsolete);
    const resolveBaseline = vi.fn(async () => 9007);
    await expect(
      initializeImapCursor(reopened, "account", "1", resolveBaseline, () => true),
    ).rejects.toThrow(/cursor UID/);
    expect(resolveBaseline).not.toHaveBeenCalled();
    const reset = await initializeImapCursor(reopened, "account", "2", resolveBaseline, () => true);
    expect(reset).toMatchObject({
      kind: "reset",
      cursor: { uidValidity: "2", lastSeenUid: 9007 },
    });
    expect(resolveBaseline).toHaveBeenCalledTimes(1);
    await closeOpenClawStateDatabaseAsync();

    const restored = openState();
    expect(await restored.cursors.lookup("account")).toEqual(reset?.cursor);
    expect(
      await initializeImapCursor(restored, "account", "2", resolveBaseline, () => true),
    ).toEqual({ kind: "resume", cursor: reset?.cursor });
    expect(resolveBaseline).toHaveBeenCalledTimes(1);
  });
});
