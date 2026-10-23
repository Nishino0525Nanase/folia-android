import { afterEach, expect, it, vi } from 'vitest';
import { withOnlineRequestLimit, OnlineRequestTimeout } from '@/services/onlineMusic/failure/onlineRequestLimit';

// Cancelling playback must release timers even when a transport never settles.
afterEach(() => vi.useRealTimers());
it('aborts in-flight work and clears the timeout immediately', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    let signal!: AbortSignal;
    const pending = withOnlineRequestLimit(s => { signal = s; return new Promise(() => {}); }, 35000, parent.signal);
    parent.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
});
it('does not start an already cancelled request', async () => {
    const parent = new AbortController(); parent.abort();
    const run = vi.fn();
    await expect(withOnlineRequestLimit(run, 1000, parent.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(run).not.toHaveBeenCalled();
});
it('keeps timeout diagnostics distinct from user cancellation', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const pending = withOnlineRequestLimit(s => { signal = s; return new Promise(() => {}); }, 1000);
    const check = expect(pending).rejects.toBeInstanceOf(OnlineRequestTimeout);
    await vi.advanceTimersByTimeAsync(1000);
    await check;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
});
